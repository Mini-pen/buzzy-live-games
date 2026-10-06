import type { ClockSyncState, PendingBuzz } from "./types.js";

const SYNC_VALIDITY_MS = 60_000;
const MAX_VALID_RTT_MS = 1_000;
const COMPENSATION_CAP_MARGIN_MS = 50;

/**
 * * Check if a clock sync state is valid for compensation.
 * * Valid if: sync exists, age < 60s, and RTT < 1000ms.
 */
export function isSyncValid(sync: ClockSyncState | undefined, nowMs: number): boolean {
  if (!sync) return false;
  const ageMs = nowMs - sync.lastSyncAt;
  if (ageMs > SYNC_VALIDITY_MS) return false;
  if (sync.minRttMs > MAX_VALID_RTT_MS) return false;
  return true;
}

/**
 * * Compute the estimated server timestamp for a buzz.
 * * Applies offset, caps compensation, and clamps to arrival time.
 */
export function computeEstimatedTimestamp(
  clientTimestamp: number,
  arrivedAt: number,
  sync: ClockSyncState | undefined,
  nowMs: number,
): number {
  if (!isSyncValid(sync, nowMs)) {
    return arrivedAt;
  }
  const rawEstimated = clientTimestamp + sync!.offsetMs;
  const compensation = arrivedAt - rawEstimated;
  const cap = sync!.minRttMs / 2 + COMPENSATION_CAP_MARGIN_MS;
  if (compensation > cap) {
    return arrivedAt - cap;
  }
  return Math.min(rawEstimated, arrivedAt);
}

/**
 * * Rank pending buzz entries by estimated timestamp (ascending), then by arrival time as tiebreaker.
 * * Returns the sorted array (does not mutate input).
 */
export function rankBuzzByEstimatedTime(buzzQueue: PendingBuzz[]): PendingBuzz[] {
  return [...buzzQueue].sort((a, b) => {
    if (a.estimatedAt !== b.estimatedAt) {
      return a.estimatedAt - b.estimatedAt;
    }
    return a.arrivedAt - b.arrivedAt;
  });
}

/**
 * * Update or create clock sync state for a player.
 * * Called after a ping burst; keeps the sample with the lowest RTT.
 */
export function updateClockSync(
  existing: ClockSyncState | undefined,
  offsetMs: number,
  rttMs: number,
  nowMs: number,
): ClockSyncState {
  if (!existing || rttMs < existing.minRttMs) {
    return { offsetMs, minRttMs: rttMs, lastSyncAt: nowMs };
  }
  return { ...existing, lastSyncAt: nowMs };
}
