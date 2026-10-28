import type { JobStatus } from "@radar/core";
import { Bookmark, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useUpdateStatus } from "../api.ts";
import { STATUS_LABEL } from "../format.ts";

const ACTIONS: { status: JobStatus; label: string; Icon: typeof Check }[] = [
	{ status: "salva", label: "Salvar", Icon: Bookmark },
	{ status: "candidatei", label: "Candidatei", Icon: Check },
	{ status: "descartada", label: "Descartar", Icon: X },
];

export function StatusButtons({
	jobId,
	status,
}: {
	jobId: number;
	status: JobStatus;
}) {
	const update = useUpdateStatus();

	const change = (next: JobStatus) => {
		// Pressing the active one again sends the job back to "nova".
		const target = status === next ? "nova" : next;
		update.mutate(
			{ id: jobId, status: target },
			{
				onSuccess: () =>
					toast.success(`Marcada como ${STATUS_LABEL[target].toLowerCase()}`),
				onError: (error) =>
					toast.error(`Não deu para salvar: ${error.message}`),
			},
		);
	};

	return (
		<fieldset className="flex flex-wrap gap-1.5">
			<legend className="sr-only">Status da vaga</legend>
			{ACTIONS.map(({ status: value, label, Icon }) => {
				const active = status === value;
				return (
					<button
						key={value}
						type="button"
						aria-pressed={active}
						onClick={() => change(value)}
						className={`pressable inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${
							active
								? "border-accent bg-accent-soft text-accent"
								: "hoverable border-line text-muted"
						}`}
					>
						<Icon aria-hidden size={14} />
						{label}
					</button>
				);
			})}
		</fieldset>
	);
}
