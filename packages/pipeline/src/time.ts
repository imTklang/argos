/**
 * The user's time zone: schedules and the daily token budget follow it, not
 * the server's clock (often UTC). America/Fortaleza is João Pessoa's offset,
 * UTC-3 with no daylight saving.
 */
export const TIMEZONE = process.env.ARGOS_TIMEZONE || "America/Fortaleza";

/** Midnight of `now`'s calendar day in `timeZone`, as an instant. */
export function startOfDay(now: Date, timeZone = TIMEZONE): Date {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
		})
			.formatToParts(now)
			.map((part) => [part.type, Number(part.value)]),
	) as Record<string, number>;
	const wallClock = Date.UTC(
		parts.year ?? 0,
		(parts.month ?? 1) - 1,
		parts.day ?? 1,
		parts.hour ?? 0,
		parts.minute ?? 0,
		parts.second ?? 0,
	);
	// Wall clock minus the real instant is the zone's offset at `now`.
	const offset = wallClock - Math.floor(now.getTime() / 1000) * 1000;
	return new Date(
		Date.UTC(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day ?? 1) - offset,
	);
}
