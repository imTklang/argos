import type { JobListItem, JobStatus } from "@radar/core";

export const STATUSES: JobStatus[] = [
	"nova",
	"vista",
	"salva",
	"candidatei",
	"descartada",
];

export const STATUS_LABEL: Record<JobStatus, string> = {
	nova: "Nova",
	vista: "Vista",
	salva: "Salva",
	candidatei: "Candidatei",
	descartada: "Descartada",
};

const SOURCE_LABEL: Record<string, string> = {
	gupy: "Gupy",
	solides: "Sólides",
	ciee: "CIEE",
	github: "GitHub",
	greenhouse: "Greenhouse",
	lever: "Lever",
	ashby: "Ashby",
	himalayas: "Himalayas",
};

export function sourceLabel(source: string): string {
	return SOURCE_LABEL[source] ?? source;
}

export type Tone = "good" | "fair" | "warn" | "bad" | "none";

/** Score bands match the notification thresholds (85 alert, 70 digest). */
export function scoreTone(score: number | null): Tone {
	if (score === null) return "none";
	if (score >= 85) return "good";
	if (score >= 70) return "fair";
	if (score >= 50) return "warn";
	return "bad";
}

export function place(job: Pick<JobListItem, "modality" | "location">): string {
	return [job.modality, job.location].filter(Boolean).join(" · ");
}

const relative = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/** "há 3 dias", "em 2 semanas"; null when there is no date. */
export function fromNow(iso: string | null, now = new Date()): string | null {
	if (!iso) return null;
	const days = Math.round(
		(new Date(iso).getTime() - now.getTime()) / 86_400_000,
	);
	if (Math.abs(days) >= 14)
		return relative.format(Math.round(days / 7), "week");
	return relative.format(days, "day");
}
