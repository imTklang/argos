import type { Job } from "./schemas.ts";
import { normalizeText } from "./text.ts";

/** Title reduced to words: accents, case and punctuation do not matter. */
export function titleKey(title: string): string {
	return normalizeText(title)
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

// Words that boards add around a company name ("Vagas Grupo Sabin",
// "Carreiras Decathlon", "ACME LTDA"). They say nothing about who hires.
const COMPANY_NOISE = new Set([
	"vagas",
	"vaga",
	"carreiras",
	"carreira",
	"careers",
	"jobs",
	"trabalhe",
	"conosco",
	"oportunidades",
	"programa",
	"estagio",
	"grupo",
	"group",
	"ltda",
	"eireli",
	"me",
	"sa",
	"s",
	"a",
	"inc",
	"the",
	"de",
	"da",
	"do",
	"das",
	"dos",
	"e",
	"brasil",
	"brazil",
]);

// Placeholders that many unrelated postings share.
const ANONYMOUS = new Set([
	"confidencial",
	"oportunidade confidencial",
	"empresa nao informada",
]);

export function companyTokens(company: string): Set<string> {
	return new Set(
		titleKey(company)
			.split(" ")
			.filter((word) => word.length > 0 && !COMPANY_NOISE.has(word)),
	);
}

/**
 * Same employer despite board decorations: "Vagas Instituto de Pesquisas
 * Eldorado" and "Instituto de Pesquisas ELDORADO" match; anonymous postings
 * never match anything.
 */
export function sameCompany(a: string, b: string): boolean {
	if (ANONYMOUS.has(titleKey(a)) || ANONYMOUS.has(titleKey(b))) return false;
	const x = companyTokens(a);
	const y = companyTokens(b);
	if (x.size === 0 || y.size === 0) return false;
	const shared = [...x].filter((word) => y.has(word)).length;
	const smaller = Math.min(x.size, y.size);
	// One name contained in the other, or most words in common.
	return shared === smaller || shared / (x.size + y.size - shared) >= 0.6;
}

function city(location: string | null): string | null {
	if (!location) return null;
	const first = titleKey(location.split(/[,/|;-]/)[0] ?? "");
	return first || null;
}

/** Same place, or not enough information to tell them apart. */
export function compatibleLocation(
	a: Pick<Job, "location" | "modality">,
	b: Pick<Job, "location" | "modality">,
): boolean {
	if (a.modality === "remoto" && b.modality === "remoto") return true;
	const x = city(a.location);
	const y = city(b.location);
	return x === null || y === null || x === y;
}

/** Whether two postings are the same opening, across sources or reposted. */
export function isSameOpening(
	a: Pick<Job, "title" | "company" | "location" | "modality">,
	b: Pick<Job, "title" | "company" | "location" | "modality">,
): boolean {
	return (
		titleKey(a.title) === titleKey(b.title) &&
		sameCompany(a.company, b.company) &&
		compatibleLocation(a, b)
	);
}
