import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

export type Resume = { text: string; hash: string };

export async function readResume(path: string): Promise<Resume> {
	const bytes = new Uint8Array(await readFile(path));
	const hash = createHash("sha256").update(bytes).digest("hex");
	const pdf = await getDocumentProxy(bytes);
	const { text } = await extractText(pdf, { mergePages: true });
	return { text: text.trim(), hash };
}
