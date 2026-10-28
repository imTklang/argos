import { isSameOpening, MAX_JOB_AGE_DAYS, titleKey } from "@radar/core";
import { and, asc, type Db, eq, isNull, jobs, lt } from "@radar/db";

const DAY_MS = 24 * 60 * 60 * 1000;

type StoredJob = typeof jobs.$inferSelect;

/**
 * Whether an earlier posting still stands for the opening. A repost of an
 * expired or stale posting is a fresh chance, not a duplicate: linking it
 * would hide it, since the old one is filtered out and never scored.
 */
function isCurrent(job: StoredJob, now: Date): boolean {
	const cutoff = now.getTime() - MAX_JOB_AGE_DAYS * DAY_MS;
	if (job.expiresAt && job.expiresAt < now) return false;
	if (job.publishedAt && job.publishedAt.getTime() < cutoff) return false;
	return job.createdAt.getTime() >= cutoff;
}

/**
 * Links each job not yet checked to the earliest earlier job it repeats,
 * across sources or as a repost on the same source. Jobs inserted since the
 * last call are the unchecked ones, so the first call also backfills
 * everything already stored. Only current postings count as originals.
 * Returns how many duplicates it found.
 */
export function markDuplicates(db: Db, now = new Date()): number {
	let found = 0;
	db.transaction((tx) => {
		const unchecked = tx
			.select()
			.from(jobs)
			.where(isNull(jobs.titleKey))
			.orderBy(asc(jobs.id))
			.all();

		for (const job of unchecked) {
			const key = titleKey(job.title);
			// Only originals are candidates, so chains point at the first one.
			const original = tx
				.select()
				.from(jobs)
				.where(
					and(
						eq(jobs.titleKey, key),
						lt(jobs.id, job.id),
						isNull(jobs.duplicateOf),
					),
				)
				.orderBy(asc(jobs.id))
				.all()
				.find(
					(candidate) =>
						isCurrent(candidate, now) && isSameOpening(candidate, job),
				);

			tx.update(jobs)
				.set({ titleKey: key, duplicateOf: original?.id ?? null })
				.where(eq(jobs.id, job.id))
				.run();
			if (original) found++;
		}
	});
	return found;
}
