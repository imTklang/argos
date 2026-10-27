import type { Job, Modality } from "@radar/core";
import { z } from "zod";
import type { JobSource, SearchQuery } from "./index.ts";
import { sleep as defaultSleep, htmlToText, politeFetch } from "./util.ts";

// Route the vagas.solides.com.br frontend calls; not a documented API.
const ENDPOINT = "https://vagas.solides.com.br/api/vacancies";
// Anything above ~20 makes the API answer HTTP 500.
const PAGE_SIZE = 20;
const MAX_PAGES_PER_SEARCH = 30;

export const SolidesJob = z.object({
	id: z.number(),
	title: z.string(),
	description: z.string().nullable(),
	companyName: z.string(),
	slug: z.string(),
	jobType: z.string().nullable(),
	currentState: z.string(),
	city: z.object({ name: z.string() }).nullable(),
	state: z.object({ code: z.string() }).nullable(),
	createdAt: z.string().nullable(),
	date: z.object({ due: z.string().nullable() }).nullable(),
	hardSkills: z.array(z.object({ name: z.string() })),
});
export type SolidesJob = z.infer<typeof SolidesJob>;

const SolidesPage = z.object({
	data: z.array(z.unknown()),
	totalPages: z.number(),
});

const MODALITY: Record<string, Modality> = {
	presencial: "presencial",
	remoto: "remoto",
	hibrido: "híbrido",
};

export type SolidesOptions = {
	fetch?: typeof globalThis.fetch;
	sleep?: (ms: number) => Promise<void>;
	delayMs?: number;
	onInvalid?: (raw: unknown, error: z.ZodError) => void;
};

/** Server-side searches whose union covers what the local filter can accept. */
export function solidesSearches(query: SearchQuery): Record<string, string>[] {
	const searches: Record<string, string>[] = [
		{ occupationAreas: "tecnologia" },
	];
	if (query.modality.includes("remoto")) searches.push({ jobsType: "remoto" });
	// The API matches a bare state code ("PB"), not a city or state name.
	for (const location of query.locations) {
		if (/^[A-Za-z]{2}$/.test(location.trim())) {
			searches.push({ locations: location.trim().toUpperCase() });
		}
	}
	return searches;
}

function dayEnd(date: string) {
	// Dates come as YYYY-MM-DD in Brasília time.
	return new Date(`${date}T23:59:59-03:00`);
}

export function createSolidesSource(
	opts: SolidesOptions = {},
): JobSource<SolidesJob> {
	const {
		fetch = globalThis.fetch,
		sleep = defaultSleep,
		delayMs = 1500,
		onInvalid,
	} = opts;

	return {
		id: "solides",

		async fetchJobs(query) {
			const byId = new Map<number, SolidesJob>();
			let requests = 0;
			for (const search of solidesSearches(query)) {
				for (let page = 1; page <= MAX_PAGES_PER_SEARCH; page++) {
					if (requests++ > 0) await sleep(delayMs);
					const params = new URLSearchParams({
						page: String(page),
						take: String(PAGE_SIZE),
						contractsType: "estagio",
						...search,
					});
					const res = await politeFetch(
						`${ENDPOINT}?${params}`,
						{ "content-type": "application/json" },
						{ fetch, sleep },
					);
					if (!res.ok) {
						throw new Error(
							`Sólides respondeu HTTP ${res.status} (${params.toString()})`,
						);
					}
					const { data, totalPages } = SolidesPage.parse(await res.json());
					for (const raw of data) {
						const parsed = SolidesJob.safeParse(raw);
						if (!parsed.success) onInvalid?.(raw, parsed.error);
						else if (parsed.data.currentState === "em_andamento") {
							byId.set(parsed.data.id, parsed.data);
						}
					}
					if (page >= totalPages) break;
				}
			}
			return [...byId.values()];
		},

		normalize(raw): Job {
			const description = [
				raw.description ? htmlToText(raw.description) : "",
				raw.hardSkills.length > 0
					? `Habilidades: ${raw.hardSkills.map((s) => s.name.trim()).join(", ")}`
					: "",
			]
				.filter(Boolean)
				.join("\n\n");

			return {
				source: "solides",
				externalId: String(raw.id),
				title: raw.title.trim(),
				company: raw.companyName.trim(),
				location:
					[raw.city?.name, raw.state?.code]
						.filter((part) => part?.trim())
						.join(", ") || null,
				modality: (raw.jobType && MODALITY[raw.jobType]) || null,
				description,
				// The API's redirectLink is malformed ("https://slug./vacancies/1").
				url: `https://${raw.slug}.vagas.solides.com.br/vaga/${raw.id}`,
				publishedAt: raw.createdAt
					? new Date(`${raw.createdAt}T00:00:00-03:00`)
					: null,
				expiresAt: raw.date?.due ? dayEnd(raw.date.due) : null,
				// Fetched with contractsType=estagio.
				level: "estágio",
			};
		},
	};
}
