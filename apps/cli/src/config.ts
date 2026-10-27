import { readFile } from "node:fs/promises";
import { z } from "zod";

export const SOURCES_CONFIG_PATH = "./config/sources.json";

const SourcesConfig = z.object({
	github: z.object({
		repos: z.array(
			z.string().regex(/^[\w.-]+\/[\w.-]+$/, "use o formato dono/repositório"),
		),
	}),
});
export type SourcesConfig = z.infer<typeof SourcesConfig>;

export async function readSourcesConfig(
	path = SOURCES_CONFIG_PATH,
): Promise<SourcesConfig> {
	const parsed = SourcesConfig.safeParse(
		JSON.parse(await readFile(path, "utf8")),
	);
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((i) => `  ${i.path.join(".") || "(raiz)"}: ${i.message}`)
			.join("\n");
		throw new Error(`${path} tem campos inválidos:\n${issues}`);
	}
	return parsed.data;
}
