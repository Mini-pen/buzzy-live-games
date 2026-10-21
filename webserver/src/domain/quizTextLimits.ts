import { isQuizRound, type QuizPack } from "../games/pack.js";

/**
 * * Server-side character guardrails.
 *   The editor's real gate is the phone preview at the minimum font.
 *   INCERTAIN: Design UI, 2026-10-21, tailles et limites de saisie, à confirmer par Minipen.
 */
export const QUESTION_PROMPT_MAX_GRAPHEMES = 140;
export const ANSWER_CHOICE_MAX_GRAPHEMES = 120;

/** * Orange counter from this share of the guardrail. The value is an editor hint. */
export const TEXT_LIMIT_WARN_RATIO = 0.85;

const ELLIPSIS = "…";

export type TextLimitTone = "ok" | "warn" | "over";

export interface QuizTextLimitIssue {
  questionNumber: number;
  field: "prompt" | "choice";
  choiceIndex?: number;
  length: number;
  max: number;
  message: string;
}

export interface ImportTextNotice {
  questionNumber: number;
  kind: "prompt" | "choice" | "duplicate_choices";
  message: string;
}

/** * Grapheme clusters, so an emoji counts as one. */
export function graphemesOf(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...segmenter.segment(text)].map((part) => part.segment);
}

export function graphemeCount(text: string): number {
  return graphemesOf(text).length;
}

export function textLimitTone(
  length: number,
  max: number,
  warnRatio: number = TEXT_LIMIT_WARN_RATIO,
): TextLimitTone {
  if (length > max) return "over";
  if (max > 0 && length >= Math.ceil(max * warnRatio)) return "warn";
  return "ok";
}

export function textLimitCounter(length: number, max: number): string {
  return `${length} / ${max}`;
}

export function textLimitOverBy(length: number, max: number): number {
  return length > max ? length - max : 0;
}

/**
 * * Cuts on grapheme boundaries and keeps the ellipsis inside the limit.
 */
export function truncateGraphemes(
  text: string,
  max: number,
): { text: string; truncated: boolean } {
  const parts = graphemesOf(text);
  if (max < 0) return { text: "", truncated: text !== "" };
  if (parts.length <= max) return { text, truncated: false };
  if (max === 0) return { text: "", truncated: true };
  const ellipsis = graphemesOf(ELLIPSIS);
  if (max <= ellipsis.length) {
    return { text: parts.slice(0, max).join(""), truncated: true };
  }
  const kept = parts.slice(0, max - ellipsis.length).join("");
  return { text: `${kept}${ELLIPSIS}`, truncated: true };
}

/**
 * * Shortens until `fits` accepts the text.
 *   Keeps the longest run of whole words, then « … ».
 *   A single word that does not fit is cut on the last grapheme that does.
 *   INCERTAIN: Specs Writer, 2026-10-21, coupe au dernier mot, à confirmer par Minipen.
 */
export function truncateUntilFits(
  text: string,
  fits: (candidate: string) => boolean,
): { text: string; truncated: boolean } {
  if (fits(text)) return { text, truncated: false };
  const words = text.trim().split(/\s+/u).filter((word) => word !== "");
  let bestWords = 0;
  let lo = 1;
  let hi = Math.max(0, words.length - 1);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = `${words.slice(0, mid).join(" ")}${ELLIPSIS}`;
    if (fits(candidate)) {
      bestWords = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (bestWords > 0) {
    return { text: `${words.slice(0, bestWords).join(" ")}${ELLIPSIS}`, truncated: true };
  }
  const word = words[0] ?? "";
  const glyphs = graphemesOf(word);
  let bestGlyphs = 0;
  lo = 0;
  hi = Math.max(0, glyphs.length - 1);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = mid <= 0 ? ELLIPSIS : `${glyphs.slice(0, mid).join("")}${ELLIPSIS}`;
    if (fits(candidate)) {
      bestGlyphs = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (bestGlyphs > 0) {
    return { text: `${glyphs.slice(0, bestGlyphs).join("")}${ELLIPSIS}`, truncated: true };
  }
  if (fits(ELLIPSIS)) return { text: ELLIPSIS, truncated: true };
  return { text: "", truncated: true };
}

interface QuizQuestionRef {
  questionNumber: number;
  roundIndex: number;
  questionIndex: number;
  prompt: string;
  choices: string[];
}

function eachQuizQuestion(pack: QuizPack): QuizQuestionRef[] {
  const found: QuizQuestionRef[] = [];
  let questionNumber = 0;
  pack.rounds.forEach((round, roundIndex) => {
    if (!isQuizRound(round)) return;
    round.questions.forEach((question, questionIndex) => {
      questionNumber += 1;
      found.push({
        questionNumber,
        roundIndex,
        questionIndex,
        prompt: question.prompt,
        choices: question.choices,
      });
    });
  });
  return found;
}

export function collectQuizTextLimitIssues(pack: QuizPack): QuizTextLimitIssue[] {
  const issues: QuizTextLimitIssue[] = [];
  for (const question of eachQuizQuestion(pack)) {
    const promptLength = graphemeCount(question.prompt);
    if (promptLength > QUESTION_PROMPT_MAX_GRAPHEMES) {
      issues.push({
        questionNumber: question.questionNumber,
        field: "prompt",
        length: promptLength,
        max: QUESTION_PROMPT_MAX_GRAPHEMES,
        message: `La question ${question.questionNumber} dépasse ${QUESTION_PROMPT_MAX_GRAPHEMES} caractères.`,
      });
    }
    question.choices.forEach((choice, choiceIndex) => {
      const length = graphemeCount(choice);
      if (length > ANSWER_CHOICE_MAX_GRAPHEMES) {
        issues.push({
          questionNumber: question.questionNumber,
          field: "choice",
          choiceIndex,
          length,
          max: ANSWER_CHOICE_MAX_GRAPHEMES,
          message: `Une réponse de la question ${question.questionNumber} dépasse ${ANSWER_CHOICE_MAX_GRAPHEMES} caractères.`,
        });
      }
    });
  }
  return issues;
}

/** * Editor and every server route that stores a question. ZIP import does not use this. */
export function assertQuizTextWithinLimits(pack: QuizPack): void {
  const issues = collectQuizTextLimitIssues(pack);
  if (issues.length === 0) return;
  throw Object.assign(new Error(issues.map((issue) => issue.message).join(" ")), {
    code: "QUIZ_TEXT_TOO_LONG",
    issues,
  });
}

function promptNotice(questionNumber: number): string {
  return `Attention, la question ${questionNumber} dépasse la taille autorisée`;
}

function choiceNotice(questionNumber: number): string {
  return `Attention, une réponse de la question ${questionNumber} dépasse la taille autorisée`;
}

function duplicateNotice(questionNumber: number): string {
  // INCERTAIN: Testeur, 2026-10-21, signalement des réponses identiques après troncature, à confirmer par Minipen
  return `Attention, la question ${questionNumber} a des réponses devenues identiques après troncature : à corriger`;
}

/**
 * * ZIP import keeps going. Oversized prompts and answers are cut to the guardrail.
 *   Identical answers after that cut are reported and still imported.
 */
export function applyQuizImportTextLimits(pack: QuizPack): {
  pack: QuizPack;
  notices: ImportTextNotice[];
} {
  const next = structuredClone(pack);
  const notices: ImportTextNotice[] = [];
  for (const question of eachQuizQuestion(next)) {
    const round = next.rounds[question.roundIndex];
    if (round === undefined || !isQuizRound(round)) continue;
    const stored = round.questions[question.questionIndex];
    if (stored === undefined) continue;

    const promptCut = truncateGraphemes(stored.prompt, QUESTION_PROMPT_MAX_GRAPHEMES);
    if (promptCut.truncated) {
      stored.prompt = promptCut.text;
      notices.push({
        questionNumber: question.questionNumber,
        kind: "prompt",
        message: promptNotice(question.questionNumber),
      });
    }

    let choiceTruncated = false;
    stored.choices = stored.choices.map((choice) => {
      const cut = truncateGraphemes(choice, ANSWER_CHOICE_MAX_GRAPHEMES);
      if (cut.truncated) choiceTruncated = true;
      return cut.text;
    });
    if (choiceTruncated) {
      notices.push({
        questionNumber: question.questionNumber,
        kind: "choice",
        message: choiceNotice(question.questionNumber),
      });
    }

    const seen = new Set<string>();
    let duplicate = false;
    for (const choice of stored.choices) {
      if (seen.has(choice)) duplicate = true;
      seen.add(choice);
    }
    if (duplicate) {
      notices.push({
        questionNumber: question.questionNumber,
        kind: "duplicate_choices",
        message: duplicateNotice(question.questionNumber),
      });
    }
  }
  return { pack: next, notices };
}
