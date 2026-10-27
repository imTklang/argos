import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { extractProfile, ProfileExtractionError } from "./profile.ts";

function fakeClient(response: Record<string, unknown>) {
	const parse = vi.fn().mockResolvedValue({
		model: "claude-sonnet-5-5",
		stop_reason: "end_turn",
		stop_details: null,
		usage: { input_tokens: 1200, output_tokens: 400 },
		parsed_output: null,
		...response,
	});
	const client = { beta: { messages: { parse } } } as unknown as Anthropic;
	return { client, parse };
}

const profile = {
	name: "Ana Souza",
	course: "Ciência da Computação",
	institution: "UFPB",
	currentPeriod: 4,
	expectedGraduation: "",
	skills: [],
	languages: [],
	projects: [],
	experience: [],
};

describe("extractProfile", () => {
	it("returns the parsed profile and token usage", async () => {
		const { client, parse } = fakeClient({ parsed_output: profile });

		const result = await extractProfile(client, "texto do currículo");

		expect(result).toEqual({
			profile,
			model: "claude-sonnet-5-5",
			inputTokens: 1200,
			outputTokens: 400,
		});
		const params = parse.mock.calls[0]?.[0];
		expect(params.model).toBe("claude-sonnet-5-5");
		expect(params.messages[0].content).toContain("texto do currículo");
	});

	it("throws on refusal", async () => {
		const { client } = fakeClient({
			stop_reason: "refusal",
			stop_details: { category: "cyber" },
		});
		await expect(extractProfile(client, "x")).rejects.toThrow(
			ProfileExtractionError,
		);
	});

	it("throws when the output did not parse", async () => {
		const { client } = fakeClient({ parsed_output: null });
		await expect(extractProfile(client, "x")).rejects.toThrow(/formato/);
	});
});
