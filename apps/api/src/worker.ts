import { parseArgs } from "node:util";
import { Anthropic, scoreJob } from "@radar/ai";
import { createDb, type Db, eq, runs, sql } from "@radar/db";
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
import { exclusive, missedSlot, runCycle, type Slot } from "./cycle.ts";
import {
	createTelegramMessenger,
	escapeHtml,
	registerHandlers,
} from "./telegram.ts";

const SCHEDULES: Slot[] = [
	{ hour: 8, digest: false },
	{ hour: 18, digest: true },
];
// How often to look for a scan missed while the computer was asleep.
const CATCH_UP_EVERY_MS = 10 * 60 * 1000;

/** When the last scan reached scoring, from any process (CLI or worker). */
function lastScanStart(db: Db): Date | null {
	const row = db
		.select({ at: sql<number | null>`max(${runs.startedAt})` })
		.from(runs)
		.where(eq(runs.source, "scoring"))
		.get();
	return row?.at ? new Date(row.at * 1000) : null;
}

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

	// Telegram is optional: without it the scans still fill the dashboard.
	const token = process.env.TELEGRAM_BOT_TOKEN || undefined;
	const chatId = process.env.TELEGRAM_CHAT_ID || undefined;

	const db = createDb(DATABASE_PATH);
	const bot = token ? new Bot(token) : null;
	if (bot) registerHandlers(bot, db, chatId);
	const messenger =
		bot && chatId ? createTelegramMessenger(bot.api, chatId) : null;
	const client = new Anthropic();

	// Started in this process, so a run that fails before scoring is not
	// retried every few minutes by the catch-up check.
	let lastAttempt: Date | null = null;

	// One lock for scheduled and manual runs alike.
	const cycle = exclusive(
		async (digest: boolean) => {
			lastAttempt = new Date();
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
		cron.schedule(`0 ${s.hour} * * *`, () => void cycle(s.digest), {
			timezone: TIMEZONE,
		}),
	);

	// A computer asleep at 8h or 18h misses the cron; run that scan on waking.
	const catchUp = () => {
		const starts = [lastScanStart(db), lastAttempt].filter(
			(d): d is Date => d !== null,
		);
		const last = starts.length
			? new Date(Math.max(...starts.map(Number)))
			: null;
		const missed = missedSlot(last, new Date(), SCHEDULES, TIMEZONE);
		if (!missed) return;
		log("Varredura agendada perdida (computador dormindo?); rodando agora.");
		void cycle(missed.digest);
	};
	const catchUpTimer = setInterval(catchUp, CATCH_UP_EVERY_MS);

	let stopping = false;
	const stop = async () => {
		stopping = true;
		log("Encerrando...");
		clearInterval(catchUpTimer);
		for (const task of tasks) await task.stop();
		// Let a running scan finish so its scores and spending are saved.
		await cycle.idle();
		await bot?.stop();
		process.exit(0);
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	log(`Worker ativo. Varreduras às 8h e às 18h (${TIMEZONE}); resumo às 18h.`);
	if (!bot) {
		log(
			"Sem TELEGRAM_BOT_TOKEN: as vagas ficam só no dashboard. Veja o README para ligar o Telegram.",
		);
	} else if (!chatId) {
		log(
			"TELEGRAM_CHAT_ID vazio: envie /start ao bot para descobrir o ID do chat.",
		);
	}
	if (values.now) void cycle(values.digest);
	else catchUp();

	// Without a bot, the cron tasks and the catch-up timer keep it alive.
	if (!bot) return;
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
