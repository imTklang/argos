import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { readSourcesConfig } from "./config.ts";
import { createSources, pickSources } from "./sources.ts";

describe("createSources", () => {
	it("builds every source from the committed config", async () => {
		const config = await readSourcesConfig(
			fileURLToPath(new URL("../../../config/sources.json", import.meta.url)),
		);
		const ids = createSources(config, {}).map((s) => s.id);
		expect(ids).toEqual([
			"gupy",
			"solides",
			"ciee",
			"github",
			"greenhouse",
			"lever",
			"ashby",
			"himalayas",
		]);
		expect(config.ats.greenhouse.length).toBeGreaterThan(0);
	});

	it("warns about a missing board instead of failing", async () => {
		const warn = vi.fn();
		const fetch = vi
			.fn()
			.mockResolvedValue(new Response("{}", { status: 404 }));
		vi.stubGlobal("fetch", fetch);
		try {
			const [lever] = pickSources(
				createSources(
					{
						ats: {
							greenhouse: [],
							lever: [{ slug: "x", name: "X" }],
							ashby: [],
						},
						github: { repos: [] },
					},
					{},
					warn,
				),
				["lever"],
			);
			await lever?.fetchJobs({ keywords: [], locations: [], modality: [] });
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("X (x)"));
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("pickSources", () => {
	it("rejects unknown ids", () => {
		expect(() => pickSources([], ["nada"])).toThrow(/Fonte desconhecida/);
	});
});
