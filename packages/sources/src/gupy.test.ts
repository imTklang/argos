import { Job } from "@radar/core";
import { describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/gupy-jobs.json" with { type: "json" };
import { createGupySource, GupyJob } from "./gupy.ts";
import { decodeHtmlEntities } from "./util.ts";

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function page(size: number, offset = 0) {
	const base = fixture.data[0];
	return {
		data: Array.from({ length: size }, (_, i) => ({
			...base,
			id: offset + i,
		})),
	};
}

const noSleep = () => Promise.resolve();

describe("gupy fetchJobs", () => {
	it("requests internships with an identifiable user agent", async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse(fixture));
		const source = createGupySource({ fetch, sleep: noSleep });

		const jobs = await source.fetchJobs({
			keywords: [],
			locations: [],
			modality: [],
		});

		expect(jobs).toHaveLength(3);
		const [url, init] = fetch.mock.calls[0] ?? [];
		expect(url).toContain("type=vacancy_type_internship");
		expect(url).toContain("limit=100");
		expect(init.headers["user-agent"]).toMatch(/radar-estagio/);
	});

	it("pages until a short page and waits between requests", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(page(100)))
			.mockResolvedValueOnce(jsonResponse(page(100, 100)))
			.mockResolvedValueOnce(jsonResponse(page(7, 200)));
		const sleep = vi.fn().mockResolvedValue(undefined);
		const source = createGupySource({ fetch, sleep, delayMs: 1500 });

		const jobs = await source.fetchJobs({
			keywords: [],
			locations: [],
			modality: [],
		});

		expect(jobs).toHaveLength(207);
		expect(fetch).toHaveBeenCalledTimes(3);
		expect(fetch.mock.calls[2]?.[0]).toContain("offset=200");
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(1500);
	});

	it("skips malformed jobs instead of failing the whole page", async () => {
		const onInvalid = vi.fn();
		const fetch = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ data: [...fixture.data, { id: "quebrado" }] }),
			);
		const source = createGupySource({ fetch, sleep: noSleep, onInvalid });

		const jobs = await source.fetchJobs({
			keywords: [],
			locations: [],
			modality: [],
		});

		expect(jobs).toHaveLength(3);
		expect(onInvalid).toHaveBeenCalledTimes(1);
	});

	it("throws on HTTP errors", async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse({}, 503));
		const source = createGupySource({ fetch, sleep: noSleep });
		await expect(
			source.fetchJobs({ keywords: [], locations: [], modality: [] }),
		).rejects.toThrow(/503/);
	});
});

describe("gupy normalize", () => {
	const source = createGupySource();
	const [remote, hybrid, onSite] = fixture.data.map((raw) =>
		source.normalize(GupyJob.parse(raw)),
	);

	it("produces valid jobs", () => {
		for (const job of [remote, hybrid, onSite]) {
			expect(Job.safeParse(job).success).toBe(true);
		}
	});

	it("maps workplace types to modalities", () => {
		expect(remote?.modality).toBe("remoto");
		expect(hybrid?.modality).toBe("híbrido");
		expect(onSite?.modality).toBe("presencial");
	});

	it("leaves modality null for old postings without a workplace type", () => {
		const { workplaceType: _, ...old } = fixture.data[0] ?? {};
		expect(source.normalize(GupyJob.parse(old)).modality).toBeNull();
	});

	it("leaves location null when city and state are empty", () => {
		expect(remote?.location).toBeNull();
		expect(onSite?.location).toBe("Anápolis, Goiás");
	});

	it("decodes HTML entities in the description", () => {
		expect(onSite?.description).not.toMatch(/&amp;/);
		expect(onSite?.description).toContain("MRV&CO");
	});

	it("parses dates", () => {
		expect(hybrid?.publishedAt).toBeInstanceOf(Date);
		expect(hybrid?.expiresAt).toBeInstanceOf(Date);
		expect(hybrid?.externalId).toBe(String(fixture.data[1]?.id));
	});
});

describe("decodeHtmlEntities", () => {
	it("decodes named and numeric entities", () => {
		expect(decodeHtmlEntities("A &amp; B &#233; &#xE9; &quot;x&quot;")).toBe(
			'A & B é é "x"',
		);
	});

	it("leaves unknown entities alone", () => {
		expect(decodeHtmlEntities("&foo; &")).toBe("&foo; &");
	});
});
