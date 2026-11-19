import { scoreTone, type Tone } from "../format.ts";

const STROKE: Record<Tone, string> = {
	good: "stroke-good",
	fair: "stroke-fair",
	warn: "stroke-warn",
	bad: "stroke-bad",
	none: "stroke-faint",
};

const TEXT: Record<Tone, string> = {
	good: "text-good",
	fair: "text-fair",
	warn: "text-warn",
	bad: "text-bad",
	none: "text-muted",
};

/** The score as a ring that fills up to it; the number carries the meaning. */
export function ScoreRing({
	score,
	size = 38,
}: {
	score: number | null;
	size?: number;
}) {
	const stroke = size >= 48 ? 4 : 3;
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	const tone = scoreTone(score);
	const label = score === null ? "Sem nota" : `Nota ${score} de 100`;
	return (
		<span
			role="img"
			aria-label={label}
			title={label}
			className="relative grid shrink-0 place-items-center"
			style={{ width: size, height: size }}
		>
			<svg
				aria-hidden
				width={size}
				height={size}
				className="absolute inset-0 -rotate-90"
			>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					strokeWidth={stroke}
					className="stroke-fill-strong"
				/>
				{score !== null && (
					<circle
						cx={size / 2}
						cy={size / 2}
						r={radius}
						fill="none"
						strokeWidth={stroke}
						strokeLinecap="round"
						strokeDasharray={`${(circumference * score) / 100} ${circumference}`}
						className={STROKE[tone]}
					/>
				)}
			</svg>
			<span
				aria-hidden
				className={`font-semibold tabular-nums ${TEXT[tone]} ${size >= 48 ? "text-[17px]" : "text-[13px]"}`}
			>
				{score ?? "–"}
			</span>
		</span>
	);
}
