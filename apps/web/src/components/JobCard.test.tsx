// @vitest-environment jsdom
import type { JobListItem } from "@radar/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobCard } from "./JobCard.tsx";

const job: JobListItem = {
	id: 7,
	title: "Backend Intern",
	company: "Acme",
	location: "Remoto, qualquer país",
	modality: "remoto",
	abroad: true,
	level: "estágio",
	source: "himalayas",
	url: "https://himalayas.app/jobs/7",
	publishedAt: null,
	expiresAt: null,
	score: 78,
	analysis: {
		score: 78,
		matchedSkills: ["Node.js"],
		missingSkills: ["Go"],
		dealBreakers: ["Remuneração não informada"],
		summary: "Boa aderência em backend.",
	},
	status: "nova",
	note: null,
	alsoOn: [{ source: "gupy", url: "https://gupy/7" }],
};

function renderCard(item = job, onOpen = vi.fn()) {
	const client = new QueryClient({
		defaultOptions: { mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<JobCard job={item} onOpen={onOpen} />
		</QueryClientProvider>,
	);
	return { onOpen };
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("JobCard", () => {
	it("shows the score, the analysis, deal breakers and other sources", () => {
		renderCard();
		expect(screen.getByTitle("Nota 78 de 100")).toHaveProperty(
			"textContent",
			"78",
		);
		expect(screen.getByText("Boa aderência em backend.")).toBeTruthy();
		expect(screen.getByText("Remuneração não informada")).toBeTruthy();
		expect(screen.getByText("Exterior")).toBeTruthy();
		expect(screen.getByText(/também em Gupy/)).toBeTruthy();
		expect(
			screen.getByRole("link", { name: /Himalayas/ }).getAttribute("href"),
		).toBe("https://himalayas.app/jobs/7");
	});

	it("opens the details from the title", async () => {
		const { onOpen } = renderCard();
		await userEvent.click(
			screen.getByRole("button", { name: "Backend Intern" }),
		);
		expect(onOpen).toHaveBeenCalledWith(7);
	});

	it("saves the job, and pressing the active status again sends it back to nova", async () => {
		// A fresh Response per call: a body can only be read once.
		const fetch = vi.fn().mockImplementation(
			async () =>
				new Response(JSON.stringify({ ...job, status: "salva" }), {
					status: 200,
				}),
		);
		vi.stubGlobal("fetch", fetch);

		renderCard();
		await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
		await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		expect(fetch.mock.calls[0]?.[0]).toBe("/api/jobs/7/status");
		expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({
			status: "salva",
		});

		cleanup();
		renderCard({ ...job, status: "salva" });
		const saved = screen.getByRole("button", { name: "Salvar" });
		expect(saved.getAttribute("aria-pressed")).toBe("true");
		await userEvent.click(saved);
		await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
		expect(JSON.parse(fetch.mock.calls[1]?.[1].body)).toEqual({
			status: "nova",
		});
	});
});
