import { describe, expect, it } from "vitest";
import { acquireLock, createDb } from "./index.ts";

describe("acquireLock", () => {
	it("lets one holder in at a time and frees the lock on release", () => {
		const db = createDb(":memory:");
		const first = acquireLock(db, "scan");
		expect(first).not.toBeNull();
		expect(acquireLock(db, "scan")).toBeNull();
		// Other names are independent.
		expect(acquireLock(db, "other")).not.toBeNull();

		first?.release();
		expect(acquireLock(db, "scan")).not.toBeNull();
	});

	it("takes over a lock whose holder stopped sending heartbeats", () => {
		const db = createDb(":memory:");
		let clock = new Date("2026-11-04T10:00:00Z");
		const now = () => clock;
		const dead = acquireLock(db, "scan", { now });
		expect(dead).not.toBeNull();

		clock = new Date("2026-11-04T10:20:00Z");
		expect(acquireLock(db, "scan", { now })).toBeNull();

		clock = new Date("2026-11-04T10:31:00Z");
		const next = acquireLock(db, "scan", { now });
		expect(next).not.toBeNull();
		// The old holder can no longer free the new holder's lock.
		dead?.release();
		expect(acquireLock(db, "scan", { now })).toBeNull();
	});

	it("keeps a live holder's lock while it sends heartbeats", () => {
		const db = createDb(":memory:");
		let clock = new Date("2026-11-04T10:00:00Z");
		const now = () => clock;
		const lock = acquireLock(db, "scan", { now });

		clock = new Date("2026-11-04T10:25:00Z");
		lock?.heartbeat();
		clock = new Date("2026-11-04T10:40:00Z");
		expect(acquireLock(db, "scan", { now })).toBeNull();
	});
});
