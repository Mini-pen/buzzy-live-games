/**
 * * Décidé (Minipen, 21/10/2026) : the next question stays hidden through the
 *   between-question pause, « Prêt ? », and the buzzer countdown. It appears
 *   only when the buzzer opens, not at the start of that countdown.
 */
export const QUESTION_REVEAL_AT = "buzzer_open" as const;

export interface RevealPartyView {
  questionHold?: { roundIndex: number; questionIndex: number } | null;
  buzzWindowOpen: boolean;
  questionRevealed?: boolean;
}

export function shouldWithholdNextQuestion(party: RevealPartyView): boolean {
  if (party.questionHold == null) return false;
  if (QUESTION_REVEAL_AT === "buzzer_open") return party.buzzWindowOpen !== true;
  return false;
}

export function isQuestionRevealed(party: RevealPartyView): boolean {
  return party.questionRevealed !== false;
}

export interface ReadyPhaseView {
  readyCheckEnabled?: boolean;
  readyPhaseStartedAt?: number | null;
  countdownStartedAt?: number | null;
  buzzWindowOpen: boolean;
  nextQuestionCountdownStartedAt?: number | null;
  state?: string;
}

/** * True while « Prêt ? » is on screen and no question text may be sent. */
export function readyPhaseHidesQuestion(party: ReadyPhaseView): boolean {
  return (
    party.state === "round_active" &&
    party.readyCheckEnabled === true &&
    party.readyPhaseStartedAt != null &&
    party.countdownStartedAt == null &&
    party.buzzWindowOpen !== true &&
    party.nextQuestionCountdownStartedAt == null
  );
}

export function buildQuizChoiceCounts(choiceCount: number, picks: Iterable<number>): number[] {
  const counts = Array.from({ length: Math.max(0, choiceCount) }, () => 0);
  for (const index of picks) {
    if (Number.isInteger(index) && index >= 0 && index < counts.length) {
      counts[index] += 1;
    }
  }
  return counts;
}

/** * « 11 (61%) ». A round of thirds may sum to 99. Zero voters stay « 0 (0%) ». */
export function quizChoiceVoteLabel(count: number, total: number): string {
  const safeCount = Number.isInteger(count) && count > 0 ? count : 0;
  const safeTotal = Number.isInteger(total) && total > 0 ? total : 0;
  if (safeTotal === 0) return "0 (0%)";
  const percent = Math.round((safeCount / safeTotal) * 100);
  return `${safeCount} (${percent}%)`;
}

export function quizChoiceRowClass(input: {
  selected: boolean;
  correct: boolean;
  verdict?: "good" | "bad" | null;
}): string {
  const parts = ["bz-choice"];
  if (input.correct) parts.push("bz-choice--correct");
  if (input.selected) parts.push("bz-choice--selected");
  if (input.verdict === "good") parts.push("bz-choice--player-pick-good");
  if (input.verdict === "bad") parts.push("bz-choice--player-pick-bad");
  return parts.join(" ");
}
