import type { Job, Modality } from "@radar/core";

export type SearchQuery = {
	keywords: string[];
	locations: string[];
	modality: Modality[];
};

export interface JobSource<Raw = unknown> {
	/** Stable identifier, e.g. "gupy" or "github-backend-br". */
	id: string;
	fetchJobs(query: SearchQuery): Promise<Raw[]>;
	normalize(raw: Raw): Job;
}

export * from "./ciee.ts";
export * from "./gupy.ts";
export * from "./solides.ts";
export { USER_AGENT } from "./util.ts";
