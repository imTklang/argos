import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_JOB_AGE_DAYS } from "@radar/core";
import Database from "better-sqlite3";
import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";
import { jobs, locks } from "./schema.ts";

export {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	or,
	sql,
} from "drizzle-orm";
export * from "./schema.ts";

const migrationsFolder = fileURLToPath(
	new URL("../migrations", import.meta.url),
);

export function createDb(path: string) {
	// A fresh server has no data directory yet.
	if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
	const sqlite = new Database(path);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder });
	return db;
}

export type Db = ReturnType<typeof createDb>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Postings still worth showing: not taken down, deadline not passed, and
 * seen by a fetch within the job age limit.
 */
export function isOpenJob(now: Date) {
	const cutoff = Math.floor((now.getTime() - MAX_JOB_AGE_DAYS * DAY_MS) / 1000);
	return and(
		isNull(jobs.closedAt),
		or(isNull(jobs.expiresAt), gte(jobs.expiresAt, now)),
		sql`coalesce(${jobs.lastSeenAt}, ${jobs.createdAt}) >= ${cutoff}`,
	);
}

export type Lock = {
	/** Proves the holder is alive; call it while the work goes on. */
	heartbeat(): void;
	release(): void;
};

/**
 * Takes a named lock shared by every process on this database, or returns
 * null when another live process holds it. A lock whose heartbeat is older
 * than staleMs is taken over, since its holder died without releasing it.
 */
export function acquireLock(
	db: Db,
	name: string,
	opts: { staleMs?: number; now?: () => Date } = {},
): Lock | null {
	const { staleMs = 30 * 60 * 1000, now = () => new Date() } = opts;
	const holder = `${hostname()}:${process.pid}:${randomUUID()}`;
	const taken = db.transaction((tx) => {
		const at = now();
		tx.delete(locks)
			.where(
				and(
					eq(locks.name, name),
					lt(locks.heartbeatAt, new Date(at.getTime() - staleMs)),
				),
			)
			.run();
		return tx
			.insert(locks)
			.values({ name, holder, heartbeatAt: at })
			.onConflictDoNothing()
			.returning({ name: locks.name })
			.get();
	});
	if (!taken) return null;

	const mine = and(eq(locks.name, name), eq(locks.holder, holder));
	return {
		heartbeat: () =>
			db.update(locks).set({ heartbeatAt: now() }).where(mine).run(),
		release: () => db.delete(locks).where(mine).run(),
	};
}
