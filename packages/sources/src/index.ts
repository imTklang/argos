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
