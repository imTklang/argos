import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import type { JobListItem, JobStatus } from "@radar/core";
import { useState } from "react";
import { toast } from "sonner";
import { useJobs, useUpdateStatus } from "../api.ts";
import { ScoreRing } from "../components/ScoreRing.tsx";
import { STATUS_LABEL } from "../format.ts";

// "Vista" is never set on its own, so it shares the first column.
const COLUMNS: { status: JobStatus; label: string; holds: JobStatus[] }[] = [
	{ status: "nova", label: "Novas", holds: ["nova", "vista"] },
	{ status: "salva", label: "Salvas", holds: ["salva"] },
	{ status: "candidatei", label: "Candidatei", holds: ["candidatei"] },
	{ status: "descartada", label: "Descartadas", holds: ["descartada"] },
];

function MiniCard({
	job,
	lifted = false,
}: {
	job: JobListItem;
	lifted?: boolean;
}) {
	return (
		<div
			className={`flex gap-3 rounded-xl bg-surface p-3 ${
				lifted
					? "scale-[1.03] shadow-[0_12px_32px_rgb(0_0_0/0.18)]"
					: "shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
			}`}
		>
			<ScoreRing score={job.score} size={34} />
			<div className="min-w-0">
				<p className="line-clamp-2 text-[15px] leading-snug font-semibold">
					{job.title}
				</p>
				<p className="mt-0.5 truncate text-[13px] text-muted">{job.company}</p>
			</div>
		</div>
	);
}

function DraggableCard({
	job,
	onOpen,
}: {
	job: JobListItem;
	onOpen: (id: number) => void;
}) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: job.id,
		data: { job },
	});
	return (
		<li ref={setNodeRef} className={isDragging ? "opacity-40" : ""}>
			<button
				type="button"
				{...attributes}
				{...listeners}
				onClick={() => onOpen(job.id)}
				aria-roledescription="vaga arrastável"
				aria-label={`${job.title}, ${job.company}, nota ${job.score ?? "sem nota"}. Espaço para mover entre colunas.`}
				className="block w-full cursor-grab text-left active:cursor-grabbing"
			>
				<MiniCard job={job} />
			</button>
		</li>
	);
}

function Column({
	status,
	label,
	jobs,
	onOpen,
}: {
	status: JobStatus;
	label: string;
	jobs: JobListItem[];
	onOpen: (id: number) => void;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: status });
	return (
		<section
			ref={setNodeRef}
			aria-label={`${label}: ${jobs.length}`}
			className={`flex w-[17.5rem] shrink-0 snap-start flex-col rounded-2xl p-2 transition-colors duration-150 ${
				isOver ? "bg-accent-soft outline-2 outline-accent" : "bg-fill"
			}`}
		>
			<h2 className="flex items-center justify-between px-2 pt-1 pb-2.5 text-[15px] font-semibold">
				{label}
				<span className="text-[13px] font-normal tabular-nums text-muted">
					{jobs.length}
				</span>
			</h2>
			<ul className="flex min-h-24 flex-col gap-2">
				{jobs.map((job) => (
					<DraggableCard key={job.id} job={job} onOpen={onOpen} />
				))}
			</ul>
		</section>
	);
}

export function KanbanPage({ onOpen }: { onOpen: (id: number) => void }) {
	const { data, isLoading, error } = useJobs({ sort: "score", limit: 200 });
	const update = useUpdateStatus();
	const [dragging, setDragging] = useState<JobListItem | null>(null);
	const sensors = useSensors(
		// A short move before dragging keeps plain clicks opening the job.
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
		useSensor(KeyboardSensor),
	);

	const onDragStart = (event: DragStartEvent) =>
		setDragging((event.active.data.current?.job as JobListItem) ?? null);

	const onDragEnd = (event: DragEndEvent) => {
		setDragging(null);
		const job = event.active.data.current?.job as JobListItem | undefined;
		const target = event.over?.id as JobStatus | undefined;
		if (!job || !target || target === job.status) return;
		update.mutate(
			{ id: job.id, status: target },
			{ onError: (e) => toast.error(`Não deu para mover: ${e.message}`) },
		);
	};

	const inColumn = (holds: JobStatus[]) =>
		(data?.items ?? []).filter((job) => holds.includes(job.status));

	return (
		<div className="pt-6 pb-28 md:pt-5 md:pb-8">
			<div className="px-4 pb-4">
				<h1 className="large-title">Quadro</h1>
				<p className="mt-1 text-[15px] text-muted">
					Arraste uma vaga para outra coluna para mudar o status. Mostra as 200
					com maior nota.
				</p>
			</div>
			{isLoading && <p className="px-4 text-[15px] text-muted">Carregando…</p>}
			{error && <p className="px-4 text-[15px] text-bad">{error.message}</p>}
			<DndContext
				sensors={sensors}
				onDragStart={onDragStart}
				onDragEnd={onDragEnd}
				onDragCancel={() => setDragging(null)}
				accessibility={{
					announcements: {
						onDragStart: () =>
							"Vaga selecionada. Use as setas para escolher a coluna.",
						onDragOver: ({ over }) =>
							over
								? `Sobre a coluna ${STATUS_LABEL[over.id as JobStatus]}.`
								: "Fora das colunas.",
						onDragEnd: ({ over }) =>
							over
								? `Vaga movida para ${STATUS_LABEL[over.id as JobStatus]}.`
								: "Movimento cancelado.",
						onDragCancel: () => "Movimento cancelado.",
					},
				}}
			>
				<div className="flex snap-x gap-3 overflow-x-auto scroll-px-4 px-4 pb-4">
					{COLUMNS.map(({ status, label, holds }) => (
						<Column
							key={status}
							status={status}
							label={label}
							jobs={inColumn(holds)}
							onOpen={onOpen}
						/>
					))}
				</div>
				{/* No drop animation: the card should not fly back before jumping. */}
				<DragOverlay dropAnimation={null}>
					{dragging && <MiniCard job={dragging} lifted />}
				</DragOverlay>
			</DndContext>
		</div>
	);
}
