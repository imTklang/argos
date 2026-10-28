import type { JobScore, JobStatus, Level, Modality } from "./schemas.ts";

// Contract between the REST API (apps/api) and the dashboard (apps/web).

export type JobListItem = {
	id: number;
	title: string;
	company: string;
	location: string | null;
	modality: Modality | null;
	abroad: boolean;
	level: Level | null;
	source: string;
	url: string;
	publishedAt: string | null;
	expiresAt: string | null;
	score: number | null;
	analysis: JobScore | null;
	status: JobStatus;
	note: string | null;
	/** The same opening seen on other sources or reposted. */
	alsoOn: { source: string; url: string }[];
};

export type JobDetail = JobListItem & {
	description: string;
	coverLetter: { text: string; model: string; createdAt: string } | null;
};

export type JobFilters = {
	status?: JobStatus[];
	source?: string[];
	minScore?: number;
	scope?: "brazil" | "abroad" | "all";
	q?: string;
	sort?: "score" | "recent";
	limit?: number;
	offset?: number;
};

export type Stats = {
	byStatus: Record<JobStatus, number>;
	lastRuns: {
		source: string;
		startedAt: string;
		finishedAt: string | null;
		jobsFound: number;
		errors: string[] | null;
	}[];
};
