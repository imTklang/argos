import { Job } from "@radar/core";
import { describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/ciee-vagas.json" with { type: "json" };
import { CieeJob, createCieeSource } from "./ciee.ts";

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const query = { keywords: [], locations: [], modality: [] };
const noSleep = () => Promise.resolve();

describe("ciee fetchJobs", () => {
	it("requests higher-education internships with an identifiable user agent", async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse(fixture));
		const source = createCieeSource({ fetch, sleep: noSleep });

		const jobs = await source.fetchJobs(query);

		expect(jobs).toHaveLength(3);
		const [url, init] = fetch.mock.calls[0] ?? [];
		expect(url).toContain("tipoVaga=ESTAGIO");
		expect(url).toContain("nivelEnsino=SU");
		expect(init.headers["user-agent"]).toMatch(/radar-estagio/);
	});

	it("pages until the last page and waits between requests", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ ...fixture, last: false }))
			.mockResolvedValueOnce(jsonResponse({ ...fixture, last: true }));
		const sleep = vi.fn().mockResolvedValue(undefined);
		const source = createCieeSource({ fetch, sleep });

		const jobs = await source.fetchJobs(query);

		expect(jobs).toHaveLength(6);
		expect(fetch.mock.calls[1]?.[0]).toContain("page=1");
		expect(sleep).toHaveBeenCalledTimes(1);
	});

	it("throws on HTTP errors", async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse({}, 500));
		const source = createCieeSource({ fetch, sleep: noSleep });
		await expect(source.fetchJobs(query)).rejects.toThrow(/500/);
	});
});

describe("ciee normalize", () => {
	const source = createCieeSource();
	const [informatica, timed] = fixture.content.map((raw) =>
		source.normalize(CieeJob.parse(raw)),
	);

	it("produces valid jobs", () => {
		for (const raw of fixture.content) {
			expect(Job.safeParse(source.normalize(CieeJob.parse(raw))).success).toBe(
				true,
			);
		}
	});

	it("builds a title from the professional area", () => {
		expect(informatica?.title).toBe("Estágio em Informática");
		expect(informatica?.level).toBe("estágio");
	});

	it("puts activities, stipend and schedule in the description", () => {
		expect(informatica?.description).toContain("Atividades:");
		expect(informatica?.description).toMatch(/Bolsa: R\$\s?1\.200,00/);
		expect(timed?.description).toMatch(/Horário: \d{2}:\d{2} às \d{2}:\d{2}/);
	});

	it("uses city and UF as location and a portal link as URL", () => {
		expect(informatica?.location).toBe("Feira de Santana, BA");
		expect(informatica?.url).toBe(
			`https://portal.ciee.org.br/quero-uma-vaga/?codigoVaga=${fixture.content[0]?.codigoVaga}`,
		);
		expect(informatica?.modality).toBeNull();
	});
});
