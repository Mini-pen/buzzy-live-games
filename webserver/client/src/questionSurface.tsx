import { useLayoutEffect, useRef, useState, type JSX, type ReactNode } from "react";

import { answerGrid, fitFontSizePx, PLAY_LAYOUT } from "../../src/domain/playLayout";
import { quizChoiceRowClass, quizChoiceVoteLabel } from "../../src/domain/questionReveal";

export interface SurfaceFitReport {
  prompt: boolean;
  choices: boolean[];
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
  const promptRef = useRef<HTMLDivElement>(null);
  const choiceRefs = useRef<Array<HTMLElement | null>>([]);
  const grid = answerGrid(props.choices.length);
  const [promptFont, setPromptFont] = useState<number>(PLAY_LAYOUT.questionFontMaxPx);
  const [answerFont, setAnswerFont] = useState<number>(PLAY_LAYOUT.answerFontMaxPx);
  const onFit = props.onFit;
  const prompt = props.prompt;
  const choices = props.choices;
  const tagline = props.tagline;

  useLayoutEffect(() => {
    if (tagline) return;
    const promptBox = promptRef.current;
    if (promptBox) {
      const fitted = fitFontSizePx({
        text: prompt,
        maxWidthPx: promptBox.clientWidth,
        maxHeightPx: promptBox.clientHeight,
        maxLines: PLAY_LAYOUT.questionMaxLines,
        maxPx: PLAY_LAYOUT.questionFontMaxPx,
        minPx: PLAY_LAYOUT.questionFontMinPx,
        lineHeight: 1.2,
        measureWidth: canvasWidth,
      });
      setPromptFont(fitted.fontPx);
    }
    const widths = choices.map((_, index) => choiceRefs.current[index]?.clientWidth ?? 0);
    const heights = choices.map((_, index) => choiceRefs.current[index]?.clientHeight ?? 0);
    const width = Math.min(...widths.filter((value) => value > 0), Number.POSITIVE_INFINITY);
    const height = Math.min(...heights.filter((value) => value > 0), Number.POSITIVE_INFINITY);
    if (Number.isFinite(width) && Number.isFinite(height)) {
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
      setAnswerFont(size);
    }
    if (!onFit) return;
    const promptFits = boxFits(promptBox, PLAY_LAYOUT.questionFontMinPx, PLAY_LAYOUT.questionMaxLines);
    const choiceFits = choices.map((_, index) =>
      boxFits(choiceRefs.current[index] ?? null, PLAY_LAYOUT.answerFontMinPx, PLAY_LAYOUT.answerMaxLines),
    );
    onFit({ prompt: promptFits, choices: choiceFits });
  }, [onFit, prompt, choices, tagline, grid.columns, grid.rows]);

  const totalVotes = (props.counts ?? []).reduce((sum, count) => sum + (count > 0 ? count : 0), 0);
  const ready = typeof tagline === "string" && tagline !== "";

  return (
    <div className={props.mode === "preview" ? "bz-app bz-play-screen bz-play-screen--preview" : "bz-app bz-play-screen"}>
      <header className="bz-play-header">{props.header}</header>
      <div className="bz-play-rest">
        {ready ? (
          <section className="bz-qna bz-ready-hold" aria-live="polite">
            <p className="bz-ready-hold-kicker">{props.kicker}</p>
            <p className="bz-ready-hold-phrase">{tagline}</p>
          </section>
        ) : (
          <section className="bz-qna">
            <div className="bz-qna-question">
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
                    <span
                      className="bz-choice-text"
                      ref={(node) => {
                        choiceRefs.current[index] = node;
                      }}
                      style={{ fontSize: answerFont }}
                    >
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
                        onClick={() => props.onPick?.(index)}
                      >
                        {body}
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={`${letter}-${index}`} className={`${rowClass}${overflow ? " bz-choice--overflow" : ""}`}>
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

function canvasWidth(text: string, fontPx: number): number {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return text.length * fontPx * 0.55;
  context.font = `${fontPx}px ${getComputedStyle(document.body).fontFamily}`;
  return context.measureText(text).width;
}

function boxFits(node: HTMLElement | null, fontPx: number, maxLines: number): boolean {
  if (!node) return true;
  const probe = document.createElement("div");
  const width = node.clientWidth;
  const height = node.clientHeight;
  if (width <= 0 || height <= 0) return true;
  probe.style.cssText = [
    "position:absolute",
    "left:0",
    "top:0",
    "visibility:hidden",
    "pointer-events:none",
    `width:${width}px`,
    `font-size:${fontPx}px`,
    "line-height:1.2",
    "overflow-wrap:anywhere",
    "word-break:break-word",
    "white-space:normal",
  ].join(";");
  probe.textContent = node.textContent ?? "";
  node.appendChild(probe);
  const needed = probe.scrollHeight;
  probe.remove();
  const lineHeight = fontPx * 1.2;
  const lines = lineHeight > 0 ? Math.ceil(needed / lineHeight) : 1;
  return needed <= height + 1 && lines <= maxLines;
}
