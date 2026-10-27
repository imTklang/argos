import type { ProfileExtraction } from "@radar/ai";
import type { Profile } from "@radar/core";
import { type Db, eq, profiles } from "@radar/db";
import type { Resume } from "../resume.ts";

export type ProfileImportResult =
	| { kind: "duplicate"; profileId: number; profile: Profile }
	| { kind: "imported"; profileId: number; extraction: ProfileExtraction };

export async function importProfile(opts: {
	db: Db;
	resume: Resume;
	extract: (text: string) => Promise<ProfileExtraction>;
	force?: boolean;
}): Promise<ProfileImportResult> {
	const { db, resume, extract, force = false } = opts;

	if (!force) {
		const existing = db
			.select()
			.from(profiles)
			.where(eq(profiles.resumeHash, resume.hash))
			.get();
		if (existing) {
			return {
				kind: "duplicate",
				profileId: existing.id,
				profile: existing.data,
			};
		}
	}

	if (resume.text.length === 0) {
		throw new Error(
			"Não foi possível extrair texto do PDF. Ele pode ser uma imagem escaneada.",
		);
	}

	const extraction = await extract(resume.text);
	const row = db
		.insert(profiles)
		.values({ data: extraction.profile, resumeHash: resume.hash })
		.returning({ id: profiles.id })
		.get();

	return { kind: "imported", profileId: row.id, extraction };
}

const LEVELS = ["avançado", "intermediário", "básico"] as const;

export function formatProfile(profile: Profile): string {
	const lines = [
		profile.name,
		`${profile.course} · ${profile.institution} · ${profile.currentPeriod}º período` +
			(profile.expectedGraduation
				? ` · formatura ${profile.expectedGraduation}`
				: ""),
		"",
		"Skills",
	];
	for (const level of LEVELS) {
		const names = profile.skills
			.filter((s) => s.level === level)
			.map((s) => s.name);
		if (names.length > 0) lines.push(`  ${level}: ${names.join(", ")}`);
	}

	if (profile.languages.length > 0) {
		lines.push("", "Idiomas");
		for (const l of profile.languages) lines.push(`  ${l.name}: ${l.level}`);
	}

	if (profile.projects.length > 0) {
		lines.push("", "Projetos");
		for (const p of profile.projects) {
			lines.push(`  ${p.name} [${p.stack.join(", ")}]`, `    ${p.summary}`);
		}
	}

	if (profile.experience.length > 0) {
		lines.push("", "Experiência");
		for (const e of profile.experience) {
			lines.push(`  ${e.title} · ${e.org}`, `    ${e.summary}`);
		}
	}

	return lines.join("\n");
}
