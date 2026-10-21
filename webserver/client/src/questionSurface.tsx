import { useLayoutEffect, useRef, useState, type JSX, type ReactNode } from "react";

import { answerGrid, fitFontSizePx, PLAY_LAYOUT } from "../../src/domain/playLayout";
import { quizChoiceRowClass, quizChoiceVoteLabel } from "../../src/domain/questionReveal";

export interface SurfaceFitReport {
  prompt: boolean;
  choices: boolean[];
  promptBox: { width: number; height: number };
  choiceBox: { width: number; height: number };
}

export function PlayFrame(props: {
  mode: "live" | "preview";
  kicker: string;
  prompt: string;
  choices: string[];
  /** * When set, the whole question zone is the ready tagline. No prompt or answers are shown. */
  tagline?: string | null;
  showResult: boolean;
  correctIndex: number | null;
  selectedIndex: number | null;
  counts: number[] | null;
  interactive: boolean;
  onPick?: (index: number) => void;
  /** * Fields that fail the preview fit check, outlined in red. */
  overflow?: { prompt: boolean; choices: boolean[] };
  /**
   * * Reports whether the prompt and every answer fit at the minimum font
   *   in the current grid. Called again when the answer count changes the columns.
   */
  onFit?: (report: SurfaceFitReport) => void;
  header: ReactNode;
  buzzer: ReactNode;
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const choiceRefs = useRef<Array<HTMLElement | null>>([]);
  const onFitRef = useRef(props.onFit);
  onFitRef.current = props.onFit;
  const grid = answerGrid(props.choices.length);
  const [promptFont, setPromptFont] = useState<number>(PLAY_LAYOUT.questionFontMaxPx);
  const [answerFont, setAnswerFont] = useState<number>(PLAY_LAYOUT.answerFontMaxPx);
  const prompt = props.prompt;
  const choices = props.choices;
  const tagline = props.tagline;
  const choiceKey = `${choices.length}\u0000${choices.join("\u0000")}`;

  useLayoutEffect(() => {
    const root = rootRef.current;
    let cancelled = false;

    const measure = (): void => {
      if (cancelled || tagline) return;
      const promptBox = promptTextBox(questionRef.current, promptRef.current);
      if (promptBox.width > 0 && promptBox.height > 0) {
        const fitted = fitFontSizePx({
          text: prompt,
          maxWidthPx: promptBox.width,
          maxHeightPx: promptBox.height,
          maxLines: PLAY_LAYOUT.questionMaxLines,
          maxPx: PLAY_LAYOUT.questionFontMaxPx,
          minPx: PLAY_LAYOUT.questionFontMinPx,
          lineHeight: 1.2,
          measureWidth: canvasWidth,
        });
        setPromptFont((prev) => (prev === fitted.fontPx ? prev : fitted.fontPx));
      }

      const choiceBoxes = choices.map((_, index) => choiceTextBox(choiceRefs.current[index] ?? null));
      const measuredChoices = choiceBoxes.filter((box) => box.width > 0 && box.height > 0);
      if (measuredChoices.length === choices.length && measuredChoices.length > 0) {
        const width = Math.min(...measuredChoices.map((box) => box.width));
        const height = Math.min(...measuredChoices.map((box) => box.height));
        let size = PLAY_LAYOUT.answerFontMaxPx;
        for (const choice of choices) {
          const fitted = fitFontSizePx({
            text: choice,
            maxWidthPx: width,
            maxHeightPx: height,
            maxLines: PLAY_LAYOUT.answerMaxLines,
            maxPx: size,
            minPx: PLAY_LAYOUT.answerFontMinPx,
            lineHeight: 1.2,
            measureWidth: canvasWidth,
          });
          size = Math.min(size, fitted.fontPx);
        }
        setAnswerFont((prev) => (prev === size ? prev : size));
      }

      const notify = onFitRef.current;
      if (!notify) return;
      if (promptBox.width <= 0 || promptBox.height <= 0) return;
      if (choices.length > 0 && measuredChoices.length !== choices.length) return;
      const choiceBox = measuredChoices.reduce(
        (box, next) => ({
          width: Math.min(box.width, next.width),
          height: Math.min(box.height, next.height),
        }),
        measuredChoices[0] ?? { width: 0, height: 0 },
      );
      // * Remeasures the prompt and every answer. A 4→5 change switches the grid and runs this again.
      // INCERTAIN: Testeur, 2026-10-21, chaque champ qui ne tient plus passe en rouge (CA-72), à confirmer par Minipen
      notify({
        prompt: domTextFits(
          prompt,
          promptBox.width,
          promptBox.height,
          PLAY_LAYOUT.questionFontMinPx,
          PLAY_LAYOUT.questionMaxLines,
        ),
        choices: choices.map((choice, index) =>
          domTextFits(
            choice,
            choiceBoxes[index]?.width ?? 0,
            choiceBoxes[index]?.height ?? 0,
            PLAY_LAYOUT.answerFontMinPx,
            PLAY_LAYOUT.answerMaxLines,
          ),
        ),
        promptBox,
        choiceBox,
      });
    };

    measure();
    if (root === null || typeof ResizeObserver === "undefined") {
      return () => {
        cancelled = true;
      };
    }
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(root);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [choiceKey, choices, prompt, tagline, grid.columns, grid.rows]);

  const totalVotes = (props.counts ?? []).reduce((sum, count) => sum + (count > 0 ? count : 0), 0);
  const ready = typeof tagline === "string" && tagline !== "";
  const previewStyle =
    props.mode === "preview"
      ? { width: PLAY_LAYOUT.referenceWidthPx, height: PLAY_LAYOUT.referenceHeightPx }
      : undefined;

  return (
    <div
      ref={rootRef}
      className={props.mode === "preview" ? "bz-app bz-play-screen bz-play-screen--preview" : "bz-app bz-play-screen"}
      style={previewStyle}
    >
      <header className="bz-play-header">{props.header}</header>
      <div className="bz-play-rest">
        {ready ? (
          <section className="bz-qna bz-ready-hold" aria-live="polite">
            <p className="bz-ready-hold-kicker">{props.kicker}</p>
            <p className="bz-ready-hold-phrase">{tagline}</p>
          </section>
        ) : (
          <section className="bz-qna">
            <div className="bz-qna-question" ref={questionRef}>
              <p className="bz-qna-kicker">{props.kicker}</p>
              <div
                ref={promptRef}
                className={props.overflow?.prompt ? "bz-qna-prompt bz-qna-prompt--overflow" : "bz-qna-prompt"}
                style={{ fontSize: promptFont }}
              >
                {prompt}
              </div>
            </div>
            <ol
              className="bz-qna-answers"
              data-columns={grid.columns}
              style={{
                gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
              }}
            >
              {props.choices.map((choice, index) => {
                const selected = props.selectedIndex === index;
                const correct = props.showResult && props.correctIndex === index;
                const rowClass = quizChoiceRowClass({ selected, correct });
                const overflow = props.overflow?.choices[index] === true;
                const letter = String.fromCharCode(65 + index);
                const vote =
                  props.showResult && props.counts
                    ? quizChoiceVoteLabel(props.counts[index] ?? 0, totalVotes)
                    : null;
                const body = (
                  <>
                    <span className="bz-choice-letter">{letter}</span>
                    <span className="bz-choice-text" style={{ fontSize: answerFont }}>
                      {choice}
                    </span>
                    <span className={correct ? "bz-choice-check" : "bz-choice-check bz-choice-check--slot"} aria-hidden={!correct}>
                      {correct ? "✓" : ""}
                    </span>
                    <span className={vote === null ? "bz-choice-votes bz-choice-votes--slot" : "bz-choice-votes"}>
                      {vote ?? "0 (0%)"}
                    </span>
                  </>
                );
                if (props.interactive) {
                  return (
                    <li key={`${letter}-${index}`}>
                      <button
                        type="button"
                        className={`${rowClass}${overflow ? " bz-choice--overflow" : ""}`}
                        ref={(node) => {
                          choiceRefs.current[index] = node;
                        }}
                        onClick={() => props.onPick?.(index)}
                      >
                        {body}
                      </button>
                    </li>
                  );
                }
                return (
                  <li
                    key={`${letter}-${index}`}
                    className={`${rowClass}${overflow ? " bz-choice--overflow" : ""}`}
                    ref={(node) => {
                      choiceRefs.current[index] = node;
                    }}
                  >
                    {body}
                  </li>
                );
              })}
            </ol>
          </section>
        )}
        <div
          className="bz-buzz-slot"
          style={{
            ["--bz-buzzer-slot" as string]: String(
              PLAY_LAYOUT.buzzerDiameterRatio / Math.max(0.01, 1 - PLAY_LAYOUT.questionAnswersRatio),
            ),
            ["--bz-buzzer-max" as string]: `${PLAY_LAYOUT.buzzerDiameterMaxPx}px`,
          }}
        >
          {props.buzzer}
        </div>
      </div>
    </div>
  );
}

/**
 * * DOM probe at a fixed font. A zero box does not count as a fit.
 *   The text is the field itself, not the letter or the vote label.
 */
export function domTextFits(
  text: string,
  width: number,
  height: number,
  fontPx: number,
  maxLines: number,
): boolean {
  if (width <= 0 || height <= 0) return false;
  if (typeof document === "undefined") return false;
  const probe = document.createElement("div");
  const family = getComputedStyle(document.body).fontFamily;
  probe.style.cssText = [
    "position:absolute",
    "left:-10000px",
    "top:0",
    "visibility:hidden",
    "pointer-events:none",
    `width:${width}px`,
    `font-size:${fontPx}px`,
    "line-height:1.2",
    "overflow-wrap:anywhere",
    "word-break:break-word",
    "white-space:normal",
    `font-family:${family}`,
  ].join(";");
  probe.textContent = text;
  document.body.appendChild(probe);
  const needed = probe.scrollHeight;
  probe.remove();
  const lineHeight = fontPx * 1.2;
  const lines = lineHeight > 0 ? Math.ceil(needed / lineHeight) : 1;
  return needed <= height + 1 && lines <= maxLines;
}

function canvasWidth(text: string, fontPx: number): number {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return text.length * fontPx * 0.55;
  context.font = `${fontPx}px ${getComputedStyle(document.body).fontFamily}`;
  return context.measureText(text).width;
}

function px(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function promptTextBox(
  question: HTMLElement | null,
  promptNode: HTMLElement | null,
): { width: number; height: number } {
  if (question === null) return { width: 0, height: 0 };
  const kicker = question.querySelector(".bz-qna-kicker");
  const kickerHeight = kicker instanceof HTMLElement ? kicker.offsetHeight : 0;
  const width = promptNode?.clientWidth ?? question.clientWidth;
  return {
    width,
    height: Math.max(0, question.clientHeight - kickerHeight),
  };
}

/** * Text column of the answer cell. The letter, the check and the votes stay reserved. */
function choiceTextBox(row: HTMLElement | null): { width: number; height: number } {
  if (row === null) return { width: 0, height: 0 };
  const style = getComputedStyle(row);
  const padX = px(style.paddingLeft, 0) + px(style.paddingRight, 0);
  const padY = px(style.paddingTop, 0) + px(style.paddingBottom, 0);
  const gap = px(style.columnGap, 8);
  let chrome = 0;
  for (const child of row.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.classList.contains("bz-choice-text")) continue;
    chrome += child.offsetWidth;
  }
  const gaps = Math.max(0, row.children.length - 1) * gap;
  return {
    width: Math.max(0, row.clientWidth - padX - chrome - gaps),
    height: Math.max(0, row.clientHeight - padY),
  };
}
