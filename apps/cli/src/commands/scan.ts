import type { JobScoreResult } from "@radar/ai";
import {
	type FilterReason,
	hardFilter,
	type Job,
	jobHash,
	MAX_JOB_AGE_DAYS,
	type Preferences,
} from "@radar/core";
import {
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
	runs,
	sql,
} from "@radar/db";
import type { JobSource } from "@radar/sources";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ScannedJob = { jobId: number; job: Job; result: JobScoreResult };

export type ScanReport = {
	sources: { id: string; found: number; inserted: number; error?: string }[];
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
	score: (job: Job) => Promise<JobScoreResult>;
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

	try {
		const raw = await source.fetchJobs({
			keywords: preferences.roles,
			locations: preferences.locations,
			modality: preferences.modality,
			since,
		});
		report.found = raw.length;
		db.transaction((tx) => {
			for (const item of raw) {
				const job = source.normalize(item);
				const inserted = tx
					.insert(jobs)
					.values({ ...job, hash: jobHash(job) })
					.onConflictDoNothing()
					.returning({ id: jobs.id })
					.get();
				if (inserted) report.inserted++;
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

export async function runScan(opts: ScanOptions): Promise<ScanReport> {
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
		pending: 0,
		rejected: {},
		candidates: 0,
		scored: [],
		deferred: 0,
		inputTokens: 0,
		outputTokens: 0,
	};

	for (const source of sources) {
		log(`Buscando vagas em ${source.id}...`);
		report.sources.push(await collect(db, source, preferences));
	}

	// Every unscored job is re-filtered, not only the new ones, so jobs left
	// behind by a limit or by older preferences get another chance.
	const pending = db
		.select({ job: jobs })
		.from(jobs)
		.leftJoin(jobScores, eq(jobScores.jobId, jobs.id))
		.where(
			and(
				isNull(jobScores.id),
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
	// Most skill overlap first, then newest, so a limit cuts the weakest.
	candidates.sort(
		(a, b) =>
			b.bonus - a.bonus ||
			(b.job.publishedAt?.getTime() ?? 0) - (a.job.publishedAt?.getTime() ?? 0),
	);
	report.candidates = candidates.length;

	const startOfDay = new Date(now);
	startOfDay.setHours(0, 0, 0, 0);
	const usedToday = tokensUsedSince(db, startOfDay);
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
	const worker = async () => {
		while (queue.length > 0 && !report.scoringError) {
			const spent = usedToday + report.inputTokens + report.outputTokens;
			if (started >= maxScored || spent >= dailyTokenLimit) return;
			const next = queue.shift();
			if (!next) return;
			started++;

			let result: JobScoreResult;
			try {
				result = await score(next.job);
			} catch (error) {
				// API-level failures (auth, outage) would repeat for every job.
				report.scoringError = errorMessage(error);
				queue.unshift(next);
				return;
			}
			report.inputTokens += result.inputTokens;
			report.outputTokens += result.outputTokens;
			db.insert(jobScores)
				.values({
					jobId: next.id,
					score: result.score?.score ?? null,
					analysis: result.score,
					model: result.model,
				})
				.run();
			db.insert(jobStatus)
				.values({ jobId: next.id })
				.onConflictDoNothing()
				.run();
			report.scored.push({ jobId: next.id, job: next.job, result });
		}
	};
	await Promise.all(Array.from({ length: concurrency }, worker));
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
