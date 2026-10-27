import { createHash } from "node:crypto";
import type { Job } from "./schemas.ts";
import { normalizeText } from "./text.ts";

/** Identity of a posting across runs: company + title + URL. */
export function jobHash(job: Pick<Job, "company" | "title" | "url">): string {
	const key = [job.company, job.title]
		.map((part) => normalizeText(part).replace(/\s+/g, " ").trim())
		.concat(job.url.trim())
		.join("|");
	return createHash("sha256").update(key).digest("hex");
}
