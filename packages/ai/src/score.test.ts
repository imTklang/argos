import type Anthropic from "@anthropic-ai/sdk";
import type { Job, Preferences, Profile } from "@radar/core";
import { describe, expect, it, vi } from "vitest";
import { scoreJob } from "./score.ts";

const profile: Profile = {
	name: "Ana Souza",
	course: "Ciência da Computação",
	institution: "UFPB",
	currentPeriod: 4,
	expectedGraduation: "",
	skills: [{ name: "Node.js", level: "avançado" }],
	languages: [],
	projects: [],
	experience: [],
};

const preferences: Preferences = {
	roles: ["estágio backend"],
	keywordsMust: ["estágio"],
	keywordsBonus: ["node.js"],
	keywordsBlock: [],
	modality: ["remoto"],
	locations: [],
	minScoreToNotify: 70,
};

const job: Job = {
	source: "gupy",
	externalId: "1",
	title: "Estágio Backend",
	company: "Acme",
	location: null,
	modality: "remoto",
	description: "Node.js e Postgres.",
	url: "https://acme.gupy.io/job/1",
	publishedAt: null,
	expiresAt: new Date("2026-11-30T00:00:00Z"),
};

const score = {
	score: 88,
	matchedSkills: ["Node.js"],
	missingSkills: ["Postgres"],
	dealBreakers: [],
	summary: "Backend em Node, remoto.",
};

function response(patch: Record<string, unknown>) {
	return {
		model: "claude-haiku-5-5",
		stop_reason: "end_turn",
		usage: {
			input_tokens: 100,
			output_tokens: 50,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 900,
		},
		parsed_output: null,
		...patch,
	};
}

function fakeClient(...responses: Record<string, unknown>[]) {
	const parse = vi.fn();
	for (const r of responses) parse.mockResolvedValueOnce(response(r));
	return {
		client: { messages: { parse } } as unknown as Anthropic,
		parse,
	};
}

describe("scoreJob", () => {
	it("returns the score and counts cached input tokens", async () => {
		const { client, parse } = fakeClient({ parsed_output: score });

		const result = await scoreJob(client, { profile, preferences }, job);

		expect(result).toEqual({
			score,
			model: "claude-haiku-5-5",
			inputTokens: 1000,
			outputTokens: 50,
		});
		const params = parse.mock.calls[0]?.[0];
		expect(params.model).toBe("claude-haiku-5-5");
		expect(params.system[1].cache_control).toEqual({ type: "ephemeral" });
		expect(params.system[1].text).toContain("Ana Souza");
		expect(params.messages[0].content).toContain("Estágio Backend");
		expect(params.messages[0].content).toContain("2026-11-30");
		expect(params.messages[0].content).not.toContain("Estágios abertos");
	});

	it("tells the model about experience and contract deal breakers", async () => {
		const { client, parse } = fakeClient({ parsed_output: score });
		await scoreJob(client, { profile, preferences }, job);
		const instructions = parse.mock.calls[0]?.[0].system[0].text;
		expect(instructions).toContain(
			"experiência profissional prévia comprovada",
		);
		expect(instructions).toContain("Lei 11.788");
	});

	it("passes the company's open internship count when known", async () => {
		const { client, parse } = fakeClient({ parsed_output: score });
		await scoreJob(client, { profile, preferences }, job, {
			companyInternships: 21,
		});
		expect(parse.mock.calls[0]?.[0].messages[0].content).toContain(
			"Estágios abertos por esta empresa nesta fonte: 21",
		);
	});

	it("retries once when the output does not parse", async () => {
		const { client, parse } = fakeClient(
			{ parsed_output: null },
			{ parsed_output: score },
		);

		const result = await scoreJob(client, { profile, preferences }, job);

		expect(parse).toHaveBeenCalledTimes(2);
		expect(result.score).toEqual(score);
		expect(result.outputTokens).toBe(100);
	});

	it("gives up with a null score after two invalid outputs", async () => {
		const { client, parse } = fakeClient(
			{ parsed_output: null },
			{ parsed_output: null },
		);

		const result = await scoreJob(client, { profile, preferences }, job);

		expect(parse).toHaveBeenCalledTimes(2);
		expect(result.score).toBeNull();
	});

	it("does not retry a refusal", async () => {
		const { client, parse } = fakeClient({ stop_reason: "refusal" });

		const result = await scoreJob(client, { profile, preferences }, job);

		expect(parse).toHaveBeenCalledTimes(1);
		expect(result.score).toBeNull();
	});
});
