import type { JobFilters } from "@radar/core";
import { useEffect, useState } from "react";
import { useJobs } from "../api.ts";
import { PopUp, SearchField, Segmented } from "../components/Controls.tsx";
import { JobDetail } from "../components/JobDetail.tsx";
import { JobRow } from "../components/JobRow.tsx";
import { Logo } from "../components/Logo.tsx";
import { ListChips } from "../components/Navigation.tsx";
import { ScrollEdge } from "../components/ScrollEdge.tsx";
import { useDebounced } from "../hooks.ts";
import { LISTS, type ListId } from "../routes.ts";

const PAGE = 30;

function Skeleton() {
	return (
		<ul aria-hidden className="card overflow-hidden rounded-2xl">
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
					? "scroll-area relative h-full w-[26rem] shrink-0 overflow-y-auto"
					: "relative mx-auto max-w-3xl"
			}
		>
			<div className="space-y-4 px-5 pt-8 pb-4 md:pt-7">
				<h1 id="list-title" className="headline">
					{config.label}.{" "}
					<span
						className={`text-muted transition-opacity duration-200 ${isFetching ? "opacity-60" : ""}`}
						aria-live="polite"
					>
						{data ? config.tagline(data.total) : null}
					</span>
				</h1>
				<ListChips route={list} />
			</div>

			{/* The title scrolls away; search and filters stay at hand. */}
			<ScrollEdge className="px-3 pt-1 pb-2">
				<div className="glass relative space-y-2 rounded-[24px] p-2">
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
			</ScrollEdge>

			<div className="space-y-4 px-3 pt-3 pb-28 md:pb-8">
				{error && (
					<p className="rounded-2xl bg-bad-soft px-4 py-3 text-[15px] text-bad">
						Não deu para carregar as vagas: {error.message}
					</p>
				)}
				{isLoading && <Skeleton />}

				{data && data.items.length === 0 && (
					<div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
						<Logo size={44} />
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
					<ul className="card overflow-hidden rounded-2xl">
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
						className="card pressable w-full rounded-2xl py-3 text-[15px] font-medium text-accent"
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
				className="scroll-area relative h-full min-w-0 flex-1 overflow-y-auto"
			>
				{selected !== null ? (
					<div className="mx-auto max-w-3xl">
						<JobDetail key={selected} jobId={selected} titleId="pane-title" />
					</div>
				) : (
					<div className="grid h-full place-items-center p-8 text-center">
						<div className="space-y-4">
							<div className="mx-auto w-fit opacity-90">
								<Logo size={72} />
							</div>
							<p className="headline text-[22px]!">
								Argos.{" "}
								<span className="text-muted">
									Escolha uma vaga para ver a análise.
								</span>
							</p>
						</div>
					</div>
				)}
			</section>
		</div>
	);
}
