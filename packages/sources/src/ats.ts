import type { Job, Level, Modality } from "@radar/core";
import { z } from "zod";
import type { JobSource } from "./index.ts";
import {
	brazilScope,
	decodeHtmlEntities,
	sleep as defaultSleep,
	htmlToText,
	issueLevel,
	modalitiesIn,
	mostFlexible,
	politeFetch,
} from "./util.ts";

/** A company's public job board on an applicant tracking system. */
export type AtsCompany = { slug: string; name: string };

export type AtsOptions = {
	companies: AtsCompany[];
	fetch?: typeof globalThis.fetch;
	sleep?: (ms: number) => Promise<void>;
	delayMs?: number;
	onInvalid?: (raw: unknown, error: z.ZodError) => void;
	/** A board that no longer exists (404); the other companies still run. */
	onMissingBoard?: (company: AtsCompany) => void;
};

/** A raw posting tagged with the company it came from. */
export type AtsPosting<T> = T & { company: AtsCompany };

type BoardSpec<T> = {
	id: string;
	label: string;
	url: (slug: string) => string;
	posting: z.ZodType<T>;
	list: (body: unknown) => unknown[];
	/** Whether the posting is in Brazil; remote roles with no country count. */
	inBrazil: (posting: T) => boolean;
	/** Remote roles abroad are kept (flagged abroad); on-site ones abroad are not. */
	isRemote: (posting: T) => boolean;
	normalize: (posting: AtsPosting<T>) => Job;
};

function createAtsSource<T>(spec: BoardSpec<T>, opts: AtsOptions) {
	const {
		companies,
		fetch = globalThis.fetch,
		sleep = defaultSleep,
		delayMs = 500,
		onInvalid,
		onMissingBoard,
	} = opts;

	const source: JobSource<AtsPosting<T>> = {
		id: spec.id,

		// Boards return every open posting in one response; there is no
		// pagination and no "since", so each scan reads them whole.
		async fetchJobs() {
			const postings: AtsPosting<T>[] = [];
			for (const [i, company] of companies.entries()) {
				if (i > 0) await sleep(delayMs);
				const res = await politeFetch(
					spec.url(company.slug),
					{ accept: "application/json" },
					{ fetch, sleep },
				);
				if (res.status === 404) {
					onMissingBoard?.(company);
					continue;
				}
				if (!res.ok) {
					throw new Error(
						`${spec.label} respondeu HTTP ${res.status} para ${company.name}`,
					);
				}
				for (const raw of spec.list(await res.json())) {
					const parsed = spec.posting.safeParse(raw);
					if (!parsed.success) onInvalid?.(raw, parsed.error);
					else if (spec.inBrazil(parsed.data) || spec.isRemote(parsed.data)) {
						postings.push({ ...parsed.data, company });
					}
				}
			}
			return postings;
		},

		normalize: (posting) => ({
			...spec.normalize(posting),
			abroad: !spec.inBrazil(posting),
		}),
	};
	return source;
}

function levelOf(
	title: string,
	hints: (string | null | undefined)[],
): Level | null {
	return issueLevel(
		title,
		hints.filter((h): h is string => Boolean(h)),
	);
}

// ---------------------------------------------------------------- Greenhouse

export const GreenhouseJob = z.object({
	id: z.number(),
	title: z.string(),
	absolute_url: z.string(),
	location: z.object({ name: z.string() }).nullable(),
	offices: z.array(z.object({ name: z.string() })).default([]),
	// HTML whose tags arrive entity-encoded ("&lt;p&gt;").
	content: z.string().default(""),
	first_published: z.string().nullable().optional(),
	updated_at: z.string().nullable().optional(),
	application_deadline: z.string().nullable().optional(),
});
export type GreenhouseJob = z.infer<typeof GreenhouseJob>;

function greenhousePlace(job: GreenhouseJob) {
	return [job.location?.name, ...job.offices.map((o) => o.name)]
		.filter(Boolean)
		.join(" ; ");
}

export function createGreenhouseSource(opts: AtsOptions) {
	return createAtsSource<GreenhouseJob>(
		{
			id: "greenhouse",
			label: "Greenhouse",
			url: (slug) =>
				`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
			posting: GreenhouseJob,
			list: (body) => z.object({ jobs: z.array(z.unknown()) }).parse(body).jobs,
			inBrazil: (job) => brazilScope(greenhousePlace(job)) !== "abroad",
			isRemote: (job) =>
				modalitiesIn(`${greenhousePlace(job)} ${job.title}`).includes("remoto"),
			normalize: (job) => {
				const location = job.location?.name.trim() || null;
				// No workplace field; boards write it in the location or title.
				const modality = mostFlexible(
					modalitiesIn(`${location ?? ""} ${job.title}`),
				);
				const published = job.first_published ?? job.updated_at;
				return {
					source: "greenhouse",
					externalId: `${job.company.slug}:${job.id}`,
					title: job.title.trim(),
					company: job.company.name,
					location,
					modality,
					description: htmlToText(decodeHtmlEntities(job.content)),
					url: job.absolute_url,
					publishedAt: published ? new Date(published) : null,
					expiresAt: job.application_deadline
						? new Date(job.application_deadline)
						: null,
					level: levelOf(job.title, []),
				};
			},
		},
		opts,
	);
}

// --------------------------------------------------------------------- Lever

export const LeverPosting = z.object({
	id: z.string(),
	text: z.string(),
	hostedUrl: z.string(),
	createdAt: z.number().nullable().optional(),
	country: z.string().nullable().optional(),
	workplaceType: z.string().nullable().optional(),
	categories: z
		.object({
			location: z.string().nullable().optional(),
			allLocations: z.array(z.string()).nullable().optional(),
			commitment: z.string().nullable().optional(),
		})
		.default({}),
	descriptionPlain: z.string().default(""),
	lists: z
		.array(z.object({ text: z.string(), content: z.string() }))
		.default([]),
	additionalPlain: z.string().default(""),
});
export type LeverPosting = z.infer<typeof LeverPosting>;

const LEVER_WORKPLACE: Record<string, Modality> = {
	remote: "remoto",
	hybrid: "híbrido",
	onsite: "presencial",
};

function leverDescription(posting: LeverPosting): string {
	const lists = posting.lists.map(
		(list) => `${list.text}\n${htmlToText(list.content)}`,
	);
	return [
		posting.descriptionPlain.trim(),
		...lists,
		posting.additionalPlain.trim(),
	]
		.filter(Boolean)
		.join("\n\n");
}

export function createLeverSource(opts: AtsOptions) {
	return createAtsSource<LeverPosting>(
		{
			id: "lever",
			label: "Lever",
			url: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
			posting: LeverPosting,
			list: (body) => z.array(z.unknown()).parse(body),
			isRemote: (posting) => posting.workplaceType === "remote",
			inBrazil: (posting) => {
				if (posting.country) return posting.country === "BR";
				const places = posting.categories.allLocations ?? [
					posting.categories.location ?? "",
				];
				return brazilScope(places.join(" ; ")) !== "abroad";
			},
			normalize: (posting) => {
				// CI&T prefixes titles with its requisition: "[Job - 123] ...".
				const title = posting.text.replace(/^\[[^\]]*\]\s*/, "").trim();
				return {
					source: "lever",
					externalId: `${posting.company.slug}:${posting.id}`,
					title,
					company: posting.company.name,
					location:
						posting.categories.allLocations?.join(" / ") ||
						posting.categories.location ||
						null,
					modality:
						(posting.workplaceType && LEVER_WORKPLACE[posting.workplaceType]) ||
						null,
					description: leverDescription(posting),
					url: posting.hostedUrl,
					publishedAt: posting.createdAt ? new Date(posting.createdAt) : null,
					expiresAt: null,
					level: levelOf(title, [posting.categories.commitment]),
				};
			},
		},
		opts,
	);
}

// --------------------------------------------------------------------- Ashby

const AshbyAddress = z
	.object({
		postalAddress: z
			.object({
				addressCountry: z.string().nullable().optional(),
				addressRegion: z.string().nullable().optional(),
				addressLocality: z.string().nullable().optional(),
			})
			.nullable()
			.optional(),
	})
	.nullable()
	.optional();

export const AshbyJob = z.object({
	id: z.string(),
	title: z.string(),
	jobUrl: z.string(),
	location: z.string().nullable().optional(),
	address: AshbyAddress,
	secondaryLocations: z
		.array(
			z.object({
				location: z.string().nullable().optional(),
				address: AshbyAddress,
			}),
		)
		.default([]),
	workplaceType: z.string().nullable().optional(),
	isRemote: z.boolean().nullable().optional(),
	employmentType: z.string().nullable().optional(),
	publishedAt: z.string().nullable().optional(),
	isListed: z.boolean().default(true),
	descriptionPlain: z.string().default(""),
});
export type AshbyJob = z.infer<typeof AshbyJob>;

const ASHBY_WORKPLACE: Record<string, Modality> = {
	Remote: "remoto",
	Hybrid: "híbrido",
	OnSite: "presencial",
};

function ashbyCountries(job: AshbyJob): string[] {
	return [job.address, ...job.secondaryLocations.map((l) => l.address)]
		.map((a) => a?.postalAddress?.addressCountry)
		.filter((c): c is string => Boolean(c));
}

export function createAshbySource(opts: AtsOptions) {
	return createAtsSource<AshbyJob>(
		{
			id: "ashby",
			label: "Ashby",
			url: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
			posting: AshbyJob,
			list: (body) => z.object({ jobs: z.array(z.unknown()) }).parse(body).jobs,
			isRemote: (job) =>
				job.isListed &&
				(job.workplaceType === "Remote" || job.isRemote === true),
			inBrazil: (job) => {
				if (!job.isListed) return false;
				const countries = ashbyCountries(job);
				if (countries.length > 0) {
					return countries.some((c) => brazilScope(c) === "brazil");
				}
				const places = [
					job.location,
					...job.secondaryLocations.map((l) => l.location),
				];
				return brazilScope(places.filter(Boolean).join(" ; ")) !== "abroad";
			},
			normalize: (job) => {
				const region = job.address?.postalAddress?.addressRegion;
				return {
					source: "ashby",
					externalId: `${job.company.slug}:${job.id}`,
					title: job.title.trim(),
					company: job.company.name,
					location:
						[job.location, region && region !== job.location ? region : null]
							.filter(Boolean)
							.join(", ") || null,
					modality:
						(job.workplaceType && ASHBY_WORKPLACE[job.workplaceType]) ||
						(job.isRemote ? "remoto" : null),
					description: job.descriptionPlain.trim(),
					url: job.jobUrl,
					publishedAt: job.publishedAt ? new Date(job.publishedAt) : null,
					expiresAt: null,
					// employmentType is structured: "Intern" settles it.
					level:
						job.employmentType === "Intern"
							? "estágio"
							: levelOf(job.title, []),
				};
			},
		},
		opts,
	);
}
