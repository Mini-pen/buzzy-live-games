import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";

import { isQuizRound, type QuizPack, type QuizQuestion } from "../../src/games/pack";
import { PLAY_LAYOUT } from "../../src/domain/playLayout";
import {
  ANSWER_CHOICE_MAX_GRAPHEMES,
  QUESTION_PROMPT_MAX_GRAPHEMES,
  collectQuizTextLimitIssues,
  graphemeCount,
  quizTextAttention,
  shrinkQuizPackToFit,
  textLimitCounter,
  textLimitOverBy,
  textLimitTone,
  type ImportTextNotice,
  type QuizTextLimitIssue,
} from "../../src/domain/quizTextLimits";
import { domTextFits, PlayFrame, type SurfaceFitReport } from "./questionSurface";

interface QuizSlot {
  roundIndex: number;
  questionIndex: number;
  number: number;
  question: QuizQuestion;
}

function quizSlots(pack: QuizPack): QuizSlot[] {
  const slots: QuizSlot[] = [];
  let number = 0;
  pack.rounds.forEach((round, roundIndex) => {
    if (!isQuizRound(round)) return;
    round.questions.forEach((question, questionIndex) => {
      number += 1;
      slots.push({ roundIndex, questionIndex, number, question });
    });
  });
  return slots;
}

export function quizFitSignature(pack: QuizPack): string {
  return quizSlots(pack)
    .map((slot) => `${slot.number}\n${slot.question.prompt}\n${slot.question.choices.join("\n")}`)
    .join("\n---\n");
}

function replaceQuestion(pack: QuizPack, slot: QuizSlot, question: QuizQuestion): QuizPack {
  const next = structuredClone(pack);
  const round = next.rounds[slot.roundIndex];
  if (round === undefined || !isQuizRound(round)) return pack;
  round.questions[slot.questionIndex] = question;
  return next;
}

export interface PackFitSnapshot {
  signature: string;
  reports: ReadonlyMap<number, SurfaceFitReport>;
}

function packFitSame(prev: PackFitSnapshot | null, next: PackFitSnapshot): boolean {
  if (prev === null || prev.signature !== next.signature || prev.reports.size !== next.reports.size) return false;
  for (const [number, report] of next.reports) {
    const before = prev.reports.get(number);
    if (before === undefined) return false;
    if (before.prompt !== report.prompt || before.choices.join() !== report.choices.join()) return false;
  }
  return true;
}

/**
 * * After the server grapheme cut, the browser shortens again until the preview fits.
 *   INCERTAIN: Testeur, 2026-10-21, mesure navigateur après l'import ZIP, à confirmer par Minipen.
 *   INCERTAIN: Specs Writer, 2026-10-21, coupe au dernier mot, à confirmer par Minipen.
 */
export function shrinkPackWithReports(
  pack: QuizPack,
  reports: ReadonlyMap<number, SurfaceFitReport>,
): { pack: QuizPack; notices: ImportTextNotice[] } {
  return shrinkQuizPackToFit(pack, (query) => {
    const report = reports.get(query.questionNumber);
    if (report === undefined) return true;
    const box = query.field === "prompt" ? report.promptBox : report.choiceBox;
    const fontPx = query.field === "prompt" ? PLAY_LAYOUT.questionFontMinPx : PLAY_LAYOUT.answerFontMinPx;
    const maxLines = query.field === "prompt" ? PLAY_LAYOUT.questionMaxLines : PLAY_LAYOUT.answerMaxLines;
    return domTextFits(query.text, box.width, box.height, fontPx, maxLines);
  });
}

/**
 * * Pack question editor. The phone preview is the player surface, so a change
 *   from 4 answers to 5 remeasures every field in the new grid.
 */
export function QuestionEditor(props: {
  pack: QuizPack;
  saving: boolean;
  notices: string[];
  onPack: (pack: QuizPack) => void;
  onSave: () => void;
}): JSX.Element {
  const slots = useMemo(() => quizSlots(props.pack), [props.pack]);
  const signature = useMemo(() => quizFitSignature(props.pack), [props.pack]);
  const [selected, setSelected] = useState(0);
  const [fit, setFit] = useState<{ key: string; report: SurfaceFitReport } | null>(null);
  const [packFit, setPackFit] = useState<PackFitSnapshot | null>(null);
  const slot = slots[Math.min(selected, Math.max(0, slots.length - 1))];
  const question = slot?.question;
  const measureKey =
    slot === undefined || question === undefined
      ? ""
      : `${slot.number}\u0000${question.prompt}\u0000${question.choices.join("\u0000")}`;
  const onPackFit = useCallback((snapshot: PackFitSnapshot) => {
    setPackFit((prev) => (packFitSame(prev, snapshot) ? prev : snapshot));
  }, []);
  const onFit = useCallback(
    (report: SurfaceFitReport) => {
      setFit((prev) => {
        if (
          prev !== null &&
          prev.key === measureKey &&
          prev.report.prompt === report.prompt &&
          prev.report.choices.join() === report.choices.join()
        ) {
          return prev;
        }
        return { key: measureKey, report };
      });
    },
    [measureKey],
  );

  if (slot === undefined || question === undefined) {
    return <p>Ce pack n'a pas de question QCM.</p>;
  }

  const promptTone = textLimitTone(graphemeCount(question.prompt), QUESTION_PROMPT_MAX_GRAPHEMES);
  const choiceTones = question.choices.map((choice) =>
    textLimitTone(graphemeCount(choice), ANSWER_CHOICE_MAX_GRAPHEMES),
  );
  const currentMeasured = fit !== null && fit.key === measureKey;
  const promptOverflow = promptTone === "over" || (currentMeasured && fit.report.prompt === false);
  const choiceOverflow = question.choices.map(
    (_, index) => choiceTones[index] === "over" || (currentMeasured && fit.report.choices[index] === false),
  );
  const graphemeIssues = collectQuizTextLimitIssues(props.pack);
  const measuring = packFit === null || packFit.signature !== signature || !currentMeasured;
  const blockMessage = editorBlockMessage({
    measuring,
    selectedNumber: slot.number,
    issues: graphemeIssues,
    promptOverflow,
    choiceOverflow,
    promptOverChars: promptTone === "over",
    choiceTones,
    packFit: packFit !== null && packFit.signature === signature ? packFit : null,
  });
  const blocked = blockMessage !== null;
  const openingLines = openingLinesFor(graphemeIssues, packFit, signature).filter(
    (line) => !props.notices.includes(line),
  );

  const update = (nextQuestion: QuizQuestion): void => {
    props.onPack(replaceQuestion(props.pack, slot, nextQuestion));
  };

  return (
    <div className="bz-editor-layout">
      <PackPreviewMeasure pack={props.pack} onReady={onPackFit} />
      <div>
        <h2 style={{ marginTop: 0 }}>Modifier la question {slot.number}</h2>
        {props.notices.length > 0 || openingLines.length > 0 ? (
          <ul className="bz-editor-notices">
            {props.notices.map((notice) => (
              <li key={`import-${notice}`}>{notice}</li>
            ))}
            {openingLines.map((notice) => (
              <li key={`open-${notice}`}>{notice}</li>
            ))}
          </ul>
        ) : null}
        <label>
          Question
          <select
            value={slot.number}
            onChange={(event) => {
              const number = Number(event.target.value);
              const index = slots.findIndex((item) => item.number === number);
              if (index >= 0) setSelected(index);
            }}
          >
            {slots.map((item) => (
              <option key={item.number} value={item.number}>
                Question {item.number}
              </option>
            ))}
          </select>
        </label>
        <LengthField
          label="Question"
          value={question.prompt}
          max={QUESTION_PROMPT_MAX_GRAPHEMES}
          multiline
          over={promptOverflow}
          onChange={(prompt) => update({ ...question, prompt })}
        />
        {question.choices.map((choice, index) => (
          <LengthField
            key={`${slot.number}-${index}`}
            label={
              index === question.correctIndex
                ? `Réponse ${String.fromCharCode(65 + index)} · bonne réponse`
                : `Réponse ${String.fromCharCode(65 + index)}`
            }
            value={choice}
            max={ANSWER_CHOICE_MAX_GRAPHEMES}
            over={choiceOverflow[index] === true}
            onChange={(value) => {
              const nextChoices = question.choices.slice();
              nextChoices[index] = value;
              update({ ...question, choices: nextChoices });
            }}
          />
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => update({ ...question, choices: [...question.choices, ""] })}
          >
            Ajouter une réponse
          </button>
          {question.choices.length > 2 ? (
            <button
              type="button"
              onClick={() => {
                const nextChoices = question.choices.slice(0, -1);
                const correctIndex = Math.min(question.correctIndex, nextChoices.length - 1);
                update({ ...question, choices: nextChoices, correctIndex });
              }}
            >
              Retirer une réponse
            </button>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16 }}>
          <button type="button" className="bz-primary" disabled={blocked || props.saving} onClick={props.onSave}>
            Enregistrer
          </button>
          {blocked ? <p className="bz-editor-save-block">{blockMessage}</p> : null}
        </div>
      </div>
      <div>
        <p className="bz-editor-preview-kicker">Aperçu joueur, en direct</p>
        <div className="bz-phone-frame">
          <PlayFrame
            mode="preview"
            kicker={`Question ${slot.number} / ${slots.length}`}
            prompt={question.prompt}
            choices={question.choices}
            showResult={false}
            correctIndex={null}
            selectedIndex={null}
            counts={null}
            interactive={false}
            overflow={{ prompt: promptOverflow, choices: choiceOverflow }}
            onFit={onFit}
            header={<span className="bz-logo">buzzy</span>}
            buzzer={<span className="bz-buzz-btn bz-buzz-sent">Buzz</span>}
          />
        </div>
      </div>
    </div>
  );
}

export function PackPreviewMeasure(props: {
  pack: QuizPack;
  onReady: (snapshot: PackFitSnapshot) => void;
}): JSX.Element | null {
  const slots = useMemo(() => quizSlots(props.pack), [props.pack]);
  const signature = useMemo(() => quizFitSignature(props.pack), [props.pack]);
  const bucket = useRef<{ signature: string; reports: Map<number, SurfaceFitReport> }>({
    signature: "",
    reports: new Map(),
  });
  const onReadyRef = useRef(props.onReady);
  onReadyRef.current = props.onReady;
  if (bucket.current.signature !== signature) {
    bucket.current = { signature, reports: new Map() };
  }

  const reportFit = useCallback((number: number, report: SurfaceFitReport) => {
    if (bucket.current.signature !== signature) return;
    if (report.promptBox.width <= 0 || report.promptBox.height <= 0) return;
    if (report.choices.length > 0 && (report.choiceBox.width <= 0 || report.choiceBox.height <= 0)) return;
    const prev = bucket.current.reports.get(number);
    if (
      prev !== undefined &&
      prev.prompt === report.prompt &&
      prev.choices.join() === report.choices.join() &&
      prev.promptBox.width === report.promptBox.width &&
      prev.choiceBox.width === report.choiceBox.width
    ) {
      return;
    }
    bucket.current.reports.set(number, report);
    if (bucket.current.reports.size < slots.length) return;
    onReadyRef.current({
      signature,
      reports: new Map(bucket.current.reports),
    });
  }, [signature, slots.length]);

  useEffect(() => {
    if (slots.length > 0) return;
    onReadyRef.current({ signature, reports: new Map() });
  }, [signature, slots.length]);

  if (slots.length === 0) return null;

  return (
    <div className="bz-preview-measure" aria-hidden="true">
      {slots.map((item) => (
        <PlayFrame
          key={`${item.number}-${item.question.choices.length}`}
          mode="preview"
          kicker={`Question ${item.number} / ${slots.length}`}
          prompt={item.question.prompt}
          choices={item.question.choices}
          showResult={false}
          correctIndex={null}
          selectedIndex={null}
          counts={null}
          interactive={false}
          onFit={(report) => reportFit(item.number, report)}
          header={<span className="bz-logo">buzzy</span>}
          buzzer={<span className="bz-buzz-btn bz-buzz-sent">Buzz</span>}
        />
      ))}
    </div>
  );
}

function LengthField(props: {
  label: string;
  value: string;
  max: number;
  over: boolean;
  multiline?: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const length = graphemeCount(props.value);
  const tone = textLimitTone(length, props.max);
  const overBy = textLimitOverBy(length, props.max);
  return (
    <label className={props.over ? "bz-limit-field bz-limit-field--over" : "bz-limit-field"}>
      <span className="bz-limit-head">
        <span>{props.label}</span>
        <span className={`bz-limit-count bz-limit-count--${tone}`}>{textLimitCounter(length, props.max)}</span>
      </span>
      {props.multiline ? (
        <textarea value={props.value} rows={3} onChange={(event) => props.onChange(event.target.value)} aria-invalid={props.over} />
      ) : (
        <input value={props.value} onChange={(event) => props.onChange(event.target.value)} aria-invalid={props.over} />
      )}
      {tone === "warn" ? <span className="bz-muted"> Proche de la limite : l'aperçu passe en police réduite.</span> : null}
      {tone === "over" ? <span className="bz-limit-count--over"> Trop long : raccourcissez de {overBy} caractères.</span> : null}
      {props.over && tone !== "over" ? <span className="bz-limit-count--over"> Ce texte ne tient pas dans l'aperçu.</span> : null}
    </label>
  );
}

function editorBlockMessage(input: {
  measuring: boolean;
  selectedNumber: number;
  issues: QuizTextLimitIssue[];
  promptOverflow: boolean;
  choiceOverflow: boolean[];
  promptOverChars: boolean;
  choiceTones: Array<"ok" | "warn" | "over">;
  packFit: PackFitSnapshot | null;
}): string | null {
  if (input.measuring) return "Mesure de l'aperçu en cours.";
  const issue = input.issues[0];
  if (issue !== undefined) {
    const onThisQuestion = issue.questionNumber === input.selectedNumber;
    if (issue.field === "prompt") {
      return onThisQuestion
        ? `Impossible d'enregistrer : la question dépasse ${issue.max} caractères.`
        : `Impossible d'enregistrer : la question ${issue.questionNumber} dépasse ${issue.max} caractères.`;
    }
    const letter = String.fromCharCode(65 + (issue.choiceIndex ?? 0));
    return onThisQuestion
      ? `Impossible d'enregistrer : la réponse ${letter} dépasse ${issue.max} caractères.`
      : `Impossible d'enregistrer : la réponse ${letter} de la question ${issue.questionNumber} dépasse ${issue.max} caractères.`;
  }
  if (input.promptOverChars) {
    return `Impossible d'enregistrer : la question dépasse ${QUESTION_PROMPT_MAX_GRAPHEMES} caractères.`;
  }
  const overIndex = input.choiceTones.findIndex((tone) => tone === "over");
  if (overIndex >= 0) {
    return `Impossible d'enregistrer : la réponse ${String.fromCharCode(65 + overIndex)} dépasse ${ANSWER_CHOICE_MAX_GRAPHEMES} caractères.`;
  }
  if (input.promptOverflow) return "Impossible d'enregistrer : la question ne tient pas dans l'aperçu.";
  const fitIndex = input.choiceOverflow.findIndex(Boolean);
  if (fitIndex >= 0) {
    return `Impossible d'enregistrer : la réponse ${String.fromCharCode(65 + fitIndex)} ne tient pas dans l'aperçu.`;
  }
  if (input.packFit === null) return null;
  for (const [number, report] of input.packFit.reports) {
    if (!report.prompt) return `Impossible d'enregistrer : la question ${number} ne tient pas dans l'aperçu.`;
    const index = report.choices.findIndex((ok) => !ok);
    if (index >= 0) {
      return `Impossible d'enregistrer : la réponse ${String.fromCharCode(65 + index)} de la question ${number} ne tient pas dans l'aperçu.`;
    }
  }
  return null;
}

function openingLinesFor(
  issues: QuizTextLimitIssue[],
  packFit: PackFitSnapshot | null,
  signature: string,
): string[] {
  const lines = new Set<string>();
  for (const issue of issues) {
    lines.add(quizTextAttention(issue.questionNumber, issue.field));
  }
  if (packFit !== null && packFit.signature === signature) {
    for (const [number, report] of packFit.reports) {
      if (!report.prompt) lines.add(`Attention, la question ${number} ne tient pas dans l'aperçu`);
      if (report.choices.some((ok) => !ok)) {
        lines.add(`Attention, une réponse de la question ${number} ne tient pas dans l'aperçu`);
      }
    }
  }
  return [...lines];
}
