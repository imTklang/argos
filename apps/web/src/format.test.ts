import { describe, expect, it } from "vitest";
import { jobsQuery } from "./api.ts";
import { fromNow, place, scoreTone, sourceLabel } from "./format.ts";

describe("scoreTone", () => {
	it("follows the alert (85) and digest (70) thresholds", () => {
		expect(scoreTone(85)).toBe("good");
		expect(scoreTone(84)).toBe("fair");
		expect(scoreTone(70)).toBe("fair");
		expect(scoreTone(69)).toBe("warn");
		expect(scoreTone(49)).toBe("bad");
		expect(scoreTone(null)).toBe("none");
	});
});

describe("fromNow", () => {
	const now = new Date("2026-10-28T12:00:00Z");
	it("uses days, then weeks", () => {
		expect(fromNow("2026-10-31T12:00:00Z", now)).toBe("em 3 dias");
		expect(fromNow("2026-12-09T12:00:00Z", now)).toBe("em 6 semanas");
		expect(fromNow(null, now)).toBeNull();
	});
});

describe("labels", () => {
	it("names sources and places", () => {
		expect(sourceLabel("solides")).toBe("Sólides");
		expect(sourceLabel("nova-fonte")).toBe("nova-fonte");
		expect(place({ modality: "remoto", location: null })).toBe("remoto");
	});
});

describe("jobsQuery", () => {
	it("joins lists and drops empty or default values", () => {
		expect(
			jobsQuery({
				status: ["nova", "salva"],
				scope: "all",
				q: "",
				minScore: 70,
				source: [],
			}),
		).toBe("?status=nova%2Csalva&minScore=70");
		expect(jobsQuery({})).toBe("");
	});
});
