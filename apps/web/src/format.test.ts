import { describe, expect, it } from "vitest";
import { jobsQuery } from "./api.ts";
import { ago, fromNow, place, scoreTone, sourceLabel } from "./format.ts";
import { listCount, routeFromHash } from "./routes.ts";

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

describe("ago", () => {
	const now = new Date("2026-10-28T12:00:00Z");
	it("uses minutes, then hours, then days", () => {
		expect(ago("2026-10-28T11:59:40Z", now)).toBe("agora");
		expect(ago("2026-10-28T11:55:00Z", now)).toBe("há 5 minutos");
		expect(ago("2026-10-28T09:00:00Z", now)).toBe("há 3 horas");
		expect(ago("2026-10-26T12:00:00Z", now)).toBe("anteontem");
		expect(ago(null, now)).toBeNull();
	});
});

describe("routes", () => {
	it("reads the hash and falls back to the main list", () => {
		expect(routeFromHash("#/salvas")).toBe("salvas");
		expect(routeFromHash("#quadro")).toBe("quadro");
		expect(routeFromHash("#/kanban")).toBe("para-voce");
		expect(routeFromHash("")).toBe("para-voce");
	});

	it("counts a list from its statuses, except the score-filtered ones", () => {
		const stats = {
			byStatus: { nova: 4, vista: 1, salva: 2, candidatei: 3, descartada: 9 },
			lastRuns: [],
		};
		expect(listCount(stats, "novas")).toBe(5);
		expect(listCount(stats, "candidaturas")).toBe(3);
		expect(listCount(stats, "para-voce")).toBeNull();
		expect(listCount(undefined, "salvas")).toBeNull();
	});
});
