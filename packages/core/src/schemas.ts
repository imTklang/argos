import { z } from "zod";

export const SkillLevel = z.enum(["básico", "intermediário", "avançado"]);

export const Profile = z.object({
	name: z.string(),
	course: z.string(),
	institution: z.string(),
	currentPeriod: z.number().int().positive(),
	expectedGraduation: z.string(),
	skills: z.array(
		z.object({
			name: z.string(),
			level: SkillLevel,
			evidence: z.string().optional(),
		}),
	),
	languages: z.array(z.object({ name: z.string(), level: z.string() })),
	projects: z.array(
		z.object({
			name: z.string(),
			stack: z.array(z.string()),
			summary: z.string(),
		}),
	),
	experience: z.array(
		z.object({ title: z.string(), org: z.string(), summary: z.string() }),
	),
});
export type Profile = z.infer<typeof Profile>;

export const Modality = z.enum(["remoto", "híbrido", "presencial"]);
export type Modality = z.infer<typeof Modality>;

export const Preferences = z.object({
	roles: z.array(z.string()),
	keywordsMust: z.array(z.string()),
	keywordsBonus: z.array(z.string()),
	keywordsBlock: z.array(z.string()),
	modality: z.array(Modality),
	locations: z.array(z.string()),
	minStipend: z.number().nonnegative().optional(),
	maxHoursPerWeek: z.number().positive().optional(),
	minScoreToNotify: z.number().min(0).max(100),
	/** Jobs at or above this score are sent right away instead of waiting for the digest. */
	instantAlertScore: z.number().min(0).max(100).optional(),
});
export type Preferences = z.infer<typeof Preferences>;

export const Level = z.enum([
	"estágio",
	"trainee",
	"júnior",
	"pleno",
	"sênior",
	"especialista",
]);
export type Level = z.infer<typeof Level>;

export const Job = z.object({
	source: z.string(),
	externalId: z.string(),
	title: z.string(),
	company: z.string(),
	location: z.string().nullable(),
	modality: Modality.nullable(),
	description: z.string(),
	url: z.url(),
	publishedAt: z.date().nullable(),
	expiresAt: z.date().nullable(),
	/** Seniority from structured data (source type, labels), not free text. */
	level: Level.nullable().optional(),
});
export type Job = z.infer<typeof Job>;

export const JobScore = z.object({
	score: z.number().int().min(0).max(100),
	matchedSkills: z.array(z.string()),
	missingSkills: z.array(z.string()),
	dealBreakers: z.array(z.string()),
	summary: z.string(),
});
export type JobScore = z.infer<typeof JobScore>;

export const JobStatus = z.enum([
	"nova",
	"vista",
	"salva",
	"candidatei",
	"descartada",
]);
export type JobStatus = z.infer<typeof JobStatus>;
