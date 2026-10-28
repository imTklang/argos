import { detectLevel, Job } from "@radar/core";
import { describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/github-issues.json" with { type: "json" };
import {
	createGitHubSource,
	GitHubIssue,
	type GitHubJob,
	parseIssueTitle,
} from "./github.ts";

function jsonResponse(body: unknown, status = 200, headers = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

const noSleep = () => Promise.resolve();
const query = { keywords: [], locations: [], modality: [] };

function issue(patch: Partial<GitHubJob> = {}): GitHubJob {
	return {
		...GitHubIssue.parse(fixture[0]),
		repo: "frontendbr/vagas",
		...patch,
	};
}

describe("github fetchJobs", () => {
	it("asks each repo for open issues with the token and skips pull requests", async () => {
		const withPr = [...fixture, { ...fixture[0], number: 1, pull_request: {} }];
		const fetch = vi.fn().mockImplementation(async () => jsonResponse(withPr));
		const source = createGitHubSource({
			repos: ["backend-br/vagas", "frontendbr/vagas"],
			token: "t0k3n",
			fetch,
			sleep: noSleep,
		});

		const jobs = await source.fetchJobs(query);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(jobs).toHaveLength(fixture.length * 2);
		expect(jobs.map((j) => j.repo)).toContain("frontendbr/vagas");
		const [url, init] = fetch.mock.calls[0] ?? [];
		expect(url).toContain("/repos/backend-br/vagas/issues?");
		expect(url).toContain("state=open");
		expect(url).toContain("per_page=100");
		expect(url).not.toContain("since=");
		expect(init.headers.authorization).toBe("Bearer t0k3n");
		expect(init.headers["user-agent"]).toMatch(/radar-estagio/);
	});

	it("only asks for issues updated since the last good scan", async () => {
		const fetch = vi.fn().mockImplementation(async () => jsonResponse([]));
		const source = createGitHubSource({
			repos: ["backend-br/vagas"],
			fetch,
			sleep: noSleep,
		});

		await source.fetchJobs({
			...query,
			since: new Date("2026-10-26T11:00:00Z"),
		});

		expect(fetch.mock.calls[0]?.[0]).toContain(
			"since=2026-10-26T11%3A00%3A00.000Z",
		);
		expect(fetch.mock.calls[0]?.[1].headers.authorization).toBeUndefined();
	});

	it("pages while pages come back full", async () => {
		const full = Array.from({ length: 100 }, (_, i) => ({
			...fixture[0],
			number: i + 1,
		}));
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(full))
			.mockResolvedValueOnce(jsonResponse(fixture));
		const source = createGitHubSource({
			repos: ["backend-br/vagas"],
			fetch,
			sleep: noSleep,
		});

		const jobs = await source.fetchJobs(query);

		expect(jobs).toHaveLength(100 + fixture.length);
		expect(fetch.mock.calls[1]?.[0]).toContain("page=2");
	});

	it("explains a rate limit and suggests the token", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({}, 403, { "x-ratelimit-remaining": "0" }),
			);
		const source = createGitHubSource({
			repos: ["backend-br/vagas"],
			fetch,
			sleep: noSleep,
		});

		await expect(source.fetchJobs(query)).rejects.toThrow(/GITHUB_TOKEN/);
	});

	it("names the repo on other HTTP errors", async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse({}, 404));
		const source = createGitHubSource({
			repos: ["dono/sumiu"],
			fetch,
			sleep: noSleep,
		});

		await expect(source.fetchJobs(query)).rejects.toThrow(/404 em dono\/sumiu/);
	});
});

describe("github normalize", () => {
	const source = createGitHubSource({ repos: [] });
	const jobs = fixture.map((raw) =>
		source.normalize({ ...GitHubIssue.parse(raw), repo: "backend-br/vagas" }),
	);

	it("produces valid jobs keyed by repo and issue number", () => {
		for (const job of jobs) expect(Job.safeParse(job).success).toBe(true);
		expect(jobs[0]?.externalId).toBe(`backend-br/vagas#${fixture[0]?.number}`);
		expect(jobs[0]?.url).toBe(fixture[0]?.html_url);
	});

	it("reads modality, location, company and level from a real title", () => {
		// "[Remoto] Back-end Developer JR - PORT LOUIS"
		expect(jobs[0]).toMatchObject({
			title: "Back-end Developer JR",
			company: "PORT LOUIS",
			modality: "remoto",
			level: "júnior",
		});
		// "[Joinville/SC] ..." with labels Sênior and Híbrido
		expect(jobs[1]).toMatchObject({
			location: "Joinville, SC",
			modality: "híbrido",
			level: "sênior",
		});
	});

	it("prefers the title tag over contradictory labels", () => {
		// Labels say Presencial and Híbrido; the tag says Híbrido.
		expect(jobs[3]?.modality).toBe("híbrido");
		// "[Remoto ou Híbrido - São Paulo/SP]" keeps the most flexible.
		expect(jobs[4]).toMatchObject({
			modality: "remoto",
			location: "São Paulo, SP",
		});
	});

	it("keeps labels and body in the description without template comments", () => {
		expect(jobs[0]?.description).toContain("Repositório: backend-br/vagas");
		expect(jobs[0]?.description).toContain("Labels: CLT, Júnior, Remoto");
		expect(jobs[0]?.description).not.toContain("<!--");
	});

	it("strips stray punctuation from a tag location", () => {
		const job = source.normalize(
			issue({ title: "[Remoto !Curitiba] Dev", labels: [] }),
		);
		expect(job.location).toBe("Curitiba");
	});

	it("uses a state label when the title has no location", () => {
		const job = source.normalize(
			issue({
				title: "Estágio Front-end - Acme",
				labels: [{ name: "Estágio" }, { name: "Paraíba" }, { name: "Alocado" }],
			}),
		);
		expect(job).toMatchObject({
			location: "Paraíba",
			modality: "presencial",
			level: "estágio",
			company: "Acme",
		});
	});

	it("reads emoji and semi-presencial labels", () => {
		const job = source.normalize(
			issue({
				title: "Dev React",
				labels: [{ name: "👶 Estágio" }, { name: "Semi-presencial" }],
			}),
		);
		expect(job.level).toBe("estágio");
		expect(job.modality).toBe("híbrido");
	});
});

describe("parseIssueTitle", () => {
	it.each([
		["[Remoto] It Jobs - Strider (Micro 1)", "It Jobs", "Strider (Micro 1)"],
		[
			"[Remoto] Engenheiro de Software- Micro 1",
			"Engenheiro de Software",
			"Micro 1",
		],
		[
			"Senior UX Engineer, Search AI na Google",
			"Senior UX Engineer, Search AI",
			"Google",
		],
		["Backend Engineer @ Nubank", "Backend Engineer", "Nubank"],
		["Dev Node | Acme", "Dev Node", "Acme"],
		[
			"[Híbrido] Senior Full Stack Developer na Aurum | US$ 5k",
			"Senior Full Stack Developer",
			"Aurum",
		],
		[
			"[Híbrido/Curitiba] Front-end Developer React-USD (Jcal)",
			"Front-end Developer React-USD (Jcal)",
			null,
		],
		["Analista Financeiro na área de TI", "Analista Financeiro", "área de TI"],
	])("%s", (raw, title, company) => {
		expect(parseIssueTitle(raw)).toMatchObject({ title, company });
	});
});

describe("detectLevel", () => {
	it("reads the title before labels", () => {
		expect(detectLevel("Dev Backend Sr", ["Júnior"])).toBe("sênior");
		expect(detectLevel("Dev Backend", ["Júnior"])).toBe("júnior");
	});

	it("treats 'estágio ou júnior' as an internship", () => {
		expect(detectLevel("Desenvolvedor Júnior ou Estagiário", [])).toBe(
			"estágio",
		);
	});

	it("does not take PL/SQL for pleno", () => {
		expect(detectLevel("Desenvolvedor PL/SQL", [])).toBeNull();
	});

	it("returns null when nothing says the level", () => {
		expect(
			detectLevel("Desenvolvedor Backend", ["Remoto", "Node.js"]),
		).toBeNull();
	});
});
