import { scoreTone, type Tone } from "../format.ts";

const TONE_CLASS: Record<Tone, string> = {
	good: "bg-good-soft text-good",
	fair: "bg-fair-soft text-fair",
	warn: "bg-warn-soft text-warn",
	bad: "bg-bad-soft text-bad",
	none: "bg-sunken text-muted",
};

export function ScoreBadge({ score }: { score: number | null }) {
	return (
		<span
			className={`inline-flex h-9 w-11 shrink-0 items-center justify-center rounded-lg text-base font-semibold tabular-nums ${TONE_CLASS[scoreTone(score)]}`}
			title={score === null ? "Não pontuada" : `Nota ${score} de 100`}
		>
			{score ?? "–"}
		</span>
	);
}
