import type { Job } from "@radar/core";
import { z } from "zod";
import type { JobSource } from "./index.ts";
import { sleep as defaultSleep, politeFetch } from "./util.ts";

// Public endpoint behind the job board on portal.ciee.org.br.
const ENDPOINT = "https://api.ciee.org.br/vagas/vitrine-vaga/publicadas";
const PAGE_SIZE = 1000;
// ~2,300 higher-education internships as of 2026-10.
const MAX_PAGES = 10;

export const CieeJob = z.object({
	codigoVaga: z.number(),
	nomeEmpresa: z.string(),
	areaProfissional: z.string().nullable(),
	bolsaAuxilio: z.number().nullable(),
	descricao: z.string().nullable(),
	atividades: z.array(z.string()).nullable(),
	local: z
		.object({ cidade: z.string().nullable(), uf: z.string().nullable() })
		.nullable(),
	horarioEntrada: z.string().nullable(),
	horarioSaida: z.string().nullable(),
	requisitos: z
		.object({
			semestreInicio: z.number().nullable(),
			semestreFinal: z.number().nullable(),
		})
		.nullable(),
});
export type CieeJob = z.infer<typeof CieeJob>;

const SpringPage = z.object({
	content: z.array(z.unknown()),
	last: z.boolean(),
});

export type CieeOptions = {
	fetch?: typeof globalThis.fetch;
	sleep?: (ms: number) => Promise<void>;
	delayMs?: number;
	onInvalid?: (raw: unknown, error: z.ZodError) => void;
};

const brl = new Intl.NumberFormat("pt-BR", {
	style: "currency",
	currency: "BRL",
});

function describe(raw: CieeJob): string {
	const lines: string[] = [];
	// descricao is the company's line of business, not the role.
	if (raw.descricao) lines.push(`Atividade da empresa: ${raw.descricao}`);
	if (raw.atividades?.length) {
		lines.push("Atividades:", ...raw.atividades.map((a) => `- ${a}`));
	}
	if (raw.bolsaAuxilio) lines.push(`Bolsa: ${brl.format(raw.bolsaAuxilio)}`);
	if (raw.horarioEntrada && raw.horarioSaida) {
		lines.push(
			`Horário: ${raw.horarioEntrada.slice(0, 5)} às ${raw.horarioSaida.slice(0, 5)}`,
		);
	}
	const { semestreInicio, semestreFinal } = raw.requisitos ?? {};
	if (semestreInicio && semestreFinal) {
		lines.push(`Semestres aceitos: ${semestreInicio}º ao ${semestreFinal}º`);
	}
	lines.push("Nível: ensino superior");
	return lines.join("\n");
}

export function createCieeSource(opts: CieeOptions = {}): JobSource<CieeJob> {
	const {
		fetch = globalThis.fetch,
		sleep = defaultSleep,
		delayMs = 1500,
		onInvalid,
	} = opts;

	return {
		id: "ciee",

		// The API ignores its uf filter, so this fetches every higher-education
		// internship (three pages) and leaves location to the local filter.
		async fetchJobs() {
			const jobs: CieeJob[] = [];
			for (let page = 0; page < MAX_PAGES; page++) {
				if (page > 0) await sleep(delayMs);
				const params = new URLSearchParams({
					tipoVaga: "ESTAGIO",
					nivelEnsino: "SU",
					size: String(PAGE_SIZE),
					page: String(page),
					sort: "codigoVaga,desc",
				});
				const res = await politeFetch(
					`${ENDPOINT}?${params}`,
					{ accept: "application/json" },
					{ fetch, sleep },
				);
				if (!res.ok) {
					throw new Error(
						`CIEE respondeu HTTP ${res.status} na página ${page}`,
					);
				}
				const { content, last } = SpringPage.parse(await res.json());
				for (const raw of content) {
					const parsed = CieeJob.safeParse(raw);
					if (parsed.success) jobs.push(parsed.data);
					else onInvalid?.(raw, parsed.error);
				}
				if (last) break;
			}
			return jobs;
		},

		normalize(raw): Job {
			return {
				source: "ciee",
				externalId: String(raw.codigoVaga),
				// Listings carry no title, only the professional area.
				title: `Estágio em ${raw.areaProfissional?.trim() || "área não informada"}`,
				company: raw.nomeEmpresa.trim(),
				location:
					[raw.local?.cidade, raw.local?.uf]
						.filter((part) => part?.trim())
						.join(", ") || null,
				// Not exposed by the API; CIEE postings are nearly all on site.
				modality: null,
				description: describe(raw),
				url: `https://portal.ciee.org.br/quero-uma-vaga/?codigoVaga=${raw.codigoVaga}`,
				publishedAt: null,
				expiresAt: null,
			};
		},
	};
}
