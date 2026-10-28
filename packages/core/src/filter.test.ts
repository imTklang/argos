import { describe, expect, it } from "vitest";
import { hardFilter } from "./filter.ts";
import { jobHash } from "./hash.ts";
import type { Job, Preferences } from "./schemas.ts";
import { keywordVariants, matchKeywords, normalizeText } from "./text.ts";

const now = new Date("2026-10-27T12:00:00Z");

const prefs: Preferences = {
	roles: ["estágio backend"],
	keywordsMust: ["estágio", "estagiário"],
	keywordsBonus: ["node.js", "typescript", "postgresql", "asaas (pix)"],
	keywordsBlock: ["sênior", "pleno"],
	modality: ["remoto", "híbrido", "presencial"],
	locations: ["João Pessoa", "PB", "Brasil (remoto)"],
	minScoreToNotify: 70,
};

const base: Job = {
	source: "gupy",
	externalId: "1",
	title: "Estágio em Desenvolvimento de Software",
	company: "Acme",
	location: "João Pessoa, Paraíba",
	modality: "presencial",
	description: "Vaga de estágio. Stack: Node, TypeScript e Postgres.",
	url: "https://acme.gupy.io/job/1",
	publishedAt: new Date("2026-10-20T00:00:00Z"),
	expiresAt: new Date("2026-11-30T00:00:00Z"),
};

const job = (patch: Partial<Job>): Job => ({ ...base, ...patch });

describe("hardFilter", () => {
	it("passes a tech internship in the region and lists matched skills", () => {
		expect(hardFilter(base, prefs, now)).toEqual({
			pass: true,
			bonus: ["node.js", "typescript", "postgresql"],
		});
	});

	it.each([
		["expirada", { expiresAt: new Date("2026-10-01T00:00:00Z") }],
		["antiga", { publishedAt: new Date("2023-07-14T00:00:00Z") }],
		// An internship title with a blocked word ("Sênior" mentoring).
		["nível bloqueado", { title: "Estágio Backend com mentoria Sênior" }],
		[
			"sem palavra obrigatória",
			{ title: "Desenvolvedor Backend", description: "Node e TypeScript." },
		],
		["fora da região", { location: "Anápolis, Goiás" }],
		[
			"fora de TI",
			{
				title: "Estágio em Direito",
				description: "Estágio para estudantes de Direito.",
			},
		],
	] as const)("rejects as %s", (reason, patch) => {
		expect(hardFilter(job(patch), prefs, now)).toEqual({
			pass: false,
			reason,
		});
	});

	it("rejects jobs whose structured level is not an internship", () => {
		expect(hardFilter(job({ level: "júnior" }), prefs, now)).toEqual({
			pass: false,
			reason: "não é estágio",
		});
	});

	it.each([
		["Desenvolvedor Backend Sr", "sênior"],
		["Analista de Sistemas III", "sênior"],
		["Dev Fullstack Pl", "pleno"],
		["Back-end Developer JR", "júnior"],
		["Lead Database Engineer", "especialista"],
		["Programa Trainee Tecnologia 2027", "trainee"],
	])(
		"rejects '%s' (%s) by its title even if the description mentions estágio",
		(title) => {
			const senior = job({
				title,
				description:
					"Valorizamos estagiários e estágio com Node.js e TypeScript.",
			});
			expect(hardFilter(senior, prefs, now)).toEqual({
				pass: false,
				reason: "não é estágio",
			});
		},
	);

	it("keeps internships whose title also names another level", () => {
		const both = job({ title: "Estágio ou Desenvolvedor Júnior Backend" });
		expect(hardFilter(both, prefs, now).pass).toBe(true);
	});

	it("does not read PL/SQL as a level", () => {
		const plsql = job({ title: "Estágio em Banco de Dados PL/SQL" });
		expect(hardFilter(plsql, prefs, now).pass).toBe(true);
	});

	it("lets a known internship skip the mandatory word", () => {
		const labeled = job({
			level: "estágio",
			title: "Desenvolvedor Backend",
			description: "Node e TypeScript no dia a dia.",
		});
		expect(hardFilter(labeled, prefs, now).pass).toBe(true);
	});

	describe("jobs abroad", () => {
		const abroad = job({
			abroad: true,
			level: "estágio",
			modality: "remoto",
			location: "Worldwide",
			title: "Backend Engineering Intern",
			description: "Internship. Node.js and TypeScript.",
		});

		it("are left out unless the user opted in", () => {
			expect(hardFilter(abroad, prefs, now)).toEqual({
				pass: false,
				reason: "exterior",
			});
		});

		it("pass when the user accepts remote jobs abroad, skipping the region rule", () => {
			expect(hardFilter(abroad, { ...prefs, abroad: "remote" }, now).pass).toBe(
				true,
			);
		});

		it("must be remote", () => {
			const onSite = { ...abroad, modality: "presencial" as const };
			expect(hardFilter(onSite, { ...prefs, abroad: "remote" }, now)).toEqual({
				pass: false,
				reason: "exterior",
			});
		});
	});

	it("accepts remote jobs anywhere", () => {
		const remote = job({ location: null, modality: "remoto" });
		expect(hardFilter(remote, prefs, now).pass).toBe(true);
	});

	it("rejects modalities left out of the preferences", () => {
		const onlyRemote = { ...prefs, modality: ["remoto" as const] };
		expect(hardFilter(base, onlyRemote, now)).toEqual({
			pass: false,
			reason: "modalidade",
		});
	});

	it("matches the state name from a UF in the preferences", () => {
		const elsewhere = job({ location: "Campina Grande, Paraíba" });
		expect(hardFilter(elsewhere, prefs, now).pass).toBe(true);
	});

	it("lets a generic title through when the description names the stack", () => {
		const generic = job({ title: "Programa de Estágio 2027" });
		expect(hardFilter(generic, prefs, now).pass).toBe(true);
	});

	it("rejects a generic title that names too few skills", () => {
		const generic = job({
			title: "Programa de Estágio 2027",
			description: "Estágio com Node.",
		});
		expect(hardFilter(generic, prefs, now)).toEqual({
			pass: false,
			reason: "fora de TI",
		});
	});

	it("recognizes tech titles written in English", () => {
		const english = job({
			title: "Estágio Short Job | Automation - Development",
			description: "Estágio na área de automação.",
		});
		expect(hardFilter(english, prefs, now).pass).toBe(true);
	});

	it("does not treat 'Desenvolvimento de Negócios' as tech", () => {
		const business = job({
			title: "Estágio em Desenvolvimento de Negócios",
			description: "Estágio comercial.",
		});
		expect(hardFilter(business, prefs, now).pass).toBe(false);
	});
});

describe("matchKeywords", () => {
	it("ignores accents and case", () => {
		expect(normalizeText("Estágio TÉCNICO")).toBe("estagio tecnico");
		expect(matchKeywords("ESTAGIO em TI", ["estágio"])).toEqual(["estágio"]);
	});

	it("matches aliases and whole words only", () => {
		expect(matchKeywords("Usamos Postgres", ["postgresql"])).toEqual([
			"postgresql",
		]);
		expect(matchKeywords("internacional", ["intern"])).toEqual([]);
	});

	it("drops parenthetical notes from keywords", () => {
		expect(keywordVariants("asaas (pix)")).toEqual(["asaas"]);
	});
});

describe("jobHash", () => {
	it("is stable across case, accents and spacing", () => {
		const a = jobHash({ company: "Acme", title: "Estágio  TI", url: "u" });
		const b = jobHash({ company: "ACME", title: "estagio ti", url: "u" });
		expect(a).toBe(b);
	});

	it("changes with the URL", () => {
		expect(jobHash({ company: "a", title: "b", url: "1" })).not.toBe(
			jobHash({ company: "a", title: "b", url: "2" }),
		);
	});
});
