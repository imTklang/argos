import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job, Preferences, Profile } from "@radar/core";
import { createDb, jobScores, jobs, profiles, runs } from "@radar/db";
import { describe, expect, it, vi } from "vitest";
import { buildServer, CLIENT_HEADER } from "./server.ts";

const CLIENT = { [CLIENT_HEADER]: "dashboard" };

const prefs: Preferences = {
	roles: ["estágio backend"],
	keywordsMust: ["estágio"],
	keywordsBonus: ["node.js"],
	keywordsBlock: [],
	modality: ["remoto"],
	locations: ["João Pessoa"],
	minScoreToNotify: 70,
};

const profile: Profile = {
	name: "Ana Souza",
	course: "Ciência da Computação",
	institution: "UFPB",
	currentPeriod: 4,
	expectedGraduation: "",
	skills: [],
	languages: [],
	projects: [],
	experience: [],
};

type Seed = Partial<Job> & { score?: number | null; duplicateOf?: number };

async function setup(seed: Seed[] = []) {
	const db = createDb(":memory:");
	const dir = await mkdtemp(join(tmpdir(), "radar-api-"));
	const preferencesPath = join(dir, "preferences.json");
	await writeFile(preferencesPath, JSON.stringify(prefs));
	const ids: number[] = [];
	for (const [i, { score = 80, duplicateOf, ...job }] of seed.entries()) {
		const { id } = db
			.insert(jobs)
			.values({
				source: "gupy",
				externalId: String(i),
				title: `Estágio ${i}`,
				company: "Acme",
				location: "João Pessoa",
				modality: "remoto",
				description: `Descrição ${i}`,
				url: `https://example.com/${i}`,
				publishedAt: null,
				expiresAt: null,
				hash: `h${i}`,
				duplicateOf: duplicateOf ?? null,
				...job,
			})
			.returning({ id: jobs.id })
			.get();
		ids.push(id);
		if (duplicateOf === undefined) {
			db.insert(jobScores)
				.values({
					jobId: id,
					score,
					analysis:
						score === null
							? null
							: {
									score,
									matchedSkills: ["Node.js"],
									missingSkills: [],
									dealBreakers: [],
									summary: `resumo ${i}`,
								},
					model: "claude-haiku-5-5",
				})
				.run();
		}
	}
	const generateCoverLetter = vi.fn().mockResolvedValue({
		text: "Olá, time da Acme",
		model: "claude-sonnet-5-5",
		inputTokens: 1,
		outputTokens: 1,
	});
	const app = buildServer({ db, preferencesPath, generateCoverLetter });
	return { app, db, ids, preferencesPath, generateCoverLetter };
}

describe("GET /api/jobs", () => {
	it("lists scored originals best first, with duplicates as alsoOn", async () => {
		// The second job (id 2) has a copy on Himalayas.
		const { app } = await setup([
			{ score: 70 },
			{ score: 90 },
			{ score: null },
			{ source: "himalayas", url: "https://h/1", duplicateOf: 2 },
		]);

		const res = await app.inject({ url: "/api/jobs" });
		const body = res.json();

		expect(res.statusCode).toBe(200);
		expect(body.total).toBe(3);
		expect(body.items.map((j: { score: number | null }) => j.score)).toEqual([
			90,
			70,
			null,
		]);
		expect(body.items[0].alsoOn).toEqual([
			{ source: "himalayas", url: "https://h/1" },
		]);
		expect(body.items[0].status).toBe("nova");
	});

	it("filters by status, scope, minimum score and text", async () => {
		const { app, ids } = await setup([
			{ score: 90, abroad: true, title: "Backend Intern" },
			{ score: 80, company: "Beta" },
			{ score: 60 },
		]);
		await app.inject({
			method: "PATCH",
			headers: CLIENT,
			url: `/api/jobs/${ids[1]}/status`,
			payload: { status: "salva" },
		});

		const titles = async (qs: string) =>
			(await app.inject({ url: `/api/jobs?${qs}` }))
				.json()
				.items.map((j: { title: string }) => j.title);

		expect(await titles("scope=abroad")).toEqual(["Backend Intern"]);
		expect(await titles("scope=brazil&minScore=70")).toEqual(["Estágio 1"]);
		expect(await titles("status=salva")).toEqual(["Estágio 1"]);
		expect(await titles("status=nova,salva&minScore=85")).toEqual([
			"Backend Intern",
		]);
		expect(await titles("q=beta")).toEqual(["Estágio 1"]);
	});

	it("rejects invalid filters", async () => {
		const { app } = await setup();
		expect((await app.inject({ url: "/api/jobs?status=xyz" })).statusCode).toBe(
			400,
		);
		expect(
			(await app.inject({ url: "/api/jobs?minScore=200" })).statusCode,
		).toBe(400);
	});
});

describe("job detail and status", () => {
	it("returns the description and 404 for unknown jobs", async () => {
		const { app, ids } = await setup([{}]);
		const res = await app.inject({ url: `/api/jobs/${ids[0]}` });
		expect(res.json()).toMatchObject({
			description: "Descrição 0",
			coverLetter: null,
		});
		expect((await app.inject({ url: "/api/jobs/999" })).statusCode).toBe(404);
	});

	it("updates status and note, keeping the note when only status changes", async () => {
		const { app, ids } = await setup([{}]);
		const url = `/api/jobs/${ids[0]}/status`;
		await app.inject({
			method: "PATCH",
			headers: CLIENT,
			url,
			payload: { status: "candidatei", note: "Enviado em 28/10" },
		});
		const res = await app.inject({
			method: "PATCH",
			headers: CLIENT,
			url,
			payload: { status: "vista" },
		});
		expect(res.json()).toMatchObject({
			status: "vista",
			note: "Enviado em 28/10",
		});
		expect(
			(
				await app.inject({
					method: "PATCH",
					headers: CLIENT,
					url,
					payload: { status: "x" },
				})
			).statusCode,
		).toBe(400);
	});
});

describe("POST /api/jobs/:id/cover-letter", () => {
	it("generates once, stores it and returns the stored letter afterwards", async () => {
		const { app, db, ids, generateCoverLetter } = await setup([{}]);
		db.insert(profiles).values({ data: profile, resumeHash: "h" }).run();
		const url = `/api/jobs/${ids[0]}/cover-letter`;

		const first = await app.inject({ method: "POST", headers: CLIENT, url });
		const second = await app.inject({ method: "POST", headers: CLIENT, url });
		const again = await app.inject({
			method: "POST",
			headers: CLIENT,
			url,
			payload: { regenerate: true },
		});

		expect(first.json().text).toBe("Olá, time da Acme");
		expect(second.json().text).toBe("Olá, time da Acme");
		expect(again.statusCode).toBe(200);
		expect(generateCoverLetter).toHaveBeenCalledTimes(2);
		expect(generateCoverLetter.mock.calls[0]?.[0]).toMatchObject({
			profile: { name: "Ana Souza" },
			job: { title: "Estágio 0", description: "Descrição 0" },
		});
		expect(
			(await app.inject({ url: `/api/jobs/${ids[0]}` })).json().coverLetter
				.text,
		).toBe("Olá, time da Acme");
	});

	it("asks for a profile first", async () => {
		const { app, ids } = await setup([{}]);
		const res = await app.inject({
			method: "POST",
			headers: CLIENT,
			url: `/api/jobs/${ids[0]}/cover-letter`,
		});
		expect(res.statusCode).toBe(409);
	});
});

describe("preferences", () => {
	it("reads and writes the preferences file, validating it", async () => {
		const { app, preferencesPath } = await setup();
		expect(
			(await app.inject({ url: "/api/preferences" })).json().roles,
		).toEqual(["estágio backend"]);

		const updated = { ...prefs, minScoreToNotify: 75, abroad: "remote" };
		const res = await app.inject({
			method: "PUT",
			headers: CLIENT,
			url: "/api/preferences",
			payload: updated,
		});
		expect(res.statusCode).toBe(200);
		expect(JSON.parse(await readFile(preferencesPath, "utf8"))).toMatchObject({
			minScoreToNotify: 75,
			abroad: "remote",
		});

		const bad = await app.inject({
			method: "PUT",
			headers: CLIENT,
			url: "/api/preferences",
			payload: { ...prefs, minScoreToNotify: 300 },
		});
		expect(bad.statusCode).toBe(400);
	});
});

describe("GET /api/stats", () => {
	it("counts jobs by status and shows the last run per source", async () => {
		const { app, db, ids } = await setup([{}, {}, { duplicateOf: 1 }]);
		await app.inject({
			method: "PATCH",
			headers: CLIENT,
			url: `/api/jobs/${ids[0]}/status`,
			payload: { status: "salva" },
		});
		db.insert(runs)
			.values([
				{
					source: "gupy",
					startedAt: new Date("2026-10-27T11:00:00Z"),
					jobsFound: 1,
				},
				{
					source: "gupy",
					startedAt: new Date("2026-10-28T11:00:00Z"),
					jobsFound: 2,
				},
			])
			.run();

		const body = (await app.inject({ url: "/api/stats" })).json();

		expect(body.byStatus).toMatchObject({ nova: 1, salva: 1 });
		expect(body.lastRuns).toEqual([
			expect.objectContaining({ source: "gupy", jobsFound: 2 }),
		]);
	});
});

describe("access from outside the dashboard", () => {
	it("refuses a Host other than localhost (DNS rebinding)", async () => {
		const { app } = await setup([{}]);
		const res = await app.inject({
			url: "/api/jobs",
			headers: { host: "evil.example:3333" },
		});
		expect(res.statusCode).toBe(403);
		expect(
			(
				await app.inject({
					url: "/api/jobs",
					headers: { host: "127.0.0.1:3333" },
				})
			).statusCode,
		).toBe(200);
	});

	it("refuses writes without the dashboard header", async () => {
		const { app, ids, generateCoverLetter } = await setup([{}]);
		const res = await app.inject({
			method: "POST",
			url: `/api/jobs/${ids[0]}/cover-letter`,
		});
		expect(res.statusCode).toBe(403);
		expect(generateCoverLetter).not.toHaveBeenCalled();
		expect(
			(
				await app.inject({
					method: "PATCH",
					url: `/api/jobs/${ids[0]}/status`,
					payload: { status: "salva" },
				})
			).statusCode,
		).toBe(403);
	});
});
