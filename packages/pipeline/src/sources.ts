import {
	createCieeSource,
	createGitHubSource,
	createGupySource,
	createSolidesSource,
	type JobSource,
} from "@radar/sources";
import type { SourcesConfig } from "./config.ts";

/** Every source the scan knows, configured from config/sources.json and env. */
export function createSources(
	config: SourcesConfig,
	env: Record<string, string | undefined> = process.env,
): JobSource[] {
	return [
		createGupySource(),
		createSolidesSource(),
		createCieeSource(),
		createGitHubSource({
			repos: config.github.repos,
			token: env.GITHUB_TOKEN || undefined,
		}),
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
