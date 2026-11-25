import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "sqlite",
	schema: "./src/schema.ts",
	out: "./migrations",
	dbCredentials: {
		// Relative paths in .env are from the repository root, like the apps.
		url: resolve("../..", process.env.DATABASE_PATH || "data/radar.db"),
	},
});
