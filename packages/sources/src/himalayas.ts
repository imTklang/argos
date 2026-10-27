import type { Job } from "@radar/core";
import { z } from "zod";
import type { JobSource } from "./index.ts";
import { sleep as defaultSleep, htmlToText, politeFetch } from "./util.ts";

// Remote-only job board. API terms (himalayas.app/api): use applicationLink
// unchanged, show Himalayas as the source, keep the jobs in apps we operate
// and drop them once expired.
const ENDPOINT = "https://himalayas.app/jobs/api/search";
// Pages hold up to 20 jobs; ~110 internships open to Brazil as of 2026-10.
const MAX_PAGES = 20;

export const HimalayasJob = z.object({
	guid: z.string(),
	title: z.string(),
	companyName: z.string(),
	employmentType: z.string().nullable().optional(),
	locationRestrictions: z.array(z.string()).default([]),
	timezoneRestrictions: z.array(z.number()).default([]),
	minSalary: z.number().nullable().optional(),
	maxSalary: z.number().nullable().optional(),
	salaryPeriod: z.string().nullable().optional(),
	currency: z.string().nullable().optional(),
	description: z.string().default(""),
	// Unix seconds.
	pubDate: z.number().nullable().optional(),
	expiryDate: z.number().nullable().optional(),
	applicationLink: z.string(),
});
export type HimalayasJob = z.infer<typeof HimalayasJob>;

export type HimalayasOptions = {
	/** Optional free API key: its own rate allowance instead of the shared one. */
	apiKey?: string;
	fetch?: typeof globalThis.fetch;
	sleep?: (ms: number) => Promise<void>;
	delayMs?: number;
	onInvalid?: (raw: unknown, error: z.ZodError) => void;
};

const PERIOD: Record<string, string> = {
	hourly: "hora",
	weekly: "semana",
	fortnightly: "quinzena",
	monthly: "mês",
	annual: "ano",
};

function salary(job: HimalayasJob): string | null {
	if (!job.minSalary && !job.maxSalary) return null;
	const range = [job.minSalary, job.maxSalary]
		.filter((n): n is number => typeof n === "number")
		.map((n) => n.toLocaleString("pt-BR"))
		.join(" a ");
	const period = PERIOD[job.salaryPeriod ?? "annual"] ?? job.salaryPeriod;
	return `${job.currency ?? ""} ${range} por ${period}`.trim();
}

/** Brazil-only postings are local remote jobs; anything wider is abroad. */
function onlyBrazil(job: HimalayasJob): boolean {
	return (
		job.locationRestrictions.length === 1 &&
		job.locationRestrictions[0] === "Brazil"
	);
}

function describe(job: HimalayasJob): string {
	const eligible =
		job.locationRestrictions.length === 0
			? "qualquer país"
			: job.locationRestrictions.join(", ");
	const lines = [
		htmlToText(job.description),
		"",
		`Países aceitos: ${eligible}`,
		`Aceita o fuso do Brasil (UTC-3): ${job.timezoneRestrictions.includes(-3) ? "sim" : "não"}`,
		`Tipo de contrato: ${job.employmentType ?? "não informado"}`,
		`Remuneração: ${salary(job) ?? "não informada"}`,
		"Fonte: Himalayas (himalayas.app)",
	];
	return lines.join("\n").trim();
}

export function createHimalayasSource(
	opts: HimalayasOptions = {},
): JobSource<HimalayasJob> {
	const {
		apiKey,
		fetch = globalThis.fetch,
		sleep = defaultSleep,
		delayMs = 1500,
		onInvalid,
	} = opts;
	const headers: Record<string, string> = { accept: "application/json" };
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;

	return {
		id: "himalayas",

		// country=BR applies Himalayas' own rule: open to Brazil when the
		// posting has no country restriction or lists Brazil, and UTC-3 fits.
		async fetchJobs() {
			const byGuid = new Map<string, HimalayasJob>();
			for (let page = 1; page <= MAX_PAGES; page++) {
				if (page > 1) await sleep(delayMs);
				const params = new URLSearchParams({
					country: "BR",
					employment_type: "Intern",
					sort: "recent",
					page: String(page),
				});
				const res = await politeFetch(`${ENDPOINT}?${params}`, headers, {
					fetch,
					sleep,
				});
				if (!res.ok) {
					throw new Error(
						`Himalayas respondeu HTTP ${res.status} na página ${page}`,
					);
				}
				const { jobs } = z
					.object({ jobs: z.array(z.unknown()).default([]) })
					.parse(await res.json());
				// Pages can come back short before the end; only an empty one ends it.
				if (jobs.length === 0) break;
				for (const raw of jobs) {
					const parsed = HimalayasJob.safeParse(raw);
					if (parsed.success) byGuid.set(parsed.data.guid, parsed.data);
					else onInvalid?.(raw, parsed.error);
				}
			}
			return [...byGuid.values()];
		},

		normalize(job): Job {
			return {
				source: "himalayas",
				externalId: job.guid,
				title: job.title.trim(),
				company: job.companyName.trim(),
				location:
					job.locationRestrictions.length === 0
						? "Remoto, qualquer país"
						: job.locationRestrictions.length <= 3
							? `Remoto: ${job.locationRestrictions.join(", ")}`
							: `Remoto: ${job.locationRestrictions.length} países, incluindo Brasil`,
				modality: "remoto",
				description: describe(job),
				// Terms: the apply link is used unchanged.
				url: job.applicationLink,
				publishedAt: job.pubDate ? new Date(job.pubDate * 1000) : null,
				expiresAt: job.expiryDate ? new Date(job.expiryDate * 1000) : null,
				level: job.employmentType === "Intern" ? "estágio" : null,
				abroad: !onlyBrazil(job),
			};
		},
	};
}
