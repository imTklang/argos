import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
	type Job,
	JobScore,
	type Preferences,
	type Profile,
} from "@radar/core";

export const SCORE_MODEL = "claude-haiku-5-5";

const INSTRUCTIONS = `Você avalia vagas de estágio para um estudante específico e dá uma nota de 0 a 100 de aderência.
O perfil e as preferências do estudante estão abaixo. A vaga vem na mensagem do usuário.

Como pontuar:
- 85–100: estágio de desenvolvimento (de preferência backend) cuja stack se sobrepõe bastante ao perfil, sem impedimentos.
- 70–84: estágio de desenvolvimento ou TI com boa parte da stack em comum, ou backend com stack diferente mas aprendível.
- 40–69: estágio de TI fora de desenvolvimento (suporte, dados, infraestrutura) ou com pouca sobreposição de stack.
- 0–39: fora de tecnologia, ou com um impedimento claro.

Impedimentos (dealBreakers) são requisitos que o estudante não cumpre de forma objetiva: curso diferente de Ciência da Computação ou correlatos,
período mínimo acima do atual, formatura antes da prevista, carga horária acima do máximo, idioma exigido que não está no perfil, local presencial fora da região.
Cada impedimento derruba a nota para no máximo 39. Não invente impedimentos que a vaga não declara, e na dúvida não marque impedimento.
Ao comparar datas, semestre "AAAA/1" é de janeiro a junho e "AAAA/2" é de julho a dezembro: formatura em Jul/2028 é 2028/2.
"Formatura a partir de X" é cumprido por qualquer formatura igual ou posterior a X.

Vagas remotas para empresas no exterior (marcadas "Remota no exterior: sim"):
- Avalie a aderência como em qualquer outra vaga; não dê nota menor só por ser no exterior.
- São impedimentos: exigir residência, cidadania ou autorização de trabalho em país que não inclua o Brasil; fuso incompatível com UTC-3 quando a vaga exige horário fixo; nível de inglês acima do que o perfil declara (compare com a escala CEFR do perfil: B2 atende "intermediário avançado", "conversação" e "leitura técnica", mas não "fluente/nativo" nem C1/C2 exigidos de forma explícita).
- Moeda estrangeira (USD, EUR) não é problema.

Sinais de vaga de baixa qualidade, em qualquer origem, contam como impedimento: estágio não remunerado, cobrança de taxa do candidato, ou anúncio genérico sem projeto, equipe ou responsabilidades concretas.
Quando a mesma empresa tem 10 ou mais estágios abertos na mesma fonte e a vaga não declara remuneração, trate como anúncio em massa (impedimento); empresas sérias com programa grande costumam informar a bolsa.

matchedSkills: tecnologias da vaga que o estudante tem. missingSkills: tecnologias pedidas pela vaga que ele não tem.
summary: uma ou duas frases em português dizendo por que vale ou não vale se candidatar.`;

export type JobScoreResult = {
	score: JobScore | null;
	model: string;
	inputTokens: number;
	outputTokens: number;
};

export type ScoreContext = { profile: Profile; preferences: Preferences };

/** Facts about a job that only the pipeline knows, not the posting itself. */
export type JobHints = {
	/** Open internships from the same company on the same source. */
	companyInternships?: number;
};

function describeJob(job: Job, hints: JobHints): string {
	const lines = [
		`Título: ${job.title}`,
		`Empresa: ${job.company}`,
		`Modalidade: ${job.modality ?? "não informada"}`,
		`Local: ${job.location ?? "não informado"}`,
		`Remota no exterior: ${job.abroad ? "sim" : "não"}`,
	];
	if (hints.companyInternships) {
		lines.push(
			`Estágios abertos por esta empresa nesta fonte: ${hints.companyInternships}`,
		);
	}
	if (job.expiresAt) {
		lines.push(`Inscrições até: ${job.expiresAt.toISOString().slice(0, 10)}`);
	}
	lines.push("", job.description);
	return `<vaga>\n${lines.join("\n")}\n</vaga>`;
}

/**
 * Scores one job. Retries once when the output fails validation and returns
 * a null score after that, so a bad response never stops a scan.
 */
export async function scoreJob(
	client: Anthropic,
	context: ScoreContext,
	job: Job,
	hints: JobHints = {},
): Promise<JobScoreResult> {
	// Profile and preferences are identical for every job in a scan, so they
	// sit in a cached system block ahead of the per-job message.
	const contextBlock = [
		"<perfil>",
		JSON.stringify(context.profile, null, 2),
		"</perfil>",
		"<preferencias>",
		JSON.stringify(context.preferences, null, 2),
		"</preferencias>",
	].join("\n");

	const result: JobScoreResult = {
		score: null,
		model: SCORE_MODEL,
		inputTokens: 0,
		outputTokens: 0,
	};

	for (let attempt = 0; attempt < 2; attempt++) {
		const response = await client.messages.parse({
			model: SCORE_MODEL,
			max_tokens: 16000,
			output_config: { effort: "medium", format: zodOutputFormat(JobScore) },
			system: [
				{ type: "text", text: INSTRUCTIONS },
				{
					type: "text",
					text: contextBlock,
					cache_control: { type: "ephemeral" },
				},
			],
			messages: [{ role: "user", content: describeJob(job, hints) }],
		});

		result.model = response.model;
		result.inputTokens +=
			response.usage.input_tokens +
			(response.usage.cache_creation_input_tokens ?? 0) +
			(response.usage.cache_read_input_tokens ?? 0);
		result.outputTokens += response.usage.output_tokens;

		// A refusal will not change on retry.
		if (response.stop_reason === "refusal") return result;
		if (response.parsed_output) {
			result.score = response.parsed_output;
			return result;
		}
	}
	return result;
}
