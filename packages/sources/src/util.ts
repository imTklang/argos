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
