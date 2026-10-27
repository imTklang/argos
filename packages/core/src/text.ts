/** Lowercase and strip accents so "Estágio" and "estagio" compare equal. */
export function normalizeText(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();
}

// Spellings job postings use for the same skill. Keys are normalized keyword
// names as they appear in preferences.json.
const ALIASES: Record<string, string[]> = {
	"node.js": ["node.js", "nodejs", "node"],
	postgresql: ["postgresql", "postgres"],
	"next.js": ["next.js", "nextjs"],
	"prisma orm": ["prisma"],
	"phoenix liveview": ["phoenix", "liveview"],
	"docker compose": ["docker compose", "docker-compose"],
	tailwindcss: ["tailwindcss", "tailwind"],
	rest: ["rest", "restful"],
};

function escapeRegExp(text: string) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches a whole term inside normalized text, so "node" won't hit "nodeira". */
export function termPattern(term: string): RegExp {
	return new RegExp(`(?<![a-z0-9])${escapeRegExp(term)}(?![a-z0-9])`);
}

/** Spellings to look for: aliases plus the keyword itself, without "(…)" notes. */
export function keywordVariants(keyword: string): string[] {
	const key = normalizeText(keyword)
		.replace(/\(.*?\)/g, "")
		.trim();
	if (!key) return [];
	return [...new Set([key, ...(ALIASES[key] ?? [])])];
}

/** Keywords (as given) that appear in the text under any of their spellings. */
export function matchKeywords(text: string, keywords: string[]): string[] {
	const haystack = normalizeText(text);
	return keywords.filter((keyword) =>
		keywordVariants(keyword).some((v) => termPattern(v).test(haystack)),
	);
}
