import { describe, it, expect } from "vitest";
import { isSyncValid, computeEstimatedTimestamp, rankBuzzByEstimatedTime, updateClockSync } from "./clockSync.js";
import type { ClockSyncState, PendingBuzz } from "./types.js";

describe("isSyncValid", () => {
  it("returns false when sync is undefined", () => {
    expect(isSyncValid(undefined, Date.now())).toBe(false);
  });

  it("returns false when sync is older than 60s", () => {
    const sync: ClockSyncState = {
      offsetMs: 100,
      minRttMs: 50,
      lastSyncAt: Date.now() - 61_000,
    };
    expect(isSyncValid(sync, Date.now())).toBe(false);
  });

  it("returns false when RTT is > 1000ms", () => {
    const sync: ClockSyncState = {
      offsetMs: 100,
      minRttMs: 1001,
      lastSyncAt: Date.now(),
    };
    expect(isSyncValid(sync, Date.now())).toBe(false);
  });

  it("returns true when sync is recent and RTT is acceptable", () => {
    const sync: ClockSyncState = {
      offsetMs: 100,
      minRttMs: 50,
      lastSyncAt: Date.now() - 1000,
    };
    expect(isSyncValid(sync, Date.now())).toBe(true);
  });
});

describe("computeEstimatedTimestamp", () => {
  it("returns arrival time when no sync available", () => {
    const arrivedAt = 10000;
    const clientTimestamp = 9500;
    expect(computeEstimatedTimestamp(clientTimestamp, arrivedAt, undefined, Date.now())).toBe(arrivedAt);
  });

  it("returns arrival time when sync is invalid", () => {
    const sync: ClockSyncState = {
      offsetMs: 100,
      minRttMs: 50,
      lastSyncAt: Date.now() - 70_000,
    };
    const arrivedAt = 10000;
    const clientTimestamp = 9500;
    expect(computeEstimatedTimestamp(clientTimestamp, arrivedAt, sync, Date.now())).toBe(arrivedAt);
  });

  it("applies offset when sync is valid", () => {
    const sync: ClockSyncState = {
      offsetMs: 50,
      minRttMs: 400,
      lastSyncAt: Date.now(),
    };
    const arrivedAt = 10000;
    const clientTimestamp = 9900;
    const cap = 400 / 2 + 50;
    const rawEstimated = clientTimestamp + sync.offsetMs;
    const compensation = arrivedAt - rawEstimated;
    expect(compensation).toBeLessThan(cap);
    const estimated = computeEstimatedTimestamp(clientTimestamp, arrivedAt, sync, Date.now());
    expect(estimated).toBe(rawEstimated);
  });

  it("caps compensation to RTT/2 + 50ms", () => {
    const sync: ClockSyncState = {
      offsetMs: -2000,
      minRttMs: 300,
      lastSyncAt: Date.now(),
    };
    const arrivedAt = 10000;
    const clientTimestamp = 9000;
    const cap = 300 / 2 + 50;
    const expected = arrivedAt - cap;
    const estimated = computeEstimatedTimestamp(clientTimestamp, arrivedAt, sync, Date.now());
    expect(estimated).toBe(expected);
  });

  it("never estimates beyond arrival time", () => {
    const sync: ClockSyncState = {
      offsetMs: 1000,
      minRttMs: 100,
      lastSyncAt: Date.now(),
    };
    const arrivedAt = 10000;
    const clientTimestamp = 10500;
    const estimated = computeEstimatedTimestamp(clientTimestamp, arrivedAt, sync, Date.now());
    expect(estimated).toBe(arrivedAt);
  });
});

describe("rankBuzzByEstimatedTime", () => {
  it("sorts by estimated time ascending", () => {
    const buzzes: PendingBuzz[] = [
      { playerId: "p1", clientTimestamp: 100, arrivedAt: 1000, estimatedAt: 950 },
      { playerId: "p2", clientTimestamp: 200, arrivedAt: 1100, estimatedAt: 900 },
      { playerId: "p3", clientTimestamp: 300, arrivedAt: 1200, estimatedAt: 975 },
    ];
    const ranked = rankBuzzByEstimatedTime(buzzes);
    expect(ranked.map(b => b.playerId)).toEqual(["p2", "p1", "p3"]);
  });

  it("uses arrival time as tiebreaker for equal estimated times", () => {
    const buzzes: PendingBuzz[] = [
      { playerId: "p1", clientTimestamp: 100, arrivedAt: 1050, estimatedAt: 950 },
      { playerId: "p2", clientTimestamp: 200, arrivedAt: 1000, estimatedAt: 950 },
    ];
    const ranked = rankBuzzByEstimatedTime(buzzes);
    expect(ranked.map(b => b.playerId)).toEqual(["p2", "p1"]);
  });
});

describe("updateClockSync", () => {
  it("creates new sync when none exists", () => {
    const updated = updateClockSync(undefined, 150, 50, 10000);
    expect(updated.offsetMs).toBe(150);
    expect(updated.minRttMs).toBe(50);
    expect(updated.lastSyncAt).toBe(10000);
  });

  it("replaces sync when new RTT is better", () => {
    const existing: ClockSyncState = {
      offsetMs: 200,
      minRttMs: 100,
      lastSyncAt: 9000,
    };
    const updated = updateClockSync(existing, 180, 60, 10000);
    expect(updated.offsetMs).toBe(180);
    expect(updated.minRttMs).toBe(60);
    expect(updated.lastSyncAt).toBe(10000);
  });

  it("keeps existing offset/RTT when new RTT is worse, but updates lastSyncAt", () => {
    const existing: ClockSyncState = {
      offsetMs: 200,
      minRttMs: 50,
      lastSyncAt: 9000,
    };
    const updated = updateClockSync(existing, 180, 100, 10000);
    expect(updated.offsetMs).toBe(200);
    expect(updated.minRttMs).toBe(50);
    expect(updated.lastSyncAt).toBe(10000);
  });
});
