import type { JobFilters, JobStatus } from "@radar/core";
import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useJobs } from "../api.ts";
import { JobCard } from "../components/JobCard.tsx";
import { STATUS_LABEL, STATUSES } from "../format.ts";

const PAGE = 30;

function useDebounced<T>(value: T, ms: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), ms);
		return () => clearTimeout(timer);
	}, [value, ms]);
	return debounced;
}

function Segmented<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: [T, string][];
	onChange: (value: T) => void;
}) {
	const name = useId();
	return (
		<fieldset className="inline-flex rounded-lg border border-line bg-surface p-0.5">
			<legend className="sr-only">{label}</legend>
			{options.map(([option, text]) => (
				// Real radio inputs: arrow keys and screen readers work for free.
				<label key={option} className="pressable cursor-pointer">
					<input
						type="radio"
						name={name}
						value={option}
						checked={value === option}
						onChange={() => onChange(option)}
						className="peer sr-only"
					/>
					<span className="block rounded-md px-2.5 py-1 text-sm text-muted peer-checked:bg-sunken peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
						{text}
					</span>
				</label>
			))}
		</fieldset>
	);
}

export function JobsPage({ onOpen }: { onOpen: (id: number) => void }) {
	const [q, setQ] = useState("");
	// Open work by default: new, seen and saved.
	const [status, setStatus] = useState<JobStatus[]>(["nova", "vista", "salva"]);
	const [scope, setScope] = useState<"all" | "brazil" | "abroad">("all");
	const [minScore, setMinScore] = useState<"0" | "50" | "70" | "85">("50");
	const [sort, setSort] = useState<"score" | "recent">("score");
	const [limit, setLimit] = useState(PAGE);

	const filters: JobFilters = {
		q: useDebounced(q, 250),
		status,
		scope,
		minScore: minScore === "0" ? undefined : Number(minScore),
		sort,
		limit,
	};
	// A new filter starts from the first page again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter change
	useEffect(() => setLimit(PAGE), [filters.q, status, scope, minScore, sort]);

	const { data, isLoading, isFetching, error } = useJobs(filters);

	const toggleStatus = (value: JobStatus) =>
		setStatus((current) =>
			current.includes(value)
				? current.filter((s) => s !== value)
				: [...current, value],
		);

	return (
		<div className="space-y-4">
			<div className="space-y-3 rounded-xl border border-line bg-surface p-3">
				<label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 focus-within:border-accent">
					<Search aria-hidden size={16} className="text-muted" />
					<input
						type="search"
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder="Buscar por cargo ou empresa"
						aria-label="Buscar por cargo ou empresa"
						className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
					/>
				</label>
				<div className="flex flex-wrap items-center gap-2">
					<fieldset className="flex flex-wrap gap-1">
						<legend className="sr-only">Status</legend>
						{STATUSES.map((value) => (
							<button
								key={value}
								type="button"
								aria-pressed={status.includes(value)}
								onClick={() => toggleStatus(value)}
								className={`pressable rounded-full border px-2.5 py-0.5 text-sm ${
									status.includes(value)
										? "border-accent bg-accent-soft text-accent"
										: "border-line text-muted"
								}`}
							>
								{STATUS_LABEL[value]}
							</button>
						))}
					</fieldset>
					<Segmented
						label="Onde"
						value={scope}
						onChange={setScope}
						options={[
							["all", "Todas"],
							["brazil", "Brasil"],
							["abroad", "Exterior"],
						]}
					/>
					<Segmented
						label="Nota mínima"
						value={minScore}
						onChange={setMinScore}
						options={[
							["0", "Qualquer"],
							["50", "50+"],
							["70", "70+"],
							["85", "85+"],
						]}
					/>
					<Segmented
						label="Ordenar por"
						value={sort}
						onChange={setSort}
						options={[
							["score", "Nota"],
							["recent", "Recentes"],
						]}
					/>
				</div>
			</div>

			<p className="text-sm text-muted" aria-live="polite">
				{isLoading
					? "Carregando…"
					: data
						? `${data.total} ${data.total === 1 ? "vaga" : "vagas"}${isFetching ? " · atualizando…" : ""}`
						: null}
			</p>

			{error && <p className="text-sm text-bad">{error.message}</p>}

			{data && data.items.length === 0 && (
				<div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
					Nenhuma vaga com esses filtros. Tente baixar a nota mínima ou incluir
					outros status.
				</div>
			)}

			<ul className="space-y-3">
				{data?.items.map((job) => (
					<li key={job.id}>
						<JobCard job={job} onOpen={onOpen} />
					</li>
				))}
			</ul>

			{data && data.items.length < data.total && (
				<button
					type="button"
					onClick={() => setLimit((n) => n + PAGE)}
					className="pressable hoverable w-full rounded-lg border border-line py-2 text-sm"
				>
					Carregar mais
				</button>
			)}
		</div>
	);
}
