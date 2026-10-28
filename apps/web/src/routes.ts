import type { JobStatus, Stats } from "@radar/core";
import {
	Archive,
	Bookmark,
	CircleDot,
	type LucideIcon,
	Send,
	Sparkles,
} from "lucide-react";

type JobList = {
	label: string;
	Icon: LucideIcon;
	status: JobStatus[];
	/** Starting minimum score; the toolbar can change it. */
	minScore: "0" | "50" | "70" | "85";
	empty: string;
	/** The gray half of the headline, from the number of jobs shown. */
	tagline: (count: number) => string;
};

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

/** Smart lists, like mailboxes: each one is a saved status filter. */
export const LISTS = {
	"para-voce": {
		label: "Para você",
		Icon: Sparkles,
		status: ["nova", "vista", "salva"],
		minScore: "50",
		empty:
			"Nada em aberto com nota 50 ou mais. Novas vagas chegam a cada varredura.",
		tagline: (n) =>
			n === 0
				? "Nada novo por enquanto."
				: `${plural(n, "vaga que combina", "vagas que combinam")} com você.`,
	},
	novas: {
		label: "Novas",
		Icon: CircleDot,
		status: ["nova", "vista"],
		minScore: "0",
		empty: "Você já olhou todas as vagas novas.",
		tagline: (n) =>
			n === 0 ? "Tudo visto." : `${plural(n, "vaga", "vagas")} para olhar.`,
	},
	salvas: {
		label: "Salvas",
		Icon: Bookmark,
		status: ["salva"],
		minScore: "0",
		empty: "Salve uma vaga para guardá-la aqui.",
		tagline: (n) =>
			n === 0
				? "Nada guardado ainda."
				: `${plural(n, "vaga guardada", "vagas guardadas")} para depois.`,
	},
	candidaturas: {
		label: "Candidaturas",
		Icon: Send,
		status: ["candidatei"],
		minScore: "0",
		empty: "Quando você marcar “Candidatei”, a vaga aparece aqui.",
		tagline: (n) =>
			n === 0
				? "Nenhuma enviada ainda."
				: `${plural(n, "candidatura", "candidaturas")} em andamento.`,
	},
	descartadas: {
		label: "Descartadas",
		Icon: Archive,
		status: ["descartada"],
		minScore: "0",
		empty: "Nenhuma vaga descartada.",
		tagline: (n) =>
			n === 0
				? "Nenhuma por aqui."
				: `${plural(n, "vaga", "vagas")} fora do páreo.`,
	},
} satisfies Record<string, JobList>;

export type ListId = keyof typeof LISTS;
export type Route = ListId | "quadro" | "ajustes";

export const LIST_IDS = Object.keys(LISTS) as ListId[];

export function isList(route: Route): route is ListId {
	return route in LISTS;
}

export function routeFromHash(hash: string): Route {
	const id = hash.replace(/^#\/?/, "");
	if (id === "quadro" || id === "ajustes") return id;
	return id in LISTS ? (id as ListId) : "para-voce";
}

/**
 * Badge count for the sidebar. "Para você" has none: it also filters by
 * score, so a raw status count would disagree with the list.
 */
export function listCount(stats: Stats | undefined, id: ListId): number | null {
	if (!stats || id === "para-voce" || id === "descartadas") return null;
	return LISTS[id].status.reduce((sum, s) => sum + stats.byStatus[s], 0);
}
