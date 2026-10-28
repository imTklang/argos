import type { JobStatus } from "@radar/core";
import { Bookmark, CircleCheck, CircleX } from "lucide-react";
import { toast } from "sonner";
import { useUpdateStatus } from "../api.ts";
import { STATUS_LABEL } from "../format.ts";

const ACTIONS: {
	status: JobStatus;
	label: string;
	Icon: typeof Bookmark;
	on: string;
}[] = [
	{
		status: "salva",
		label: "Salvar",
		Icon: Bookmark,
		on: "bg-accent-soft text-accent",
	},
	{
		status: "candidatei",
		label: "Candidatei",
		Icon: CircleCheck,
		on: "bg-good-soft text-good",
	},
	{
		status: "descartada",
		label: "Descartar",
		Icon: CircleX,
		on: "bg-bad-soft text-bad",
	},
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
		<fieldset className="grid grid-cols-3 gap-2">
			<legend className="sr-only">Status da vaga</legend>
			{ACTIONS.map(({ status: value, label, Icon, on }) => {
				const active = status === value;
				return (
					<button
						key={value}
						type="button"
						aria-pressed={active}
						onClick={() => change(value)}
						className={`pressable flex flex-col items-center gap-1 rounded-2xl py-2.5 text-[13px] font-medium ${
							active ? on : "card text-ink"
						}`}
					>
						<Icon
							aria-hidden
							size={20}
							fill={active && value === "salva" ? "currentColor" : "none"}
						/>
						{label}
					</button>
				);
			})}
		</fieldset>
	);
}
