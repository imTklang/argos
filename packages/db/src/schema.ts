import type {
	JobScore,
	JobStatus,
	Level,
	Modality,
	Preferences,
	Profile,
} from "@radar/core";
import { sql } from "drizzle-orm";
import {
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
	integer("created_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`);

export const profiles = sqliteTable("profiles", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	data: text("data", { mode: "json" }).$type<Profile>().notNull(),
	resumeHash: text("resume_hash").notNull(),
	createdAt: createdAt(),
});

export const preferences = sqliteTable("preferences", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	profileId: integer("profile_id").references(() => profiles.id),
	data: text("data", { mode: "json" }).$type<Preferences>().notNull(),
	createdAt: createdAt(),
});

export const jobs = sqliteTable(
	"jobs",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		source: text("source").notNull(),
		externalId: text("external_id").notNull(),
		title: text("title").notNull(),
		company: text("company").notNull(),
		location: text("location"),
		modality: text("modality").$type<Modality>(),
		description: text("description").notNull(),
		url: text("url").notNull(),
		publishedAt: integer("published_at", { mode: "timestamp" }),
		expiresAt: integer("expires_at", { mode: "timestamp" }),
		level: text("level").$type<Level>(),
		// hash(company + title + url): dedup across sources
		hash: text("hash").notNull().unique(),
		createdAt: createdAt(),
	},
	(t) => [uniqueIndex("jobs_source_external_id").on(t.source, t.externalId)],
);

export const jobScores = sqliteTable("job_scores", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	jobId: integer("job_id")
		.notNull()
		.references(() => jobs.id),
	// null when the model output failed validation twice
	score: integer("score"),
	analysis: text("analysis", { mode: "json" }).$type<JobScore>(),
	model: text("model").notNull(),
	createdAt: createdAt(),
});

export const jobStatus = sqliteTable("job_status", {
	jobId: integer("job_id")
		.primaryKey()
		.references(() => jobs.id),
	status: text("status").$type<JobStatus>().notNull().default("nova"),
	note: text("note"),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`),
});

export const runs = sqliteTable("runs", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	source: text("source").notNull(),
	startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
	finishedAt: integer("finished_at", { mode: "timestamp" }),
	jobsFound: integer("jobs_found").notNull().default(0),
	errors: text("errors", { mode: "json" }).$type<string[]>(),
	inputTokens: integer("input_tokens").notNull().default(0),
	outputTokens: integer("output_tokens").notNull().default(0),
});
