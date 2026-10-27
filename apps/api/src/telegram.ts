import type { Db } from "@radar/db";
import {
	type Decision,
	decide,
	type Messenger,
	type NotifiableJob,
} from "@radar/pipeline";
import { type Api, type Bot, InlineKeyboard } from "grammy";

// Telegram rejects messages over 4096 characters; keep the digest well below.
const DIGEST_LIMIT = 3500;

const DECISIONS: Record<string, Decision> = {
	save: "salva",
	discard: "descartada",
};

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function where(item: NotifiableJob): string {
	return [item.job.modality, item.job.location].filter(Boolean).join(" · ");
}

// Himalayas API terms ask for a visible link back to the source.
const ATTRIBUTION: Record<string, string> = {
	himalayas: `<a href="https://himalayas.app">via Himalayas</a>`,
};

export function formatJob(item: NotifiableJob): string {
	const { job, score } = item;
	const lines = [
		`⭐ <b>${score.score}</b> · <b>${escapeHtml(job.title)}</b>`,
		`${escapeHtml(job.company)}${where(item) ? ` · ${escapeHtml(where(item))}` : ""}`,
		"",
		escapeHtml(score.summary),
	];
	if (score.matchedSkills.length > 0) {
		lines.push(`✅ ${escapeHtml(score.matchedSkills.join(", "))}`);
	}
	if (score.missingSkills.length > 0) {
		lines.push(`➕ ${escapeHtml(score.missingSkills.join(", "))}`);
	}
	const via = ATTRIBUTION[job.source];
	lines.push(
		"",
		`<a href="${escapeHtml(job.url)}">Ver vaga</a>${via ? ` · ${via}` : ""}`,
	);
	return lines.join("\n");
}

function digestLine(item: NotifiableJob): string {
	const { job, score } = item;
	const via = ATTRIBUTION[job.source];
	return `\n<b>${score.score}</b> · <a href="${escapeHtml(job.url)}">${escapeHtml(job.title)}</a> — ${escapeHtml(job.company)}${where(item) ? ` · ${escapeHtml(where(item))}` : ""}${via ? ` · ${via}` : ""}`;
}

/**
 * The digest as one or more messages: jobs in Brazil first, remote jobs
 * abroad in their own section after. It splits instead of truncating, since
 * every job passed in is recorded as sent.
 */
export function formatDigest(items: NotifiableJob[]): string[] {
	const local = items.filter((i) => !i.job.abroad);
	const abroad = items.filter((i) => i.job.abroad);
	const header = `📋 <b>Resumo do dia</b>: ${items.length} ${items.length === 1 ? "vaga" : "vagas"}\n`;
	const sections: [string | null, NotifiableJob[]][] = [
		[local.length > 0 && abroad.length > 0 ? "🇧🇷 <b>Brasil</b>" : null, local],
		["🌎 <b>Remoto no exterior</b>", abroad],
	];

	const pages: string[] = [];
	let text = header;
	const push = (chunk: string) => {
		if (text.length + chunk.length > DIGEST_LIMIT) {
			pages.push(text);
			text = "📋 <b>Resumo do dia</b> (continuação)\n";
		}
		text += chunk;
	};
	for (const [title, group] of sections) {
		if (group.length === 0) continue;
		if (title) push(`\n${title}`);
		for (const item of group) push(digestLine(item));
		if (title) push("\n");
	}
	pages.push(text);
	return pages;
}

export function decisionKeyboard(jobId: number): InlineKeyboard {
	return new InlineKeyboard()
		.text("💾 Salvar", `save:${jobId}`)
		.text("🗑 Descartar", `discard:${jobId}`);
}

export function parseDecision(
	data: string,
): { jobId: number; status: Decision } | null {
	const match = /^(save|discard):(\d+)$/.exec(data);
	const status = match?.[1] ? DECISIONS[match[1]] : undefined;
	if (!match?.[2] || !status) return null;
	return { jobId: Number(match[2]), status };
}

/**
 * Applies a button press. Only the configured chat may change job status,
 * since anyone who finds the bot can talk to it.
 */
export function handleDecision(
	db: Db,
	allowedChatId: string | undefined,
	fromChatId: number | undefined,
	data: string,
): string {
	if (!allowedChatId || String(fromChatId) !== allowedChatId) {
		return "Este chat não está autorizado.";
	}
	const decision = parseDecision(data);
	if (!decision) return "Ação desconhecida.";
	if (!decide(db, decision.jobId, decision.status)) {
		return "Vaga não encontrada.";
	}
	return decision.status === "salva" ? "💾 Vaga salva" : "🗑 Vaga descartada";
}

export function createTelegramMessenger(
	api: Pick<Api, "sendMessage">,
	chatId: string,
): Messenger {
	return {
		channel: "telegram",
		async sendJob(item) {
			const message = await api.sendMessage(chatId, formatJob(item), {
				parse_mode: "HTML",
				link_preview_options: { is_disabled: true },
				reply_markup: decisionKeyboard(item.jobId),
			});
			return String(message.message_id);
		},
		async sendDigest(items) {
			let first: string | undefined;
			for (const page of formatDigest(items)) {
				const message = await api.sendMessage(chatId, page, {
					parse_mode: "HTML",
					link_preview_options: { is_disabled: true },
				});
				first ??= String(message.message_id);
			}
			return first ?? "";
		},
		async sendText(text) {
			const message = await api.sendMessage(chatId, text, {
				parse_mode: "HTML",
			});
			return String(message.message_id);
		},
	};
}

export function registerHandlers(
	bot: Bot,
	db: Db,
	chatId: string | undefined,
): void {
	bot.command("start", (ctx) =>
		ctx.reply(
			chatId
				? "Radar de Estágio ativo. As vagas chegam aqui às 8h e às 18h."
				: `O ID deste chat é <code>${ctx.chat.id}</code>.\nColoque <code>TELEGRAM_CHAT_ID=${ctx.chat.id}</code> no .env e reinicie o worker.`,
			{ parse_mode: "HTML" },
		),
	);

	bot.on("callback_query:data", async (ctx) => {
		// The outcome button left after a choice does nothing.
		if (ctx.callbackQuery.data === "noop") return ctx.answerCallbackQuery();
		const answer = handleDecision(
			db,
			chatId,
			ctx.chat?.id,
			ctx.callbackQuery.data,
		);
		await ctx.answerCallbackQuery({ text: answer });
		if (answer.startsWith("💾") || answer.startsWith("🗑")) {
			// Replace the buttons with the outcome so the choice is visible later.
			await ctx.editMessageReplyMarkup({
				reply_markup: new InlineKeyboard().text(answer, "noop"),
			});
		}
	});
}
