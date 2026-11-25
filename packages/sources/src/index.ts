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
	/**
	 * Whether nothing from this part of the source (a GitHub repository) is
	 * stored yet. An incremental source reads such a part whole, since "since"
	 * would skip the postings it never saw.
	 */
	isNew?: (scope: string) => boolean;
};

export interface JobSource<Raw = unknown> {
	/** Stable identifier, e.g. "gupy" or "github". */
	id: string;
	/**
	 * True when every successful fetch returns all open postings of the
	 * source, so a stored posting missing from one has been taken down.
	 */
	snapshot?: boolean;
	fetchJobs(query: SearchQuery): Promise<Raw[]>;
	normalize(raw: Raw): Job;
	/** Whether this fetched posting says it was closed (e.g. a closed issue). */
	isClosed?(raw: Raw): boolean;
}

export * from "./ats.ts";
export * from "./ciee.ts";
export * from "./github.ts";
export * from "./gupy.ts";
export * from "./himalayas.ts";
export * from "./solides.ts";
export { USER_AGENT } from "./util.ts";
