import type { Job, Preferences } from "./schemas.ts";
import { matchKeywords, normalizeText, termPattern } from "./text.ts";

/** Postings older than this are treated as stale even without a deadline. */
export const MAX_JOB_AGE_DAYS = 120;
// Generic titles ("Programa de Estágio 2027") pass only if the description
// names at least this many of the profile's skills.
const MIN_BONUS_FOR_GENERIC_TITLE = 2;

// Portuguese and English: company boards (Greenhouse, Lever) often title
// internships in English, e.g. "Automation - Development".
const TECH_TITLE =
	/(?<![a-z])(ti|t\.i\.|it|tecnologia|technology|software|sistemas|programacao|programming|programador|desenvolvedor|developer|development|desenvolvimento (de )?(software|sistemas|web|aplicac)|back-?end|front-?end|full ?stack|dev|devops|computacao|computer science|informatica|dados|data|automacao|automation|machine learning|cloud|qa)(?![a-z])/;

const STATES: Record<string, string> = {
	ac: "acre",
	al: "alagoas",
	ap: "amapa",
	am: "amazonas",
	ba: "bahia",
	ce: "ceara",
	df: "distrito federal",
	es: "espirito santo",
	go: "goias",
	ma: "maranhao",
	mt: "mato grosso",
	ms: "mato grosso do sul",
	mg: "minas gerais",
	pa: "para",
	pb: "paraiba",
	pr: "parana",
	pe: "pernambuco",
	pi: "piaui",
	rj: "rio de janeiro",
	rn: "rio grande do norte",
	rs: "rio grande do sul",
	ro: "rondonia",
	rr: "roraima",
	sc: "santa catarina",
	sp: "sao paulo",
	se: "sergipe",
	to: "tocantins",
};

/** Brazilian state names, normalized (no accents, lowercase). */
export const STATE_NAMES = Object.values(STATES);

export type FilterReason =
	| "expirada"
	| "antiga"
	| "nível bloqueado"
	| "não é estágio"
	| "exterior"
	| "sem palavra obrigatória"
	| "modalidade"
	| "fora da região"
	| "fora de TI";

export type FilterResult =
	| { pass: true; bonus: string[] }
	| { pass: false; reason: FilterReason };

function locationTerms(locations: string[]): string[] {
	const terms: string[] = [];
	for (const location of locations) {
		const term = normalizeText(location)
			.replace(/\(.*?\)/g, "")
			.trim();
		// "Brasil (remoto)" means remote jobs are fine; remote is handled apart.
		if (!term || term === "brasil") continue;
		terms.push(term);
		const state = STATES[term];
		if (state) terms.push(state);
	}
	return terms;
}

/** Cheap rules that drop a job before any tokens are spent on it. */
export function hardFilter(
	job: Job,
	prefs: Preferences,
	now = new Date(),
): FilterResult {
	if (job.expiresAt && job.expiresAt < now) {
		return { pass: false, reason: "expirada" };
	}
	const maxAgeMs = MAX_JOB_AGE_DAYS * 24 * 60 * 60 * 1000;
	if (job.publishedAt && now.getTime() - job.publishedAt.getTime() > maxAgeMs) {
		return { pass: false, reason: "antiga" };
	}

	if (job.level && job.level !== "estágio") {
		return { pass: false, reason: "não é estágio" };
	}
	if (matchKeywords(job.title, prefs.keywordsBlock).length > 0) {
		return { pass: false, reason: "nível bloqueado" };
	}
	const fullText = `${job.title}\n${job.description}`;
	if (
		job.level !== "estágio" &&
		matchKeywords(fullText, prefs.keywordsMust).length === 0
	) {
		return { pass: false, reason: "sem palavra obrigatória" };
	}

	if (job.abroad) {
		// Only remote roles abroad, and only when the user opted in.
		if ((prefs.abroad ?? "none") !== "remote" || job.modality !== "remoto") {
			return { pass: false, reason: "exterior" };
		}
	} else if (job.modality && !prefs.modality.includes(job.modality)) {
		return { pass: false, reason: "modalidade" };
	}
	if (!job.abroad && job.modality !== "remoto") {
		const location = normalizeText(job.location ?? "");
		const inRegion = locationTerms(prefs.locations).some((term) =>
			termPattern(term).test(location),
		);
		if (!inRegion) return { pass: false, reason: "fora da região" };
	}

	const bonus = matchKeywords(job.description, prefs.keywordsBonus);
	const techTitle = TECH_TITLE.test(normalizeText(job.title));
	if (!techTitle && bonus.length < MIN_BONUS_FOR_GENERIC_TITLE) {
		return { pass: false, reason: "fora de TI" };
	}

	return { pass: true, bonus };
}
