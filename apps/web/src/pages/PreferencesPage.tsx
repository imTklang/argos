import type { Modality, Preferences } from "@radar/core";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { usePreferences, useSavePreferences } from "../api.ts";
import { Group } from "../components/Group.tsx";

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
		field: "keywordsBonus",
		label: "Suas tecnologias",
		hint: "Contam a favor e ajudam a achar vagas com título genérico.",
	},
	{
		field: "keywordsMust",
		label: "Palavras obrigatórias",
		hint: "Pelo menos uma precisa aparecer na vaga (vagas de estágio passam mesmo sem).",
	},
	{
		field: "keywordsBlock",
		label: "Palavras bloqueadas no título",
		hint: "Ex.: vendas, comercial. Sênior e pleno já são descartados sozinhos.",
	},
	{
		field: "roles",
		label: "Cargos de interesse",
		hint: "Usados pelas fontes que buscam por termo.",
	},
];

/** A settings row: label on the left, control on the right. */
function Row({
	label,
	children,
}: {
	label: string;
	children: (id: string) => React.ReactNode;
}) {
	const id = useId();
	return (
		<div className="flex min-h-11 items-center gap-3 border-b border-separator py-1.5 pr-4 pl-4 last:border-b-0">
			<label htmlFor={id} className="flex-1 text-[15px]">
				{label}
			</label>
			{children(id)}
		</div>
	);
}

const numberClass =
	"w-24 rounded-lg bg-fill px-2.5 py-1.5 text-right text-[15px] tabular-nums outline-none focus:outline-2 focus:outline-accent";

const listClass =
	"block w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed outline-none";

export function PreferencesPage() {
	const { data, isLoading, error } = usePreferences();
	const save = useSavePreferences();
	const [draft, setDraft] = useState<Preferences | null>(null);
	useEffect(() => {
		if (data) setDraft(data);
	}, [data]);

	if (isLoading || !draft) {
		return (
			<p
				className={`px-4 pt-6 text-[15px] ${error ? "text-bad" : "text-muted"}`}
			>
				{error ? error.message : "Carregando…"}
			</p>
		);
	}

	const dirty = JSON.stringify(draft) !== JSON.stringify(data);
	const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
		setDraft({ ...draft, [key]: value });
	const number = (value: string) => (value === "" ? undefined : Number(value));

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		save.mutate(draft, {
			onSuccess: () =>
				toast.success("Ajustes salvos. Valem a partir da próxima varredura."),
			onError: (e) => toast.error(`Não deu para salvar: ${e.message}`),
		});
	};

	const list = (field: ListField, label: string) => (
		<textarea
			aria-label={label}
			rows={4}
			value={draft[field].join("\n")}
			onChange={(e) =>
				set(
					field,
					e.target.value.split("\n").map((line) => line.trimStart()),
				)
			}
			// Blank lines are dropped only on blur so typing stays natural.
			onBlur={() =>
				set(field, draft[field].map((l) => l.trim()).filter(Boolean))
			}
			className={listClass}
		/>
	);

	return (
		<form onSubmit={submit} className="mx-auto max-w-2xl pb-28 md:pb-10">
			<div className="material sticky top-0 z-10 flex items-center justify-between gap-3 px-4 pt-6 pb-3 md:pt-5">
				<h1 className="large-title">Ajustes</h1>
				<div className="flex items-center gap-2">
					{dirty && (
						<button
							type="button"
							onClick={() => data && setDraft(data)}
							className="pressable rounded-full px-3 py-1.5 text-[15px] text-accent"
						>
							Desfazer
						</button>
					)}
					<button
						type="submit"
						disabled={!dirty || save.isPending}
						className="pressable inline-flex items-center gap-1.5 rounded-full bg-accent-fill px-4 py-1.5 text-[15px] font-semibold text-on-accent disabled:bg-fill disabled:text-muted"
					>
						{save.isPending && (
							<Loader2 aria-hidden size={15} className="animate-spin" />
						)}
						Salvar
					</button>
				</div>
			</div>

			<div className="space-y-7 px-4 pt-3">
				<Group
					title="Notificações no Telegram"
					footer="O resumo diário traz as vagas a partir da primeira nota; a partir da segunda, o alerta chega na hora."
				>
					<Row label="Nota para o resumo diário">
						{(id) => (
							<input
								id={id}
								type="number"
								min={0}
								max={100}
								required
								value={draft.minScoreToNotify}
								onChange={(e) =>
									set("minScoreToNotify", Number(e.target.value))
								}
								className={numberClass}
							/>
						)}
					</Row>
					<Row label="Nota para alerta imediato">
						{(id) => (
							<input
								id={id}
								type="number"
								min={0}
								max={100}
								value={draft.instantAlertScore ?? ""}
								placeholder="85"
								onChange={(e) =>
									set("instantAlertScore", number(e.target.value))
								}
								className={numberClass}
							/>
						)}
					</Row>
				</Group>

				<Group
					title="Modalidade"
					footer="Estágios no exterior entram só se forem remotos e ficam abaixo dos do Brasil."
				>
					{MODALITIES.map(([value, label]) => (
						<Row key={value} label={label}>
							{(id) => (
								<input
									id={id}
									type="checkbox"
									role="switch"
									aria-checked={draft.modality.includes(value)}
									checked={draft.modality.includes(value)}
									onChange={(e) =>
										set(
											"modality",
											e.target.checked
												? [...draft.modality, value]
												: draft.modality.filter((m) => m !== value),
										)
									}
									className="switch"
								/>
							)}
						</Row>
					))}
					<Row label="Remoto no exterior">
						{(id) => (
							<input
								id={id}
								type="checkbox"
								role="switch"
								aria-checked={draft.abroad === "remote"}
								checked={draft.abroad === "remote"}
								onChange={(e) =>
									set("abroad", e.target.checked ? "remote" : "none")
								}
								className="switch"
							/>
						)}
					</Row>
				</Group>

				<Group
					title="Cidades e estados aceitos"
					footer="Para vagas presenciais e híbridas. Uma por linha; siglas de estado valem (PB)."
				>
					{list("locations", "Cidades e estados aceitos")}
				</Group>

				<Group
					title="Bolsa e carga horária"
					footer="Deixe vazio para não filtrar."
				>
					<Row label="Bolsa mínima (R$)">
						{(id) => (
							<input
								id={id}
								type="number"
								min={0}
								value={draft.minStipend ?? ""}
								onChange={(e) => set("minStipend", number(e.target.value))}
								className={numberClass}
							/>
						)}
					</Row>
					<Row label="Máximo de horas por semana">
						{(id) => (
							<input
								id={id}
								type="number"
								min={1}
								value={draft.maxHoursPerWeek ?? ""}
								onChange={(e) => set("maxHoursPerWeek", number(e.target.value))}
								className={numberClass}
							/>
						)}
					</Row>
				</Group>

				{LISTS.map(({ field, label, hint }) => (
					<Group key={field} title={label} footer={`${hint} Uma por linha.`}>
						{list(field, label)}
					</Group>
				))}
			</div>
		</form>
	);
}
