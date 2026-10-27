import { access, readFile, writeFile } from "node:fs/promises";
import { buildPreferences, Preferences } from "@radar/core";
import { type Db, desc, preferences, profiles } from "@radar/db";

export type PrefsInitResult =
	| { kind: "no-profile" }
	| { kind: "exists"; path: string }
	| { kind: "created"; path: string; profileId: number; prefs: Preferences };

export async function initPreferences(opts: {
	db: Db;
	path: string;
	force?: boolean;
}): Promise<PrefsInitResult> {
	const { db, path, force = false } = opts;

	const profile = db
		.select()
		.from(profiles)
		.orderBy(desc(profiles.id))
		.limit(1)
		.get();
	if (!profile) return { kind: "no-profile" };

	if (!force && (await fileExists(path))) return { kind: "exists", path };

	const prefs = buildPreferences(profile.data);
	await writeFile(path, `${JSON.stringify(prefs, null, 2)}\n`);
	db.insert(preferences).values({ profileId: profile.id, data: prefs }).run();

	return { kind: "created", path, profileId: profile.id, prefs };
}

async function fileExists(path: string) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function readPreferences(path: string): Promise<Preferences> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		throw new Error(
			`${path} não encontrado. Rode primeiro: pnpm cli prefs init`,
		);
	}
	const parsed = Preferences.safeParse(JSON.parse(raw));
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((i) => `  ${i.path.join(".") || "(raiz)"}: ${i.message}`)
			.join("\n");
		throw new Error(`${path} tem campos inválidos:\n${issues}`);
	}
	return parsed.data;
}
