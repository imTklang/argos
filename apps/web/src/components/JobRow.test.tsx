// @vitest-environment jsdom
import type { JobDetail as Detail, JobListItem } from "@radar/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobDetail } from "./JobDetail.tsx";
import { JobRow } from "./JobRow.tsx";
import { StatusButtons } from "./StatusButtons.tsx";

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
		dealBreakers: [],
		summary: "Boa aderência em backend.",
	},
	status: "salva",
	note: null,
	alsoOn: [{ source: "gupy", url: "https://gupy/7" }],
};

function wrap(ui: React.ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

/** A fresh Response per call: a body can only be read once. */
function stubFetch(body: unknown) {
	const fetch = vi
		.fn()
		.mockImplementation(
			async () => new Response(JSON.stringify(body), { status: 200 }),
		);
	vi.stubGlobal("fetch", fetch);
	return fetch;
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("JobRow", () => {
	it("shows the score, the summary and where the job is, and opens it", async () => {
		const onOpen = vi.fn();
		wrap(
			<ul>
				<JobRow job={job} onOpen={onOpen} />
			</ul>,
		);
		expect(screen.getByRole("img", { name: "Nota 78 de 100" })).toBeTruthy();
		expect(screen.getByText("Boa aderência em backend.")).toBeTruthy();
		const row = screen.getByRole("button");
		expect(row.textContent).toContain("exterior");
		expect(row.textContent).toContain("salva");
		await userEvent.click(row);
		expect(onOpen).toHaveBeenCalledWith(7);
	});

	it("puts the first deal breaker in place of the summary", () => {
		wrap(
			<ul>
				<JobRow
					job={{
						...job,
						analysis: {
							...(job.analysis as NonNullable<JobListItem["analysis"]>),
							dealBreakers: ["Contrato PJ"],
						},
					}}
					onOpen={vi.fn()}
				/>
			</ul>,
		);
		expect(screen.getByText("Contrato PJ")).toBeTruthy();
		expect(screen.queryByText("Boa aderência em backend.")).toBeNull();
	});

	it("marks the selected job for assistive tech", () => {
		wrap(
			<ul>
				<JobRow job={job} selected onOpen={vi.fn()} />
			</ul>,
		);
		expect(screen.getByRole("button").getAttribute("aria-current")).toBe(
			"true",
		);
	});
});

describe("StatusButtons", () => {
	it("saves, and pressing the active status again sends the job back to nova", async () => {
		const fetch = stubFetch({ ...job, status: "salva" });

		wrap(<StatusButtons jobId={7} status="nova" />);
		await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
		await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		expect(fetch.mock.calls[0]?.[0]).toBe("/api/jobs/7/status");
		expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({
			status: "salva",
		});

		cleanup();
		wrap(<StatusButtons jobId={7} status="salva" />);
		const saved = screen.getByRole("button", { name: "Salvar" });
		expect(saved.getAttribute("aria-pressed")).toBe("true");
		await userEvent.click(saved);
		await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
		expect(JSON.parse(fetch.mock.calls[1]?.[1].body)).toEqual({
			status: "nova",
		});
	});
});

describe("JobDetail", () => {
	const detail: Detail = {
		...job,
		analysis: {
			...(job.analysis as NonNullable<JobListItem["analysis"]>),
			dealBreakers: ["Remuneração não informada"],
		},
		description: "Trabalhe com Node.js.",
		coverLetter: null,
	};

	it("shows the analysis, the link to apply and the other sources", async () => {
		stubFetch(detail);
		wrap(<JobDetail jobId={7} titleId="t" />);
		expect(
			await screen.findByRole("heading", { name: "Backend Intern" }),
		).toBeTruthy();
		expect(screen.getByText("Remuneração não informada")).toBeTruthy();
		expect(screen.getByText("Node.js")).toBeTruthy();
		expect(screen.getByText("Go")).toBeTruthy();
		expect(screen.getByText(/Também em Gupy/)).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: /Abrir no Himalayas/ })
				.getAttribute("href"),
		).toBe("https://himalayas.app/jobs/7");
		expect(screen.getByRole("button", { name: /Gerar rascunho/ })).toBeTruthy();
		// Only a sheet has a close button.
		expect(screen.queryByRole("button", { name: "Fechar" })).toBeNull();
	});

	it("closes from its own button inside a sheet", async () => {
		stubFetch(detail);
		const onClose = vi.fn();
		wrap(<JobDetail jobId={7} titleId="t" onClose={onClose} />);
		await userEvent.click(
			await screen.findByRole("button", { name: "Fechar" }),
		);
		expect(onClose).toHaveBeenCalled();
	});
});
