import type Anthropic from "@anthropic-ai/sdk";
import type { Job, JobScore, Profile } from "@radar/core";

export const COVER_LETTER_MODEL = "claude-sonnet-5-5";

const SYSTEM_PROMPT = `Você escreve rascunhos de mensagem de apresentação para um estudante se candidatar a uma vaga de estágio.

Regras:
- Escreva no idioma da descrição da vaga: português para vaga em português, inglês para vaga em inglês.
- No máximo 220 palavras, em 3 ou 4 parágrafos curtos, sem título e sem assinatura além do nome.
- Use só fatos do perfil. Não invente experiências, números, tecnologias nem nível de idioma.
- Conecte 2 ou 3 projetos ou experiências concretas do perfil aos requisitos da vaga, citando a tecnologia em comum.
- Se faltar algo que a vaga pede, não esconda nem exagere: mencione em uma frase que está aprendendo ou disposto a aprender, só se for verdade plausível pelo perfil.
- Tom direto e profissional, sem bajulação e sem frases genéricas ("sou apaixonado por tecnologia").
- Comece com uma saudação simples ao time da empresa e termine com o nome do estudante.
- Responda só com o texto da mensagem.`;

export type CoverLetter = {
	text: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
};

export class CoverLetterError extends Error {
	override name = "CoverLetterError";
}

export async function generateCoverLetter(
	client: Anthropic,
	input: { profile: Profile; job: Job; analysis: JobScore | null },
): Promise<CoverLetter> {
	const { profile, job, analysis } = input;
	const fit = analysis
		? [
				`Tecnologias em comum: ${analysis.matchedSkills.join(", ") || "nenhuma identificada"}`,
				`Tecnologias que faltam: ${analysis.missingSkills.join(", ") || "nenhuma"}`,
			].join("\n")
		: "";

	const response = await client.beta.messages.create({
		model: COVER_LETTER_MODEL,
		max_tokens: 16000,
		betas: ["server-side-fallback-2026-07-01"],
		fallbacks: "default",
		output_config: { effort: "medium" },
		system: SYSTEM_PROMPT,
		messages: [
			{
				role: "user",
				content: [
					`<perfil>\n${JSON.stringify(profile, null, 2)}\n</perfil>`,
					`<vaga>\nTítulo: ${job.title}\nEmpresa: ${job.company}\nLocal: ${job.location ?? "não informado"}\n\n${job.description}\n</vaga>`,
					fit ? `<aderencia>\n${fit}\n</aderencia>` : "",
				]
					.filter(Boolean)
					.join("\n\n"),
			},
		],
	});

	if (response.stop_reason === "refusal") {
		throw new CoverLetterError("O modelo recusou gerar a carta.");
	}
	if (response.stop_reason === "max_tokens") {
		throw new CoverLetterError("A resposta foi cortada por max_tokens.");
	}
	const text = response.content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("")
		.trim();
	if (!text) throw new CoverLetterError("A resposta veio vazia.");

	return {
		text,
		model: response.model,
		inputTokens: response.usage.input_tokens,
		outputTokens: response.usage.output_tokens,
	};
}
