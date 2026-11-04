import type { JobHints, JobScoreResult } from "@radar/ai";
import {
	type FilterReason,
	hardFilter,
	type Job,
	jobHash,
	MAX_JOB_AGE_DAYS,
	type Preferences,
} from "@radar/core";
import {
	acquireLock,
	and,
	type Db,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	jobScores,
	jobStatus,
	jobs,
	type Lock,
	runs,
	sql,
} from "@radar/db";
import type { JobSource } from "@radar/sources";
import { markDuplicates } from "./dedupe.ts";
import { startOfDay } from "./time.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ScannedJob = { jobId: number; job: Job; result: JobScoreResult };

export type ScanReport = {
	sources: {
		id: string;
		found: number;
		inserted: number;
		/** Stored postings this fetch showed were taken down. */
		closed?: number;
		error?: string;
	}[];
	/** New jobs linked to a job already seen (another source or a repost). */
	duplicates: number;
	pending: number;
	rejected: Partial<Record<FilterReason, number>>;
	candidates: number;
	scored: ScannedJob[];
	/** Candidates left for the next scan by the per-scan or daily limit. */
	deferred: number;
	scoringError?: string;
	inputTokens: number;
	outputTokens: number;
};

export type ScanOptions = {
	db: Db;
	sources: JobSource[];
	preferences: Preferences;
	score: (job: Job, hints: JobHints) => Promise<JobScoreResult>;
	maxScored: number;
	dailyTokenLimit: number;
	concurrency?: number;
	now?: Date;
	log?: (message: string) => void;
};

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function tokensUsedSince(db: Db, since: Date): number {
	const row = db
		.select({
			total: sql<number>`coalesce(sum(${runs.inputTokens} + ${runs.outputTokens}), 0)`,
		})
		.from(runs)
		.where(gte(runs.startedAt, since))
		.get();
	return row?.total ?? 0;
}

function lastSuccessfulRun(db: Db, sourceId: string): Date | undefined {
	const row = db
		.select({ startedAt: runs.startedAt })
		.from(runs)
		.where(
			and(
				eq(runs.source, sourceId),
				isNotNull(runs.finishedAt),
				isNull(runs.errors),
			),
		)
		.orderBy(desc(runs.startedAt))
		.limit(1)
		.get();
	return row?.startedAt;
}

async function collect(
	db: Db,
	source: JobSource,
	preferences: Preferences,
): Promise<ScanReport["sources"][number]> {
	const since = lastSuccessfulRun(db, source.id);
	const run = db
		.insert(runs)
		.values({ source: source.id, startedAt: new Date() })
		.returning({ id: runs.id })
		.get();
	const report: ScanReport["sources"][number] = {
		id: source.id,
		found: 0,
		inserted: 0,
	};

	const fetchedAt = new Date();
	try {
		const raw = await source.fetchJobs({
			keywords: preferences.roles,
			locations: preferences.locations,
			modality: preferences.modality,
			since,
			isNew: (scope) =>
				!db
					.select({ id: jobs.id })
					.from(jobs)
					.where(
						and(
							eq(jobs.source, source.id),
							sql`substr(${jobs.externalId}, 1, ${scope.length + 1}) = ${`${scope}#`}`,
						),
					)
					.limit(1)
					.get(),
		});
		report.found = raw.length;
		db.transaction((tx) => {
			for (const item of raw) {
				const job = source.normalize(item);
				const stored = tx
					.select({ id: jobs.id })
					.from(jobs)
					.where(
						and(
							eq(jobs.source, job.source),
							eq(jobs.externalId, job.externalId),
						),
					)
					.get();
				const closed = source.isClosed?.(item) ?? false;

				if (stored) {
					// Keep what can change at the source current. Title and company
					// stay: they make up the hash that deduplicates across sources.
					tx.update(jobs)
						.set({
							description: job.description,
							expiresAt: job.expiresAt,
							lastSeenAt: fetchedAt,
							closedAt: closed ? fetchedAt : null,
						})
						.where(eq(jobs.id, stored.id))
						.run();
					continue;
				}
				// A posting first seen already closed is not worth keeping.
				if (closed) continue;
				const inserted = tx
					.insert(jobs)
					.values({ ...job, hash: jobHash(job), lastSeenAt: fetchedAt })
					.onConflictDoNothing()
					.returning({ id: jobs.id })
					.get();
				if (inserted) report.inserted++;
			}

			// A complete listing that no longer has a posting means it closed.
			if (source.snapshot) {
				report.closed = tx
					.update(jobs)
					.set({ closedAt: fetchedAt })
					.where(
						and(
							eq(jobs.source, source.id),
							isNull(jobs.closedAt),
							sql`coalesce(${jobs.lastSeenAt}, ${jobs.createdAt}) < ${Math.floor(fetchedAt.getTime() / 1000)}`,
						),
					)
					.run().changes;
			}
		});
	} catch (error) {
		// One broken source must not stop the others.
		report.error = errorMessage(error);
	}

	db.update(runs)
		.set({
			finishedAt: new Date(),
			jobsFound: report.found,
			errors: report.error ? [report.error] : null,
		})
		.where(eq(runs.id, run.id))
		.run();
	return report;
}

/** Thrown when another process (CLI or worker) is already scanning. */
export class ScanBusyError extends Error {
	constructor() {
		super(
			"Outra varredura já está em andamento; tente de novo quando ela terminar.",
		);
		this.name = "ScanBusyError";
	}
}

/**
 * Errors caused by one job's content (HTTP 400 or 413 from the API), which
 * would not repeat for the next job. Anything else (auth, rate limit,
 * outage) would, so it stops the scoring.
 */
function isJobError(error: unknown): boolean {
	const status = (error as { status?: unknown } | null)?.status;
	return status === 400 || status === 413;
}

// Per-job errors in a row that mean the request itself is broken.
const MAX_JOB_ERRORS_IN_A_ROW = 3;

// Tokens a job is assumed to cost before any job of the scan has finished.
const DEFAULT_TOKENS_PER_JOB = 8_000;

/**
 * Collects every source, then filters and scores the new jobs. Only one scan
 * runs at a time across processes; a second one throws ScanBusyError.
 */
export async function runScan(opts: ScanOptions): Promise<ScanReport> {
	const lock = acquireLock(opts.db, "scan");
	if (!lock) throw new ScanBusyError();
	try {
		return await scan(opts, lock);
	} finally {
		lock.release();
	}
}

async function scan(opts: ScanOptions, lock: Lock): Promise<ScanReport> {
	const {
		db,
		sources,
		preferences,
		score,
		maxScored,
		dailyTokenLimit,
		concurrency = 4,
		now = new Date(),
		log = () => {},
	} = opts;

	const report: ScanReport = {
		sources: [],
		duplicates: 0,
		pending: 0,
		rejected: {},
		candidates: 0,
		scored: [],
		deferred: 0,
		inputTokens: 0,
		outputTokens: 0,
	};

	for (const source of sources) {
		lock.heartbeat();
		log(`Buscando vagas em ${source.id}...`);
		report.sources.push(await collect(db, source, preferences));
	}
	// Duplicates are never scored or notified; their original already is.
	report.duplicates = markDuplicates(db, now);

	// Every unscored job is re-filtered, not only the new ones, so jobs left
	// behind by a limit or by older preferences get another chance.
	const pending = db
		.select({ job: jobs })
		.from(jobs)
		.leftJoin(jobScores, eq(jobScores.jobId, jobs.id))
		.where(
			and(
				isNull(jobScores.id),
				isNull(jobs.duplicateOf),
				// Only jobs from the sources in this scan, so `--source x` stays scoped.
				inArray(
					jobs.source,
					sources.map((s) => s.id),
				),
				gte(
					jobs.createdAt,
					new Date(now.getTime() - MAX_JOB_AGE_DAYS * DAY_MS),
				),
			),
		)
		.all();
	report.pending = pending.length;

	const candidates: { id: number; job: Job; bonus: number }[] = [];
	for (const { job: row } of pending) {
		const { id, hash: _hash, createdAt: _createdAt, ...job } = row;
		const result = hardFilter(job, preferences, now);
		if (result.pass) candidates.push({ id, job, bonus: result.bonus.length });
		else
			report.rejected[result.reason] =
				(report.rejected[result.reason] ?? 0) + 1;
	}
	// Jobs in Brazil before jobs abroad, then most skill overlap, then newest,
	// so a limit cuts the lowest-priority ones.
	candidates.sort(
		(a, b) =>
			Number(a.job.abroad ?? false) - Number(b.job.abroad ?? false) ||
			b.bonus - a.bonus ||
			(b.job.publishedAt?.getTime() ?? 0) - (a.job.publishedAt?.getTime() ?? 0),
	);
	report.candidates = candidates.length;

	// How many internships each company has open per source: a company that
	// posts dozens at once is a mass-posting signal the model cannot see alone.
	// Counted over every recent job, scored or not, so one new posting from a
	// company that already has twenty still carries the signal.
	const internshipsByCompany = new Map(
		db
			.select({
				source: jobs.source,
				company: jobs.company,
				total: sql<number>`count(*)`,
			})
			.from(jobs)
			.where(
				and(
					eq(jobs.level, "estágio"),
					isNull(jobs.duplicateOf),
					gte(
						jobs.createdAt,
						new Date(now.getTime() - MAX_JOB_AGE_DAYS * DAY_MS),
					),
				),
			)
			.groupBy(jobs.source, jobs.company)
			.all()
			.map((row) => [`${row.source}|${row.company}`, row.total]),
	);

	const usedToday = tokensUsedSince(db, startOfDay(now));
	const scoringRun = db
		.insert(runs)
		.values({ source: "scoring", startedAt: new Date() })
		.returning({ id: runs.id })
		.get();

	if (candidates.length > 0) {
		log(`Pontuando até ${Math.min(maxScored, candidates.length)} vagas...`);
	}
	const queue = [...candidates];
	let started = 0;
	let finished = 0;
	let inFlight = 0;
	let jobErrorsInARow = 0;
	const skipped: typeof candidates = [];
	const spent = () => report.inputTokens + report.outputTokens;
	const worker = async () => {
		while (queue.length > 0 && !report.scoringError) {
			// Jobs still running count at the average cost so far, so parallel
			// workers do not all start past the budget together.
			const perJob = finished > 0 ? spent() / finished : DEFAULT_TOKENS_PER_JOB;
			const committed = usedToday + spent() + inFlight * perJob;
			if (started >= maxScored || committed >= dailyTokenLimit) return;
			const next = queue.shift();
			if (!next) return;
			started++;
			inFlight++;

			let result: JobScoreResult;
			try {
				result = await score(next.job, {
					companyInternships:
						internshipsByCompany.get(
							`${next.job.source}|${next.job.company}`,
						) ?? 0,
				});
			} catch (error) {
				inFlight--;
				started--;
				if (isJobError(error) && ++jobErrorsInARow < MAX_JOB_ERRORS_IN_A_ROW) {
					// This job alone is the problem: try it again next scan and
					// go on with the others.
					log(`Vaga #${next.id} não pôde ser pontuada: ${errorMessage(error)}`);
					skipped.push(next);
					continue;
				}
				report.scoringError = errorMessage(error);
				queue.unshift(next);
				return;
			}
			inFlight--;
			finished++;
			jobErrorsInARow = 0;
			report.inputTokens += result.inputTokens;
			report.outputTokens += result.outputTokens;
			db.transaction((tx) => {
				const saved = tx
					.insert(jobScores)
					.values({
						jobId: next.id,
						score: result.score?.score ?? null,
						analysis: result.score,
						model: result.model,
					})
					.onConflictDoNothing()
					.returning({ id: jobScores.id })
					.get();
				tx.insert(jobStatus)
					.values({ jobId: next.id })
					.onConflictDoNothing()
					.run();
				// Spending is saved per job, so a crash mid-scan still counts
				// toward the daily limit.
				tx.update(runs)
					.set({
						inputTokens: report.inputTokens,
						outputTokens: report.outputTokens,
					})
					.where(eq(runs.id, scoringRun.id))
					.run();
				if (saved)
					report.scored.push({ jobId: next.id, job: next.job, result });
			});
			lock.heartbeat();
		}
	};
	await Promise.all(Array.from({ length: concurrency }, worker));
	queue.push(...skipped);
	report.deferred = queue.length;

	db.update(runs)
		.set({
			finishedAt: new Date(),
			jobsFound: report.scored.length,
			errors: report.scoringError ? [report.scoringError] : null,
			inputTokens: report.inputTokens,
			outputTokens: report.outputTokens,
		})
		.where(eq(runs.id, scoringRun.id))
		.run();

	return report;
}

// claude-haiku-5-5 list prices per million tokens (cache reads cost less, so
// this slightly overestimates).
const INPUT_USD_PER_MTOK = 0.1;
const OUTPUT_USD_PER_MTOK = 0.5;

export function formatScanReport(report: ScanReport, minScore: number): string {
	const lines: string[] = [];

	const ranked = [...report.scored].sort(
		(a, b) => (b.result.score?.score ?? -1) - (a.result.score?.score ?? -1),
	);
	if (ranked.length > 0) lines.push("");
	for (const { job, result } of ranked) {
		const s = result.score;
		const mark = s && s.score >= minScore ? "★" : " ";
		const where = [job.modality, job.location].filter(Boolean).join(" · ");
		lines.push(
			`${mark} ${s ? String(s.score).padStart(3) : "  ?"}  ${job.title} — ${job.company}${where ? ` · ${where}` : ""}`,
		);
		lines.push(
			`        ${s ? s.summary : "Não foi possível pontuar esta vaga."}`,
		);
		if (s && s.dealBreakers.length > 0) {
			lines.push(`        Impedimentos: ${s.dealBreakers.join("; ")}`);
		}
		lines.push(`        ${job.url}`);
	}

	lines.push("", "Resumo");
	for (const source of report.sources) {
		lines.push(
			source.error
				? `  ${source.id}: falhou (${source.error})`
				: `  ${source.id}: ${source.found} vagas, ${source.inserted} novas`,
		);
	}
	if (report.duplicates > 0) {
		lines.push(
			`  Duplicadas: ${report.duplicates} (mesma vaga já vista em outra fonte ou repostada)`,
		);
	}
	const rejected = Object.entries(report.rejected)
		.sort(([, a], [, b]) => b - a)
		.map(([reason, count]) => `${reason} ${count}`)
		.join(", ");
	lines.push(
		`  Filtro: ${report.pending} pendentes, ${report.candidates} candidatas${rejected ? ` (descartadas: ${rejected})` : ""}`,
	);
	const above = report.scored.filter(
		(j) => (j.result.score?.score ?? 0) >= minScore,
	).length;
	lines.push(
		`  Pontuadas: ${report.scored.length}, ${above} com nota ≥ ${minScore}`,
	);
	if (report.deferred > 0) {
		lines.push(
			`  ${report.deferred} candidatas ficaram para a próxima varredura (limite por varredura ou diário).`,
		);
	}
	if (report.scoringError) {
		lines.push(`  Pontuação interrompida: ${report.scoringError}`);
	}
	const cost =
		(report.inputTokens * INPUT_USD_PER_MTOK +
			report.outputTokens * OUTPUT_USD_PER_MTOK) /
		1_000_000;
	lines.push(
		`  Tokens: ${report.inputTokens} de entrada, ${report.outputTokens} de saída (~US$ ${cost.toFixed(3)})`,
	);
	return lines.join("\n");
}
