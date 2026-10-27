import { type Job, normalizeText, STATE_NAMES } from "@radar/core";
import { z } from "zod";
import type { JobSource } from "./index.ts";
import {
	sleep as defaultSleep,
	issueLevel,
	modalitiesIn,
	mostFlexible,
	politeFetch,
} from "./util.ts";

const API = "https://api.github.com";
const PER_PAGE = 100;
// Job repos have a few dozen open issues; this only guards a runaway loop.
const MAX_PAGES = 20;

export const GitHubIssue = z.object({
	number: z.number(),
	title: z.string(),
	html_url: z.string(),
	body: z.string().nullable(),
	created_at: z.string(),
	labels: z.array(z.object({ name: z.string() })),
	// Present only when the "issue" is a pull request.
	pull_request: z.unknown().optional(),
});
export type GitHubIssue = z.infer<typeof GitHubIssue>;

/** An issue plus the repository it came from ("owner/name"). */
export type GitHubJob = GitHubIssue & { repo: string };

export type GitHubOptions = {
	/** Repositories in "owner/name" form, e.g. "backend-br/vagas". */
	repos: string[];
	token?: string;
	fetch?: typeof globalThis.fetch;
	sleep?: (ms: number) => Promise<void>;
	delayMs?: number;
	onInvalid?: (raw: unknown, error: z.ZodError) => void;
};

export type ParsedTitle = {
	title: string;
	company: string | null;
	tag: string | null;
};

/**
 * Splits the community title convention "[Tag] Role - Company" or
 * "[Tag] Role na Company". The tag holds modality and/or location.
 */
export function parseIssueTitle(raw: string): ParsedTitle {
	let title = raw.trim();
	let tag: string | null = null;
	const bracket = /^\[([^\]]+)\]\s*/.exec(title);
	if (bracket?.[1]) {
		tag = bracket[1].trim();
		title = title.slice(bracket[0].length).trim();
	}

	// A trailing "| US$ 5k" is pay, not the company.
	title = title.replace(/\s*\|\s*(US\$|R\$)\s*[\d.,]+\s*k?\s*$/i, "");

	// Company separators, most explicit first. A dash needs a space after it
	// so "React-USD" stays whole, but "Software- Micro 1" still splits.
	const separators = [
		/\s*@\s*([^@]+)$/,
		/\s+\|\s+([^|]+)$/,
		/\s+(?:na|no|at)\s+([^-–—|@]+)$/i,
		/\s*[-–—]\s+([^-–—]+)$/,
	];
	let company: string | null = null;
	const suffix = separators
		.map((pattern) => pattern.exec(title))
		.find((match) => match?.[1]);
	if (suffix?.[1]) {
		company = suffix[1].trim();
		title = title.slice(0, suffix.index).trim();
	}
	return { title, company, tag };
}

/** Location left in a title tag once modality words are removed. */
function locationFromTag(tag: string): string | null {
	const location = tag
		.replace(
			/(remot[oa]|remote|home ?office|h[ií]brid[oa]|semi-?presencial|presencial|alocad[oa])/gi,
			"",
		)
		.replace(/\bou\b/gi, "")
		.replace(/\s*\/\s*/g, ", ")
		.replace(/^[^\p{L}\d]+|[^\p{L}\d)]+$/gu, "")
		.replace(/\s*[–—-]\s*/g, ", ")
		.replace(/(,\s*)+/g, ", ")
		.trim();
	return location || null;
}

const STATE_LABELS = new Set(STATE_NAMES.map((name) => normalizeText(name)));

function describe(issue: GitHubJob): string {
	const labels = issue.labels.map((l) => l.name);
	const body = (issue.body ?? "")
		// Template instructions left in the issue body.
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\r\n/g, "\n")
		.trim();
	return [
		`Repositório: ${issue.repo}`,
		labels.length > 0 ? `Labels: ${labels.join(", ")}` : "",
		body,
	]
		.filter(Boolean)
		.join("\n\n");
}

export function createGitHubSource(opts: GitHubOptions): JobSource<GitHubJob> {
	const {
		repos,
		token,
		fetch = globalThis.fetch,
		sleep = defaultSleep,
		delayMs = 500,
		onInvalid,
	} = opts;

	const headers: Record<string, string> = {
		accept: "application/vnd.github+json",
		"x-github-api-version": "2022-11-28",
	};
	if (token) headers.authorization = `Bearer ${token}`;

	return {
		id: "github",

		async fetchJobs(query) {
			const jobs: GitHubJob[] = [];
			let requests = 0;
			for (const repo of repos) {
				for (let page = 1; page <= MAX_PAGES; page++) {
					if (requests++ > 0) await sleep(delayMs);
					const params = new URLSearchParams({
						state: "open",
						sort: "updated",
						direction: "desc",
						per_page: String(PER_PAGE),
						page: String(page),
					});
					// Issues updated since the last good scan: new postings and edits.
					if (query.since) params.set("since", query.since.toISOString());

					const res = await politeFetch(
						`${API}/repos/${repo}/issues?${params}`,
						headers,
						{ fetch, sleep },
					);
					if (!res.ok) {
						const limited =
							res.status === 403 &&
							res.headers.get("x-ratelimit-remaining") === "0";
						throw new Error(
							limited
								? `limite da API do GitHub atingido em ${repo}${token ? "" : " (configure GITHUB_TOKEN)"}`
								: `GitHub respondeu HTTP ${res.status} em ${repo}`,
						);
					}

					const data = z.array(z.unknown()).parse(await res.json());
					for (const raw of data) {
						const parsed = GitHubIssue.safeParse(raw);
						if (!parsed.success) onInvalid?.(raw, parsed.error);
						else if (parsed.data.pull_request === undefined) {
							jobs.push({ ...parsed.data, repo });
						}
					}
					if (data.length < PER_PAGE) break;
				}
			}
			return jobs;
		},

		normalize(issue): Job {
			const { title, company, tag } = parseIssueTitle(issue.title);
			const labels = issue.labels.map((l) => l.name);

			// The title tag is written per posting; labels are often left over
			// from the template, so the tag wins when it names a modality.
			const fromTag = tag ? modalitiesIn(tag) : [];
			const modality = mostFlexible(
				fromTag.length > 0 ? fromTag : labels.flatMap(modalitiesIn),
			);
			const stateLabel = labels.find((l) => STATE_LABELS.has(normalizeText(l)));

			return {
				source: "github",
				// Dedup key: repository + issue number.
				externalId: `${issue.repo}#${issue.number}`,
				title: title || issue.title.trim(),
				company: company ?? "Empresa não informada",
				location: (tag && locationFromTag(tag)) ?? stateLabel ?? null,
				modality,
				description: describe(issue),
				url: issue.html_url,
				publishedAt: new Date(issue.created_at),
				expiresAt: null,
				level: issueLevel(issue.title, labels),
			};
		},
	};
}
