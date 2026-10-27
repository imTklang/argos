import type { ProfileExtraction } from "@radar/ai";
import type { Profile } from "@radar/core";
import { createDb, profiles } from "@radar/db";
import { describe, expect, it, vi } from "vitest";
import { formatProfile, importProfile } from "./profile-import.ts";

const profile: Profile = {
	name: "Ana Souza",
	course: "Ciência da Computação",
	institution: "UFPB",
	currentPeriod: 4,
	expectedGraduation: "12/2027",
	skills: [
		{ name: "Node.js", level: "avançado", evidence: "API em produção" },
		{ name: "TypeScript", level: "intermediário" },
		{ name: "Elixir", level: "básico" },
	],
	languages: [{ name: "Inglês", level: "intermediário" }],
	projects: [
		{ name: "Bolão", stack: ["Node.js", "Postgres"], summary: "App de bolão." },
	],
	experience: [],
};

const extraction: ProfileExtraction = {
	profile,
	model: "claude-sonnet-5-5",
	inputTokens: 1000,
	outputTokens: 500,
};

const resume = { text: "Ana Souza\nCiência da Computação", hash: "h1" };

describe("importProfile", () => {
	it("extracts and stores a new profile", async () => {
		const db = createDb(":memory:");
		const extract = vi.fn().mockResolvedValue(extraction);

		const result = await importProfile({ db, resume, extract });

		expect(result.kind).toBe("imported");
		expect(extract).toHaveBeenCalledWith(resume.text);
		const stored = db.select().from(profiles).all();
		expect(stored).toHaveLength(1);
		expect(stored[0]?.data).toEqual(profile);
		expect(stored[0]?.resumeHash).toBe("h1");
	});

	it("skips extraction when the same resume was already imported", async () => {
		const db = createDb(":memory:");
		await importProfile({
			db,
			resume,
			extract: vi.fn().mockResolvedValue(extraction),
		});
		const extract = vi.fn();

		const result = await importProfile({ db, resume, extract });

		expect(result.kind).toBe("duplicate");
		expect(extract).not.toHaveBeenCalled();
	});

	it("re-extracts with force", async () => {
		const db = createDb(":memory:");
		const extract = vi.fn().mockResolvedValue(extraction);
		await importProfile({ db, resume, extract });

		const result = await importProfile({ db, resume, extract, force: true });

		expect(result.kind).toBe("imported");
		expect(db.select().from(profiles).all()).toHaveLength(2);
	});

	it("rejects a PDF with no text", async () => {
		const db = createDb(":memory:");
		await expect(
			importProfile({
				db,
				resume: { text: "", hash: "h2" },
				extract: vi.fn(),
			}),
		).rejects.toThrow(/escaneada/);
	});
});

describe("formatProfile", () => {
	it("groups skills by level", () => {
		const out = formatProfile(profile);
		expect(out).toContain("avançado: Node.js");
		expect(out).toContain("intermediário: TypeScript");
		expect(out).toContain("básico: Elixir");
		expect(out).toContain("4º período · formatura 12/2027");
	});
});
