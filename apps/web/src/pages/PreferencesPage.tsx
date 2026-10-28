import type { Modality, Preferences } from "@radar/core";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { usePreferences, useSavePreferences } from "../api.ts";

const MODALITIES: [Modality, string][] = [
	["remoto", "Remoto"],
	["híbrido", "Híbrido"],
	["presencial", "Presencial"],
];

type ListField =
	| "roles"
	| "keywordsMust"
	| "keywordsBonus"
	| "keywordsBlock"
	| "locations";

const LISTS: { field: ListField; label: string; hint: string }[] = [
	{
		field: "keywordsMust",
		label: "Palavras obrigatórias",
		hint: "Pelo menos uma precisa aparecer na vaga.",
	},
	{
		field: "keywordsBonus",
		label: "Suas tecnologias",
		hint: "Contam a favor; também servem para achar vagas com título genérico.",
	},
	{
		field: "keywordsBlock",
		label: "Palavras bloqueadas no título",
		hint: "Ex.: sênior, pleno, vendas.",
	},
	{
		field: "locations",
		label: "Cidades e estados aceitos",
		hint: "Para vagas presenciais e híbridas. Siglas de estado valem (PB).",
	},
	{
		field: "roles",
		label: "Cargos de interesse",
		hint: "Usados pelas fontes que buscam por termo.",
	},
];

function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: (id: string) => React.ReactNode;
}) {
	const id = useId();
	return (
		<div className="space-y-1">
			<label htmlFor={id} className="block text-sm font-medium">
				{label}
			</label>
			{hint && <p className="text-xs text-muted">{hint}</p>}
			{children(id)}
		</div>
	);
}

const inputClass =
	"w-full rounded-lg border border-control bg-surface px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none";

export function PreferencesPage() {
	const { data, isLoading, error } = usePreferences();
	const save = useSavePreferences();
	const [draft, setDraft] = useState<Preferences | null>(null);
	useEffect(() => {
		if (data) setDraft(data);
	}, [data]);

	if (isLoading || !draft) {
		return error ? (
			<p className="text-sm text-bad">{error.message}</p>
		) : (
			<p className="text-sm text-muted">Carregando…</p>
		);
	}

	const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
		setDraft({ ...draft, [key]: value });
	const number = (value: string) => (value === "" ? undefined : Number(value));

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		save.mutate(draft, {
			onSuccess: () =>
				toast.success(
					"Preferências salvas. Valem a partir da próxima varredura.",
				),
			onError: (e) => toast.error(`Não deu para salvar: ${e.message}`),
		});
	};

	return (
		<form
			onSubmit={submit}
			className="space-y-6 rounded-xl border border-line bg-surface p-5"
		>
			<div className="grid gap-5 md:grid-cols-2">
				{LISTS.map(({ field, label, hint }) => (
					<Field key={field} label={label} hint={hint}>
						{(id) => (
							<textarea
								id={id}
								rows={5}
								value={draft[field].join("\n")}
								onChange={(e) =>
									set(
										field,
										e.target.value.split("\n").map((line) => line.trimStart()),
									)
								}
								// Blank lines are dropped only on save so typing stays natural.
								onBlur={() =>
									set(field, draft[field].map((l) => l.trim()).filter(Boolean))
								}
								className={`${inputClass} resize-y font-mono text-[13px]`}
							/>
						)}
					</Field>
				))}
			</div>

			<fieldset className="space-y-2">
				<legend className="text-sm font-medium">Modalidades</legend>
				<div className="flex flex-wrap gap-4">
					{MODALITIES.map(([value, label]) => (
						<label
							key={value}
							className="inline-flex items-center gap-2 text-sm"
						>
							<input
								type="checkbox"
								checked={draft.modality.includes(value)}
								onChange={(e) =>
									set(
										"modality",
										e.target.checked
											? [...draft.modality, value]
											: draft.modality.filter((m) => m !== value),
									)
								}
								className="size-4 accent-[var(--color-accent)]"
							/>
							{label}
						</label>
					))}
				</div>
				<label className="mt-2 inline-flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={draft.abroad === "remote"}
						onChange={(e) =>
							set("abroad", e.target.checked ? "remote" : "none")
						}
						className="size-4 accent-[var(--color-accent)]"
					/>
					Incluir estágios remotos no exterior (com prioridade menor que os do
					Brasil)
				</label>
			</fieldset>

			<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
				<Field label="Nota para o resumo diário" hint="0 a 100">
					{(id) => (
						<input
							id={id}
							type="number"
							min={0}
							max={100}
							required
							value={draft.minScoreToNotify}
							onChange={(e) => set("minScoreToNotify", Number(e.target.value))}
							className={inputClass}
						/>
					)}
				</Field>
				<Field label="Nota para alerta imediato" hint="Padrão 85">
					{(id) => (
						<input
							id={id}
							type="number"
							min={0}
							max={100}
							value={draft.instantAlertScore ?? ""}
							placeholder="85"
							onChange={(e) => set("instantAlertScore", number(e.target.value))}
							className={inputClass}
						/>
					)}
				</Field>
				<Field label="Máximo de horas por semana">
					{(id) => (
						<input
							id={id}
							type="number"
							min={1}
							value={draft.maxHoursPerWeek ?? ""}
							onChange={(e) => set("maxHoursPerWeek", number(e.target.value))}
							className={inputClass}
						/>
					)}
				</Field>
				<Field label="Bolsa mínima (R$)">
					{(id) => (
						<input
							id={id}
							type="number"
							min={0}
							value={draft.minStipend ?? ""}
							onChange={(e) => set("minStipend", number(e.target.value))}
							className={inputClass}
						/>
					)}
				</Field>
			</div>

			<div className="flex items-center gap-3">
				<button
					type="submit"
					disabled={save.isPending}
					className="pressable inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-60"
				>
					{save.isPending && (
						<Loader2 aria-hidden size={15} className="animate-spin" />
					)}
					Salvar preferências
				</button>
				<button
					type="button"
					onClick={() => data && setDraft(data)}
					className="pressable hoverable rounded-md px-3 py-2 text-sm text-muted"
				>
					Desfazer alterações
				</button>
			</div>
		</form>
	);
}
