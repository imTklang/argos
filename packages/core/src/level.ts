import type { Level } from "./schemas.ts";
import { normalizeText } from "./text.ts";

// Level words in titles and labels ("👶 Estágio", "Junior", "Dev Sr").
// Matched as whole words on normalized text so "pl" or "sr" never hit inside
// another word.
const LEVEL_WORDS: [RegExp, Level][] = [
	[/(?<![a-z])(estagio|estagiari[oa]s?|intern|internship)(?![a-z])/, "estágio"],
	[/(?<![a-z])trainee(?![a-z])/, "trainee"],
	[/(?<![a-z])(junior|jr)(?![a-z])/, "júnior"],
	// "pl" but not "PL/SQL".
	[/(?<![a-z])(pleno|plena|pl(?!\/))(?![a-z])/, "pleno"],
	[/(?<![a-z])(senior|sr|iii)(?![a-z])/, "sênior"],
	[
		/(?<![a-z])(especialista|staff|principal|tech lead|lead|lider)(?![a-z])/,
		"especialista",
	],
];

export function levelsIn(text: string): Level[] {
	const normalized = normalizeText(text);
	return LEVEL_WORDS.filter(([pattern]) => pattern.test(normalized)).map(
		([, level]) => level,
	);
}

/**
 * Level named in a title, then in hints such as labels or a contract field.
 * The title wins because it is written per posting, while labels are often
 * left over from a template. "Estágio ou Júnior" counts as estágio.
 */
export function detectLevel(title: string, hints: string[] = []): Level | null {
	for (const levels of [levelsIn(title), hints.flatMap(levelsIn)]) {
		if (levels.includes("estágio")) return "estágio";
		if (levels[0]) return levels[0];
	}
	return null;
}
