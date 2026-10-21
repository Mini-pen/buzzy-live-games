import { describe, expect, it } from "vitest";

import { answerGrid, playStageMetrics } from "./playLayout.js";
import { quizChoiceRowClass, quizChoiceVoteLabel } from "./questionReveal.js";

describe("quiz result labels", () => {
  it("shows 0 (0%) for every answer when nobody has answered", () => {
    expect(quizChoiceVoteLabel(0, 0)).toBe("0 (0%)");
    expect(quizChoiceVoteLabel(-1, 0)).toBe("0 (0%)");
    expect(quizChoiceVoteLabel(Number.NaN, 0)).toBe("0 (0%)");
  });

  it("rounds each share on its own, so three equal answers can read 33%", () => {
    expect(quizChoiceVoteLabel(1, 3)).toBe("1 (33%)");
    expect(quizChoiceVoteLabel(1, 3)).toBe("1 (33%)");
    const labels = [0, 1, 2].map(() => quizChoiceVoteLabel(1, 3));
    expect(labels).toEqual(["1 (33%)", "1 (33%)", "1 (33%)"]);
    const sum = labels.reduce((total, label) => total + Number(label.match(/\((\d+)%\)/u)?.[1] ?? 0), 0);
    expect(sum).toBe(99);
  });

  it("keeps the yellow selection together with the green correct row", () => {
    expect(quizChoiceRowClass({ selected: true, correct: true })).toBe(
      "bz-choice bz-choice--correct bz-choice--selected",
    );
    expect(quizChoiceRowClass({ selected: true, correct: false })).toBe("bz-choice bz-choice--selected");
    expect(quizChoiceRowClass({ selected: false, correct: true })).toBe("bz-choice bz-choice--correct");
  });
});

describe("answer grid", () => {
  it("uses one column for 2 to 4 answers and a 2×3 grid for 5 or 6", () => {
    expect(answerGrid(2)).toEqual({ columns: 1, rows: 2 });
    expect(answerGrid(4)).toEqual({ columns: 1, rows: 4 });
    expect(answerGrid(5)).toEqual({ columns: 2, rows: 3 });
    expect(answerGrid(6)).toEqual({ columns: 2, rows: 3 });
  });

  it("keeps the question zone and the buzzer size when the answer count changes", () => {
    const four = playStageMetrics(640);
    const six = playStageMetrics(640);
    expect(six.zonePx).toBe(four.zonePx);
    expect(six.questionPx).toBe(four.questionPx);
    expect(six.buzzerPx).toBe(four.buzzerPx);
  });
});
