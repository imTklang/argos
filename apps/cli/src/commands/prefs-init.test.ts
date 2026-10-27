import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Preferences, type Profile } from "@radar/core";
import { createDb, preferences, profiles } from "@radar/db";
import { describe, expect, it } from "vitest";
import { initPreferences } from "./prefs-init.ts";

const profile: Profile = {
	name: "Ana Souza",
	course: "Ciência da Computação",
	institution: "UFPB",
	currentPeriod: 4,
	expectedGraduation: "",
	skills: [{ name: "Node.js", level: "avançado" }],
	languages: [],
	projects: [],
	experience: [],
};

async function setup() {
	const db = createDb(":memory:");
	const dir = await mkdtemp(join(tmpdir(), "radar-prefs-"));
	return { db, path: join(dir, "preferences.json") };
}

describe("initPreferences", () => {
	it("asks for a profile first when there is none", async () => {
		const { db, path } = await setup();
		expect(await initPreferences({ db, path })).toEqual({
			kind: "no-profile",
		});
	});

	it("writes an editable JSON file and stores a snapshot", async () => {
		const { db, path } = await setup();
		db.insert(profiles).values({ data: profile, resumeHash: "h" }).run();

		const result = await initPreferences({ db, path });

		expect(result.kind).toBe("created");
		const file = JSON.parse(await readFile(path, "utf8"));
		expect(Preferences.parse(file).keywordsBonus).toEqual(["node.js"]);
		expect(db.select().from(preferences).all()).toHaveLength(1);
	});

	it("does not overwrite an edited file without force", async () => {
		const { db, path } = await setup();
		db.insert(profiles).values({ data: profile, resumeHash: "h" }).run();
		await writeFile(path, "editado");

		expect((await initPreferences({ db, path })).kind).toBe("exists");
		expect(await readFile(path, "utf8")).toBe("editado");

		expect((await initPreferences({ db, path, force: true })).kind).toBe(
			"created",
		);
	});
});
