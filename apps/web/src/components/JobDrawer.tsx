import {
	Copy,
	ExternalLink,
	Loader2,
	RefreshCw,
	Sparkles,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useCoverLetter, useJob, useUpdateStatus } from "../api.ts";
import { fromNow, place, sourceLabel } from "../format.ts";
import { SkillChips } from "./JobCard.tsx";
import { ScoreBadge } from "./ScoreBadge.tsx";
import { StatusButtons } from "./StatusButtons.tsx";

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="border-t border-line px-5 py-4">
			<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
				{title}
			</h3>
			{children}
		</section>
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
			<p
				className="flex items-center gap-2 text-sm text-muted"
				aria-live="polite"
			>
				<Loader2 aria-hidden size={16} className="animate-spin" />
				Escrevendo o rascunho…
			</p>
		);
	}
	if (!existing) {
		return (
			<button
				type="button"
				onClick={() => generate(false)}
				className="pressable inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent"
			>
				<Sparkles aria-hidden size={15} /> Gerar rascunho
			</button>
		);
	}
	return (
		<div>
			<p className="whitespace-pre-wrap rounded-lg bg-sunken p-3 text-sm leading-relaxed">
				{existing}
			</p>
			<div className="mt-2 flex gap-2">
				<button
					type="button"
					onClick={() =>
						navigator.clipboard
							.writeText(existing)
							.then(() => toast.success("Copiado"))
							.catch(() => toast.error("Não deu para copiar"))
					}
					className="pressable hoverable inline-flex items-center gap-1.5 rounded-md border border-control px-2.5 py-1 text-sm"
				>
					<Copy aria-hidden size={14} /> Copiar
				</button>
				<button
					type="button"
					onClick={() => generate(true)}
					className="pressable hoverable inline-flex items-center gap-1.5 rounded-md border border-control px-2.5 py-1 text-sm text-muted"
				>
					<RefreshCw aria-hidden size={14} /> Gerar outro
				</button>
			</div>
		</div>
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
			className="w-full resize-y rounded-lg border border-control bg-surface p-2.5 text-sm placeholder:text-muted"
		/>
	);
}

export function JobDrawer({
	jobId,
	onClose,
}: {
	jobId: number;
	onClose: () => void;
}) {
	const { data: job, isLoading, error } = useJob(jobId);
	const panel = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const returnTo = document.activeElement as HTMLElement | null;
		panel.current?.focus();
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		document.addEventListener("keydown", onKey);
		const overflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = overflow;
			returnTo?.focus();
		};
	}, [onClose]);

	return (
		<div className="fixed inset-0 z-40">
			<button
				type="button"
				aria-label="Fechar detalhes"
				onClick={onClose}
				className="drawer-backdrop absolute inset-0 cursor-default bg-black/30"
			/>
			<div
				ref={panel}
				role="dialog"
				aria-modal="true"
				aria-labelledby="drawer-title"
				tabIndex={-1}
				className="drawer absolute inset-y-0 right-0 flex w-full max-w-xl flex-col overflow-y-auto bg-surface shadow-2xl outline-none"
			>
				<div className="sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-surface px-5 py-4">
					{job && <ScoreBadge score={job.score} />}
					<div className="min-w-0 flex-1">
						<h2 id="drawer-title" className="font-semibold leading-snug">
							{job?.title ?? (isLoading ? "Carregando…" : "Vaga")}
						</h2>
						{job && (
							<p className="text-sm text-muted">
								{job.company}
								{place(job) && ` · ${place(job)}`}
							</p>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Fechar"
						className="pressable hoverable rounded-md p-1.5 text-muted"
					>
						<X aria-hidden size={18} />
					</button>
				</div>

				{error && <p className="p-5 text-sm text-bad">{error.message}</p>}

				{job && (
					<>
						<div className="space-y-3 px-5 py-4">
							<StatusButtons jobId={job.id} status={job.status} />
							<p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
								<a
									href={job.url}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
								>
									Ver em {sourceLabel(job.source)}{" "}
									<ExternalLink aria-hidden size={13} />
								</a>
								{job.alsoOn.map((copy) => (
									<a
										key={copy.url}
										href={copy.url}
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 text-muted underline-offset-2 hover:underline"
									>
										também em {sourceLabel(copy.source)}
									</a>
								))}
								{fromNow(job.expiresAt) && (
									<span className="text-muted">
										inscrições até {fromNow(job.expiresAt)}
									</span>
								)}
							</p>
						</div>

						{job.analysis && (
							<Section title="Análise">
								<p className="text-sm leading-relaxed">
									{job.analysis.summary}
								</p>
								{job.analysis.dealBreakers.length > 0 && (
									<ul className="mt-2 list-disc pl-5 text-sm text-bad">
										{job.analysis.dealBreakers.map((d) => (
											<li key={d}>{d}</li>
										))}
									</ul>
								)}
								<div className="mt-3 space-y-1.5">
									<SkillChips
										skills={job.analysis.matchedSkills}
										tone="match"
									/>
									<SkillChips
										skills={job.analysis.missingSkills}
										tone="missing"
									/>
								</div>
							</Section>
						)}

						<Section title="Sua nota">
							<Note jobId={job.id} status={job.status} note={job.note} />
						</Section>

						<Section title="Mensagem de apresentação">
							<CoverLetter
								jobId={job.id}
								existing={job.coverLetter?.text ?? null}
							/>
						</Section>

						<Section title="Descrição">
							<p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/90">
								{job.description}
							</p>
						</Section>
					</>
				)}
			</div>
		</div>
	);
}
