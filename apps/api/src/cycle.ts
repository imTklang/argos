import type { JobHints, JobScoreResult } from "@radar/ai";
import type { Job, Preferences, Profile } from "@radar/core";
import type { Db } from "@radar/db";
import {
	formatScanReport,
	type Messenger,
	notify,
	runScan,
	type ScanReport,
} from "@radar/pipeline";
import type { JobSource } from "@radar/sources";

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
		return { report, alerts: 0, digest: 0 };
	}
	const sent = await notify({
		db: opts.db,
		prefs: opts.preferences,
		messenger: opts.messenger,
		digest: opts.digest,
	});
	opts.log(`Telegram: ${sent.alerts} alertas, ${sent.digest} vagas no resumo.`);
	return { report, ...sent };
}

/** Runs at most one call at a time; a call that overlaps a running one is skipped. */
export function exclusive<A extends unknown[], T>(
	task: (...args: A) => Promise<T>,
	onSkip: () => void,
): (...args: A) => Promise<T | undefined> {
	let running = false;
	return async (...args) => {
		if (running) {
			onSkip();
			return undefined;
		}
		running = true;
		try {
			return await task(...args);
		} finally {
			running = false;
		}
	};
}
