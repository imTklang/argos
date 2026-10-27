import type { Job, Modality } from "@radar/core";
import { z } from "zod";
import type { JobSource } from "./index.ts";
import { decodeHtmlEntities, USER_AGENT } from "./util.ts";

// Same endpoint the public portal (portal.gupy.io) calls. Not documented, so
// it can change without notice: the old portal.api.gupy.io host now 404s.
const ENDPOINT = "https://portal.gupy.io/api/job-search/jobs";
// The API rejects anything above 100 with HTTP 400.
const PAGE_SIZE = 100;
// ~2,600 internships nationwide as of 2026-10; this caps a runaway loop.
const MAX_PAGES = 60;

export const GupyJob = z.object({
	id: z.number(),
	name: z.string(),
	description: z.string(),
	careerPageName: z.string(),
	type: z.string(),
	// Missing on postings older than ~2024.
	workplaceType: z.string().optional(),
	city: z.string().nullable(),
	state: z.string().nullable(),
	jobUrl: z.string(),
	publishedDate: z.string().nullable(),
	applicationDeadline: z.string().nullable(),
});
export type GupyJob = z.infer<typeof GupyJob>;

const GupyPage = z.object({ data: z.array(z.unknown()) });

const MODALITY: Record<string, Modality> = {
	remote: "remoto",
	hybrid: "híbrido",
	"on-site": "presencial",
};

export type GupyOptions = {
	fetch?: typeof globalThis.fetch;
	sleep?: (ms: number) => Promise<void>;
	delayMs?: number;
	onInvalid?: (raw: unknown, error: z.ZodError) => void;
};

export function createGupySource(opts: GupyOptions = {}): JobSource<GupyJob> {
	const {
		fetch = globalThis.fetch,
		sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
		delayMs = 1500,
		onInvalid,
	} = opts;

	return {
		id: "gupy",

		// Fetches every internship and leaves relevance to the local filter:
		// jobName only matches title prefixes, so tech internships titled like
		// "Programa de Estágio 2027" would be missed by a term search.
		async fetchJobs() {
			const jobs: GupyJob[] = [];
			for (let page = 0; page < MAX_PAGES; page++) {
				if (page > 0) await sleep(delayMs);

				const params = new URLSearchParams({
					type: "vacancy_type_internship",
					limit: String(PAGE_SIZE),
					offset: String(page * PAGE_SIZE),
				});
				const res = await fetch(`${ENDPOINT}?${params}`, {
					headers: { "user-agent": USER_AGENT, accept: "application/json" },
				});
				if (!res.ok) {
					throw new Error(
						`Gupy respondeu HTTP ${res.status} na página ${page}`,
					);
				}

				// pagination.total is unreliable (it echoes the limit), so page
				// until a short page comes back.
				const { data } = GupyPage.parse(await res.json());
				for (const raw of data) {
					const parsed = GupyJob.safeParse(raw);
					if (parsed.success) jobs.push(parsed.data);
					else onInvalid?.(raw, parsed.error);
				}
				if (data.length < PAGE_SIZE) break;
			}
			return jobs;
		},

		normalize(raw): Job {
			return {
				source: "gupy",
				externalId: String(raw.id),
				title: raw.name.trim(),
				company: raw.careerPageName.trim(),
				location:
					[raw.city, raw.state].filter((part) => part?.trim()).join(", ") ||
					null,
				modality: (raw.workplaceType && MODALITY[raw.workplaceType]) || null,
				description: decodeHtmlEntities(raw.description),
				url: raw.jobUrl,
				publishedAt: raw.publishedDate ? new Date(raw.publishedDate) : null,
				expiresAt: raw.applicationDeadline
					? new Date(raw.applicationDeadline)
					: null,
			};
		},
	};
}
