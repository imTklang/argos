import { describe, expect, it } from "vitest";
import {
	compatibleLocation,
	isSameOpening,
	sameCompany,
	titleKey,
} from "./dedupe.ts";

const opening = (
	company: string,
	location: string | null = null,
	title = "Estágio em Desenvolvimento de Software",
	modality: "remoto" | "híbrido" | "presencial" | null = null,
) => ({ title, company, location, modality });

describe("titleKey", () => {
	it("ignores accents, case and punctuation", () => {
		expect(titleKey("Estágio Short Job | Automation - Development")).toBe(
			titleKey("estagio short job automation development"),
		);
	});
});

describe("sameCompany", () => {
	it.each([
		[
			"Vagas Instituto de Pesquisas Eldorado",
			"Instituto de Pesquisas ELDORADO",
		],
		["BTG Pactual", "BTG Pactual"],
		["Carreiras Decathlon", "Decathlon"],
		["ACME TECNOLOGIA LTDA", "Acme Tecnologia"],
	])("%s = %s", (a, b) => {
		expect(sameCompany(a, b)).toBe(true);
	});

	it.each([
		["Santillana Brasil", "Unimed Porto Alegre"],
		["Grupo Sabin", "Grupo Moura"],
		["Confidencial", "Confidencial"],
		["Oportunidade Confidencial", "Oportunidade Confidencial"],
		["", ""],
	])("%s ≠ %s", (a, b) => {
		expect(sameCompany(a, b)).toBe(false);
	});
});

describe("compatibleLocation", () => {
	it("matches the same city written differently", () => {
		expect(
			compatibleLocation(
				opening("x", "São Paulo, SP"),
				opening("x", "Sao Paulo"),
			),
		).toBe(true);
	});

	it("keeps openings in different cities apart", () => {
		expect(
			compatibleLocation(
				opening("x", "Anápolis, GO"),
				opening("x", "Goiânia, GO"),
			),
		).toBe(false);
	});

	it("treats a missing location or two remote jobs as compatible", () => {
		expect(compatibleLocation(opening("x", null), opening("x", "Recife"))).toBe(
			true,
		);
		expect(
			compatibleLocation(
				opening("x", "Remoto: Brazil", "t", "remoto"),
				opening("x", "São Paulo", "t", "remoto"),
			),
		).toBe(true);
	});
});

describe("isSameOpening", () => {
	it("finds the same posting on two sources", () => {
		expect(
			isSameOpening(
				opening("Instituto de Pesquisas ELDORADO", null),
				opening("Vagas Instituto de Pesquisas Eldorado", "Remoto: Brazil"),
			),
		).toBe(true);
	});

	it("does not merge generic titles from different companies", () => {
		expect(
			isSameOpening(
				opening("Santillana Brasil", null, "Estágio Financeiro"),
				opening("VERBO", null, "Estágio Financeiro"),
			),
		).toBe(false);
	});

	it("does not merge one company's openings in different cities", () => {
		const title = "Programa de Estágio MRV&CO | Engenharia Civil";
		expect(
			isSameOpening(
				opening("Programa de Estágio MRV&CO", "Anápolis, Goiás", title),
				opening("Programa de Estágio MRV&CO", "Londrina, PR", title),
			),
		).toBe(false);
	});
});
