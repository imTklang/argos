import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Preferences } from "@radar/core";
import { z } from "zod";

/** The repository root, so paths work whatever directory starts the process. */
export const ROOT_DIR = fileURLToPath(new URL("../../../", import.meta.url));

/** A path from the environment or the default, relative paths from the root. */
function pathFromEnv(name: string, fallback: string): string {
	return resolve(ROOT_DIR, process.env[name] || fallback);
}

export const DATABASE_PATH = pathFromEnv("DATABASE_PATH", "data/radar.db");
export const PREFERENCES_PATH = pathFromEnv(
	"PREFERENCES_PATH",
	"data/preferences.json",
);
export const SOURCES_CONFIG_PATH = pathFromEnv(
	"SOURCES_CONFIG_PATH",
	"config/sources.json",
);

const Company = z.object({
	slug: z.string().regex(/^[\w.-]+$/, "slug do board, ex.: btgpactual"),
	name: z.string().min(1),
});

const SourcesConfig = z.object({
	ats: z
		.object({
			greenhouse: z.array(Company).default([]),
			lever: z.array(Company).default([]),
			ashby: z.array(Company).default([]),
		})
		.default({ greenhouse: [], lever: [], ashby: [] }),
	github: z.object({
		repos: z.array(
			z.string().regex(/^[\w.-]+\/[\w.-]+$/, "use o formato dono/repositório"),
		),
	}),
});
export type SourcesConfig = z.infer<typeof SourcesConfig>;

export async function readSourcesConfig(
	path = SOURCES_CONFIG_PATH,
): Promise<SourcesConfig> {
	const parsed = SourcesConfig.safeParse(
		JSON.parse(await readFile(path, "utf8")),
	);
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((i) => `  ${i.path.join(".") || "(raiz)"}: ${i.message}`)
			.join("\n");
		throw new Error(`${path} tem campos inválidos:\n${issues}`);
	}
	return parsed.data;
}

export async function readPreferences(
	path = PREFERENCES_PATH,
): Promise<Preferences> {
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
