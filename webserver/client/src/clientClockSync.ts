/**
 * * Client-side clock synchronization (NTP-like).
 * * Performs bursts of up to 5 pings and keeps the min-RTT sample.
 * * A failed first ping stops the burst (offset 0, no retry storm).
 */

import { BASE_PATH } from "./paths";
import {
  clockSyncFromSamples,
  playerTimeSyncUrl,
  shouldStopClockSyncBurst,
  type ClockSyncSample,
} from "../../src/http/playerTimeSyncUrl.js";

export interface ClientClockSync {
  offsetMs: number;
  minRttMs: number;
  lastSyncAt: number;
}

export interface TimeSyncResponse {
  clientTimestamp: number;
  serverTimestamp: number;
}

/**
 * * Perform a single ping to estimate offset and RTT.
 * * Returns null when the request fails so the burst can stop immediately.
 */
async function performSinglePing(
  partyId: string,
  playerToken: string,
): Promise<ClockSyncSample | null> {
  const t0 = performance.now();
  try {
    const resp = await fetch(playerTimeSyncUrl(partyId, BASE_PATH), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${playerToken}`,
      },
      body: JSON.stringify({ clientTimestamp: t0 }),
    });
    const t1 = performance.now();

    if (!resp.ok) return null;

    const data: TimeSyncResponse = await resp.json();
    const rttMs = t1 - t0;
    const offsetMs = data.serverTimestamp - (t0 + t1) / 2;

    return { offsetMs, rttMs };
  } catch {
    return null;
  }
}

/**
 * * Perform a burst of up to 5 pings and return the result with the lowest RTT.
 * * The first failure aborts the burst. No successful sample yields offset 0.
 */
export async function performClockSyncBurst(
  partyId: string,
  playerToken: string,
): Promise<ClientClockSync> {
  const results: ClockSyncSample[] = [];

  try {
    for (let i = 0; i < 5; i += 1) {
      const result = await performSinglePing(partyId, playerToken);
      if (result === null) {
        if (shouldStopClockSyncBurst(results.length, true)) break;
        continue;
      }
      results.push(result);
      if (i < 4) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  } catch {
    return clockSyncFromSamples([], Date.now());
  }

  return clockSyncFromSamples(results, Date.now());
}

/**
 * * Convert a local monotonic timestamp to server time using the sync state.
 */
export function convertToServerTime(
  clientMonotonicMs: number,
  sync: ClientClockSync | null,
): number {
  if (!sync) return clientMonotonicMs;
  return clientMonotonicMs + sync.offsetMs;
}

/**
 * * Check if sync is still valid (< 60s old, RTT < 1000ms).
 */
export function isClientSyncValid(sync: ClientClockSync | null): boolean {
  if (!sync) return false;
  const ageMs = Date.now() - sync.lastSyncAt;
  if (ageMs > 60_000) return false;
  if (sync.minRttMs > 1_000) return false;
  return true;
}
