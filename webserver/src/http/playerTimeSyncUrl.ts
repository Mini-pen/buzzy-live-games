import { normaliseBasePath } from "../basePath.js";

/**
 * * Clock-sync request the player page must send.
 *
 * Fastify registers `POST /api/parties/:partyId/me/time-sync` with no mount
 * prefix: Traefik `StripPrefix` removes `/buzzy-live-games` before the request
 * arrives. The browser, though, has to put that prefix back, the same way
 * `withBase` does for every other player call (`fetchJson`).
 */

/** * HTTP method registered for the player clock-sync route. */
export const PLAYER_TIME_SYNC_METHOD = "POST";

/** * Fastify route template (no deployment prefix). */
export const PLAYER_TIME_SYNC_ROUTE = "/api/parties/:partyId/me/time-sync";

export interface ClockSyncSample {
  offsetMs: number;
  rttMs: number;
}

export interface ClockSyncSnapshot {
  offsetMs: number;
  minRttMs: number;
  lastSyncAt: number;
}

/**
 * * Absolute path the browser requests.
 * * `mountPath` is Vite's base (`""` at the domain root, `/buzzy-live-games` in production).
 */
export function playerTimeSyncUrl(
  partyId: string,
  mountPath: string | null | undefined,
): string {
  const path = `/api/parties/${encodeURIComponent(partyId)}/me/time-sync`;
  const base = normaliseBasePath(mountPath);
  if (base === "") return path;
  return `${base}${path}`;
}

/**
 * * Path Fastify matches after the reverse proxy strips the mount prefix.
 */
export function playerTimeSyncPathOnServer(
  partyId: string,
  mountPath: string | null | undefined,
): string {
  const url = playerTimeSyncUrl(partyId, mountPath);
  const base = normaliseBasePath(mountPath);
  if (base === "") return url;
  const stripped = url.slice(base.length);
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

/**
 * * A failed first ping will not succeed if retried immediately (404, network).
 * * Stop the burst so a bad URL does not fire the remaining samples.
 * * A later miss still leaves room for the samples that already succeeded.
 */
export function shouldStopClockSyncBurst(
  successCount: number,
  pingFailed: boolean,
): boolean {
  return pingFailed && successCount === 0;
}

/**
 * * Keeps the lowest-RTT sample.
 * * No successful ping yields offset 0 so buzz timestamps stay uncompensated
 * * without another immediate retry.
 */
export function clockSyncFromSamples(
  samples: readonly ClockSyncSample[],
  nowMs: number,
): ClockSyncSnapshot {
  if (samples.length === 0) {
    return { offsetMs: 0, minRttMs: 0, lastSyncAt: nowMs };
  }
  let best = samples[0];
  for (const sample of samples) {
    if (sample.rttMs < best.rttMs) best = sample;
  }
  return {
    offsetMs: best.offsetMs,
    minRttMs: best.rttMs,
    lastSyncAt: nowMs,
  };
}
