import type { JobScore, JobStatus, Level, Modality } from "@radar/core";
import {
	and,
	asc,
	coverLetters,
	type Db,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	jobScores,
	jobStatus,
	jobs,
	runs,
	sql,
} from "@radar/db";

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

function iso(date: Date | null): string | null {
	return date ? date.toISOString() : null;
}

/** Only scored originals: duplicates live inside their original's alsoOn. */
function baseConditions(filters: JobFilters) {
	const conditions = [isNull(jobs.duplicateOf)];
	if (filters.status?.length) {
		conditions.push(
			inArray(sql`coalesce(${jobStatus.status}, 'nova')`, filters.status),
		);
	}
	if (filters.source?.length)
		conditions.push(inArray(jobs.source, filters.source));
	if (filters.minScore !== undefined) {
		conditions.push(gte(jobScores.score, filters.minScore));
	}
	if (filters.scope === "brazil") conditions.push(eq(jobs.abroad, false));
	if (filters.scope === "abroad") conditions.push(eq(jobs.abroad, true));
	if (filters.q?.trim()) {
		const like = `%${filters.q.trim().toLowerCase()}%`;
		conditions.push(
			sql`(lower(${jobs.title}) like ${like} or lower(${jobs.company}) like ${like})`,
		);
	}
	return and(...conditions);
}

function selectJobs(db: Db) {
	return db
		.select({ job: jobs, score: jobScores, status: jobStatus })
		.from(jobScores)
		.innerJoin(jobs, eq(jobs.id, jobScores.jobId))
		.leftJoin(jobStatus, eq(jobStatus.jobId, jobs.id));
}

type Row = Awaited<ReturnType<ReturnType<typeof selectJobs>["all"]>>[number];

function alsoOnFor(db: Db, ids: number[]) {
	const map = new Map<number, { source: string; url: string }[]>();
	if (ids.length === 0) return map;
	const rows = db
		.select({ of: jobs.duplicateOf, source: jobs.source, url: jobs.url })
		.from(jobs)
		.where(inArray(jobs.duplicateOf, ids))
		.orderBy(asc(jobs.id))
		.all();
	for (const row of rows) {
		if (row.of === null) continue;
		const list = map.get(row.of) ?? [];
		list.push({ source: row.source, url: row.url });
		map.set(row.of, list);
	}
	return map;
}

function toItem(row: Row, alsoOn: JobListItem["alsoOn"]): JobListItem {
	const { job, score, status } = row;
	return {
		id: job.id,
		title: job.title,
		company: job.company,
		location: job.location,
		modality: job.modality,
		abroad: job.abroad,
		level: job.level,
		source: job.source,
		url: job.url,
		publishedAt: iso(job.publishedAt),
		expiresAt: iso(job.expiresAt),
		score: score.score,
		analysis: score.analysis,
		status: status?.status ?? "nova",
		note: status?.note ?? null,
		alsoOn,
	};
}

export function listJobs(
	db: Db,
	filters: JobFilters,
): { items: JobListItem[]; total: number } {
	const where = baseConditions(filters);
	const total =
		db
			.select({ n: sql<number>`count(*)` })
			.from(jobScores)
			.innerJoin(jobs, eq(jobs.id, jobScores.jobId))
			.leftJoin(jobStatus, eq(jobStatus.jobId, jobs.id))
			.where(where)
			.get()?.n ?? 0;

	const order =
		filters.sort === "recent"
			? [desc(jobScores.createdAt), desc(jobs.id)]
			: // Unscored jobs (null) last.
				[sql`${jobScores.score} is null`, desc(jobScores.score), desc(jobs.id)];

	const rows = selectJobs(db)
		.where(where)
		.orderBy(...order)
		.limit(filters.limit ?? 50)
		.offset(filters.offset ?? 0)
		.all();
	const alsoOn = alsoOnFor(
		db,
		rows.map((r) => r.job.id),
	);
	return {
		items: rows.map((row) => toItem(row, alsoOn.get(row.job.id) ?? [])),
		total,
	};
}

export function getJob(db: Db, id: number): JobDetail | null {
	const row = selectJobs(db).where(eq(jobs.id, id)).get();
	if (!row) return null;
	const letter = db
		.select()
		.from(coverLetters)
		.where(eq(coverLetters.jobId, id))
		.orderBy(desc(coverLetters.id))
		.limit(1)
		.get();
	return {
		...toItem(row, alsoOnFor(db, [id]).get(id) ?? []),
		description: row.job.description,
		coverLetter: letter
			? {
					text: letter.text,
					model: letter.model,
					createdAt: letter.createdAt.toISOString(),
				}
			: null,
	};
}

export function setStatus(
	db: Db,
	id: number,
	status: JobStatus,
	note: string | null | undefined,
): boolean {
	const exists = db
		.select({ id: jobs.id })
		.from(jobs)
		.where(eq(jobs.id, id))
		.get();
	if (!exists) return false;
	const values = {
		status,
		updatedAt: new Date(),
		...(note !== undefined ? { note } : {}),
	};
	db.insert(jobStatus)
		.values({ jobId: id, ...values })
		.onConflictDoUpdate({ target: jobStatus.jobId, set: values })
		.run();
	return true;
}

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

export function getStats(db: Db): Stats {
	const byStatus: Record<JobStatus, number> = {
		nova: 0,
		vista: 0,
		salva: 0,
		candidatei: 0,
		descartada: 0,
	};
	const counts = db
		.select({
			status: sql<JobStatus>`coalesce(${jobStatus.status}, 'nova')`,
			n: sql<number>`count(*)`,
		})
		.from(jobScores)
		.innerJoin(jobs, eq(jobs.id, jobScores.jobId))
		.leftJoin(jobStatus, eq(jobStatus.jobId, jobs.id))
		.where(isNull(jobs.duplicateOf))
		.groupBy(sql`coalesce(${jobStatus.status}, 'nova')`)
		.all();
	for (const { status, n } of counts) byStatus[status] = n;

	// Latest run per source.
	const latest = db
		.select({ id: sql<number>`max(${runs.id})` })
		.from(runs)
		.groupBy(runs.source);
	const lastRuns = db
		.select()
		.from(runs)
		.where(inArray(runs.id, latest))
		.orderBy(asc(runs.source))
		.all()
		.map((run) => ({
			source: run.source,
			startedAt: run.startedAt.toISOString(),
			finishedAt: iso(run.finishedAt),
			jobsFound: run.jobsFound,
			errors: run.errors,
		}));
	return { byStatus, lastRuns };
}
