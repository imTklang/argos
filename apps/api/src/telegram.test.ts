import type { JobScore } from "@radar/core";
import { createDb, jobStatus, jobs } from "@radar/db";
import type { NotifiableJob } from "@radar/pipeline";
import { describe, expect, it, vi } from "vitest";
import {
	createTelegramMessenger,
	escapeHtml,
	formatDigest,
	formatJob,
	handleDecision,
	parseDecision,
} from "./telegram.ts";

const score: JobScore = {
	score: 88,
	matchedSkills: ["Node.js", "TypeScript"],
	missingSkills: ["Go"],
	dealBreakers: [],
	summary: "Backend em Node <remoto> & com mentoria.",
};

function item(n = 1, patch: Partial<NotifiableJob["job"]> = {}): NotifiableJob {
	return {
		jobId: n,
		score,
		job: {
			source: "gupy",
			externalId: String(n),
			title: `Estágio Backend ${n}`,
			company: "Acme & Cia",
			location: "João Pessoa, PB",
			modality: "híbrido",
			description: "",
			url: `https://acme.gupy.io/job/${n}?a=1&b=2`,
			publishedAt: null,
			expiresAt: null,
			...patch,
		},
	};
}

describe("formatJob", () => {
	it("shows score, place, summary, skills and link, HTML-escaped", () => {
		const text = formatJob(item());
		expect(text).toContain("⭐ <b>88</b> · <b>Estágio Backend 1</b>");
		expect(text).toContain("Acme &amp; Cia · híbrido · João Pessoa, PB");
		expect(text).toContain(
			"Backend em Node &lt;remoto&gt; &amp; com mentoria.",
		);
		expect(text).toContain("✅ Node.js, TypeScript");
		expect(text).toContain("➕ Go");
		expect(text).toContain('href="https://acme.gupy.io/job/1?a=1&amp;b=2"');
	});
});

describe("formatDigest", () => {
	it("lists every job when it fits", () => {
		const text = formatDigest([item(1), item(2)]);
		expect(text).toContain("2 vagas");
		expect(text).toContain("Estágio Backend 2");
		expect(text).not.toContain("e mais");
	});

	it("puts jobs abroad in their own section after Brazil", () => {
		const text = formatDigest([
			item(1),
			item(2, { abroad: true, title: "Backend Intern" }),
		]);
		expect(text.indexOf("🇧🇷 <b>Brasil</b>")).toBeLessThan(
			text.indexOf("🌎 <b>Remoto no exterior</b>"),
		);
		expect(text.indexOf("Estágio Backend 1")).toBeLessThan(
			text.indexOf("Backend Intern"),
		);
	});

	it("skips the Brazil heading when every job is local", () => {
		expect(formatDigest([item(1)])).not.toContain("<b>Brasil</b>");
	});

	it("credits Himalayas as the API terms require", () => {
		const himalayas = item(3, { source: "himalayas", abroad: true });
		expect(formatDigest([himalayas])).toContain(
			'href="https://himalayas.app">via Himalayas',
		);
		expect(formatJob(himalayas)).toContain("via Himalayas");
		expect(formatJob(item(4))).not.toContain("via Himalayas");
	});

	it("stays under Telegram's message limit", () => {
		const many = Array.from({ length: 200 }, (_, i) => item(i));
		const text = formatDigest(many);
		expect(text.length).toBeLessThan(4096);
		expect(text).toMatch(/…e mais \d+\./);
	});
});

describe("parseDecision", () => {
	it("reads the button payloads", () => {
		expect(parseDecision("save:12")).toEqual({ jobId: 12, status: "salva" });
		expect(parseDecision("discard:3")).toEqual({
			jobId: 3,
			status: "descartada",
		});
	});

	it("rejects anything else", () => {
		expect(parseDecision("delete:1")).toBeNull();
		expect(parseDecision("save:abc")).toBeNull();
		expect(parseDecision("noop")).toBeNull();
	});
});

describe("handleDecision", () => {
	function dbWithJob() {
		const db = createDb(":memory:");
		const { id } = db
			.insert(jobs)
			.values({
				source: "gupy",
				externalId: "1",
				title: "Estágio",
				company: "Acme",
				location: null,
				modality: "remoto",
				description: "",
				url: "https://x",
				publishedAt: null,
				expiresAt: null,
				hash: "h",
			})
			.returning({ id: jobs.id })
			.get();
		return { db, id };
	}

	it("saves a job when the configured chat presses the button", () => {
		const { db, id } = dbWithJob();
		expect(handleDecision(db, "42", 42, `save:${id}`)).toBe("💾 Vaga salva");
		expect(db.select().from(jobStatus).get()?.status).toBe("salva");
	});

	it("refuses other chats and an unset chat id", () => {
		const { db, id } = dbWithJob();
		expect(handleDecision(db, "42", 7, `save:${id}`)).toMatch(
			/não está autorizado/,
		);
		expect(handleDecision(db, undefined, 42, `save:${id}`)).toMatch(
			/não está autorizado/,
		);
		expect(db.select().from(jobStatus).all()).toHaveLength(0);
	});

	it("reports unknown jobs and actions", () => {
		const { db } = dbWithJob();
		expect(handleDecision(db, "42", 42, "save:999")).toBe(
			"Vaga não encontrada.",
		);
		expect(handleDecision(db, "42", 42, "hack:1")).toBe("Ação desconhecida.");
	});
});

describe("createTelegramMessenger", () => {
	it("sends jobs with save/discard buttons to the configured chat", async () => {
		const sendMessage = vi.fn().mockResolvedValue({ message_id: 77 });
		const messenger = createTelegramMessenger({ sendMessage } as never, "42");

		const id = await messenger.sendJob(item(5));

		expect(id).toBe("77");
		const [chat, , options] = sendMessage.mock.calls[0] ?? [];
		expect(chat).toBe("42");
		expect(options.parse_mode).toBe("HTML");
		const buttons = options.reply_markup.inline_keyboard[0];
		expect(
			buttons.map((b: { callback_data: string }) => b.callback_data),
		).toEqual(["save:5", "discard:5"]);
	});

	it("sends the digest and plain notices without buttons", async () => {
		const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
		const messenger = createTelegramMessenger({ sendMessage } as never, "42");

		await messenger.sendDigest([item()]);
		await messenger.sendText("⚠️ falhou");

		for (const call of sendMessage.mock.calls) {
			expect(call[2].reply_markup).toBeUndefined();
		}
	});
});

describe("escapeHtml", () => {
	it("escapes the characters Telegram HTML cares about", () => {
		expect(escapeHtml(`<a href="x">&</a>`)).toBe(
			`&lt;a href="x"&gt;&amp;&lt;/a&gt;`,
		);
	});
});
