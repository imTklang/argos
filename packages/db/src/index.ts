import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

export { and, desc, eq } from "drizzle-orm";
export * from "./schema.ts";

const migrationsFolder = fileURLToPath(
	new URL("../migrations", import.meta.url),
);

export function createDb(path: string) {
	const sqlite = new Database(path);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder });
	return db;
}

export type Db = ReturnType<typeof createDb>;
