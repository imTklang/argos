import { Job } from "@radar/core";
import { describe, expect, it, vi } from "vitest";
import ashbyFixture from "./__fixtures__/ashby-jobs.json" with { type: "json" };
import greenhouseFixture from "./__fixtures__/greenhouse-jobs.json" with {
	type: "json",
};
import leverFixture from "./__fixtures__/lever-postings.json" with {
	type: "json",
};
import {
	AshbyJob,
	createAshbySource,
	createGreenhouseSource,
	createLeverSource,
	GreenhouseJob,
	LeverPosting,
} from "./ats.ts";
import { brazilScope } from "./util.ts";

const query = { keywords: [], locations: [], modality: [] };
const noSleep = () => Promise.resolve();
const btg = { slug: "btgpactual", name: "BTG Pactual" };
const ciandt = { slug: "ciandt", name: "CI&T" };
const nubank = { slug: "nubank", name: "Nubank" };

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("ATS fetchJobs", () => {
	it("reads one board per company with an identifiable user agent", async () => {
		const fetch = vi
			.fn()
			.mockImplementation(async () => jsonResponse(greenhouseFixture));
		const sleep = vi.fn().mockResolvedValue(undefined);
		const source = createGreenhouseSource({
			companies: [btg, { slug: "stone", name: "Stone" }],
			fetch,
			sleep,
		});

		const postings = await source.fetchJobs(query);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls[0]?.[0]).toBe(
			"https://boards-api.greenhouse.io/v1/boards/btgpactual/jobs?content=true",
		);
		expect(fetch.mock.calls[0]?.[1].headers["user-agent"]).toMatch(/argos\//);
		expect(sleep).toHaveBeenCalledTimes(1);
		expect(postings).toHaveLength(greenhouseFixture.jobs.length * 2);
		expect(postings[0]?.company).toEqual(btg);
	});

	it("skips a board that no longer exists and keeps the others", async () => {
		const onMissingBoard = vi.fn();
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({}, 404))
			.mockResolvedValueOnce(jsonResponse(leverFixture));
		const source = createLeverSource({
			companies: [{ slug: "sumiu", name: "Sumiu" }, ciandt],
			fetch,
			sleep: noSleep,
			onMissingBoard,
		});

		const postings = await source.fetchJobs(query);

		expect(onMissingBoard).toHaveBeenCalledWith({
			slug: "sumiu",
			name: "Sumiu",
		});
		expect(postings.length).toBeGreaterThan(0);
	});

	it("fails the source on other HTTP errors", async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse({}, 500));
		const source = createAshbySource({
			companies: [nubank],
			fetch,
			sleep: noSleep,
		});
		await expect(source.fetchJobs(query)).rejects.toThrow(/Ashby.*500.*Nubank/);
	});
});

describe("Greenhouse", () => {
	const source = createGreenhouseSource({ companies: [btg] });
	const jobs = greenhouseFixture.jobs.map((raw) =>
		source.normalize({ ...GreenhouseJob.parse(raw), company: btg }),
	);

	it("produces valid jobs keyed by company and id", () => {
		for (const job of jobs) expect(Job.safeParse(job).success).toBe(true);
		expect(jobs[0]?.externalId).toBe(
			`btgpactual:${greenhouseFixture.jobs[0]?.id}`,
		);
		expect(jobs[0]?.company).toBe("BTG Pactual");
	});

	it("decodes the entity-encoded HTML content", () => {
		expect(jobs[0]?.description).not.toMatch(/&lt;|<[a-z]/i);
		expect(jobs[0]?.description.length).toBeGreaterThan(20);
	});

	it("does not read 'Interna' as an internship", () => {
		expect(jobs[0]?.title).toContain("Interna");
		expect(jobs[0]?.level).toBeNull();
	});

	it("takes modality and level from the title when present", () => {
		const raw = GreenhouseJob.parse({
			...greenhouseFixture.jobs[0],
			title: "Estágio em Engenharia de Software (Remoto)",
		});
		const job = source.normalize({ ...raw, company: btg });
		expect(job.level).toBe("estágio");
		expect(job.modality).toBe("remoto");
	});

	it("drops postings whose location is abroad", async () => {
		const abroad = {
			...greenhouseFixture.jobs[0],
			location: { name: "London, UK" },
			offices: [],
		};
		const fetch = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ jobs: [abroad, ...greenhouseFixture.jobs] }),
			);
		const s = createGreenhouseSource({
			companies: [btg],
			fetch,
			sleep: noSleep,
		});
		expect(await s.fetchJobs(query)).toHaveLength(
			greenhouseFixture.jobs.length,
		);
	});
});

describe("Lever", () => {
	const source = createLeverSource({ companies: [ciandt] });

	it("keeps Brazilian postings and flags remote ones abroad", async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse(leverFixture));
		const s = createLeverSource({ companies: [ciandt], fetch, sleep: noSleep });
		const postings = await s.fetchJobs(query);
		const jobs = postings.map((p) => s.normalize(p));
		expect(jobs.map((j) => [j.title, j.abroad])).toEqual([
			["Senior Java Developer, São Paulo (Hybrid)", false],
			["Senior Fullstack Developer ( Java + Angular ), Brazil", false],
			["Data Product Manager, Colombia", true],
		]);
	});

	it("drops on-site postings abroad", async () => {
		const onSite = { ...leverFixture[2], workplaceType: "onsite" };
		const fetch = vi.fn().mockResolvedValue(jsonResponse([onSite]));
		const s = createLeverSource({ companies: [ciandt], fetch, sleep: noSleep });
		expect(await s.fetchJobs(query)).toHaveLength(0);
	});

	it("strips the requisition prefix and maps workplace and level", () => {
		const [hybrid, remote] = leverFixture.map((raw) =>
			source.normalize({ ...LeverPosting.parse(raw), company: ciandt }),
		);
		expect(hybrid?.title).toBe("Senior Java Developer, São Paulo (Hybrid)");
		expect(hybrid?.modality).toBe("híbrido");
		expect(hybrid?.level).toBe("sênior");
		expect(remote?.modality).toBe("remoto");
		expect(Job.safeParse(hybrid).success).toBe(true);
		expect(hybrid?.publishedAt).toBeInstanceOf(Date);
	});

	it("reads an internship from the commitment", () => {
		const raw = LeverPosting.parse({
			...leverFixture[0],
			text: "Desenvolvimento de Software",
			categories: { ...leverFixture[0]?.categories, commitment: "Estágio" },
		});
		expect(source.normalize({ ...raw, company: ciandt }).level).toBe("estágio");
	});

	it("includes the requirement lists in the description", () => {
		const raw = LeverPosting.parse({
			...leverFixture[0],
			lists: [{ text: "Requisitos", content: "<li>Node.js</li><li>SQL</li>" }],
		});
		const job = source.normalize({ ...raw, company: ciandt });
		expect(job.description).toContain("Requisitos\n- Node.js\n- SQL");
	});
});

describe("Ashby", () => {
	const source = createAshbySource({ companies: [nubank] });

	it("keeps remote roles abroad flagged, and Brazil unflagged", async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse(ashbyFixture));
		const s = createAshbySource({ companies: [nubank], fetch, sleep: noSleep });
		const jobs = (await s.fetchJobs(query)).map((p) => s.normalize(p));
		expect(jobs.map((j) => [j.location, j.abroad])).toEqual([
			["Palo Alto, California", true],
			["São Paulo", false],
		]);
	});

	it("drops on-site roles abroad", async () => {
		const onSite = {
			...ashbyFixture.jobs[0],
			workplaceType: "OnSite",
			isRemote: false,
		};
		const fetch = vi.fn().mockResolvedValue(jsonResponse({ jobs: [onSite] }));
		const s = createAshbySource({ companies: [nubank], fetch, sleep: noSleep });
		expect(await s.fetchJobs(query)).toHaveLength(0);
	});

	it("drops unlisted postings", async () => {
		const unlisted = { ...ashbyFixture.jobs[1], isListed: false };
		const fetch = vi.fn().mockResolvedValue(jsonResponse({ jobs: [unlisted] }));
		const s = createAshbySource({ companies: [nubank], fetch, sleep: noSleep });
		expect(await s.fetchJobs(query)).toHaveLength(0);
	});

	it("uses employmentType for internships", () => {
		const [intern, senior] = ashbyFixture.jobs.map((raw) =>
			source.normalize({ ...AshbyJob.parse(raw), company: nubank }),
		);
		expect(intern?.level).toBe("estágio");
		expect(senior).toMatchObject({ level: "sênior", modality: "híbrido" });
		expect(Job.safeParse(senior).success).toBe(true);
	});
});

describe("brazilScope", () => {
	it.each([
		["São Paulo, SP", "brazil"],
		["Brazil (Remote)", "brazil"],
		["Curitiba / PR / Brazil", "brazil"],
		["🇧🇷 São Paulo / 🌎Remote", "brazil"],
		["Mexico City / CDMX / Mexico", "abroad"],
		["London, UK", "abroad"],
		["Remote", "unknown"],
	])("%s → %s", (location, scope) => {
		expect(brazilScope(location)).toBe(scope);
	});
});
