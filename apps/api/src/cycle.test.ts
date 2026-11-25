import type { JobScoreResult } from "@radar/ai";
import type { Job, Preferences, Profile } from "@radar/core";
import { createDb } from "@radar/db";
import type { Messenger } from "@radar/pipeline";
import type { JobSource } from "@radar/sources";
import { describe, expect, it, vi } from "vitest";
import { exclusive, lastSlot, missedSlot, runCycle } from "./cycle.ts";

const preferences: Preferences = {
	roles: [],
	keywordsMust: ["estágio"],
	keywordsBonus: ["node.js"],
	keywordsBlock: [],
	modality: ["remoto"],
	locations: [],
	minScoreToNotify: 70,
};

const profile: Profile = {
	name: "Ana",
	course: "CC",
	institution: "UFPB",
	currentPeriod: 4,
	expectedGraduation: "",
	skills: [],
	languages: [],
	projects: [],
	experience: [],
};

const job: Job = {
	source: "fake",
	externalId: "1",
	title: "Estágio Backend",
	company: "Acme",
	location: null,
	modality: "remoto",
	description: "Estágio com Node.js e TypeScript.",
	url: "https://example.com/1",
	publishedAt: new Date(),
	expiresAt: null,
};

const source: JobSource<Job> = {
	id: "fake",
	fetchJobs: async () => [job],
	normalize: (j) => j,
};

function scored(value: number): JobScoreResult {
	return {
		score: {
			score: value,
			matchedSkills: [],
			missingSkills: [],
			dealBreakers: [],
			summary: "ok",
		},
		model: "claude-haiku-5-5",
		inputTokens: 10,
		outputTokens: 5,
	};
}

function messenger(): Messenger {
	return {
		channel: "fake",
		sendJob: vi.fn().mockResolvedValue("1"),
		sendDigest: vi.fn().mockResolvedValue("2"),
		sendText: vi.fn().mockResolvedValue("3"),
	};
}

const base = {
	sources: [source],
	preferences,
	profile,
	maxScored: 10,
	dailyTokenLimit: 1_000_000,
	log: () => {},
};

describe("runCycle", () => {
	it("scans, scores with the profile and alerts strong matches", async () => {
		const db = createDb(":memory:");
		const score = vi.fn().mockResolvedValue(scored(90));
		const m = messenger();

		const result = await runCycle({
			...base,
			db,
			score,
			messenger: m,
			digest: false,
		});

		expect(score).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Estágio Backend" }),
			profile,
			{ companyInternships: 0 },
		);
		expect(result.alerts).toBe(1);
		expect(m.sendJob).toHaveBeenCalledTimes(1);
	});

	it("sends nothing without a messenger", async () => {
		const db = createDb(":memory:");
		const result = await runCycle({
			...base,
			db,
			score: vi.fn().mockResolvedValue(scored(90)),
			messenger: null,
			digest: true,
		});
		expect(result).toMatchObject({ alerts: 0, digest: 0 });
	});

	it("includes the digest only on digest runs", async () => {
		const db = createDb(":memory:");
		const m = messenger();
		const score = vi.fn().mockResolvedValue(scored(75));

		await runCycle({ ...base, db, score, messenger: m, digest: false });
		expect(m.sendDigest).not.toHaveBeenCalled();

		const result = await runCycle({
			...base,
			db,
			score,
			messenger: m,
			digest: true,
		});
		expect(result.digest).toBe(1);
	});
});

describe("exclusive", () => {
	it("skips calls while one is running and releases after", async () => {
		let release: () => void = () => {};
		const task = vi.fn(
			(n: number) =>
				new Promise<number>((resolve) => {
					release = () => resolve(n);
				}),
		);
		const onSkip = vi.fn();
		const run = exclusive(task, onSkip);

		const first = run(1);
		expect(await run(2)).toBeUndefined();
		expect(onSkip).toHaveBeenCalledTimes(1);
		release();
		expect(await first).toBe(1);

		const third = run(3);
		release();
		expect(await third).toBe(3);
		expect(task).toHaveBeenCalledTimes(2);
	});

	it("releases the lock when the task throws", async () => {
		const run = exclusive(
			vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue("ok"),
			() => {},
		);
		await expect(run()).rejects.toThrow("x");
		expect(await run()).toBe("ok");
	});
});

describe("missed scheduled scans", () => {
	const schedule = [
		{ hour: 8, digest: false },
		{ hour: 18, digest: true },
	];
	const tz = "America/Fortaleza"; // UTC-3, no daylight saving
	// Local wall-clock time in Fortaleza as an instant.
	const at = (day: number, hour: number, minute = 0) =>
		new Date(Date.UTC(2026, 10, day, hour + 3, minute));

	it("finds the latest slot, yesterday's evening before 8h", () => {
		expect(lastSlot(at(20, 12), schedule, tz)).toEqual({
			at: at(20, 8),
			digest: false,
		});
		expect(lastSlot(at(20, 18), schedule, tz)).toEqual({
			at: at(20, 18),
			digest: true,
		});
		expect(lastSlot(at(20, 6), schedule, tz)).toEqual({
			at: at(19, 18),
			digest: true,
		});
	});

	it("reports a slot only when no run started after it", () => {
		expect(missedSlot(null, at(20, 9), schedule, tz)?.at).toEqual(at(20, 8));
		// Asleep at 18h, woke up at 23h: the evening scan and digest are due.
		expect(missedSlot(at(20, 8, 1), at(20, 23), schedule, tz)).toEqual({
			at: at(20, 18),
			digest: true,
		});
		expect(missedSlot(at(20, 18, 2), at(20, 23), schedule, tz)).toBeNull();
		expect(missedSlot(at(20, 8), at(20, 9), schedule, tz)).toBeNull();
	});
});
