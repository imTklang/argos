import type { Profile } from "@radar/core";
import { type Db, desc, profiles } from "@radar/db";

/** The most recently imported profile, or null before the first import. */
export function loadLatestProfile(db: Db): Profile | null {
	const row = db
		.select({ data: profiles.data })
		.from(profiles)
		.orderBy(desc(profiles.id))
		.limit(1)
		.get();
	return row?.data ?? null;
}
