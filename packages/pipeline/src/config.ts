import { readFile } from "node:fs/promises";
import { Preferences } from "@radar/core";
import { z } from "zod";

export const SOURCES_CONFIG_PATH = "./config/sources.json";
export const PREFERENCES_PATH = "./data/preferences.json";

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
