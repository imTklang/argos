import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import fastifyStatic from "@fastify/static";
import type { CoverLetter } from "@radar/ai";
import {
	type Job,
	type JobScore,
	JobStatus,
	Preferences,
	type Profile,
} from "@radar/core";
import { coverLetters, type Db } from "@radar/db";
import { loadLatestProfile } from "@radar/pipeline";
import Fastify, { type FastifyError } from "fastify";
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { getJob, getStats, listJobs, setStatus } from "./queries.ts";

export type ServerOptions = {
	db: Db;
	preferencesPath: string;
	generateCoverLetter: (input: {
		profile: Profile;
		job: Job;
		analysis: JobScore | null;
	}) => Promise<CoverLetter>;
	/** Built dashboard (apps/web/dist) to serve at "/", when present. */
	webRoot?: string;
	logger?: boolean;
	/**
	 * Read-only demo for sharing through a tunnel: any Host, no writes, and
	 * personal notes and cover letters hidden.
	 */
	demo?: boolean;
};

/** "a,b,c" query values as a list. */
const csv = z.string().transform((value) => value.split(",").filter(Boolean));

const JobsQuery = z.object({
	status: csv.pipe(z.array(JobStatus)).optional(),
	source: csv.optional(),
	minScore: z.coerce.number().int().min(0).max(100).optional(),
	scope: z.enum(["brazil", "abroad", "all"]).optional(),
	q: z.string().max(200).optional(),
	sort: z.enum(["score", "recent"]).optional(),
	limit: z.coerce.number().int().min(1).max(200).optional(),
	offset: z.coerce.number().int().min(0).optional(),
});

const IdParams = z.object({ id: z.coerce.number().int().positive() });

/** Header the dashboard sends; a cross-site page cannot add it without CORS. */
export const CLIENT_HEADER = "x-radar-client";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hostname(host: string | undefined): string {
	if (!host) return "";
	// "[::1]:3333" keeps its brackets; "localhost:3333" drops the port.
	return host.startsWith("[")
		? host.slice(0, host.indexOf("]") + 1)
		: (host.split(":")[0] ?? "");
}

export function buildServer(opts: ServerOptions) {
	const app = Fastify({ logger: opts.logger ?? false });

	// There is no login, so the API must only answer this machine's dashboard:
	// - a loopback Host blocks DNS rebinding (an outside page resolving its own
	//   name to 127.0.0.1 to read the data);
	// - the custom header on writes forces a CORS preflight that this API never
	//   grants, so another site cannot trigger paid cover letters or edits.
	app.addHook("onRequest", async (req, reply) => {
		if (opts.demo) {
			if (MUTATING.has(req.method)) {
				return reply.code(403).send({ error: "Demonstração: só leitura" });
			}
			return;
		}
		if (!LOOPBACK_HOSTS.has(hostname(req.headers.host))) {
			return reply
				.code(403)
				.send({ error: "Acesso permitido só pelo localhost" });
		}
		if (
			MUTATING.has(req.method) &&
			req.headers[CLIENT_HEADER] !== "dashboard"
		) {
			return reply
				.code(403)
				.send({ error: "Requisição sem o cabeçalho do dashboard" });
		}
	});

	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	const api = app.withTypeProvider<ZodTypeProvider>();

	api.get("/api/jobs", { schema: { querystring: JobsQuery } }, (req) => {
		const page = listJobs(opts.db, req.query);
		return opts.demo
			? { ...page, items: page.items.map((job) => ({ ...job, note: null })) }
			: page;
	});

	api.get("/api/jobs/:id", { schema: { params: IdParams } }, (req, reply) => {
		const job = getJob(opts.db, req.params.id);
		if (!job) return reply.code(404).send({ error: "Vaga não encontrada" });
		return opts.demo ? { ...job, note: null, coverLetter: null } : job;
	});

	api.patch(
		"/api/jobs/:id/status",
		{
			schema: {
				params: IdParams,
				body: z.object({
					status: JobStatus,
					note: z.string().max(2000).nullable().optional(),
				}),
			},
		},
		(req, reply) => {
			const { id } = req.params;
			if (!setStatus(opts.db, id, req.body.status, req.body.note)) {
				return reply.code(404).send({ error: "Vaga não encontrada" });
			}
			return getJob(opts.db, id);
		},
	);

	api.post(
		"/api/jobs/:id/cover-letter",
		{
			schema: {
				params: IdParams,
				body: z.object({ regenerate: z.boolean().optional() }).nullish(),
			},
		},
		async (req, reply) => {
			const detail = getJob(opts.db, req.params.id);
			if (!detail)
				return reply.code(404).send({ error: "Vaga não encontrada" });
			// Generated letters are kept: asking again returns the stored one.
			if (detail.coverLetter && !req.body?.regenerate)
				return detail.coverLetter;

			const profile = loadLatestProfile(opts.db);
			if (!profile) {
				return reply.code(409).send({
					error: "Nenhum perfil importado. Rode: pnpm cli profile import",
				});
			}
			const { description, analysis, ...rest } = detail;
			const letter = await opts.generateCoverLetter({
				profile,
				analysis,
				job: {
					source: rest.source,
					externalId: String(rest.id),
					title: rest.title,
					company: rest.company,
					location: rest.location,
					modality: rest.modality,
					description,
					url: rest.url,
					publishedAt: null,
					expiresAt: null,
				},
			});
			const saved = opts.db
				.insert(coverLetters)
				.values({ jobId: detail.id, text: letter.text, model: letter.model })
				.returning()
				.get();
			return {
				text: saved.text,
				model: saved.model,
				createdAt: saved.createdAt.toISOString(),
			};
		},
	);

	api.get("/api/preferences", async () =>
		Preferences.parse(JSON.parse(await readFile(opts.preferencesPath, "utf8"))),
	);

	api.put(
		"/api/preferences",
		{ schema: { body: Preferences } },
		async (req) => {
			await writeFile(
				opts.preferencesPath,
				`${JSON.stringify(req.body, null, 2)}\n`,
			);
			return req.body;
		},
	);

	api.get("/api/stats", () => getStats(opts.db));

	app.setErrorHandler((error: FastifyError, _req, reply) => {
		if (error.validation) {
			return reply
				.code(400)
				.send({ error: "Dados inválidos", details: error.message });
		}
		app.log.error(error);
		return reply.code(500).send({ error: error.message || "Erro interno" });
	});

	if (opts.webRoot && existsSync(opts.webRoot)) {
		app.register(fastifyStatic, { root: opts.webRoot });
		// Client-side routes fall back to the app shell.
		app.setNotFoundHandler((req, reply) =>
			req.url.startsWith("/api/")
				? reply.code(404).send({ error: "Rota não encontrada" })
				: reply.sendFile("index.html"),
		);
	}

	return app;
}
