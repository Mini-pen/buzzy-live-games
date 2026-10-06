/**
 * * Client-side clock synchronization (NTP-like).
 * * Performs bursts of 5 pings and keeps the min-RTT sample.
 */

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
 */
async function performSinglePing(
  partyId: string,
  playerToken: string,
): Promise<{ offsetMs: number; rttMs: number } | null> {
  const t0 = performance.now();
  try {
    const resp = await fetch(`/api/parties/${partyId}/me/time-sync`, {
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
 * * Perform a burst of 5 pings and return the result with the lowest RTT.
 */
export async function performClockSyncBurst(
  partyId: string,
  playerToken: string,
): Promise<ClientClockSync | null> {
  const results: Array<{ offsetMs: number; rttMs: number }> = [];
  
  for (let i = 0; i < 5; i += 1) {
    const result = await performSinglePing(partyId, playerToken);
    if (result) results.push(result);
    if (i < 4) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  
  if (results.length === 0) return null;
  
  const best = results.reduce((prev, curr) => 
    curr.rttMs < prev.rttMs ? curr : prev
  );
  
  return {
    offsetMs: best.offsetMs,
    minRttMs: best.rttMs,
    lastSyncAt: Date.now(),
  };
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
