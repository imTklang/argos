import type { Job, JobScore, Preferences } from "@radar/core";
import {
	and,
	type Db,
	desc,
	eq,
	gte,
	isNull,
	jobScores,
	jobStatus,
	jobs,
	notifications,
	sql,
} from "@radar/db";

export const DEFAULT_INSTANT_ALERT_SCORE = 85;

export type NotifiableJob = {
	jobId: number;
	job: Job;
	score: JobScore;
};

/** Where notifications go. The worker plugs Telegram in; tests use a fake. */
export interface Messenger {
	readonly channel: string;
	/** One job with save/discard actions; returns the message id. */
	sendJob(item: NotifiableJob): Promise<string>;
	sendDigest(items: NotifiableJob[]): Promise<string>;
	/** Plain notice, e.g. a failed scheduled scan. */
	sendText(text: string): Promise<string>;
}

function scoredJobs(
	db: Db,
	minScore: number,
	excludeKinds: string[],
	includeAbroad: boolean,
) {
	const alreadySent = db
		.select({ jobId: notifications.jobId })
		.from(notifications)
		.where(
			sql`${notifications.kind} in (${sql.join(
				excludeKinds.map((k) => sql`${k}`),
				sql`, `,
			)})`,
		);

	const rows = db
		.select({ job: jobs, score: jobScores, status: jobStatus.status })
		.from(jobScores)
		.innerJoin(jobs, eq(jobs.id, jobScores.jobId))
		.leftJoin(jobStatus, eq(jobStatus.jobId, jobs.id))
		.where(
			and(
				gte(jobScores.score, minScore),
				// Saved or discarded jobs were already handled by the user.
				sql`coalesce(${jobStatus.status}, 'nova') = 'nova'`,
				sql`${jobs.id} not in ${alreadySent}`,
				includeAbroad ? undefined : eq(jobs.abroad, false),
				// The original was (or will be) notified on its own.
				isNull(jobs.duplicateOf),
			),
		)
		// Jobs in Brazil first, then by score.
		.orderBy(jobs.abroad, desc(jobScores.score))
		.all();

	return rows.flatMap(({ job: row, score }) => {
		if (!score.analysis) return [];
		const { id, hash: _hash, createdAt: _createdAt, ...job } = row;
		return [{ jobId: id, job, score: score.analysis }];
	});
}

/**
 * Strong matches not yet alerted. Jobs abroad never interrupt: they wait for
 * the digest, since the user wants them available but not prioritized.
 */
export function pendingAlerts(db: Db, prefs: Preferences): NotifiableJob[] {
	const threshold = prefs.instantAlertScore ?? DEFAULT_INSTANT_ALERT_SCORE;
	return scoredJobs(db, threshold, ["alert"], false);
}

/** Jobs above the notify threshold that no message has mentioned yet, Brazil first. */
export function pendingDigest(db: Db, prefs: Preferences): NotifiableJob[] {
	return scoredJobs(db, prefs.minScoreToNotify, ["alert", "digest"], true);
}

function record(
	db: Db,
	items: NotifiableJob[],
	kind: "alert" | "digest",
	channel: string,
	messageId: string,
) {
	if (items.length === 0) return;
	db.insert(notifications)
		.values(items.map((i) => ({ jobId: i.jobId, kind, channel, messageId })))
		.run();
}

export type NotifyResult = { alerts: number; digest: number };

/**
 * Sends instant alerts and, when asked, the digest. Each job is recorded as
 * soon as its message goes out, so a failure halfway never re-sends the ones
 * already delivered.
 */
export async function notify(opts: {
	db: Db;
	prefs: Preferences;
	messenger: Messenger;
	digest: boolean;
}): Promise<NotifyResult> {
	const { db, prefs, messenger } = opts;
	const result: NotifyResult = { alerts: 0, digest: 0 };

	for (const item of pendingAlerts(db, prefs)) {
		const messageId = await messenger.sendJob(item);
		record(db, [item], "alert", messenger.channel, messageId);
		result.alerts++;
	}

	if (opts.digest) {
		const items = pendingDigest(db, prefs);
		if (items.length > 0) {
			const messageId = await messenger.sendDigest(items);
			record(db, items, "digest", messenger.channel, messageId);
			result.digest = items.length;
		}
	}
	return result;
}

export type Decision = "salva" | "descartada";

/** Applies a save/discard choice coming back from a notification button. */
export function decide(db: Db, jobId: number, status: Decision): boolean {
	const job = db
		.select({ id: jobs.id })
		.from(jobs)
		.where(eq(jobs.id, jobId))
		.get();
	if (!job) return false;
	db.insert(jobStatus)
		.values({ jobId, status, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: jobStatus.jobId,
			set: { status, updatedAt: new Date() },
		})
		.run();
	return true;
}
