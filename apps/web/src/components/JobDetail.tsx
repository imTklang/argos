import {
	ArrowUpRight,
	Copy,
	Loader2,
	RefreshCw,
	Sparkles,
	TriangleAlert,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCoverLetter, useJob, useUpdateStatus } from "../api.ts";
import { fromNow, place, sourceLabel } from "../format.ts";
import { Cell, Group } from "./Group.tsx";
import { ScoreRing } from "./ScoreRing.tsx";
import { ScrollEdge } from "./ScrollEdge.tsx";
import type { DragHandle } from "./Sheet.tsx";
import { StatusButtons } from "./StatusButtons.tsx";

export function SkillChips({
	skills,
	tone,
}: {
	skills: string[];
	tone: "match" | "missing";
}) {
	if (skills.length === 0) return null;
	return (
		<div>
			<p className="mb-1.5 text-[13px] text-muted">
				{tone === "match" ? "Você tem" : "Falta"}
			</p>
			<ul className="flex flex-wrap gap-1.5">
				{skills.map((skill) => (
					<li
						key={skill}
						className={`rounded-full px-2.5 py-0.5 text-[13px] ${
							tone === "match" ? "bg-good-soft text-good" : "bg-fill text-ink"
						}`}
					>
						{skill}
					</li>
				))}
			</ul>
		</div>
	);
}

function CoverLetter({
	jobId,
	existing,
}: {
	jobId: number;
	existing: string | null;
}) {
	const letter = useCoverLetter(jobId);
	const generate = (regenerate: boolean) =>
		letter.mutate(regenerate, {
			onError: (error) => toast.error(`Não deu para gerar: ${error.message}`),
		});

	if (letter.isPending) {
		return (
			<Cell>
				<p
					className="flex items-center gap-2 text-[15px] text-muted"
					aria-live="polite"
				>
					<Loader2 aria-hidden size={16} className="animate-spin" />
					Escrevendo o rascunho…
				</p>
			</Cell>
		);
	}
	if (!existing) {
		return (
			<button
				type="button"
				onClick={() => generate(false)}
				className="hoverable flex w-full items-center gap-2 px-4 py-3 text-left text-[15px] text-accent"
			>
				<Sparkles aria-hidden size={17} /> Gerar rascunho
			</button>
		);
	}
	return (
		<>
			<Cell>
				<p className="whitespace-pre-wrap text-[15px] leading-relaxed">
					{existing}
				</p>
			</Cell>
			<div className="grid grid-cols-2">
				<button
					type="button"
					onClick={() =>
						navigator.clipboard
							.writeText(existing)
							.then(() => toast.success("Copiado"))
							.catch(() => toast.error("Não deu para copiar"))
					}
					className="hoverable flex items-center justify-center gap-1.5 border-r border-separator py-3 text-[15px] text-accent"
				>
					<Copy aria-hidden size={16} /> Copiar
				</button>
				<button
					type="button"
					onClick={() => generate(true)}
					className="hoverable flex items-center justify-center gap-1.5 py-3 text-[15px] text-accent"
				>
					<RefreshCw aria-hidden size={16} /> Gerar outro
				</button>
			</div>
		</>
	);
}

function Note({
	jobId,
	status,
	note,
}: {
	jobId: number;
	status: Parameters<typeof StatusButtons>[0]["status"];
	note: string | null;
}) {
	const [value, setValue] = useState(note ?? "");
	const update = useUpdateStatus();
	useEffect(() => setValue(note ?? ""), [note]);

	return (
		<textarea
			value={value}
			onChange={(e) => setValue(e.target.value)}
			// Saved when leaving the field, so typing never fires requests.
			onBlur={() => {
				if (value === (note ?? "")) return;
				update.mutate(
					{ id: jobId, status, note: value || null },
					{
						onSuccess: () => toast.success("Nota salva"),
						onError: (error) =>
							toast.error(`Não deu para salvar: ${error.message}`),
					},
				);
			}}
			rows={3}
			placeholder="Ex.: enviei pelo LinkedIn em 28/10, falar com a recrutadora Ana"
			aria-label="Nota pessoal sobre a vaga"
			className="block w-full resize-y bg-transparent px-4 py-3 text-[15px] outline-none placeholder:text-muted"
		/>
	);
}

function Description({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	const long = text.length > 600;
	return (
		<>
			<Cell>
				<p
					className={`whitespace-pre-wrap text-[15px] leading-relaxed ${
						long && !open ? "line-clamp-6" : ""
					}`}
				>
					{text}
				</p>
			</Cell>
			{long && (
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className="hoverable w-full px-4 py-3 text-left text-[15px] text-accent"
				>
					{open ? "Mostrar menos" : "Mostrar descrição completa"}
				</button>
			)}
		</>
	);
}

/**
 * Everything about one job. In a sheet it gets a grabber and a close
 * button; in the split view it sits next to the list.
 */
export function JobDetail({
	jobId,
	titleId,
	onClose,
	handle,
}: {
	jobId: number;
	titleId: string;
	onClose?: () => void;
	handle?: DragHandle;
}) {
	const { data: job, isLoading, error } = useJob(jobId);
	const sources = job
		? [...new Set(job.alsoOn.map((copy) => sourceLabel(copy.source)))]
		: [];
	const deadline = job ? fromNow(job.expiresAt) : null;

	return (
		<article aria-labelledby={titleId}>
			<ScrollEdge
				as="header"
				{...handle}
				className="px-5 pt-2 pb-3 max-md:touch-none"
			>
				{onClose && (
					<div
						aria-hidden
						className="mx-auto mb-2 h-[5px] w-9 rounded-full bg-faint md:hidden"
					/>
				)}
				<div className="flex items-start gap-3 pt-2">
					{job && <ScoreRing score={job.score} size={52} />}
					<div className="min-w-0 flex-1">
						<h2
							id={titleId}
							className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-balance"
						>
							{job?.title ?? (isLoading ? "Carregando…" : "Vaga")}
						</h2>
						{job && (
							<p className="mt-0.5 text-[15px] text-muted">
								{job.company}
								{place(job) && ` · ${place(job)}`}
							</p>
						)}
					</div>
					{onClose && (
						<button
							type="button"
							onClick={onClose}
							aria-label="Fechar"
							className="pressable grid size-9 shrink-0 place-items-center rounded-full bg-fill text-ink"
						>
							<X aria-hidden size={16} strokeWidth={2.5} />
						</button>
					)}
				</div>
			</ScrollEdge>

			{error && <p className="p-5 text-[15px] text-bad">{error.message}</p>}

			{job && (
				<div className="space-y-6 px-4 pt-5 pb-10 md:px-5">
					<div className="space-y-3">
						<StatusButtons jobId={job.id} status={job.status} />
						<a
							href={job.url}
							target="_blank"
							rel="noreferrer"
							className="prominent pressable flex h-12 items-center justify-center gap-1 rounded-full text-[15px] font-semibold"
						>
							Abrir no {sourceLabel(job.source)}
							<ArrowUpRight aria-hidden size={17} />
						</a>
						{(sources.length > 0 || deadline) && (
							<p className="px-1 text-center text-[13px] text-muted">
								{sources.length > 0 && <>Também em {sources.join(", ")}</>}
								{sources.length > 0 && deadline && " · "}
								{deadline && <>Inscrições terminam {deadline}</>}
							</p>
						)}
					</div>

					{job.analysis && (
						<Group title="Análise">
							<Cell>
								<p className="text-[15px] leading-relaxed">
									{job.analysis.summary}
								</p>
							</Cell>
							{job.analysis.dealBreakers.length > 0 && (
								<Cell>
									<ul className="space-y-1.5 text-[15px] text-bad">
										{job.analysis.dealBreakers.map((reason) => (
											<li key={reason} className="flex gap-2">
												<TriangleAlert
													aria-hidden
													size={16}
													className="mt-0.5 shrink-0"
												/>
												{reason}
											</li>
										))}
									</ul>
								</Cell>
							)}
							{(job.analysis.matchedSkills.length > 0 ||
								job.analysis.missingSkills.length > 0) && (
								<Cell className="space-y-3">
									<SkillChips
										skills={job.analysis.matchedSkills}
										tone="match"
									/>
									<SkillChips
										skills={job.analysis.missingSkills}
										tone="missing"
									/>
								</Cell>
							)}
						</Group>
					)}

					<Group title="Sua nota" footer="Salva quando você sai do campo.">
						<Note jobId={job.id} status={job.status} note={job.note} />
					</Group>

					<Group
						title="Mensagem de apresentação"
						footer="Rascunho escrito pelo Claude a partir do seu currículo. Revise antes de enviar."
					>
						<CoverLetter
							jobId={job.id}
							existing={job.coverLetter?.text ?? null}
						/>
					</Group>

					<Group title="Descrição">
						<Description text={job.description} />
					</Group>
				</div>
			)}
		</article>
	);
}
