import type {
	JobDetail,
	JobFilters,
	JobListItem,
	JobStatus,
	Preferences,
	Stats,
} from "@radar/core";
import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		...init,
		headers: init?.body ? { "content-type": "application/json" } : undefined,
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) {
		throw new ApiError(body?.error ?? `Erro ${res.status}`, res.status);
	}
	return body as T;
}

/** Query string for /api/jobs; lists become "a,b". */
export function jobsQuery(filters: JobFilters): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(filters)) {
		if (value === undefined || value === "" || value === "all") continue;
		if (Array.isArray(value)) {
			if (value.length > 0) params.set(key, value.join(","));
		} else {
			params.set(key, String(value));
		}
	}
	const qs = params.toString();
	return qs ? `?${qs}` : "";
}

export type JobsPage = { items: JobListItem[]; total: number };

export function useJobs(filters: JobFilters) {
	return useQuery({
		queryKey: ["jobs", filters],
		queryFn: () => request<JobsPage>(`/api/jobs${jobsQuery(filters)}`),
		// Keep the old list on screen while a new filter loads.
		placeholderData: keepPreviousData,
	});
}

export function useJob(id: number | null) {
	return useQuery({
		queryKey: ["job", id],
		queryFn: () => request<JobDetail>(`/api/jobs/${id}`),
		enabled: id !== null,
	});
}

export function useStats() {
	return useQuery({
		queryKey: ["stats"],
		queryFn: () => request<Stats>("/api/stats"),
	});
}

type StatusChange = { id: number; status: JobStatus; note?: string | null };

/**
 * Status changes show up at once in every cached list and roll back if the
 * API refuses them.
 */
export function useUpdateStatus() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: ({ id, ...body }: StatusChange) =>
			request<JobDetail>(`/api/jobs/${id}/status`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),
		onMutate: async (change) => {
			await client.cancelQueries({ queryKey: ["jobs"] });
			const previous = client.getQueriesData<JobsPage>({ queryKey: ["jobs"] });
			client.setQueriesData<JobsPage>({ queryKey: ["jobs"] }, (page) =>
				page
					? {
							...page,
							items: page.items.map((job) =>
								job.id === change.id
									? {
											...job,
											status: change.status,
											...(change.note !== undefined
												? { note: change.note }
												: {}),
										}
									: job,
							),
						}
					: page,
			);
			return { previous };
		},
		onError: (_error, _change, context) => {
			for (const [key, data] of context?.previous ?? []) {
				client.setQueryData(key, data);
			}
		},
		onSuccess: (job) => client.setQueryData(["job", job.id], job),
		onSettled: () => {
			client.invalidateQueries({ queryKey: ["jobs"] });
			client.invalidateQueries({ queryKey: ["stats"] });
		},
	});
}

export function useCoverLetter(id: number) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (regenerate: boolean) =>
			request<NonNullable<JobDetail["coverLetter"]>>(
				`/api/jobs/${id}/cover-letter`,
				{ method: "POST", body: JSON.stringify({ regenerate }) },
			),
		onSuccess: (coverLetter) =>
			client.setQueryData<JobDetail>(["job", id], (job) =>
				job ? { ...job, coverLetter } : job,
			),
	});
}

export function usePreferences() {
	return useQuery({
		queryKey: ["preferences"],
		queryFn: () => request<Preferences>("/api/preferences"),
	});
}

export function useSavePreferences() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (prefs: Preferences) =>
			request<Preferences>("/api/preferences", {
				method: "PUT",
				body: JSON.stringify(prefs),
			}),
		onSuccess: (prefs) => client.setQueryData(["preferences"], prefs),
	});
}
