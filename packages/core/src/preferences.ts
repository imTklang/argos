import type { Preferences, Profile } from "./schemas.ts";

const DEFAULTS = {
	roles: ["estágio backend", "estágio desenvolvimento", "estágio full stack"],
	keywordsMust: ["estágio", "estagiário", "estagiária", "intern", "internship"],
	keywordsBlock: [
		"sênior",
		"senior",
		"pleno",
		"especialista",
		"tech lead",
		"vendas",
		"suporte n1",
		"telemarketing",
	],
	locations: ["João Pessoa", "PB", "Brasil (remoto)"],
	maxHoursPerWeek: 30,
	minScoreToNotify: 70,
} as const;

/** First draft of search preferences; the user edits the result by hand. */
export function buildPreferences(profile: Profile): Preferences {
	const bonus = profile.skills
		.filter((s) => s.level !== "básico")
		.map((s) => s.name.toLowerCase());

	return {
		roles: [...DEFAULTS.roles],
		keywordsMust: [...DEFAULTS.keywordsMust],
		keywordsBonus: [...new Set(bonus)],
		keywordsBlock: [...DEFAULTS.keywordsBlock],
		modality: ["remoto", "híbrido", "presencial"],
		locations: [...DEFAULTS.locations],
		maxHoursPerWeek: DEFAULTS.maxHoursPerWeek,
		minScoreToNotify: DEFAULTS.minScoreToNotify,
	};
}
