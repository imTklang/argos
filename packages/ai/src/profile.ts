import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Profile } from "@radar/core";

export const PROFILE_MODEL = "claude-sonnet-5-5";

const SYSTEM_PROMPT = `Você extrai um perfil estruturado a partir do texto de um currículo de estudante de tecnologia.
O perfil será usado para buscar e pontuar vagas de estágio, então precisão importa mais que completude.

Regras:
- Use só o que está escrito no currículo. Não invente skills, projetos ou experiências.
- Escreva os textos em português, mantendo nomes de tecnologias como aparecem (ex.: "Node.js", "TypeScript").
- skills: uma entrada por tecnologia, ferramenta ou conceito técnico (ex.: "Docker", "arquitetura orientada a eventos").
  Para decidir o nível, cruze a lista de skills com os projetos e experiências: o nível vem do uso, não de onde a skill foi listada.
  - level "avançado": usada em sistema em produção ou entregue a cliente, ou base de dois ou mais projetos.
  - level "intermediário": usada em pelo menos um projeto real.
  - level "básico": só citada como estudo, curso ou interesse, sem nenhum projeto que a use.
  - Ferramentas de base do dia a dia de quem tem projetos reais (Git, GitHub, APIs REST) são no mínimo "intermediário" quando houver projetos publicados ou entregues.
  - Uma skill marcada como "em estudo" ou "ampliando repertório" que aparece na stack de um projeto em produção segue a regra do uso, não a da frase.
  - evidence: onde a skill aparece (projeto, experiência ou curso), em poucas palavras.
- projects: projetos pessoais, acadêmicos ou de sociedade, com a stack usada. Se um projeto não lista stack, deixe a lista vazia.
- experience: empregos, estágios, freelas e trabalhos para clientes.
- currentPeriod: o período atual do curso como número inteiro.
- expectedGraduation: previsão de formatura como aparece no currículo (ex.: "12/2027"); string vazia se não constar.`;

export class ProfileExtractionError extends Error {
	override name = "ProfileExtractionError";
}

export type ProfileExtraction = {
	profile: Profile;
	model: string;
	inputTokens: number;
	outputTokens: number;
};

export async function extractProfile(
	client: Anthropic,
	resumeText: string,
): Promise<ProfileExtraction> {
	const response = await client.beta.messages.parse({
		model: PROFILE_MODEL,
		max_tokens: 16000,
		betas: ["server-side-fallback-2026-07-01"],
		fallbacks: "default",
		output_config: {
			effort: "medium",
			format: betaZodOutputFormat(Profile),
		},
		system: SYSTEM_PROMPT,
		messages: [
			{
				role: "user",
				content: `<curriculo>\n${resumeText}\n</curriculo>`,
			},
		],
	});

	if (response.stop_reason === "refusal") {
		throw new ProfileExtractionError(
			`O modelo recusou a extração (${response.stop_details?.category ?? "sem categoria"}).`,
		);
	}
	if (response.stop_reason === "max_tokens") {
		throw new ProfileExtractionError("A resposta foi cortada por max_tokens.");
	}
	if (!response.parsed_output) {
		throw new ProfileExtractionError(
			"A resposta não veio no formato de perfil esperado.",
		);
	}

	return {
		profile: response.parsed_output,
		model: response.model,
		inputTokens: response.usage.input_tokens,
		outputTokens: response.usage.output_tokens,
	};
}
