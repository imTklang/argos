import {
	type AtsCompany,
	createAshbySource,
	createCieeSource,
	createGitHubSource,
	createGreenhouseSource,
	createGupySource,
	createHimalayasSource,
	createLeverSource,
	createSolidesSource,
	type JobSource,
} from "@radar/sources";
import type { SourcesConfig } from "./config.ts";

/** Every source the scan knows, configured from config/sources.json and env. */
export function createSources(
	config: SourcesConfig,
	env: Record<string, string | undefined> = process.env,
	warn: (message: string) => void = console.warn,
): JobSource[] {
	const onMissingBoard = (company: AtsCompany) =>
		warn(
			`Board de ${company.name} (${company.slug}) não existe mais; revise config/sources.json.`,
		);
	return [
		createGupySource(),
		createSolidesSource(),
		createCieeSource(),
		createGitHubSource({
			repos: config.github.repos,
			token: env.GITHUB_TOKEN || undefined,
		}),
		createGreenhouseSource({
			companies: config.ats.greenhouse,
			onMissingBoard,
		}),
		createLeverSource({ companies: config.ats.lever, onMissingBoard }),
		createAshbySource({ companies: config.ats.ashby, onMissingBoard }),
		createHimalayasSource({ apiKey: env.HIMALAYAS_API_KEY || undefined }),
	];
}

/** The sources named in `only`, or all of them; unknown ids are an error. */
export function pickSources(all: JobSource[], only?: string[]): JobSource[] {
	if (!only?.length) return all;
	const unknown = only.filter((id) => !all.some((s) => s.id === id));
	if (unknown.length > 0) {
		throw new Error(
			`Fonte desconhecida: ${unknown.join(", ")}. Disponíveis: ${all.map((s) => s.id).join(", ")}`,
		);
	}
	return all.filter((s) => only.includes(s.id));
}
