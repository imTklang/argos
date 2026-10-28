import { fileURLToPath } from "node:url";
import { Anthropic, generateCoverLetter } from "@radar/ai";
import { createDb } from "@radar/db";
import { PREFERENCES_PATH } from "@radar/pipeline";
import { buildServer } from "./server.ts";

const port = Number.parseInt(process.env.API_PORT ?? "", 10) || 3333;
// ARGOS_DEMO=1: read-only copy to share through a tunnel (pnpm demo).
const demo = process.env.ARGOS_DEMO === "1";
const client = new Anthropic();

const app = buildServer({
	db: createDb(process.env.DATABASE_PATH ?? "./data/radar.db"),
	preferencesPath: PREFERENCES_PATH,
	generateCoverLetter: (input) => generateCoverLetter(client, input),
	webRoot: fileURLToPath(new URL("../../web/dist", import.meta.url)),
	logger: true,
	demo,
});

// Loopback only: the dashboard edits personal data and has no login.
app
	.listen({ host: "127.0.0.1", port })
	.then((address) =>
		console.log(
			`Argos em ${address}${demo ? " (demonstração, só leitura)" : ""}`,
		),
	)
	.catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
