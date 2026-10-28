import type { JobListItem } from "@radar/core";
import { AlertTriangle, ExternalLink, Globe } from "lucide-react";
import { place, sourceLabel } from "../format.ts";
import { ScoreBadge } from "./ScoreBadge.tsx";
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
		<ul
			className="flex flex-wrap gap-1"
			aria-label={tone === "match" ? "Você tem" : "Falta"}
		>
			{skills.map((skill) => (
				<li
					key={skill}
					className={`rounded px-1.5 py-0.5 text-xs ${
						tone === "match"
							? "bg-good-soft text-good"
							: "border border-dashed border-line text-muted"
					}`}
				>
					{skill}
				</li>
			))}
		</ul>
	);
}

export function JobCard({
	job,
	onOpen,
}: {
	job: JobListItem;
	onOpen: (id: number) => void;
}) {
	const analysis = job.analysis;
	return (
		<article className="rounded-xl border border-line bg-surface p-4">
			<div className="flex gap-3">
				<ScoreBadge score={job.score} />
				<div className="min-w-0 flex-1">
					<h3 className="text-[15px] font-semibold leading-snug">
						<button
							type="button"
							onClick={() => onOpen(job.id)}
							className="text-left underline-offset-2 hover:underline"
						>
							{job.title}
						</button>
					</h3>
					<p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
						<span className="text-ink">{job.company}</span>
						{place(job) && <span>· {place(job)}</span>}
						{job.abroad && (
							<span className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 text-xs text-accent">
								<Globe aria-hidden size={12} /> Exterior
							</span>
						)}
					</p>
				</div>
			</div>

			{analysis && (
				<p className="mt-3 text-sm leading-relaxed">{analysis.summary}</p>
			)}

			{analysis && analysis.dealBreakers.length > 0 && (
				<p className="mt-2 flex gap-1.5 rounded-md bg-bad-soft px-2.5 py-1.5 text-sm text-bad">
					<AlertTriangle aria-hidden size={16} className="mt-0.5 shrink-0" />
					<span>{analysis.dealBreakers.join(" · ")}</span>
				</p>
			)}

			{analysis && (
				<div className="mt-3 space-y-1.5">
					<SkillChips skills={analysis.matchedSkills} tone="match" />
					<SkillChips skills={analysis.missingSkills} tone="missing" />
				</div>
			)}

			<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
				<StatusButtons jobId={job.id} status={job.status} />
				<div className="flex items-center gap-3 text-sm text-muted">
					{job.alsoOn.length > 0 && (
						<span>
							também em{" "}
							{[...new Set(job.alsoOn.map((a) => sourceLabel(a.source)))].join(
								", ",
							)}
						</span>
					)}
					<a
						href={job.url}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
					>
						{sourceLabel(job.source)} <ExternalLink aria-hidden size={13} />
					</a>
				</div>
			</div>
		</article>
	);
}
