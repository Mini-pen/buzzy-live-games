import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { quizPackSchema, scanQuizPacks } from "./pack.js";

describe("scanQuizPacks", () => {
  test("indexes nested pack under guess_by_color/", async () => {
    const gamesDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "games",
    );
    const map = await scanQuizPacks(gamesDir);
    expect(map.has("guess_by_color/quiz_with_images")).toBe(true);
  });
});


describe("quizPackSchema · question.imageUrl", () => {
  const minimalRound = {
    id: "r",
    title: "T",
    questions: [
      {
        id: "q1",
        prompt: "Hello?",
        choices: ["A", "B"],
        correctIndex: 0,
        points: 1,
      },
    ],
  };

  test("accepts HTTPS and root-relative URLs", () => {
    const parsed = quizPackSchema.parse({
      id: "p",
      title: "Pack",
      version: 1,
      rounds: [
        {
          ...minimalRound,
          questions: [
            {
              ...minimalRound.questions[0],
              imageUrl: "/games/foo/bar.png",
            },
          ],
        },
      ],
    });
    expect(parsed.rounds[0]).toMatchObject({ id: "r" });
    const r0 = parsed.rounds[0];
    if (!("questions" in r0)) throw new Error("expected quiz round");
    expect(r0.questions[0]?.imageUrl).toBe("/games/foo/bar.png");
  });

  test("rejects traversal in imageUrl", () => {
    expect(() =>
      quizPackSchema.parse({
        id: "p",
        title: "Pack",
        version: 1,
        rounds: [
          {
            ...minimalRound,
            questions: [
              {
                ...minimalRound.questions[0],
                imageUrl: "/games/../secret",
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});
