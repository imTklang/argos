import { isSameOpening, titleKey } from "@radar/core";
import { and, asc, type Db, eq, isNull, jobs, lt } from "@radar/db";

/**
 * Links each job not yet checked to the earliest earlier job it repeats,
 * across sources or as a repost on the same source. Jobs inserted since the
 * last call are the unchecked ones, so the first call also backfills
 * everything already stored. Returns how many duplicates it found.
 */
export function markDuplicates(db: Db): number {
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
				.find((candidate) => isSameOpening(candidate, job));

			tx.update(jobs)
				.set({ titleKey: key, duplicateOf: original?.id ?? null })
				.where(eq(jobs.id, job.id))
				.run();
			if (original) found++;
		}
	});
	return found;
}
