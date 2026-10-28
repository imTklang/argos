import type { JobFilters } from "@radar/core";
import { Radar } from "lucide-react";
import { useEffect, useState } from "react";
import { useJobs } from "../api.ts";
import { PopUp, SearchField, Segmented } from "../components/Controls.tsx";
import { JobDetail } from "../components/JobDetail.tsx";
import { JobRow } from "../components/JobRow.tsx";
import { ListChips } from "../components/Navigation.tsx";
import { useDebounced } from "../hooks.ts";
import { LISTS, type ListId } from "../routes.ts";

const PAGE = 30;

function Skeleton() {
	return (
		<ul aria-hidden className="overflow-hidden rounded-xl bg-surface">
			{[0, 1, 2, 3, 4].map((i) => (
				<li
					key={i}
					className="flex gap-3 border-b border-separator p-4 last:border-b-0"
				>
					<span className="size-[38px] shrink-0 rounded-full bg-fill" />
					<span className="flex-1 space-y-2 pt-1">
						<span className="block h-3.5 w-3/5 rounded bg-fill" />
						<span className="block h-3 w-2/5 rounded bg-fill" />
					</span>
				</li>
			))}
		</ul>
	);
}

/**
 * One smart list. On wide screens the selected job opens beside the list,
 * like Mail; otherwise the app shows it in a sheet.
 */
export function JobsPage({
	list,
	inline,
	selected,
	onOpen,
}: {
	list: ListId;
	inline: boolean;
	selected: number | null;
	onOpen: (id: number) => void;
}) {
	const config = LISTS[list];
	const [q, setQ] = useState("");
	const [scope, setScope] = useState<"all" | "brazil" | "abroad">("all");
	const [minScore, setMinScore] = useState<"0" | "50" | "70" | "85">(
		config.minScore,
	);
	const [sort, setSort] = useState<"score" | "recent">("score");
	const [limit, setLimit] = useState(PAGE);

	const filters: JobFilters = {
		q: useDebounced(q, 250),
		status: config.status,
		scope,
		minScore: minScore === "0" ? undefined : Number(minScore),
		sort,
		limit,
	};
	// A new filter starts from the first page again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter change
	useEffect(() => setLimit(PAGE), [filters.q, scope, minScore, sort]);

	const { data, isLoading, isFetching, error } = useJobs(filters);
	const filtered = q !== "" || scope !== "all" || minScore !== config.minScore;
	const clear = () => {
		setQ("");
		setScope("all");
		setMinScore(config.minScore);
	};

	const listPane = (
		<section
			aria-labelledby="list-title"
			className={
				inline
					? "h-full w-[26rem] shrink-0 overflow-y-auto border-r border-separator"
					: "mx-auto max-w-3xl"
			}
		>
			<div className="space-y-3 px-4 pt-6 pb-3 md:pt-5">
				<div className="flex items-baseline justify-between gap-3">
					<h1 id="list-title" className="large-title">
						{config.label}
					</h1>
					<p className="text-[13px] text-muted tabular-nums" aria-live="polite">
						{data
							? `${data.total} ${data.total === 1 ? "vaga" : "vagas"}${isFetching ? "…" : ""}`
							: null}
					</p>
				</div>
				<ListChips route={list} />
			</div>

			{/* The title scrolls away; search and filters stay at hand. */}
			<div className="material sticky top-0 z-10 space-y-2.5 border-b border-separator px-4 pt-1 pb-3">
				<SearchField
					value={q}
					onChange={setQ}
					label="Buscar cargo ou empresa"
				/>
				<div className="grid grid-cols-2 gap-2">
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

					<PopUp
						label="Nota mínima"
						value={minScore}
						onChange={setMinScore}
						options={[
							["0", "Qualquer nota"],
							["50", "Nota 50+"],
							["70", "Nota 70+"],
							["85", "Nota 85+"],
						]}
					/>
					<PopUp
						label="Ordenar por"
						value={sort}
						onChange={setSort}
						options={[
							["score", "Maior nota"],
							["recent", "Mais recentes"],
						]}
					/>
				</div>
			</div>

			<div className="space-y-4 px-4 pt-4 pb-28 md:pb-8">
				{error && (
					<p className="rounded-xl bg-bad-soft px-4 py-3 text-[15px] text-bad">
						Não deu para carregar as vagas: {error.message}
					</p>
				)}
				{isLoading && <Skeleton />}

				{data && data.items.length === 0 && (
					<div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
						<Radar aria-hidden size={36} className="text-faint" />
						<p className="text-[17px] font-semibold">Nenhuma vaga</p>
						<p className="max-w-xs text-[15px] text-muted">
							{filtered ? "Nada com esses filtros." : config.empty}
						</p>
						{filtered && (
							<button
								type="button"
								onClick={clear}
								className="pressable mt-2 rounded-full bg-fill px-4 py-1.5 text-[15px] font-medium text-accent"
							>
								Limpar filtros
							</button>
						)}
					</div>
				)}

				{data && data.items.length > 0 && (
					<ul className="overflow-hidden rounded-xl bg-surface">
						{data.items.map((job) => (
							<JobRow
								key={job.id}
								job={job}
								selected={inline && selected === job.id}
								onOpen={onOpen}
							/>
						))}
					</ul>
				)}

				{data && data.items.length < data.total && (
					<button
						type="button"
						onClick={() => setLimit((n) => n + PAGE)}
						className="pressable hoverable w-full rounded-xl bg-surface py-3 text-[15px] text-accent"
					>
						Mostrar mais {Math.min(PAGE, data.total - data.items.length)}
					</button>
				)}
			</div>
		</section>
	);

	if (!inline) return listPane;

	return (
		<div className="flex h-full">
			{listPane}
			<section
				aria-label="Detalhes da vaga"
				className="h-full min-w-0 flex-1 overflow-y-auto"
			>
				{selected !== null ? (
					<div className="mx-auto max-w-3xl">
						<JobDetail key={selected} jobId={selected} titleId="pane-title" />
					</div>
				) : (
					<div className="grid h-full place-items-center p-8 text-center">
						<div className="space-y-2">
							<Radar aria-hidden size={40} className="mx-auto text-faint" />
							<p className="text-[15px] text-muted">
								Escolha uma vaga para ver a análise.
							</p>
						</div>
					</div>
				)}
			</section>
		</div>
	);
}
