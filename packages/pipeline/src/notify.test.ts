import type { JobScore, Preferences } from "@radar/core";
import { createDb, jobScores, jobStatus, jobs, notifications } from "@radar/db";
import { describe, expect, it, vi } from "vitest";
import {
	decide,
	type Messenger,
	type NotifiableJob,
	notify,
	pendingAlerts,
	pendingDigest,
} from "./notify.ts";

const prefs: Preferences = {
	roles: [],
	keywordsMust: [],
	keywordsBonus: [],
	keywordsBlock: [],
	modality: ["remoto"],
	locations: [],
	minScoreToNotify: 70,
};

function analysis(score: number): JobScore {
	return {
		score,
		matchedSkills: [],
		missingSkills: [],
		dealBreakers: [],
		summary: `nota ${score}`,
	};
}

/** Inserts a scored job and returns its id. */
function seed(
	db: ReturnType<typeof createDb>,
	n: number,
	score: number | null,
	abroad = false,
) {
	const { id } = db
		.insert(jobs)
		.values({
			source: "fake",
			externalId: String(n),
			title: `Estágio ${n}`,
			company: "Acme",
			location: null,
			modality: "remoto",
			description: "desc",
			url: `https://example.com/${n}`,
			publishedAt: null,
			expiresAt: null,
			hash: `h${n}`,
			abroad,
		})
		.returning({ id: jobs.id })
		.get();
	db.insert(jobScores)
		.values({
			jobId: id,
			score,
			analysis: score === null ? null : analysis(score),
			model: "claude-haiku-5-5",
		})
		.run();
	db.insert(jobStatus).values({ jobId: id }).run();
	return id;
}

function fakeMessenger() {
	const sent: { kind: string; items: NotifiableJob[] }[] = [];
	let n = 0;
	const messenger: Messenger = {
		channel: "fake",
		sendJob: vi.fn(async (item) => {
			sent.push({ kind: "job", items: [item] });
			return String(++n);
		}),
		sendDigest: vi.fn(async (items) => {
			sent.push({ kind: "digest", items });
			return String(++n);
		}),
		sendText: vi.fn(async () => String(++n)),
	};
	return { messenger, sent };
}

describe("pending notifications", () => {
	it("alerts only at or above the instant threshold, best first", () => {
		const db = createDb(":memory:");
		seed(db, 1, 86);
		seed(db, 2, 84);
		seed(db, 3, 95);
		expect(pendingAlerts(db, prefs).map((i) => i.score.score)).toEqual([
			95, 86,
		]);
	});

	it("honors a custom instant threshold", () => {
		const db = createDb(":memory:");
		seed(db, 1, 80);
		expect(pendingAlerts(db, { ...prefs, instantAlertScore: 75 })).toHaveLength(
			1,
		);
	});

	it("digests jobs above minScoreToNotify and skips unscored ones", () => {
		const db = createDb(":memory:");
		seed(db, 1, 72);
		seed(db, 2, 60);
		seed(db, 3, null);
		expect(pendingDigest(db, prefs).map((i) => i.job.title)).toEqual([
			"Estágio 1",
		]);
	});

	it("never alerts jobs abroad and lists them after Brazil in the digest", () => {
		const db = createDb(":memory:");
		seed(db, 1, 95, true);
		seed(db, 2, 72);
		seed(db, 3, 80, true);
		expect(pendingAlerts(db, prefs)).toHaveLength(0);
		expect(
			pendingDigest(db, prefs).map((i) => [i.score.score, i.job.abroad]),
		).toEqual([
			[72, false],
			[95, true],
			[80, true],
		]);
	});

	it("leaves out jobs the user already saved or discarded", () => {
		const db = createDb(":memory:");
		const id = seed(db, 1, 90);
		decide(db, id, "descartada");
		expect(pendingAlerts(db, prefs)).toHaveLength(0);
		expect(pendingDigest(db, prefs)).toHaveLength(0);
	});
});

describe("notify", () => {
	it("sends alerts and the digest once, never repeating a job", async () => {
		const db = createDb(":memory:");
		seed(db, 1, 90);
		seed(db, 2, 75);
		const { messenger, sent } = fakeMessenger();

		const first = await notify({ db, prefs, messenger, digest: true });
		const second = await notify({ db, prefs, messenger, digest: true });

		expect(first).toEqual({ alerts: 1, digest: 1 });
		expect(second).toEqual({ alerts: 0, digest: 0 });
		// The alerted job is not repeated in the digest.
		expect(sent[1]?.items.map((i) => i.job.title)).toEqual(["Estágio 2"]);
		expect(db.select().from(notifications).all()).toHaveLength(2);
	});

	it("holds the digest until a digest run", async () => {
		const db = createDb(":memory:");
		seed(db, 1, 75);
		const { messenger } = fakeMessenger();

		expect(await notify({ db, prefs, messenger, digest: false })).toEqual({
			alerts: 0,
			digest: 0,
		});
		expect(await notify({ db, prefs, messenger, digest: true })).toEqual({
			alerts: 0,
			digest: 1,
		});
	});

	it("keeps alerts already delivered when a later one fails", async () => {
		const db = createDb(":memory:");
		seed(db, 1, 95);
		seed(db, 2, 90);
		const { messenger } = fakeMessenger();
		vi.mocked(messenger.sendJob)
			.mockResolvedValueOnce("1")
			.mockRejectedValueOnce(new Error("telegram fora do ar"));

		await expect(
			notify({ db, prefs, messenger, digest: false }),
		).rejects.toThrow(/fora do ar/);

		expect(pendingAlerts(db, prefs).map((i) => i.score.score)).toEqual([90]);
	});
});

describe("decide", () => {
	it("stores the user's choice", () => {
		const db = createDb(":memory:");
		const id = seed(db, 1, 90);
		expect(decide(db, id, "salva")).toBe(true);
		expect(db.select().from(jobStatus).get()?.status).toBe("salva");
	});

	it("creates the status row when there is none", () => {
		const db = createDb(":memory:");
		const id = seed(db, 1, 90);
		db.delete(jobStatus).run();
		decide(db, id, "descartada");
		expect(db.select().from(jobStatus).get()?.status).toBe("descartada");
	});

	it("ignores unknown jobs", () => {
		const db = createDb(":memory:");
		expect(decide(db, 999, "salva")).toBe(false);
	});
});
