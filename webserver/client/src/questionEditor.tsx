import { useCallback, useMemo, useState } from "react";

import { isQuizRound, type QuizPack, type QuizQuestion } from "../../src/games/pack";
import {
  ANSWER_CHOICE_MAX_GRAPHEMES,
  QUESTION_PROMPT_MAX_GRAPHEMES,
  graphemeCount,
  textLimitCounter,
  textLimitOverBy,
  textLimitTone,
} from "../../src/domain/quizTextLimits";
import { PlayFrame, type SurfaceFitReport } from "./questionSurface";

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

function replaceQuestion(pack: QuizPack, slot: QuizSlot, question: QuizQuestion): QuizPack {
  const next = structuredClone(pack);
  const round = next.rounds[slot.roundIndex];
  if (round === undefined || !isQuizRound(round)) return pack;
  round.questions[slot.questionIndex] = question;
  return next;
}

/**
 * * Pack question editor. The phone preview is the player surface, so a change
 *   from 4 answers to 5 remeasures every field in the new grid.
 */
export function QuestionEditor(props: {
  pack: QuizPack;
  saving: boolean;
  onPack: (pack: QuizPack) => void;
  onSave: () => void;
}): JSX.Element {
  const slots = useMemo(() => quizSlots(props.pack), [props.pack]);
  const [selected, setSelected] = useState(0);
  const [fit, setFit] = useState<SurfaceFitReport>({ prompt: true, choices: [] });
  const slot = slots[Math.min(selected, Math.max(0, slots.length - 1))];
  const onFit = useCallback((report: SurfaceFitReport) => {
    setFit((prev) =>
      prev.prompt === report.prompt && prev.choices.join() === report.choices.join() ? prev : report,
    );
  }, []);

  if (slot === undefined) {
    return <p>Ce pack n'a pas de question QCM.</p>;
  }

  const question = slot.question;
  const promptTone = textLimitTone(graphemeCount(question.prompt), QUESTION_PROMPT_MAX_GRAPHEMES);
  const choiceTones = question.choices.map((choice) =>
    textLimitTone(graphemeCount(choice), ANSWER_CHOICE_MAX_GRAPHEMES),
  );
  const promptOverflow = fit.prompt === false || promptTone === "over";
  const choiceOverflow = question.choices.map(
    (_, index) => fit.choices[index] === false || choiceTones[index] === "over",
  );
  const blocked = promptOverflow || choiceOverflow.some(Boolean);
  const blockMessage = saveBlockMessage(question, promptOverflow, choiceOverflow, promptTone === "over", choiceTones);

  const update = (nextQuestion: QuizQuestion): void => {
    props.onPack(replaceQuestion(props.pack, slot, nextQuestion));
  };

  return (
    <div className="bz-editor-layout">
      <div>
        <h2 style={{ marginTop: 0 }}>Modifier la question {slot.number}</h2>
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
              const choices = question.choices.slice();
              choices[index] = value;
              update({ ...question, choices });
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
                const choices = question.choices.slice(0, -1);
                const correctIndex = Math.min(question.correctIndex, choices.length - 1);
                update({ ...question, choices, correctIndex });
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
        <p className="bz-muted" style={{ marginTop: 0 }}>Aperçu joueur, en direct</p>
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
    <label className={props.over ? "bz-limit-field bz-limit-field--over" : "bz-limit-field"} style={{ display: "block", marginTop: 12 }}>
      <span>{props.label}</span>
      {props.multiline ? (
        <textarea value={props.value} rows={3} onChange={(event) => props.onChange(event.target.value)} aria-invalid={props.over} />
      ) : (
        <input value={props.value} onChange={(event) => props.onChange(event.target.value)} aria-invalid={props.over} />
      )}
      <span className={`bz-limit-count bz-limit-count--${tone}`}>{textLimitCounter(length, props.max)}</span>
      {tone === "warn" ? <span className="bz-muted"> Proche de la limite : l'aperçu passe en police réduite.</span> : null}
      {tone === "over" ? <span className="bz-limit-count--over"> Trop long : raccourcissez de {overBy} caractères.</span> : null}
      {props.over && tone !== "over" ? <span className="bz-limit-count--over"> Ce texte ne tient pas dans l'aperçu.</span> : null}
    </label>
  );
}

function saveBlockMessage(
  question: QuizQuestion,
  promptOverflow: boolean,
  choiceOverflow: boolean[],
  promptOverChars: boolean,
  choiceTones: Array<"ok" | "warn" | "over">,
): string {
  if (promptOverChars) return `Impossible d'enregistrer : la question dépasse ${QUESTION_PROMPT_MAX_GRAPHEMES} caractères.`;
  const overIndex = choiceTones.findIndex((tone) => tone === "over");
  if (overIndex >= 0) {
    return `Impossible d'enregistrer : la réponse ${String.fromCharCode(65 + overIndex)} dépasse ${ANSWER_CHOICE_MAX_GRAPHEMES} caractères.`;
  }
  if (promptOverflow) return "Impossible d'enregistrer : la question ne tient pas dans l'aperçu.";
  const fitIndex = choiceOverflow.findIndex(Boolean);
  if (fitIndex >= 0) {
    return `Impossible d'enregistrer : la réponse ${String.fromCharCode(65 + fitIndex)} ne tient pas dans l'aperçu.`;
  }
  return "Impossible d'enregistrer.";
}
