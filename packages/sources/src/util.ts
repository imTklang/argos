import { type Level, type Modality, normalizeText } from "@radar/core";

export const USER_AGENT =
	"radar-estagio/0.1 (+https://github.com/imTklang/radar-estagio)";

const NAMED: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

/** Plain text from a job description in HTML, keeping paragraphs and list items. */
export function htmlToText(html: string): string {
	const text = html
		.replace(/<\s*br\s*\/?>/gi, "\n")
		.replace(/<\s*li[^>]*>/gi, "\n- ")
		.replace(/<\/\s*(p|div|ul|ol|h[1-6])\s*>/gi, "\n")
		.replace(/<[^>]+>/g, "");
	return decodeHtmlEntities(text)
		.replace(/[ \t ]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

export type PoliteFetchOptions = {
	fetch: typeof globalThis.fetch;
	sleep: (ms: number) => Promise<void>;
	retries?: number;
	backoffMs?: number;
};

/** Error text that keeps undici's hidden cause ("fetch failed" alone says nothing). */
export function describeError(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const cause = error.cause as { code?: string; message?: string } | undefined;
	const detail = cause?.code ?? cause?.message;
	return detail ? `${error.message} (${detail})` : error.message;
}

/**
 * GET with an identifiable User-Agent that retries network errors, 429 and
 * 5xx with a growing pause, so one hiccup does not lose a whole source.
 */
export async function politeFetch(
	url: string,
	headers: Record<string, string>,
	opts: PoliteFetchOptions,
): Promise<Response> {
	const { fetch, sleep, retries = 3, backoffMs = 10_000 } = opts;
	for (let attempt = 0; ; attempt++) {
		try {
			const res = await fetch(url, {
				headers: { "user-agent": USER_AGENT, ...headers },
			});
			const retryable = res.status === 429 || res.status >= 500;
			if (!retryable || attempt >= retries) return res;
		} catch (error) {
			if (attempt >= retries) throw new Error(describeError(error));
		}
		await sleep(backoffMs * (attempt + 1));
	}
}

export function decodeHtmlEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
		if (entity[0] === "#") {
			const code =
				entity[1] === "x" || entity[1] === "X"
					? Number.parseInt(entity.slice(2), 16)
					: Number.parseInt(entity.slice(1), 10);
			return Number.isNaN(code) ? match : String.fromCodePoint(code);
		}
		return NAMED[entity.toLowerCase()] ?? match;
	});
}

// Modality words as they appear in labels, title tags and ATS locations,
// matched on normalized text. "Alocado" (frontendbr) means on-site and
// "Semi-presencial" (soujava, androiddevbr) means hybrid.
const MODALITY_WORDS: [RegExp, Modality][] = [
	[/(?<![a-z])(remot[oa]|remote|home ?office)(?![a-z])/, "remoto"],
	[/(?<![a-z])(hibrid[oa]|hybrid|semi-?presencial)(?![a-z])/, "híbrido"],
	[/(?<![a-z-])(presencial|alocad[oa]|on-?site)(?![a-z])/, "presencial"],
];

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
		/(?<![a-z])(especialista|staff|principal|tech lead)(?![a-z])/,
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
 * Title first, then labels: the title is written per posting, labels are
 * often left over from the template. "Estágio ou Júnior" counts as estágio.
 */
export function issueLevel(title: string, labels: string[]): Level | null {
	for (const levels of [levelsIn(title), labels.flatMap(levelsIn)]) {
		if (levels.includes("estágio")) return "estágio";
		if (levels[0]) return levels[0];
	}
	return null;
}

// When several are named ("Remoto ou Híbrido", or contradictory labels),
// keep the most flexible one: it is the one the candidate can take.
const FLEXIBILITY: Modality[] = ["remoto", "híbrido", "presencial"];

export function modalitiesIn(text: string): Modality[] {
	const normalized = normalizeText(text);
	return MODALITY_WORDS.filter(([pattern]) => pattern.test(normalized)).map(
		([, modality]) => modality,
	);
}

export function mostFlexible(modalities: Modality[]): Modality | null {
	return FLEXIBILITY.find((m) => modalities.includes(m)) ?? null;
}

// Places that mark a posting as Brazilian. Cities are the ones Brazilian
// tech companies actually list; state codes need the ", SP" form so "PR"
// never matches "PR review".
const BRAZIL =
	/(brasil|brazil|🇧🇷|sao paulo|rio de janeiro|belo horizonte|curitiba|porto alegre|florianopolis|recife|fortaleza|salvador|campinas|joao pessoa|brasilia|goiania|manaus|natal|vitoria|blumenau|joinville|abc paulista|pocos de caldas|sao jose)|,\s*(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)\b/;
const ABROAD =
	/(mexico|cdmx|colombia|bogota|medellin|argentina|buenos aires|chile|santiago|peru|lima|uruguay|montevideo|united states|usa|\bus\b|new york|palo alto|san francisco|los angeles|miami|virginia|canada|toronto|united kingdom|\buk\b|london|spain|barcelona|madrid|portugal|lisbon|lisboa|germany|berlin|ghent|france|paris|china|shanghai|singapore|india|korea|japan|australia|sydney)/;

/**
 * Whether a location string points at Brazil. Text naming only places
 * abroad is "abroad"; text naming neither (e.g. just "Remote") is "unknown"
 * and is kept, since every configured company hires in Brazil.
 */
export function brazilScope(location: string): "brazil" | "abroad" | "unknown" {
	const text = normalizeText(location);
	if (BRAZIL.test(text)) return "brazil";
	if (ABROAD.test(text)) return "abroad";
	return "unknown";
}
