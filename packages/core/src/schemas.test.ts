import { describe, expect, it } from "vitest";
import { JobScore, Preferences } from "./schemas.ts";

describe("JobScore", () => {
	const valid = {
		score: 82,
		matchedSkills: ["node", "typescript"],
		missingSkills: ["docker"],
		dealBreakers: [],
		summary: "Estágio backend em Node, remoto.",
	};

	it("accepts a well-formed score", () => {
		expect(JobScore.parse(valid)).toEqual(valid);
	});

	it("rejects scores outside 0–100", () => {
		expect(JobScore.safeParse({ ...valid, score: 120 }).success).toBe(false);
	});

	it("rejects missing fields", () => {
		const { summary: _, ...partial } = valid;
		expect(JobScore.safeParse(partial).success).toBe(false);
	});
});

describe("Preferences", () => {
	it("rejects unknown modality", () => {
		const result = Preferences.safeParse({
			roles: [],
			keywordsMust: [],
			keywordsBonus: [],
			keywordsBlock: [],
			modality: ["home office"],
			locations: [],
			minScoreToNotify: 70,
		});
		expect(result.success).toBe(false);
	});
});
