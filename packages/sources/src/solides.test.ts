import { Job } from "@radar/core";
import { describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/solides-vacancies.json" with {
	type: "json",
};
import { createSolidesSource, SolidesJob, solidesSearches } from "./solides.ts";
import { htmlToText } from "./util.ts";

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const noSleep = () => Promise.resolve();
const query = {
	keywords: [],
	locations: ["João Pessoa", "PB", "Brasil (remoto)"],
	modality: ["remoto" as const, "híbrido" as const, "presencial" as const],
};

describe("solidesSearches", () => {
	it("searches tech, remote and each state code in the preferences", () => {
		expect(solidesSearches(query)).toEqual([
			{ occupationAreas: "tecnologia" },
			{ jobsType: "remoto" },
			{ locations: "PB" },
		]);
	});

	it("skips remote when the preferences leave it out", () => {
		expect(
			solidesSearches({ ...query, locations: [], modality: ["presencial"] }),
		).toEqual([{ occupationAreas: "tecnologia" }]);
	});
});

describe("solides fetchJobs", () => {
	it("runs every search, deduplicates by id and waits between requests", async () => {
		const fetch = vi.fn().mockImplementation(async () => jsonResponse(fixture));
		const sleep = vi.fn().mockResolvedValue(undefined);
		const source = createSolidesSource({ fetch, sleep });

		const jobs = await source.fetchJobs(query);

		expect(fetch).toHaveBeenCalledTimes(3);
		expect(jobs).toHaveLength(3);
		expect(sleep).toHaveBeenCalledTimes(2);
		const [url, init] = fetch.mock.calls[0] ?? [];
		expect(url).toContain("contractsType=estagio");
		expect(url).toContain("take=20");
		expect(init.headers["user-agent"]).toMatch(/radar-estagio/);
	});

	it("follows totalPages", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ ...fixture, totalPages: 2 }))
			.mockImplementation(async () => jsonResponse(fixture));
		const source = createSolidesSource({ fetch, sleep: noSleep });

		await source.fetchJobs({ ...query, locations: [], modality: [] });

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls[1]?.[0]).toContain("page=2");
	});

	it("drops postings that are no longer open", async () => {
		const closed = { ...fixture.data[0], currentState: "encerrada" };
		const fetch = vi
			.fn()
			.mockResolvedValue(jsonResponse({ ...fixture, data: [closed] }));
		const source = createSolidesSource({ fetch, sleep: noSleep });

		const jobs = await source.fetchJobs({
			...query,
			locations: [],
			modality: [],
		});

		expect(jobs).toHaveLength(0);
	});

	it("throws on HTTP errors", async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse({}, 500));
		const source = createSolidesSource({ fetch, sleep: noSleep });
		await expect(source.fetchJobs(query)).rejects.toThrow(/500/);
	});
});

describe("solides normalize", () => {
	const source = createSolidesSource();
	const [presencial, remoto, hibrido] = fixture.data.map((raw) =>
		source.normalize(SolidesJob.parse(raw)),
	);

	it("produces valid jobs", () => {
		for (const job of [presencial, remoto, hibrido]) {
			expect(Job.safeParse(job).success).toBe(true);
		}
	});

	it("maps job types to modalities", () => {
		expect(presencial?.modality).toBe("presencial");
		expect(remoto?.modality).toBe("remoto");
		expect(hibrido?.modality).toBe("híbrido");
	});

	it("builds the public job URL from slug and id", () => {
		const raw = fixture.data[0];
		expect(presencial?.url).toBe(
			`https://${raw?.slug}.vagas.solides.com.br/vaga/${raw?.id}`,
		);
	});

	it("turns the HTML description into text and lists hard skills", () => {
		expect(presencial?.description).not.toMatch(/<[a-z]/i);
		expect(presencial?.description).toContain("Habilidades:");
	});

	it("reads the deadline as the end of that day in Brasília", () => {
		const due = fixture.data[0]?.date?.due;
		expect(presencial?.expiresAt?.toISOString()).toBe(
			new Date(`${due}T23:59:59-03:00`).toISOString(),
		);
		expect(presencial?.location).toMatch(/, [A-Z]{2}$/);
	});
});

describe("htmlToText", () => {
	it("keeps paragraphs and list items readable", () => {
		expect(
			htmlToText(
				"<p>Olá&nbsp;<strong>mundo</strong></p><ul><li>Node</li><li>SQL</li></ul>",
			),
		).toBe("Olá mundo\n\n- Node\n- SQL");
	});
});
