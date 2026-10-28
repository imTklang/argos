import type { JobListItem } from "@radar/core";
import { Bookmark, CircleCheck, Globe, TriangleAlert } from "lucide-react";
import { fromNow, place } from "../format.ts";
import { ScoreRing } from "./ScoreRing.tsx";

/** One job in a list, laid out like a message in Mail. */
export function JobRow({
	job,
	selected = false,
	onOpen,
}: {
	job: JobListItem;
	selected?: boolean;
	onOpen: (id: number) => void;
}) {
	const analysis = job.analysis;
	const warning = analysis?.dealBreakers[0];
	return (
		<li className="group">
			<button
				type="button"
				onClick={() => onOpen(job.id)}
				aria-current={selected || undefined}
				className={`flex w-full gap-3 pl-4 text-left transition-colors duration-100 ${
					selected ? "bg-accent-soft" : "hoverable active:bg-fill"
				}`}
			>
				<span className="pt-3">
					<ScoreRing score={job.score} />
				</span>
				<span className="min-w-0 flex-1 border-b border-separator py-3 pr-4 group-last:border-b-0">
					<span className="flex items-baseline gap-2">
						<span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
							{job.title}
						</span>
						{job.publishedAt && (
							<span className="shrink-0 text-xs text-muted">
								{fromNow(job.publishedAt)}
							</span>
						)}
					</span>
					<span className="mt-0.5 flex items-center gap-1.5 text-[13px]">
						<span className="truncate">
							{job.company}
							{place(job) && (
								<span className="text-muted"> · {place(job)}</span>
							)}
						</span>
						{job.abroad && (
							<>
								<Globe aria-hidden size={13} className="shrink-0 text-accent" />
								<span className="sr-only">, exterior</span>
							</>
						)}
						{job.status === "salva" && (
							<Bookmark
								aria-hidden
								size={13}
								fill="currentColor"
								className="ml-auto shrink-0 text-accent"
							/>
						)}
						{job.status !== "nova" && job.status !== "vista" && (
							<span className="sr-only">, {job.status}</span>
						)}
						{job.status === "candidatei" && (
							<CircleCheck
								aria-hidden
								size={14}
								className="ml-auto shrink-0 text-good"
							/>
						)}
					</span>
					{warning ? (
						<span className="mt-1 flex items-start gap-1 text-[13px] text-bad">
							<TriangleAlert
								aria-hidden
								size={13}
								className="mt-0.5 shrink-0"
							/>
							<span className="line-clamp-1">{warning}</span>
						</span>
					) : (
						analysis && (
							<span className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted">
								{analysis.summary}
							</span>
						)
					)}
				</span>
			</button>
		</li>
	);
}
