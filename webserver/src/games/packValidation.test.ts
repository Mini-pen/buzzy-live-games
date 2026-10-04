import { describe, expect, it } from "vitest";
import { z } from "zod";

import { quizPackSchema, optionalPublicUrlSchema } from "./pack.js";
import type { QuizPack } from "./pack.js";

/**
 * Helper: create a minimal valid pack.
 */
function createValidPack(): QuizPack {
  return {
    id: "test-pack",
    title: "Test Pack",
    version: 1,
    rounds: [
      {
        id: "r1",
        title: "Round 1",
        questions: [
          {
            id: "q1",
            prompt: "What is 2+2?",
            choices: ["3", "4", "5"],
            correctIndex: 1,
            points: 10,
          },
        ],
      },
    ],
  };
}

describe("quizPackSchema validation", () => {
  describe("valid packs", () => {
    it("accepts a minimal valid pack", () => {
      const pack = createValidPack();

      const result = quizPackSchema.safeParse(pack);

      expect(result.success).toBe(true);
    });

    it("accepts a pack with image URLs", () => {
      const pack: QuizPack = {
        id: "image-pack",
        title: "Pack with Images",
        version: 1,
        rounds: [
          {
            id: "r1",
            title: "Round 1",
            questions: [
              {
                id: "q1",
                prompt: "Question?",
                choices: ["A", "B"],
                correctIndex: 0,
                points: 1,
                imageUrl: "https://example.com/img.png",
              },
            ],
          },
        ],
      };

      const result = quizPackSchema.safeParse(pack);

      expect(result.success).toBe(true);
    });

    it("accepts a pack with multiple rounds", () => {
      const pack: QuizPack = {
        id: "multi-round",
        title: "Multi Round Pack",
        version: 1,
        rounds: [
          {
            id: "r1",
            title: "Round 1",
            questions: [
              { id: "q1", prompt: "Q1?", choices: ["A", "B"], correctIndex: 0, points: 1 },
            ],
          },
          {
            id: "r2",
            title: "Round 2",
            questions: [
              { id: "q2", prompt: "Q2?", choices: ["C", "D"], correctIndex: 1, points: 2 },
            ],
          },
        ],
      };

      const result = quizPackSchema.safeParse(pack);

      expect(result.success).toBe(true);
    });
  });

  describe("validation errors", () => {
    it("rejects pack without id", () => {
      const pack = { ...createValidPack(), id: "" };

      const result = quizPackSchema.safeParse(pack);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("id"))).toBe(true);
      }
    });

    it("rejects pack without title", () => {
      const pack = { ...createValidPack(), title: "" };

      const result = quizPackSchema.safeParse(pack);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("title"))).toBe(true);
      }
    });

    it("rejects pack with invalid version", () => {
      const pack = { ...createValidPack(), version: 0 };

      const result = quizPackSchema.safeParse(pack);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("version"))).toBe(true);
      }
    });

    it("rejects pack with no rounds", () => {
      const pack = { ...createValidPack(), rounds: [] };

      const result = quizPackSchema.safeParse(pack);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("rounds"))).toBe(true);
      }
    });

    it("rejects round with no questions", () => {
      const pack: any = {
        ...createValidPack(),
        rounds: [{ id: "r1", title: "Round 1", questions: [] }],
      };

      const result = quizPackSchema.safeParse(pack);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("questions"))).toBe(true);
      }
    });

    it("rejects question with less than 2 choices", () => {
      const pack: any = {
        ...createValidPack(),
        rounds: [
          {
            id: "r1",
            title: "Round 1",
            questions: [
              { id: "q1", prompt: "Q?", choices: ["A"], correctIndex: 0, points: 1 },
            ],
          },
        ],
      };

      const result = quizPackSchema.safeParse(pack);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("choices"))).toBe(true);
      }
    });

    it("rejects question with invalid correctIndex", () => {
      const pack: any = {
        ...createValidPack(),
        rounds: [
          {
            id: "r1",
            title: "Round 1",
            questions: [
              { id: "q1", prompt: "Q?", choices: ["A", "B"], correctIndex: -1, points: 1 },
            ],
          },
        ],
      };

      const result = quizPackSchema.safeParse(pack);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("correctIndex"))).toBe(true);
      }
    });

    it("rejects question with zero or negative points", () => {
      const pack: any = {
        ...createValidPack(),
        rounds: [
          {
            id: "r1",
            title: "Round 1",
            questions: [
              { id: "q1", prompt: "Q?", choices: ["A", "B"], correctIndex: 0, points: 0 },
            ],
          },
        ],
      };

      const result = quizPackSchema.safeParse(pack);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("points"))).toBe(true);
      }
    });
  });
});

describe("optionalPublicUrlSchema validation", () => {
  describe("valid URLs", () => {
    const validUrls = [
      "https://example.com/img.png",
      "https://cdn.example.com/path/to/image.jpg",
      "/avatars/player1.png",
      "/games/video/clip.mp4",
      "games/image.png", // * Will be transformed to /games/image.png
      "http://localhost:3000/img.png",
      "http://127.0.0.1:3000/img.png",
    ];

    for (const url of validUrls) {
      it(`accepts valid URL: ${url}`, () => {
        const result = optionalPublicUrlSchema.safeParse(url);

        expect(result.success).toBe(true);
      });
    }

    it("transforms games/ prefix to /games/", () => {
      const result = optionalPublicUrlSchema.safeParse("games/image.png");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("/games/image.png");
      }
    });
  });

  describe("forbidden URLs", () => {
    it("rejects URLs with path traversal (..)", () => {
      const traversalUrls = [
        "../secret.png",
        "images/../../etc/passwd",
        "/games/../outside.png",
      ];

      for (const url of traversalUrls) {
        const result = optionalPublicUrlSchema.safeParse(url);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toBe("PUBLIC_URL_REJECTED");
        }
      }
    });

    it("rejects javascript: URLs", () => {
      const jsUrls = ["javascript:alert(1)", "  javascript:void(0)  "];

      for (const url of jsUrls) {
        const result = optionalPublicUrlSchema.safeParse(url);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toBe("PUBLIC_URL_REJECTED");
        }
      }
    });

    it("rejects other non-http/https protocols", () => {
      const invalidProtocolUrls = ["ftp://example.com/img.png", "file:///etc/passwd"];

      for (const url of invalidProtocolUrls) {
        const result = optionalPublicUrlSchema.safeParse(url);

        expect(result.success).toBe(false);
      }
    });

    it("rejects URLs exceeding max length (4096 chars)", () => {
      const tooLong = "https://example.com/" + "a".repeat(4096);

      const result = optionalPublicUrlSchema.safeParse(tooLong);

      expect(result.success).toBe(false);
    });
  });
});

describe("Validation errors are surfaced", () => {
  it("documents that Zod validation errors contain structured issue information", () => {
    // * This test documents the expected behavior:
    // * - Zod validation errors are surfaced via error.issues
    // * - Each issue contains path, message, and code
    // * - The UI can use this to show red error messages (test the validation result, not CSS)

    const invalidPack = {
      id: "", // * Invalid: too short
      title: "Test",
      version: 1,
      rounds: [
        {
          id: "r1",
          title: "Round 1",
          questions: [
            {
              id: "q1",
              prompt: "", // * Invalid: too short
              choices: ["A"], // * Invalid: must have at least 2 choices
              correctIndex: 0,
              points: 0, // * Invalid: must be positive
            },
          ],
        },
      ],
    };

    const result = quizPackSchema.safeParse(invalidPack);

    expect(result.success).toBe(false);
    if (!result.success) {
      // * Verify error structure
      expect(result.error.issues.length).toBeGreaterThan(0);

      const idIssue = result.error.issues.find((i) => i.path.includes("id"));
      expect(idIssue).toBeDefined();
      expect(idIssue?.message).toBeTruthy();

      const promptIssue = result.error.issues.find((i) => i.path.includes("prompt"));
      expect(promptIssue).toBeDefined();

      const choicesIssue = result.error.issues.find((i) => i.path.includes("choices"));
      expect(choicesIssue).toBeDefined();

      const pointsIssue = result.error.issues.find((i) => i.path.includes("points"));
      expect(pointsIssue).toBeDefined();
    }
  });
});
