import { describe, expect, it } from "vitest";
import { buildPreferences } from "./preferences.ts";
import { Preferences, type Profile } from "./schemas.ts";

const profile: Profile = {
	name: "Ana Souza",
	course: "Ciência da Computação",
	institution: "UFPB",
	currentPeriod: 4,
	expectedGraduation: "",
	skills: [
		{ name: "Node.js", level: "avançado" },
		{ name: "TypeScript", level: "intermediário" },
		{ name: "typescript", level: "avançado" },
		{ name: "Elixir", level: "básico" },
	],
	languages: [],
	projects: [],
	experience: [],
};

describe("buildPreferences", () => {
	it("produces valid preferences", () => {
		expect(Preferences.safeParse(buildPreferences(profile)).success).toBe(true);
	});

	it("uses non-basic skills as bonus keywords, lowercased and deduplicated", () => {
		expect(buildPreferences(profile).keywordsBonus).toEqual([
			"node.js",
			"typescript",
		]);
	});

	it("blocks senior roles", () => {
		const { keywordsBlock } = buildPreferences(profile);
		expect(keywordsBlock).toContain("sênior");
		expect(keywordsBlock).toContain("pleno");
	});
});
