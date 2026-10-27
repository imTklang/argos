import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Anthropic, extractProfile } from "@radar/ai";
import { createDb } from "@radar/db";
import { formatProfile, importProfile } from "./commands/profile-import.ts";
import { readResume } from "./resume.ts";

const usage = `Radar de Estágio

Uso:
  pnpm cli profile import <curriculo.pdf> [--force]   Lê o currículo e gera o perfil
  pnpm cli prefs init                                 Gera preferências a partir do perfil
  pnpm cli scan                                       Busca e pontua vagas`;

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

	const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_PROFILE } =
		process.env;
	if (!ANTHROPIC_API_KEY && !ANTHROPIC_AUTH_TOKEN && !ANTHROPIC_PROFILE) {
		console.error(
			"ANTHROPIC_API_KEY não configurada. Coloque a chave no arquivo .env e rode de novo.",
		);
		process.exitCode = 1;
		return;
	}

	const db = createDb(process.env.DATABASE_PATH ?? "./data/radar.db");
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
	if (command === "prefs" || command === "scan") {
		console.log("Ainda não implementado.");
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
