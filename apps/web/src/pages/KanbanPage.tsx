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
import { ScoreBadge } from "../components/ScoreBadge.tsx";
import { STATUS_LABEL, STATUSES } from "../format.ts";

function MiniCard({
	job,
	lifted = false,
}: {
	job: JobListItem;
	lifted?: boolean;
}) {
	return (
		<div
			className={`flex gap-2.5 rounded-lg border border-line bg-surface p-2.5 ${
				lifted ? "scale-[1.02] shadow-lg" : ""
			}`}
		>
			<ScoreBadge score={job.score} />
			<div className="min-w-0">
				<p className="line-clamp-2 text-sm font-medium leading-snug">
					{job.title}
				</p>
				<p className="truncate text-xs text-muted">{job.company}</p>
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
	jobs,
	onOpen,
}: {
	status: JobStatus;
	jobs: JobListItem[];
	onOpen: (id: number) => void;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: status });
	return (
		<section
			ref={setNodeRef}
			aria-label={`${STATUS_LABEL[status]}: ${jobs.length}`}
			className={`flex w-72 shrink-0 flex-col rounded-xl border p-2 transition-colors duration-150 ${
				isOver ? "border-accent bg-accent-soft" : "border-line bg-sunken"
			}`}
		>
			<h2 className="flex items-center justify-between px-1.5 pb-2 pt-1 text-sm font-semibold">
				{STATUS_LABEL[status]}
				<span className="text-xs font-normal tabular-nums text-muted">
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

	if (isLoading) return <p className="text-sm text-muted">Carregando…</p>;
	if (error) return <p className="text-sm text-bad">{error.message}</p>;

	const byStatus = (status: JobStatus) =>
		(data?.items ?? []).filter((job) => job.status === status);

	return (
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
			<div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4">
				{STATUSES.map((status) => (
					<Column
						key={status}
						status={status}
						jobs={byStatus(status)}
						onOpen={onOpen}
					/>
				))}
			</div>
			{/* No drop animation: the card should not fly back before jumping. */}
			<DragOverlay dropAnimation={null}>
				{dragging && <MiniCard job={dragging} lifted />}
			</DragOverlay>
		</DndContext>
	);
}
