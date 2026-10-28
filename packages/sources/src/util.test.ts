import { describe, expect, it, vi } from "vitest";
import { describeError, politeFetch } from "./util.ts";

const ok = () => new Response("{}", { status: 200 });

describe("politeFetch", () => {
	it("retries network errors and 5xx with growing pauses", async () => {
		const fetch = vi
			.fn()
			.mockRejectedValueOnce(new TypeError("fetch failed"))
			.mockResolvedValueOnce(new Response("", { status: 503 }))
			.mockResolvedValueOnce(ok());
		const sleep = vi.fn().mockResolvedValue(undefined);

		const res = await politeFetch("https://x", {}, { fetch, sleep });

		expect(res.status).toBe(200);
		expect(sleep.mock.calls).toEqual([[10_000], [20_000]]);
	});

	it("does not retry client errors", async () => {
		const fetch = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
		const sleep = vi.fn();

		const res = await politeFetch("https://x", {}, { fetch, sleep });

		expect(res.status).toBe(404);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("gives up after the retries and reports the hidden cause", async () => {
		const error = new TypeError("fetch failed", {
			cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
		});
		const fetch = vi.fn().mockRejectedValue(error);
		const sleep = vi.fn().mockResolvedValue(undefined);

		await expect(
			politeFetch("https://x", {}, { fetch, sleep, retries: 1 }),
		).rejects.toThrow("fetch failed (UND_ERR_CONNECT_TIMEOUT)");
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("sends the project User-Agent", async () => {
		const fetch = vi.fn().mockResolvedValue(ok());
		await politeFetch("https://x", { accept: "a" }, { fetch, sleep: vi.fn() });
		expect(fetch.mock.calls[0]?.[1].headers).toMatchObject({
			accept: "a",
			"user-agent": expect.stringMatching(/argos\//),
		});
	});
});

describe("describeError", () => {
	it("falls back to the message when there is no cause", () => {
		expect(describeError(new Error("boom"))).toBe("boom");
	});
});
