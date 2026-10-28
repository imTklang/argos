import type { JobScoreResult } from "@radar/ai";
import type { Job, Preferences } from "@radar/core";
import { createDb, jobScores, jobStatus, runs } from "@radar/db";
import type { JobSource } from "@radar/sources";
import { describe, expect, it, vi } from "vitest";
import { formatScanReport, runScan } from "./scan.ts";

const now = new Date("2026-10-27T12:00:00Z");

const preferences: Preferences = {
	roles: ["estágio backend"],
	keywordsMust: ["estágio"],
	keywordsBonus: ["node.js", "typescript"],
	keywordsBlock: ["sênior"],
	modality: ["remoto", "híbrido", "presencial"],
	locations: ["João Pessoa", "PB"],
	minScoreToNotify: 70,
};

function makeJob(id: number, patch: Partial<Job> = {}): Job {
	return {
		source: "fake",
		externalId: String(id),
		title: `Estágio Backend ${id}`,
		company: "Acme",
		location: null,
		modality: "remoto",
		description: "Estágio com Node.js e TypeScript.",
		url: `https://example.com/${id}`,
		publishedAt: new Date("2026-10-20T00:00:00Z"),
		expiresAt: null,
		...patch,
	};
}

function fakeSource(items: Job[], id = "fake"): JobSource<Job> {
	return { id, fetchJobs: async () => items, normalize: (job) => job };
}

function scoreOf(value: number): JobScoreResult {
	return {
		score: {
			score: value,
			matchedSkills: [],
			missingSkills: [],
			dealBreakers: [],
			summary: `nota ${value}`,
		},
		model: "claude-haiku-5-5",
		inputTokens: 1000,
		outputTokens: 100,
	};
}

const options = {
	preferences,
	maxScored: 50,
	dailyTokenLimit: 1_000_000,
	now,
};

describe("runScan", () => {
	it("stores new jobs, filters them and scores the candidates", async () => {
		const db = createDb(":memory:");
		const score = vi.fn().mockResolvedValue(scoreOf(80));

		const report = await runScan({
			...options,
			db,
			sources: [
				fakeSource([
					makeJob(1),
					makeJob(2, { title: "Desenvolvedor Sênior" }),
					makeJob(3, { modality: "presencial", location: "Goiânia, Goiás" }),
				]),
			],
			score,
		});

		expect(report.sources).toEqual([{ id: "fake", found: 3, inserted: 3 }]);
		expect(report.rejected).toEqual({
			"não é estágio": 1,
			"fora da região": 1,
		});
		expect(score).toHaveBeenCalledTimes(1);
		expect(report.scored[0]?.job.title).toBe("Estágio Backend 1");
		expect(db.select().from(jobScores).all()).toHaveLength(1);
		expect(db.select().from(jobStatus).all()[0]?.status).toBe("nova");
	});

	it("does not score the same job twice across scans", async () => {
		const db = createDb(":memory:");
		const score = vi.fn().mockResolvedValue(scoreOf(80));
		const sources = [fakeSource([makeJob(1)])];

		await runScan({ ...options, db, sources, score });
		const second = await runScan({ ...options, db, sources, score });

		expect(second.sources[0]?.inserted).toBe(0);
		expect(second.pending).toBe(0);
		expect(score).toHaveBeenCalledTimes(1);
	});

	it("keeps going when a source fails", async () => {
		const db = createDb(":memory:");
		const broken: JobSource<Job> = {
			id: "broken",
			fetchJobs: async () => {
				throw new Error("HTTP 503");
			},
			normalize: (job) => job,
		};

		const report = await runScan({
			...options,
			db,
			sources: [broken, fakeSource([makeJob(1)])],
			score: vi.fn().mockResolvedValue(scoreOf(80)),
		});

		expect(report.sources[0]).toMatchObject({
			id: "broken",
			error: "HTTP 503",
		});
		expect(report.scored).toHaveLength(1);
		const failedRun = db.select().from(runs).all()[0];
		expect(failedRun?.errors).toEqual(["HTTP 503"]);
	});

	it("defers candidates beyond the per-scan limit to the next scan", async () => {
		const db = createDb(":memory:");
		const score = vi.fn().mockResolvedValue(scoreOf(80));
		const sources = [fakeSource([1, 2, 3, 4, 5].map((id) => makeJob(id)))];

		const first = await runScan({
			...options,
			db,
			sources,
			score,
			maxScored: 2,
		});
		expect(first.scored).toHaveLength(2);
		expect(first.deferred).toBe(3);

		const second = await runScan({
			...options,
			db,
			sources,
			score,
			maxScored: 10,
		});
		expect(second.scored).toHaveLength(3);
	});

	it("tells the scorer how many internships the company has open", async () => {
		const db = createDb(":memory:");
		const score = vi.fn().mockResolvedValue(scoreOf(80));
		const posts = [1, 2, 3].map((id) =>
			makeJob(id, { company: "Massa", level: "estágio" }),
		);

		await runScan({ ...options, db, sources: [fakeSource(posts)], score });

		expect(score).toHaveBeenCalledWith(expect.anything(), {
			companyInternships: 3,
		});
	});

	it("scores jobs in Brazil before jobs abroad when a limit cuts", async () => {
		const db = createDb(":memory:");
		const score = vi.fn().mockResolvedValue(scoreOf(80));

		const report = await runScan({
			...options,
			preferences: { ...preferences, abroad: "remote" },
			db,
			sources: [
				fakeSource([
					makeJob(1, { abroad: true, level: "estágio" }),
					makeJob(2),
				]),
			],
			score,
			concurrency: 1,
			maxScored: 1,
		});

		expect(report.scored.map((s) => s.job.externalId)).toEqual(["2"]);
		expect(report.deferred).toBe(1);
	});

	it("stops at the daily token limit", async () => {
		const db = createDb(":memory:");
		const score = vi.fn().mockResolvedValue(scoreOf(80));

		const report = await runScan({
			...options,
			db,
			sources: [fakeSource([1, 2, 3].map((id) => makeJob(id)))],
			score,
			concurrency: 1,
			dailyTokenLimit: 1500,
		});

		expect(report.scored).toHaveLength(2);
		expect(report.deferred).toBe(1);
	});

	it("stops scoring after an API error and leaves the jobs pending", async () => {
		const db = createDb(":memory:");
		const score = vi.fn().mockRejectedValue(new Error("401 invalid x-api-key"));

		const report = await runScan({
			...options,
			db,
			sources: [fakeSource([makeJob(1), makeJob(2)])],
			score,
			concurrency: 1,
		});

		expect(report.scoringError).toMatch(/401/);
		expect(report.scored).toHaveLength(0);
		expect(report.deferred).toBe(2);
	});

	it("saves a null score when the model output could not be parsed", async () => {
		const db = createDb(":memory:");
		const score = vi.fn().mockResolvedValue({ ...scoreOf(0), score: null });

		await runScan({
			...options,
			db,
			sources: [fakeSource([makeJob(1)])],
			score,
		});

		expect(db.select().from(jobScores).all()[0]?.score).toBeNull();
	});
});

describe("formatScanReport", () => {
	it("ranks by score and marks jobs above the threshold", async () => {
		const db = createDb(":memory:");
		const score = vi
			.fn()
			.mockResolvedValueOnce(scoreOf(55))
			.mockResolvedValueOnce(scoreOf(90));
		const report = await runScan({
			...options,
			db,
			sources: [fakeSource([makeJob(1), makeJob(2)])],
			score,
			concurrency: 1,
		});

		const out = formatScanReport(report, 70);
		const first = out.indexOf("nota 90");
		const second = out.indexOf("nota 55");
		expect(first).toBeGreaterThan(-1);
		expect(first).toBeLessThan(second);
		expect(out).toMatch(/★ {2}90/);
		expect(out).toContain("1 com nota ≥ 70");
	});
});

describe("incremental collection", () => {
	it("passes the start of the last successful run as since", async () => {
		const db = createDb(":memory:");
		const seen: (Date | undefined)[] = [];
		const source: JobSource<Job> = {
			id: "fake",
			fetchJobs: async (query) => {
				seen.push(query.since);
				return [];
			},
			normalize: (job) => job,
		};
		const score = vi.fn();

		await runScan({ ...options, db, sources: [source], score });
		await runScan({ ...options, db, sources: [source], score });

		expect(seen[0]).toBeUndefined();
		expect(seen[1]).toBeInstanceOf(Date);
	});

	it("does not advance since past a failed run", async () => {
		const db = createDb(":memory:");
		const seen: (Date | undefined)[] = [];
		let fail = false;
		const source: JobSource<Job> = {
			id: "flaky",
			fetchJobs: async (query) => {
				seen.push(query.since);
				if (fail) throw new Error("timeout");
				return [];
			},
			normalize: (job) => job,
		};
		const score = vi.fn();

		await runScan({ ...options, db, sources: [source], score });
		fail = true;
		await runScan({ ...options, db, sources: [source], score });
		fail = false;
		await runScan({ ...options, db, sources: [source], score });

		expect(seen[2]?.getTime()).toBe(seen[1]?.getTime());
	});
});

describe("scoped scans", () => {
	it("only filters and scores jobs from the sources being scanned", async () => {
		const db = createDb(":memory:");
		const score = vi.fn().mockResolvedValue(scoreOf(80));
		await runScan({
			...options,
			db,
			sources: [fakeSource([makeJob(1, { source: "a" })], "a")],
			score: vi.fn().mockRejectedValue(new Error("offline")),
		});

		const report = await runScan({
			...options,
			db,
			sources: [fakeSource([makeJob(2, { source: "b" })], "b")],
			score,
		});

		expect(report.pending).toBe(1);
		expect(score).toHaveBeenCalledTimes(1);
		expect(report.scored[0]?.job.source).toBe("b");
	});
});
