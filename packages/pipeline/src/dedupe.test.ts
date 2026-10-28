import type { Job } from "@radar/core";
import { createDb, jobs } from "@radar/db";
import type { JobSource } from "@radar/sources";
import { describe, expect, it, vi } from "vitest";
import { markDuplicates } from "./dedupe.ts";
import { runScan } from "./scan.ts";

function insert(
	db: ReturnType<typeof createDb>,
	n: number,
	patch: Partial<Job> = {},
) {
	return db
		.insert(jobs)
		.values({
			source: "gupy",
			externalId: String(n),
			title: "Estágio em Desenvolvimento de Software",
			company: "Instituto de Pesquisas ELDORADO",
			location: null,
			modality: "remoto",
			description: "Estágio com Node.js.",
			url: `https://example.com/${n}`,
			publishedAt: new Date(),
			expiresAt: null,
			hash: `h${n}`,
			...patch,
		})
		.returning({ id: jobs.id })
		.get().id;
}

function duplicateOf(db: ReturnType<typeof createDb>) {
	return Object.fromEntries(
		db
			.select({ id: jobs.id, duplicateOf: jobs.duplicateOf })
			.from(jobs)
			.all()
			.map((r) => [r.id, r.duplicateOf]),
	);
}

describe("markDuplicates", () => {
	it("links the same opening from another source to the first one seen", () => {
		const db = createDb(":memory:");
		const original = insert(db, 1);
		const copy = insert(db, 2, {
			source: "himalayas",
			company: "Vagas Instituto de Pesquisas Eldorado",
			location: "Remoto: Brazil",
		});
		const other = insert(db, 3, { company: "Outra Empresa" });

		expect(markDuplicates(db)).toBe(1);
		expect(duplicateOf(db)).toEqual({
			[original]: null,
			[copy]: original,
			[other]: null,
		});
	});

	it("points every repost at the original, not at the previous repost", () => {
		const db = createDb(":memory:");
		const original = insert(db, 1);
		const second = insert(db, 2);
		const third = insert(db, 3);

		markDuplicates(db);

		expect(duplicateOf(db)).toEqual({
			[original]: null,
			[second]: original,
			[third]: original,
		});
	});

	it("treats a repost of an expired or stale posting as a new opening", () => {
		const db = createDb(":memory:");
		const now = new Date("2026-10-28T12:00:00Z");
		const expired = insert(db, 1, {
			expiresAt: new Date("2026-10-01T00:00:00Z"),
		});
		const repost = insert(db, 2);
		const stale = insert(db, 3, {
			title: "Estágio Backend",
			publishedAt: new Date("2026-03-01T00:00:00Z"),
		});
		const fresh = insert(db, 4, { title: "Estágio Backend" });
		const repostAgain = insert(db, 5);

		markDuplicates(db, now);

		expect(duplicateOf(db)).toEqual({
			[expired]: null,
			[repost]: null,
			[stale]: null,
			[fresh]: null,
			// Later reposts link to the posting that is still current.
			[repostAgain]: repost,
		});
	});

	it("only checks jobs it has not seen yet", () => {
		const db = createDb(":memory:");
		insert(db, 1);
		expect(markDuplicates(db)).toBe(0);
		insert(db, 2);
		expect(markDuplicates(db)).toBe(1);
		expect(markDuplicates(db)).toBe(0);
	});
});

describe("scan with duplicates", () => {
	it("does not score or re-score a duplicate", async () => {
		const db = createDb(":memory:");
		const job = (source: string, company: string): Job => ({
			source,
			externalId: source,
			title: "Estágio Backend",
			company,
			location: null,
			modality: "remoto",
			description: "Estágio com Node.js e TypeScript.",
			url: `https://example.com/${source}`,
			publishedAt: new Date(),
			expiresAt: null,
		});
		const source = (id: string, company: string): JobSource<Job> => ({
			id,
			fetchJobs: async () => [job(id, company)],
			normalize: (j) => j,
		});
		const score = vi.fn().mockResolvedValue({
			score: {
				score: 80,
				matchedSkills: [],
				missingSkills: [],
				dealBreakers: [],
				summary: "ok",
			},
			model: "claude-haiku-5-5",
			inputTokens: 1,
			outputTokens: 1,
		});

		const report = await runScan({
			db,
			sources: [source("gupy", "Acme"), source("himalayas", "Vagas Acme")],
			preferences: {
				roles: [],
				keywordsMust: ["estágio"],
				keywordsBonus: ["node.js"],
				keywordsBlock: [],
				modality: ["remoto"],
				locations: [],
				minScoreToNotify: 70,
			},
			score,
			maxScored: 10,
			dailyTokenLimit: 1_000_000,
		});

		expect(report.duplicates).toBe(1);
		expect(score).toHaveBeenCalledTimes(1);
		expect(report.scored[0]?.job.source).toBe("gupy");
	});
});
