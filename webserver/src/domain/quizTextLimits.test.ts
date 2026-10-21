import { describe, expect, it } from "vitest";

import type { QuizPack } from "../games/pack.js";
import { assessQuestionFields, previewFieldBoxes } from "./playLayout.js";
import {
  ANSWER_CHOICE_MAX_GRAPHEMES,
  QUESTION_PROMPT_MAX_GRAPHEMES,
  applyQuizImportTextLimits,
  assertQuizTextWithinLimits,
  graphemeCount,
  shrinkQuizPackToFit,
  textLimitTone,
  truncateGraphemes,
  truncateUntilFits,
} from "./quizTextLimits.js";

function packWith(questions: Array<{ prompt: string; choices: string[] }>): QuizPack {
  return {
    id: "limits",
    title: "Limites",
    version: 1,
    rounds: [
      {
        kind: "free_buzz",
        id: "oral",
        title: "Oral",
        playerPrompt: "Parlez",
      },
      {
        id: "quiz",
        title: "Quiz",
        questions: questions.map((question, index) => ({
          id: `q${index + 1}`,
          prompt: question.prompt,
          choices: question.choices,
          correctIndex: 0,
          points: 1,
        })),
      },
    ],
  };
}

describe("grapheme guardrail", () => {
  it("counts an emoji and an accent as one grapheme", () => {
    expect(graphemeCount("🎉")).toBe(1);
    expect(graphemeCount("é")).toBe(1);
    expect(graphemeCount(`${"a".repeat(139)}🎉`)).toBe(140);
  });

  it("keeps the ellipsis inside the limit and does not split an emoji", () => {
    const cut = truncateGraphemes(`${"a".repeat(139)}🎉b`, QUESTION_PROMPT_MAX_GRAPHEMES);
    expect(cut.truncated).toBe(true);
    expect(cut.text).toBe(`${"a".repeat(139)}…`);
    expect(graphemeCount(cut.text)).toBeLessThanOrEqual(QUESTION_PROMPT_MAX_GRAPHEMES);
    expect(cut.text.includes("🎉")).toBe(false);
  });

  it("cuts a ZIP guardrail on graphemes, even in the middle of a word", () => {
    const cut = truncateGraphemes("abcde ".repeat(40), 10);
    expect(cut.truncated).toBe(true);
    expect(cut.text.endsWith("…")).toBe(true);
    expect(graphemeCount(cut.text)).toBe(10);
  });

  it("turns the counter orange from 85% and red past the limit", () => {
    expect(textLimitTone(118, QUESTION_PROMPT_MAX_GRAPHEMES)).toBe("ok");
    expect(textLimitTone(119, QUESTION_PROMPT_MAX_GRAPHEMES)).toBe("warn");
    expect(textLimitTone(141, QUESTION_PROMPT_MAX_GRAPHEMES)).toBe("over");
  });

  it("refuses a pack past the grapheme guardrail", () => {
    const pack = packWith([{ prompt: "é".repeat(141), choices: ["Oui", "Non"] }]);
    expect(() => assertQuizTextWithinLimits(pack)).toThrow(/dépasse/);
    try {
      assertQuizTextWithinLimits(pack);
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("QUIZ_TEXT_TOO_LONG");
    }
  });
});

describe("ZIP text notices", () => {
  it("numbers quiz questions only and reports a prompt, an answer and a new duplicate", () => {
    const longChoiceA = `${"A".repeat(119)}YZ`;
    const longChoiceB = `${"A".repeat(119)}YQ`;
    const pack = packWith([
      { prompt: "Courte ?", choices: ["Oui", "Non"] },
      {
        prompt: `${"é".repeat(140)}🎉`,
        choices: [longChoiceA, longChoiceB],
      },
    ]);
    const limited = applyQuizImportTextLimits(pack);
    const quiz = limited.pack.rounds[1];
    if (quiz === undefined || !("questions" in quiz)) throw new Error("expected a quiz round");
    expect(graphemeCount(quiz.questions[1]!.prompt)).toBeLessThanOrEqual(QUESTION_PROMPT_MAX_GRAPHEMES);
    expect(quiz.questions[1]!.prompt.endsWith("…")).toBe(true);
    expect(quiz.questions[1]!.choices[0]).toBe(`${"A".repeat(119)}…`);
    expect(quiz.questions[1]!.choices[1]).toBe(`${"A".repeat(119)}…`);
    expect(graphemeCount(quiz.questions[1]!.choices[0]!)).toBeLessThanOrEqual(ANSWER_CHOICE_MAX_GRAPHEMES);
    expect(limited.notices.map((notice) => notice.message)).toEqual([
      "Attention, la question 2 dépasse la taille autorisée",
      "Attention, une réponse de la question 2 dépasse la taille autorisée",
      "Attention, la question 2 a des réponses devenues identiques après troncature : à corriger",
    ]);
  });

  it("does not flag answers that were already identical", () => {
    const pack = packWith([{ prompt: "Déjà ?", choices: ["Pareil", "Pareil"] }]);
    const limited = applyQuizImportTextLimits(pack);
    expect(limited.notices).toEqual([]);
  });
});

describe("truncateUntilFits", () => {
  it("keeps the last whole word that fits, then cuts a single word on a grapheme", () => {
    const words = truncateUntilFits("alpha beta gamma", (candidate) => candidate.length <= "alpha beta…".length);
    expect(words).toEqual({ text: "alpha beta…", truncated: true });

    const glyphs = truncateUntilFits("Supercalifragilistic", (candidate) => candidate.length <= 6);
    expect(glyphs).toEqual({ text: "Super…", truncated: true });
  });

  it("leaves a text that already fits", () => {
    expect(truncateUntilFits("Oui", () => true)).toEqual({ text: "Oui", truncated: false });
  });
});

describe("preview remeasure", () => {
  const widthOf = (text: string, fontPx: number): number => text.length * fontPx * 0.5;

  it("fits a long answer in one column and rejects it when a fifth answer narrows the cells", () => {
    const word = "A".repeat(30);
    const four = assessQuestionFields("Question courte", [word, word, "Oui", "Non"], widthOf);
    const five = assessQuestionFields("Question courte", [word, word, "Oui", "Non", "Peut-etre"], widthOf);
    expect(previewFieldBoxes(5).choice.widthPx).toBeLessThan(previewFieldBoxes(4).choice.widthPx);
    expect(previewFieldBoxes(5).prompt).toEqual(previewFieldBoxes(4).prompt);
    expect(four.prompt).toBe(true);
    expect(four.choices).toEqual([true, true, true, true]);
    expect(five.prompt).toBe(true);
    expect(five.choices[0]).toBe(false);
    expect(five.choices[1]).toBe(false);
    expect(five.choices[2]).toBe(true);
  });

  it("truncates every answer again for the narrower grid and reports identical results", () => {
    const pack = packWith([
      {
        prompt: "Laquelle ?",
        choices: [
          "alpha beta one",
          "alpha beta two",
          "alpha beta three",
          "alpha beta four",
          "alpha beta five",
        ],
      },
    ]);
    const shrunk = shrinkQuizPackToFit(pack, (query) => {
      if (query.field === "prompt") return query.text.length <= 80;
      const limit = query.choiceCount >= 5 ? 12 : 80;
      return query.text.length <= limit;
    });
    const quiz = shrunk.pack.rounds[1];
    if (quiz === undefined || !("questions" in quiz)) throw new Error("expected a quiz round");
    expect(quiz.questions[0]!.choices).toEqual([
      "alpha beta…",
      "alpha beta…",
      "alpha beta…",
      "alpha beta…",
      "alpha beta…",
    ]);
    expect(shrunk.notices.map((notice) => notice.kind)).toEqual(["choice", "duplicate_choices"]);
    expect(shrunk.notices[0]?.message).toBe("Attention, une réponse de la question 1 dépasse la taille autorisée");
    expect(shrunk.notices[1]?.message).toBe(
      "Attention, la question 1 a des réponses devenues identiques après troncature : à corriger",
    );
  });
});
