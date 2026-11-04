import type { JobScoreResult } from "@radar/ai";
import type { Job, Preferences } from "@radar/core";
import {
	acquireLock,
	createDb,
	eq,
	jobScores,
	jobStatus,
	jobs,
	runs,
} from "@radar/db";
import type { JobSource } from "@radar/sources";
import { describe, expect, it, vi } from "vitest";
import { formatScanReport, runScan, ScanBusyError } from "./scan.ts";
import { startOfDay } from "./time.ts";

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

describe("runScan across processes", () => {
	it("refuses to start while another scan holds the lock", async () => {
		const db = createDb(":memory:");
		const other = acquireLock(db, "scan");
		expect(other).not.toBeNull();

		await expect(
			runScan({
				...options,
				db,
				sources: [fakeSource([makeJob(1)])],
				score: vi.fn(),
			}),
		).rejects.toBeInstanceOf(ScanBusyError);

		other?.release();
		const report = await runScan({
			...options,
			db,
			sources: [fakeSource([makeJob(1)])],
			score: vi.fn().mockResolvedValue(scoreOf(80)),
		});
		expect(report.scored).toHaveLength(1);
	});

	it("saves the spending after each job, not only at the end", async () => {
		const db = createDb(":memory:");
		const score = vi
			.fn()
			.mockResolvedValueOnce(scoreOf(80))
			.mockImplementationOnce(async () => {
				// Mid-scan, the first job's tokens are already on record.
				const run = db
					.select()
					.from(runs)
					.where(eq(runs.source, "scoring"))
					.get();
				expect(run?.inputTokens).toBe(1000);
				return scoreOf(70);
			});

		await runScan({
			...options,
			db,
			sources: [fakeSource([makeJob(1), makeJob(2)])],
			score,
			concurrency: 1,
		});
		expect(score).toHaveBeenCalledTimes(2);
	});
});

describe("runScan with one bad job", () => {
	it("skips a job the API rejects and scores the rest", async () => {
		const db = createDb(":memory:");
		const rejected = Object.assign(new Error("400 prompt is too long"), {
			status: 400,
		});
		const score = vi
			.fn()
			.mockRejectedValueOnce(rejected)
			.mockResolvedValue(scoreOf(80));

		const report = await runScan({
			...options,
			db,
			sources: [fakeSource([makeJob(1), makeJob(2), makeJob(3)])],
			score,
			concurrency: 1,
		});

		expect(report.scoringError).toBeUndefined();
		expect(report.scored).toHaveLength(2);
		// The rejected one waits for the next scan instead of a null score.
		expect(report.deferred).toBe(1);
		expect(db.select().from(jobScores).all()).toHaveLength(2);
	});

	it("stops when every job is rejected the same way", async () => {
		const db = createDb(":memory:");
		const rejected = Object.assign(new Error("400 bad model"), { status: 400 });
		const score = vi.fn().mockRejectedValue(rejected);

		const report = await runScan({
			...options,
			db,
			sources: [fakeSource([1, 2, 3, 4, 5].map((id) => makeJob(id)))],
			score,
			concurrency: 1,
		});

		expect(report.scoringError).toMatch(/bad model/);
		expect(score).toHaveBeenCalledTimes(3);
		expect(report.deferred).toBe(5);
	});
});

describe("runScan closures", () => {
	it("marks postings gone from a snapshot source as closed", async () => {
		const db = createDb(":memory:");
		const score = vi.fn().mockResolvedValue(scoreOf(80));
		const source = (items: Job[]): JobSource<Job> => ({
			...fakeSource(items),
			snapshot: true,
		});

		await runScan({
			...options,
			db,
			sources: [source([makeJob(1), makeJob(2)])],
			score,
		});
		// Timestamps are whole seconds; the next fetch must be a later one.
		await new Promise((resolve) => setTimeout(resolve, 1100));
		const report = await runScan({
			...options,
			db,
			sources: [source([makeJob(1)])],
			score,
		});

		expect(report.sources[0]?.closed).toBe(1);
		const byId = Object.fromEntries(
			db
				.select()
				.from(jobs)
				.all()
				.map((j) => [j.externalId, j.closedAt]),
		);
		expect(byId["1"]).toBeNull();
		expect(byId["2"]).toBeInstanceOf(Date);
	});

	it("closes a stored posting the source reports closed, and skips new closed ones", async () => {
		const db = createDb(":memory:");
		const score = vi.fn().mockResolvedValue(scoreOf(80));
		type Raw = Job & { closed?: boolean };
		const source = (items: Raw[]): JobSource<Raw> => ({
			id: "fake",
			fetchJobs: async () => items,
			normalize: ({ closed: _closed, ...job }) => job,
			isClosed: (raw) => raw.closed === true,
		});

		await runScan({ ...options, db, sources: [source([makeJob(1)])], score });
		const report = await runScan({
			...options,
			db,
			sources: [
				source([
					{ ...makeJob(1), closed: true },
					{ ...makeJob(2), closed: true },
				]),
			],
			score,
		});

		expect(report.sources[0]?.inserted).toBe(0);
		const stored = db.select().from(jobs).all();
		expect(stored).toHaveLength(1);
		expect(stored[0]?.closedAt).toBeInstanceOf(Date);
	});

	it("updates the deadline and description of a posting seen again", async () => {
		const db = createDb(":memory:");
		const score = vi.fn().mockResolvedValue(scoreOf(80));
		const deadline = new Date("2026-12-01T00:00:00Z");

		await runScan({
			...options,
			db,
			sources: [fakeSource([makeJob(1)])],
			score,
		});
		await runScan({
			...options,
			db,
			sources: [
				fakeSource([
					makeJob(1, { description: "Nova descrição", expiresAt: deadline }),
				]),
			],
			score,
		});

		const stored = db.select().from(jobs).get();
		expect(stored?.description).toBe("Nova descrição");
		expect(stored?.expiresAt).toEqual(deadline);
	});

	it("asks an incremental source to read new scopes whole", async () => {
		const db = createDb(":memory:");
		const seen: boolean[] = [];
		const source: JobSource<Job> = {
			id: "github",
			fetchJobs: async (query) => {
				seen.push(query.isNew?.("a/repo") ?? false);
				return [makeJob(1, { source: "github", externalId: "a/repo#1" })];
			},
			normalize: (job) => job,
		};
		const score = vi.fn().mockResolvedValue(scoreOf(80));

		await runScan({ ...options, db, sources: [source], score });
		await runScan({ ...options, db, sources: [source], score });

		expect(seen).toEqual([true, false]);
	});
});

describe("startOfDay", () => {
	it("is midnight in João Pessoa, not on the server's clock", () => {
		// 01:30 UTC on the 5th is still 22:30 on the 4th in UTC-3.
		const day = startOfDay(
			new Date("2026-11-05T01:30:00Z"),
			"America/Fortaleza",
		);
		expect(day.toISOString()).toBe("2026-11-04T03:00:00.000Z");
	});

	it("handles a zone ahead of UTC", () => {
		const day = startOfDay(new Date("2026-11-04T20:00:00Z"), "Asia/Tokyo");
		expect(day.toISOString()).toBe("2026-11-04T15:00:00.000Z");
	});
});
