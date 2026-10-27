import { parseArgs } from "node:util";
import { Anthropic, scoreJob } from "@radar/ai";
import { createDb } from "@radar/db";
import {
	createSources,
	loadLatestProfile,
	readPreferences,
	readSourcesConfig,
} from "@radar/pipeline";
import { Bot } from "grammy";
import cron from "node-cron";
import { exclusive, runCycle } from "./cycle.ts";
import {
	createTelegramMessenger,
	escapeHtml,
	registerHandlers,
} from "./telegram.ts";

// Times are in João Pessoa's offset; America/Fortaleza has the same UTC-3 and
// no daylight saving.
const TIMEZONE = "America/Fortaleza";
const SCHEDULES = [
	{ cron: "0 8 * * *", digest: false },
	{ cron: "0 18 * * *", digest: true },
];

function intFromEnv(name: string, fallback: number) {
	const value = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function log(message: string) {
	const time = new Date().toLocaleString("pt-BR", { timeZone: TIMEZONE });
	for (const line of message.split("\n")) console.log(`[${time}] ${line}`);
}

async function main() {
	const { values } = parseArgs({
		options: {
			now: { type: "boolean", default: false },
			digest: { type: "boolean", default: false },
		},
	});

	const token = process.env.TELEGRAM_BOT_TOKEN;
	if (!token) {
		throw new Error(
			"TELEGRAM_BOT_TOKEN não configurado. Crie o bot no @BotFather e coloque o token no .env.",
		);
	}
	const chatId = process.env.TELEGRAM_CHAT_ID || undefined;

	const db = createDb(process.env.DATABASE_PATH ?? "./data/radar.db");
	const bot = new Bot(token);
	registerHandlers(bot, db, chatId);
	const messenger = chatId ? createTelegramMessenger(bot.api, chatId) : null;
	const client = new Anthropic();

	// One lock for scheduled and manual runs alike.
	const cycle = exclusive(
		async (digest: boolean) => {
			try {
				const preferences = await readPreferences();
				const profile = loadLatestProfile(db);
				if (!profile) {
					throw new Error(
						"Nenhum perfil encontrado. Rode: pnpm cli profile import <curriculo.pdf>",
					);
				}
				const sources = createSources(await readSourcesConfig());
				await runCycle({
					db,
					sources,
					preferences,
					profile,
					score: (job, p) => scoreJob(client, { profile: p, preferences }, job),
					messenger,
					digest,
					maxScored: intFromEnv("SCAN_MAX_JOBS", 50),
					dailyTokenLimit: intFromEnv("DAILY_TOKEN_LIMIT", 2_000_000),
					log,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				log(`Varredura falhou: ${message}`);
				// Unattended runs should not fail silently.
				await messenger
					?.sendText(`⚠️ Varredura falhou: ${escapeHtml(message)}`)
					.catch(() => {});
			}
		},
		() => log("Varredura anterior ainda em andamento; pulando esta."),
	);

	const tasks = SCHEDULES.map((s) =>
		cron.schedule(s.cron, () => void cycle(s.digest), {
			timezone: TIMEZONE,
		}),
	);

	const stop = async () => {
		log("Encerrando...");
		for (const task of tasks) await task.stop();
		await bot.stop();
		process.exit(0);
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	log(`Worker ativo. Varreduras às 8h e às 18h (${TIMEZONE}); resumo às 18h.`);
	if (!chatId) {
		log(
			"TELEGRAM_CHAT_ID vazio: envie /start ao bot para descobrir o ID do chat.",
		);
	}
	if (values.now) void cycle(values.digest);

	// Long polling keeps the process alive and receives the button presses.
	await bot.start({ drop_pending_updates: false });
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
