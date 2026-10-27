import type { Job, Modality } from "@radar/core";

export type SearchQuery = {
	keywords: string[];
	locations: string[];
	modality: Modality[];
	/**
	 * Start of this source's last successful collection, if any. Sources that
	 * support incremental fetching only ask for what changed after it.
	 */
	since?: Date;
};

export interface JobSource<Raw = unknown> {
	/** Stable identifier, e.g. "gupy" or "github". */
	id: string;
	fetchJobs(query: SearchQuery): Promise<Raw[]>;
	normalize(raw: Raw): Job;
}

export * from "./ats.ts";
export * from "./ciee.ts";
export * from "./github.ts";
export * from "./gupy.ts";
export * from "./solides.ts";
export { USER_AGENT } from "./util.ts";
