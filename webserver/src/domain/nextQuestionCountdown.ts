/**
 * * Pause shown on the next question before it becomes playable.
 *   Distinct from §4.5 `countdownDurationSec` (pre-buzzer countdown after « Prêt »).
 */

/** * Default length of the next-question pause. */
export const NEXT_QUESTION_COUNTDOWN_DEFAULT_SEC = 5;

/** * Inclusive minimum for `nextQuestionCountdownSec`. `0` means no pause. */
export const NEXT_QUESTION_COUNTDOWN_MIN_SEC = 0;

// INCERTAIN: plafond 30 s ; Minipen peut le resserrer. 0 (pas de pause) est décidé.
/** * Inclusive maximum for `nextQuestionCountdownSec`. */
export const NEXT_QUESTION_COUNTDOWN_MAX_SEC = 30;

/** * Default pre-buzzer countdown. `0` opens the buzzer as soon as the question is ready. */
export const BUZZER_COUNTDOWN_DEFAULT_SEC = 5;

/** * Inclusive minimum for `countdownDurationSec`. */
export const BUZZER_COUNTDOWN_MIN_SEC = 0;

// INCERTAIN: plafond 10 s du décompte buzzer. 0 et le défaut 5 s sont décidés.
/** * Inclusive maximum for `countdownDurationSec`. */
export const BUZZER_COUNTDOWN_MAX_SEC = 10;

/** * Default « Prêt ? » auto-timeout. `0` never skips the ready wait. */
export const READY_TIMEOUT_DEFAULT_SEC = 15;

/** * Smallest non-zero « Prêt ? » auto-timeout. */
export const READY_TIMEOUT_MIN_SEC = 5;

// INCERTAIN: plage 5–60 s, et 0 = pas de délai automatique. Le défaut 15 s est décidé.
/** * Inclusive maximum for `readyTimeoutSec`. */
export const READY_TIMEOUT_MAX_SEC = 60;

/** * True for `0` (no auto-timeout) or an integer from 5 to 60. */
export function isValidReadyTimeoutSec(seconds: number): boolean {
  if (!Number.isInteger(seconds)) return false;
  if (seconds === 0) return true;
  return seconds >= READY_TIMEOUT_MIN_SEC && seconds <= READY_TIMEOUT_MAX_SEC;
}

/** * Point-modal auto-close on the player page, unless the pause ends sooner. */
export const POINT_MODAL_CLOSE_MS = 3_000;

// INCERTAIN: la diffusion reprend le même plafond de 3 s, et n'affiche pas la modale si le délai est 0.
/** * Broadcast point-modal auto-close, unless the pause ends sooner. */
export const BROADCAST_POINT_MODAL_CLOSE_MS = POINT_MODAL_CLOSE_MS;

/** * True when `seconds` is an integer inside the allowed pause range. */
export function isValidNextQuestionCountdownSec(seconds: number): boolean {
  return (
    Number.isInteger(seconds) &&
    seconds >= NEXT_QUESTION_COUNTDOWN_MIN_SEC &&
    seconds <= NEXT_QUESTION_COUNTDOWN_MAX_SEC
  );
}

/**
 * * Whole seconds still to show (5, 4, 3…) from a server start timestamp.
 *   `null` when the pause is not running. `0` once the pause has elapsed.
 */
export function nextQuestionCountdownRemainingSec(
  startedAt: number | null,
  durationSec: number,
  nowMs: number,
): number | null {
  if (startedAt === null || !Number.isFinite(startedAt) || !Number.isFinite(durationSec)) return null;
  const totalMs = durationSec * 1000;
  if (totalMs <= 0) return 0;
  // * A client clock slightly behind the server start used to ceil 5.05 s up to 6.
  const elapsed = Math.max(0, nowMs - startedAt);
  if (elapsed >= totalMs) return 0;
  const cap = Math.max(0, Math.floor(durationSec));
  return Math.min(cap, Math.max(0, Math.ceil((totalMs - elapsed) / 1000)));
}

/**
 * * Drain ratio in `[0, 1]` (1 = full, 0 = empty) from the same server timestamp.
 *   `null` when the pause is not running.
 */
export function nextQuestionCountdownProgress(
  startedAt: number | null,
  durationSec: number,
  nowMs: number,
): number | null {
  if (startedAt === null || !Number.isFinite(startedAt) || !(durationSec > 0)) return null;
  const totalMs = durationSec * 1000;
  const elapsed = nowMs - startedAt;
  if (elapsed <= 0) return 1;
  if (elapsed >= totalMs) return 0;
  return 1 - elapsed / totalMs;
}

/**
 * * Whether the point modal is still up.
 *   It closes on click (`dismissed`), at `closeAfterMs`, or at the end of the pause — whichever is sooner.
 */
export function isPointModalVisible(input: {
  dismissed: boolean;
  startedAt: number | null;
  durationSec: number;
  closeAfterMs: number;
  nowMs: number;
}): boolean {
  if (input.dismissed || input.startedAt === null || !(input.durationSec > 0)) return false;
  const pauseEnd = input.startedAt + input.durationSec * 1000;
  const modalEnd = input.startedAt + Math.max(0, input.closeAfterMs);
  return input.nowMs < Math.min(pauseEnd, modalEnd);
}

/**
 * * Team token inside « pour l'équipe <nom> ».
 *   A non-empty `name` wins. Otherwise the 1-based index is used.
 *   INCERTAIN: Party and Player store only `teamId`, so the index fallback is what the pill shows today.
 */
export function pointTeamLabel(teamId: number, name?: string | null): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed !== "") return trimmed;
  return String(teamId);
}

/**
 * * Pill under the winner name.
 *   INCERTAIN: the singular form is « + 1 point ».
 *   A team score appends « pour l'équipe <nom> », where `<nom>` comes from `pointTeamLabel`.
 */
export function pointAwardLabel(points: number, teamName?: string | null): string {
  const n = Number.isInteger(points) && points > 0 ? points : 1;
  const amount = n === 1 ? "+ 1 point" : `+ ${n} points`;
  const team = typeof teamName === "string" ? teamName.trim() : "";
  if (team !== "") return `${amount} pour l'équipe ${team}`;
  return amount;
}

/**
 * * Ready-count line.
 *   `player` is under the buzzer (« 3 / 5 joueurs prêts »). `summary` is the host and the broadcast (« 3/5 prêts »).
 *   Both surfaces agree on the ready count. Singular only when that count is 1. Zero stays plural, as on the host.
 */
export function readyStatusLabel(ready: number, total: number, surface: "player" | "summary"): string {
  const safeReady = Number.isFinite(ready) ? Math.max(0, Math.floor(ready)) : 0;
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const pret = safeReady === 1 ? "prêt" : "prêts";
  if (surface === "summary") {
    // INCERTAIN: host and broadcast use « 3/5 prêts ».
    return `${safeReady}/${safeTotal} ${pret}`;
  }
  // INCERTAIN: « 3 / 5 joueurs prêts » under the player button is a Design UI proposal.
  // * « joueur prêt » follows the ready count, the same rule as `pret` on the host.
  const joueur = safeReady === 1 ? "joueur" : "joueurs";
  return `${safeReady} / ${safeTotal} ${joueur} ${pret}`;
}
