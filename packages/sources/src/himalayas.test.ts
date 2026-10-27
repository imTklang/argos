import { Job } from "@radar/core";
import { describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/himalayas-jobs.json" with { type: "json" };
import { createHimalayasSource, HimalayasJob } from "./himalayas.ts";

const query = { keywords: [], locations: [], modality: [] };

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("himalayas fetchJobs", () => {
	it("searches internships open to Brazil until an empty page", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(fixture))
			.mockResolvedValueOnce(jsonResponse({ jobs: fixture.jobs.slice(0, 1) }))
			.mockResolvedValueOnce(jsonResponse({ jobs: [] }));
		const sleep = vi.fn().mockResolvedValue(undefined);
		const source = createHimalayasSource({ fetch, sleep });

		const jobs = await source.fetchJobs(query);

		// The repeated job on page 2 is deduplicated by guid.
		expect(jobs).toHaveLength(fixture.jobs.length);
		expect(fetch).toHaveBeenCalledTimes(3);
		const [url, init] = fetch.mock.calls[0] ?? [];
		expect(url).toContain("country=BR");
		expect(url).toContain("employment_type=Intern");
		expect(url).toContain("page=1");
		expect(fetch.mock.calls[2]?.[0]).toContain("page=3");
		expect(init.headers["user-agent"]).toMatch(/radar-estagio/);
		expect(init.headers.authorization).toBeUndefined();
		expect(sleep).toHaveBeenCalledWith(1500);
	});

	it("sends the API key when configured", async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse({ jobs: [] }));
		const source = createHimalayasSource({
			apiKey: "k",
			fetch,
			sleep: vi.fn(),
		});
		await source.fetchJobs(query);
		expect(fetch.mock.calls[0]?.[1].headers.authorization).toBe("Bearer k");
	});

	it("throws on HTTP errors", async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse({}, 403));
		const source = createHimalayasSource({ fetch, sleep: vi.fn() });
		await expect(source.fetchJobs(query)).rejects.toThrow(/403/);
	});
});

describe("himalayas normalize", () => {
	const source = createHimalayasSource();
	const [worldwide, brazilOnly, latam, unpaid] = fixture.jobs.map((raw) =>
		source.normalize(HimalayasJob.parse(raw)),
	);

	it("produces valid remote internships", () => {
		for (const job of [worldwide, brazilOnly, latam, unpaid]) {
			expect(Job.safeParse(job).success).toBe(true);
			expect(job?.modality).toBe("remoto");
			expect(job?.level).toBe("estágio");
		}
	});

	it("flags jobs open beyond Brazil as abroad", () => {
		expect(worldwide?.abroad).toBe(true);
		expect(latam?.abroad).toBe(true);
		expect(brazilOnly?.abroad).toBe(false);
	});

	it("describes eligibility, timezone, pay and the source", () => {
		expect(worldwide?.location).toBe("Remoto, qualquer país");
		expect(worldwide?.description).toContain("Países aceitos: qualquer país");
		expect(worldwide?.description).toMatch(
			/Remuneração: USD 1\.000 a 1\.200 por ano/,
		);
		expect(worldwide?.description).toContain(
			"Aceita o fuso do Brasil (UTC-3): sim",
		);
		expect(worldwide?.description).toContain("Fonte: Himalayas");
		expect(latam?.location).toMatch(/países, incluindo Brasil/);
		expect(brazilOnly?.location).toBe("Remoto: Brazil");
	});

	it("keeps the application link unchanged, as the API terms require", () => {
		expect(worldwide?.url).toBe(fixture.jobs[0]?.applicationLink);
		expect(worldwide?.externalId).toBe(fixture.jobs[0]?.guid);
	});

	it("reads unix-second dates", () => {
		expect(worldwide?.expiresAt?.getTime()).toBe(
			(fixture.jobs[0]?.expiryDate ?? 0) * 1000,
		);
	});
});
