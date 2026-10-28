import type Anthropic from "@anthropic-ai/sdk";
import type { Job, Profile } from "@radar/core";
import { describe, expect, it, vi } from "vitest";
import { CoverLetterError, generateCoverLetter } from "./cover-letter.ts";

const profile: Profile = {
	name: "Ana Souza",
	course: "Ciência da Computação",
	institution: "UFPB",
	currentPeriod: 4,
	expectedGraduation: "",
	skills: [{ name: "Node.js", level: "avançado" }],
	languages: [{ name: "Inglês", level: "B2" }],
	projects: [],
	experience: [],
};

const job: Job = {
	source: "himalayas",
	externalId: "1",
	title: "Backend Intern",
	company: "Acme",
	location: "Remoto, qualquer país",
	modality: "remoto",
	description: "We use Node.js and Postgres.",
	url: "https://example.com/1",
	publishedAt: null,
	expiresAt: null,
};

function fakeClient(response: Record<string, unknown>) {
	const create = vi.fn().mockResolvedValue({
		model: "claude-sonnet-5-5",
		stop_reason: "end_turn",
		usage: { input_tokens: 900, output_tokens: 300 },
		content: [{ type: "text", text: "Hi Acme team,\n\n...\n\nAna Souza" }],
		...response,
	});
	return {
		client: { beta: { messages: { create } } } as unknown as Anthropic,
		create,
	};
}

describe("generateCoverLetter", () => {
	it("asks Sonnet with the profile, the job and the fit", async () => {
		const { client, create } = fakeClient({});

		const letter = await generateCoverLetter(client, {
			profile,
			job,
			analysis: {
				score: 80,
				matchedSkills: ["Node.js"],
				missingSkills: ["Postgres"],
				dealBreakers: [],
				summary: "",
			},
		});

		expect(letter).toEqual({
			text: "Hi Acme team,\n\n...\n\nAna Souza",
			model: "claude-sonnet-5-5",
			inputTokens: 900,
			outputTokens: 300,
		});
		const params = create.mock.calls[0]?.[0];
		expect(params.model).toBe("claude-sonnet-5-5");
		expect(params.fallbacks).toBe("default");
		expect(params.messages[0].content).toContain("Ana Souza");
		expect(params.messages[0].content).toContain(
			"We use Node.js and Postgres.",
		);
		expect(params.messages[0].content).toContain(
			"Tecnologias que faltam: Postgres",
		);
	});

	it("works without a score analysis", async () => {
		const { client, create } = fakeClient({});
		await generateCoverLetter(client, { profile, job, analysis: null });
		expect(create.mock.calls[0]?.[0].messages[0].content).not.toContain(
			"<aderencia>",
		);
	});

	it("throws on refusal or an empty answer", async () => {
		await expect(
			generateCoverLetter(
				fakeClient({ stop_reason: "refusal", content: [] }).client,
				{
					profile,
					job,
					analysis: null,
				},
			),
		).rejects.toThrow(CoverLetterError);
		await expect(
			generateCoverLetter(fakeClient({ content: [] }).client, {
				profile,
				job,
				analysis: null,
			}),
		).rejects.toThrow(/vazia/);
	});
});
