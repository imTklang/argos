import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, jobStatus, jobs } from "./index.ts";

const job = {
	source: "github-backend-br",
	externalId: "123",
	title: "Estágio Backend Node.js",
	company: "Acme",
	location: "João Pessoa, PB",
	modality: "híbrido" as const,
	description: "Node, TypeScript, Postgres",
	url: "https://github.com/backend-br/vagas/issues/123",
	publishedAt: null,
	expiresAt: null,
	hash: "abc",
};

describe("createDb", () => {
	it("applies migrations and round-trips a job", () => {
		const db = createDb(":memory:");
		const inserted = db.insert(jobs).values(job).returning().get();
		expect(inserted.title).toBe(job.title);
		expect(inserted.createdAt).toBeInstanceOf(Date);

		db.insert(jobStatus).values({ jobId: inserted.id }).run();
		const status = db
			.select()
			.from(jobStatus)
			.where(eq(jobStatus.jobId, inserted.id))
			.get();
		expect(status?.status).toBe("nova");
	});

	it("rejects a duplicate hash", () => {
		const db = createDb(":memory:");
		db.insert(jobs).values(job).run();
		expect(() =>
			db
				.insert(jobs)
				.values({ ...job, externalId: "456" })
				.run(),
		).toThrow(/UNIQUE/);
	});
});
