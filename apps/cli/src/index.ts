import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Anthropic, extractProfile, scoreJob } from "@radar/ai";
import { createDb, desc, profiles } from "@radar/db";
import {
	createCieeSource,
	createGupySource,
	createSolidesSource,
} from "@radar/sources";
import { initPreferences, readPreferences } from "./commands/prefs-init.ts";
import { formatProfile, importProfile } from "./commands/profile-import.ts";
import { formatScanReport, runScan } from "./commands/scan.ts";
import { readResume } from "./resume.ts";

const usage = `Radar de Estágio

Uso:
  pnpm cli profile import <curriculo.pdf> [--force]   Lê o currículo e gera o perfil
  pnpm cli prefs init [--force]                       Gera preferências a partir do perfil
  pnpm cli scan [--max N]                             Busca e pontua vagas`;

const PREFERENCES_PATH = "./data/preferences.json";

function openDb() {
	return createDb(process.env.DATABASE_PATH ?? "./data/radar.db");
}

function hasAnthropicCredentials() {
	const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_PROFILE } =
		process.env;
	if (ANTHROPIC_API_KEY || ANTHROPIC_AUTH_TOKEN || ANTHROPIC_PROFILE) {
		return true;
	}
	console.error(
		"ANTHROPIC_API_KEY não configurada. Coloque a chave no arquivo .env e rode de novo.",
	);
	process.exitCode = 1;
	return false;
}

function intFromEnv(name: string, fallback: number) {
	const value = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function scan(args: string[]) {
	const { values } = parseArgs({ args, options: { max: { type: "string" } } });
	if (!hasAnthropicCredentials()) return;

	const preferences = await readPreferences(PREFERENCES_PATH);
	const db = openDb();
	const profile = db
		.select()
		.from(profiles)
		.orderBy(desc(profiles.id))
		.limit(1)
		.get();
	if (!profile) {
		console.error(
			"Nenhum perfil encontrado. Rode primeiro: pnpm cli profile import <curriculo.pdf>",
		);
		process.exitCode = 1;
		return;
	}

	const client = new Anthropic();
	const context = { profile: profile.data, preferences };
	const report = await runScan({
		db,
		sources: [createGupySource(), createSolidesSource(), createCieeSource()],
		preferences,
		score: (job) => scoreJob(client, context, job),
		maxScored: values.max
			? Number.parseInt(values.max, 10)
			: intFromEnv("SCAN_MAX_JOBS", 50),
		dailyTokenLimit: intFromEnv("DAILY_TOKEN_LIMIT", 2_000_000),
		log: (message) => console.log(message),
	});
	console.log(formatScanReport(report, preferences.minScoreToNotify));
}

async function prefsInit(args: string[]) {
	const { values } = parseArgs({
		args,
		options: { force: { type: "boolean", default: false } },
	});
	const result = await initPreferences({
		db: openDb(),
		path: PREFERENCES_PATH,
		force: values.force,
	});

	switch (result.kind) {
		case "no-profile":
			console.error(
				"Nenhum perfil encontrado. Rode primeiro: pnpm cli profile import <curriculo.pdf>",
			);
			process.exitCode = 1;
			return;
		case "exists":
			console.log(
				`${result.path} já existe e pode ter edições suas. Use --force para gerar de novo.`,
			);
			return;
		case "created":
			console.log(
				`Preferências geradas a partir do perfil #${result.profileId} em ${result.path}\n`,
			);
			console.log(JSON.stringify(result.prefs, null, 2));
			console.log(
				"\nRevise e edite o arquivo: palavras-chave, cidades, carga horária e nota mínima para aviso.",
			);
	}
}

async function profileImport(args: string[]) {
	const { positionals, values } = parseArgs({
		args,
		allowPositionals: true,
		options: { force: { type: "boolean", default: false } },
	});
	const [pdfPath] = positionals;
	if (!pdfPath) {
		console.error("Informe o caminho do currículo em PDF.\n");
		console.log(usage);
		process.exitCode = 1;
		return;
	}

	if (!hasAnthropicCredentials()) return;

	const db = openDb();
	console.log("Lendo o currículo...");
	const resume = await readResume(resolve(pdfPath));

	const result = await importProfile({
		db,
		resume,
		force: values.force,
		extract: (text) => extractProfile(new Anthropic(), text),
	});

	if (result.kind === "duplicate") {
		console.log(
			`Este currículo já foi importado (perfil #${result.profileId}). Use --force para extrair de novo.\n`,
		);
		console.log(formatProfile(result.profile));
		return;
	}

	const { extraction } = result;
	console.log(`Perfil #${result.profileId} salvo.\n`);
	console.log(formatProfile(extraction.profile));
	console.log(
		`\n${extraction.model} · ${extraction.inputTokens} tokens de entrada, ${extraction.outputTokens} de saída`,
	);
}

async function main() {
	const [command, subcommand, ...rest] = process.argv.slice(2);

	if (command === "profile" && subcommand === "import") {
		await profileImport(rest);
		return;
	}
	if (command === "prefs" && subcommand === "init") {
		await prefsInit(rest);
		return;
	}
	if (command === "scan") {
		await scan([subcommand, ...rest].filter((a) => a !== undefined));
		return;
	}
	console.log(usage);
}

main().catch((error: unknown) => {
	if (error instanceof Anthropic.AuthenticationError) {
		console.error(
			"Chave da Anthropic inválida ou ausente. Configure ANTHROPIC_API_KEY no .env.",
		);
	} else if (error instanceof Anthropic.APIError) {
		console.error(`Erro da API Anthropic (${error.status}): ${error.message}`);
	} else {
		console.error(error instanceof Error ? error.message : error);
	}
	process.exitCode = 1;
});
