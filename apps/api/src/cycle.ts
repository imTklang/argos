import type { JobHints, JobScoreResult } from "@radar/ai";
import type { Job, Preferences, Profile } from "@radar/core";
import type { Db } from "@radar/db";
import {
	formatScanReport,
	type Messenger,
	notify,
	runScan,
	type ScanReport,
	startOfDay,
} from "@radar/pipeline";
import type { JobSource } from "@radar/sources";

const HOUR_MS = 60 * 60 * 1000;

export type CycleOptions = {
	db: Db;
	sources: JobSource[];
	preferences: Preferences;
	profile: Profile;
	score: (
		job: Job,
		profile: Profile,
		hints: JobHints,
	) => Promise<JobScoreResult>;
	messenger: Messenger | null;
	digest: boolean;
	maxScored: number;
	dailyTokenLimit: number;
	log: (message: string) => void;
};

export type CycleResult = {
	report: ScanReport;
	alerts: number;
	digest: number;
	errors: string[];
};

/** One scheduled run: scan every source, then notify. */
export async function runCycle(opts: CycleOptions): Promise<CycleResult> {
	const report = await runScan({
		db: opts.db,
		sources: opts.sources,
		preferences: opts.preferences,
		score: (job, hints) => opts.score(job, opts.profile, hints),
		maxScored: opts.maxScored,
		dailyTokenLimit: opts.dailyTokenLimit,
		log: opts.log,
	});
	opts.log(formatScanReport(report, opts.preferences.minScoreToNotify));

	if (!opts.messenger) {
		opts.log("TELEGRAM_CHAT_ID não configurado: nada foi enviado.");
		return { report, alerts: 0, digest: 0, errors: [] };
	}
	const sent = await notify({
		db: opts.db,
		prefs: opts.preferences,
		messenger: opts.messenger,
		digest: opts.digest,
	});
	opts.log(`Telegram: ${sent.alerts} alertas, ${sent.digest} vagas no resumo.`);
	for (const error of sent.errors) opts.log(`Telegram falhou: ${error}`);
	return {
		report,
		alerts: sent.alerts,
		digest: sent.digest,
		errors: sent.errors,
	};
}

/**
 * Runs at most one call at a time; a call that overlaps a running one is
 * skipped. idle() resolves once the running call, if any, has finished.
 */
export function exclusive<A extends unknown[], T>(
	task: (...args: A) => Promise<T>,
	onSkip: () => void,
): ((...args: A) => Promise<T | undefined>) & { idle(): Promise<void> } {
	let current: Promise<T> | null = null;
	const run = async (...args: A) => {
		if (current) {
			onSkip();
			return undefined;
		}
		current = task(...args);
		try {
			return await current;
		} finally {
			current = null;
		}
	};
	return Object.assign(run, {
		idle: async () => {
			await current?.catch(() => {});
		},
	});
}

/** A daily scan at `hour` o'clock; `digest` also sends the daily summary. */
export type Slot = { hour: number; digest: boolean };

/** The most recent scheduled scan at or before `now`, in `timeZone`. */
export function lastSlot(
	now: Date,
	schedule: Slot[],
	timeZone: string,
): { at: Date; digest: boolean } | null {
	const today = startOfDay(now, timeZone);
	const yesterday = startOfDay(new Date(today.getTime() - 1), timeZone);
	let latest: { at: Date; digest: boolean } | null = null;
	for (const day of [yesterday, today]) {
		for (const slot of schedule) {
			const at = new Date(day.getTime() + slot.hour * HOUR_MS);
			if (at <= now && (!latest || at > latest.at)) {
				latest = { at, digest: slot.digest };
			}
		}
	}
	return latest;
}

/**
 * The scheduled scan that should have run but did not, e.g. because the
 * computer was asleep at that hour, or null when the last run covers it.
 */
export function missedSlot(
	lastRun: Date | null,
	now: Date,
	schedule: Slot[],
	timeZone: string,
): { at: Date; digest: boolean } | null {
	const slot = lastSlot(now, schedule, timeZone);
	if (!slot) return null;
	return !lastRun || lastRun < slot.at ? slot : null;
}
