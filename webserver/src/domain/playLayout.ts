/**
 * * Player stage ratios.
 *   INCERTAIN: Design UI, 2026-10-21, répartition en % de la zone, à confirmer par Minipen.
 *   The svh height is frozen and changes only on rotation.
 *   Minimum font sizes are decided: 14 px for the prompt, 10 px for an answer.
 */
export const PLAY_LAYOUT = {
  headerHeightPx: 48,
  /** * Share of the area under the header taken by the question and the answers. */
  questionAnswersRatio: 0.5,
  /** * Share of that zone taken by the prompt. The four answers split the rest. */
  questionShareOfZone: 0.35,
  answerSlotCount: 4,
  /** * Buzzer diameter as a share of the area under the header, then capped. */
  buzzerDiameterRatio: 0.3,
  buzzerDiameterMaxPx: 230,
  /** * Smallest supported phone. The editor preview measures this size. */
  referenceWidthPx: 360,
  referenceHeightPx: 640,
  questionMaxLines: 3,
  answerMaxLines: 2,
  questionFontMaxPx: 21,
  questionFontMinPx: 14,
  answerFontMaxPx: 16,
  answerFontMinPx: 10,
} as const;

/**
 * * How answers share the fixed answers zone.
 *   INCERTAIN: Design UI, 2026-10-21, 2 à 4 réponses en une colonne et 5 ou 6 en 2×3, à confirmer par Minipen.
 *   The question block and the buzzer stay put: only the cells inside the answers zone change.
 */
export function answerGrid(choiceCount: number): { columns: 1 | 2; rows: number } {
  const count = Number.isInteger(choiceCount) && choiceCount > 0 ? choiceCount : 1;
  if (count >= 5) return { columns: 2, rows: 3 };
  return { columns: 1, rows: Math.min(4, count) };
}

// INCERTAIN: Coding Agent, 2026-10-21, hauteur de zone dérivée de l'écran et aperçu de référence 360×640, à confirmer par Minipen
export const PLAY_REFERENCE_SCREEN = {
  widthPx: PLAY_LAYOUT.referenceWidthPx,
  heightPx: PLAY_LAYOUT.referenceHeightPx,
} as const;

export interface PlayStageMetrics {
  headerPx: number;
  remainingPx: number;
  zonePx: number;
  questionPx: number;
  answersPx: number;
  answerRowPx: number;
  buzzerPx: number;
}

/** * Pixel sizes for a frozen screen height. The same formula drives the 360×640 preview. */
export function playStageMetrics(screenHeightPx: number): PlayStageMetrics {
  const headerPx = PLAY_LAYOUT.headerHeightPx;
  const remainingPx = Math.max(0, screenHeightPx - headerPx);
  const zonePx = remainingPx * PLAY_LAYOUT.questionAnswersRatio;
  const questionPx = zonePx * PLAY_LAYOUT.questionShareOfZone;
  const answersPx = Math.max(0, zonePx - questionPx);
  const answerRowPx =
    PLAY_LAYOUT.answerSlotCount > 0 ? answersPx / PLAY_LAYOUT.answerSlotCount : 0;
  const buzzerPx = Math.min(
    remainingPx * PLAY_LAYOUT.buzzerDiameterRatio,
    PLAY_LAYOUT.buzzerDiameterMaxPx,
  );
  return { headerPx, remainingPx, zonePx, questionPx, answersPx, answerRowPx, buzzerPx };
}

export interface FitFontInput {
  text: string;
  maxWidthPx: number;
  maxHeightPx: number;
  maxLines: number;
  maxPx: number;
  minPx: number;
  lineHeight: number;
  measureWidth: (text: string, fontPx: number) => number;
}

/**
 * * Largest font in [minPx, maxPx] whose wrapped text stays in the box.
 *   Below the minimum, the caller clips with an ellipsis. There is no scroll.
 *   INCERTAIN: Specs Writer, 2026-10-21, coupure « … » en dernier recours, à confirmer par Minipen.
 */
export function fitFontSizePx(input: FitFontInput): { fontPx: number; needsClamp: boolean } {
  const minPx = Math.max(1, input.minPx);
  const maxPx = Math.max(minPx, input.maxPx);
  const fits = (fontPx: number): boolean => {
    const lines = wrapLineCount(input.text, fontPx, input.maxWidthPx, input.measureWidth);
    if (lines > input.maxLines) return false;
    return lines * fontPx * input.lineHeight <= input.maxHeightPx + 0.5;
  };
  if (!fits(minPx)) return { fontPx: minPx, needsClamp: true };
  let lo = minPx;
  let hi = maxPx;
  let best = minPx;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { fontPx: best, needsClamp: false };
}

/**
 * * Reserved chrome inside the 360×640 preview, matching the play-screen CSS.
 *   The live editor measures the real nodes. These sizes are the shared model
 *   used when no DOM box is available, including the remeasure tests.
 */
export const PREVIEW_CHROME = {
  qnaPadTopPx: 4,
  qnaPadXPx: 12,
  qnaGapPx: 6,
  kickerPx: 16,
  answerGapPx: 6,
  choicePadYPx: 8,
  choicePadXPx: 16,
  choiceColumnGapPx: 8,
  letterPx: 18,
  checkPx: 16,
  votesPx: 72,
} as const;

export interface PreviewBox {
  widthPx: number;
  heightPx: number;
}

/**
 * * Prompt box and one answer box for the reference phone.
 *   Five or six answers use the narrower 2-column cell. The zone height does not change.
 */
export function previewFieldBoxes(choiceCount: number): { prompt: PreviewBox; choice: PreviewBox } {
  const rest = PLAY_REFERENCE_SCREEN.heightPx - PLAY_LAYOUT.headerHeightPx;
  const zone = rest * PLAY_LAYOUT.questionAnswersRatio;
  const innerH = Math.max(0, zone - PREVIEW_CHROME.qnaPadTopPx);
  const innerW = Math.max(0, PLAY_REFERENCE_SCREEN.widthPx - PREVIEW_CHROME.qnaPadXPx * 2);
  const questionTrack = innerH * PLAY_LAYOUT.questionShareOfZone;
  const answersTrack = Math.max(0, innerH - questionTrack - PREVIEW_CHROME.qnaGapPx);
  const prompt: PreviewBox = {
    widthPx: innerW,
    heightPx: Math.max(0, questionTrack - PREVIEW_CHROME.kickerPx),
  };
  const grid = answerGrid(choiceCount);
  const rowGaps = Math.max(0, grid.rows - 1) * PREVIEW_CHROME.answerGapPx;
  const rowH = grid.rows > 0 ? Math.max(0, (answersTrack - rowGaps) / grid.rows) : 0;
  const colGaps = Math.max(0, grid.columns - 1) * PREVIEW_CHROME.answerGapPx;
  const cellW = grid.columns > 0 ? Math.max(0, (innerW - colGaps) / grid.columns) : 0;
  const textW = Math.max(
    0,
    cellW -
      PREVIEW_CHROME.choicePadXPx -
      PREVIEW_CHROME.choiceColumnGapPx * 3 -
      PREVIEW_CHROME.letterPx -
      PREVIEW_CHROME.checkPx -
      PREVIEW_CHROME.votesPx,
  );
  return {
    prompt,
    choice: {
      widthPx: textW,
      heightPx: Math.max(0, rowH - PREVIEW_CHROME.choicePadYPx),
    },
  };
}

/** * True when the text stays inside the box at the minimum font, without an ellipsis. */
export function fieldFitsAtMinFont(
  text: string,
  box: PreviewBox,
  role: "prompt" | "choice",
  measureWidth: (text: string, fontPx: number) => number,
): boolean {
  const minPx = role === "prompt" ? PLAY_LAYOUT.questionFontMinPx : PLAY_LAYOUT.answerFontMinPx;
  const maxLines = role === "prompt" ? PLAY_LAYOUT.questionMaxLines : PLAY_LAYOUT.answerMaxLines;
  const fitted = fitFontSizePx({
    text,
    maxWidthPx: box.widthPx,
    maxHeightPx: box.heightPx,
    maxLines,
    maxPx: minPx,
    minPx,
    lineHeight: 1.2,
    measureWidth,
  });
  return !fitted.needsClamp;
}

/**
 * * Fits the prompt and every answer for the grid of `choices.length`.
 *   Adding a fifth answer switches to two columns and runs this again for every field.
 *   INCERTAIN: Testeur, 2026-10-21, chaque champ qui ne tient plus passe en rouge (CA-72), à confirmer par Minipen.
 */
export function assessQuestionFields(
  prompt: string,
  choices: string[],
  measureWidth: (text: string, fontPx: number) => number,
): { prompt: boolean; choices: boolean[] } {
  const boxes = previewFieldBoxes(choices.length);
  return {
    prompt: fieldFitsAtMinFont(prompt, boxes.prompt, "prompt", measureWidth),
    choices: choices.map((choice) => fieldFitsAtMinFont(choice, boxes.choice, "choice", measureWidth)),
  };
}

function wrapLineCount(
  text: string,
  fontPx: number,
  maxWidthPx: number,
  measureWidth: (text: string, fontPx: number) => number,
): number {
  if (text.trim() === "") return 1;
  if (maxWidthPx <= 0) return Number.POSITIVE_INFINITY;
  const words = text.split(/\s+/u).filter((word) => word !== "");
  let lines = 1;
  let line = "";
  const widthOf = (value: string): number => measureWidth(value, fontPx);
  for (const word of words) {
    const next = line === "" ? word : `${line} ${word}`;
    if (widthOf(next) <= maxWidthPx) {
      line = next;
      continue;
    }
    if (line !== "") {
      lines += 1;
      line = "";
    }
    if (widthOf(word) <= maxWidthPx) {
      line = word;
      continue;
    }
    let chunk = "";
    for (const glyph of [...word]) {
      const trial = `${chunk}${glyph}`;
      if (widthOf(trial) <= maxWidthPx) {
        chunk = trial;
        continue;
      }
      lines += chunk === "" ? 0 : 1;
      chunk = glyph;
    }
    line = chunk;
  }
  return lines;
}
