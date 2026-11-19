import { parseArgs } from "node:util";
import { Anthropic, scoreJob } from "@radar/ai";
import { createDb } from "@radar/db";
import {
	createSources,
	DATABASE_PATH,
	loadLatestProfile,
	readPreferences,
	readSourcesConfig,
	ScanBusyError,
	TIMEZONE,
} from "@radar/pipeline";
import { Bot } from "grammy";
import cron from "node-cron";
import { exclusive, runCycle } from "./cycle.ts";
import {
	createTelegramMessenger,
	escapeHtml,
	registerHandlers,
} from "./telegram.ts";

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

	const db = createDb(DATABASE_PATH);
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
					score: (job, p, hints) =>
						scoreJob(client, { profile: p, preferences }, job, hints),
					messenger,
					digest,
					maxScored: intFromEnv("SCAN_MAX_JOBS", 50),
					dailyTokenLimit: intFromEnv("DAILY_TOKEN_LIMIT", 2_000_000),
					log,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				log(`Varredura falhou: ${message}`);
				// A CLI scan running now is not a failure worth a message.
				if (error instanceof ScanBusyError) return;
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

	let stopping = false;
	const stop = async () => {
		stopping = true;
		log("Encerrando...");
		for (const task of tasks) await task.stop();
		// Let a running scan finish so its scores and spending are saved.
		await cycle.idle();
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
	try {
		await bot.start({ drop_pending_updates: false });
	} catch (error) {
		// bot.stop() interrupts the long poll; that is not a failure.
		if (!stopping) throw error;
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
