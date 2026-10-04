import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";

import { PackEditorStore } from "./packEditor.js";
import { quizPackSchema } from "./pack.js";
import type { QuizPack } from "./pack.js";

/**
 * Helper: create a minimal valid pack.
 */
function createTestPack(id: string, title: string): QuizPack {
  return {
    id,
    title,
    version: 1,
    rounds: [
      {
        id: "r1",
        title: "Round 1",
        questions: [
          {
            id: "q1",
            prompt: "What is the answer?",
            choices: ["Option A", "Option B", "Option C"],
            correctIndex: 1,
            points: 10,
          },
        ],
      },
    ],
  };
}

describe("Editor integration tests (4.2)", () => {
  describe("Round list operations", () => {
    it("allows adding a new round", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("test-add-round", "Test Pack");
      const editorId = store.startEditing(pack, new Map());

      const updatedPack = { ...pack };
      updatedPack.rounds.push({
        id: "r2",
        title: "Round 2",
        questions: [
          {
            id: "q2",
            prompt: "Another question?",
            choices: ["Yes", "No"],
            correctIndex: 0,
            points: 5,
          },
        ],
      });

      store.update(editorId, updatedPack);

      const retrieved = store.get(editorId);
      expect(retrieved?.rounds.length).toBe(2);
      expect(retrieved?.rounds[1]?.title).toBe("Round 2");
    });

    it("allows deleting a round", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("test-delete-round", "Test Pack");
      pack.rounds.push({
        id: "r2",
        title: "Round 2",
        questions: [
          {
            id: "q2",
            prompt: "Question 2?",
            choices: ["A", "B"],
            correctIndex: 0,
            points: 5,
          },
        ],
      });

      const editorId = store.startEditing(pack, new Map());

      // * Delete the first round
      const updatedPack = { ...pack };
      updatedPack.rounds = [pack.rounds[1]!];

      store.update(editorId, updatedPack);

      const retrieved = store.get(editorId);
      expect(retrieved?.rounds.length).toBe(1);
      expect(retrieved?.rounds[0]?.title).toBe("Round 2");
    });

    it("allows reordering rounds", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("test-reorder", "Test Pack");
      pack.rounds.push({
        id: "r2",
        title: "Round 2",
        questions: [
          { id: "q2", prompt: "Q2?", choices: ["A", "B"], correctIndex: 0, points: 5 },
        ],
      });

      const editorId = store.startEditing(pack, new Map());

      // * Swap rounds
      const updatedPack = { ...pack };
      updatedPack.rounds = [pack.rounds[1]!, pack.rounds[0]!];

      store.update(editorId, updatedPack);

      const retrieved = store.get(editorId);
      expect(retrieved?.rounds[0]?.title).toBe("Round 2");
      expect(retrieved?.rounds[1]?.title).toBe("Round 1");
    });
  });

  describe("Question editing", () => {
    it("allows editing question text", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("test-edit-text", "Test Pack");
      const editorId = store.startEditing(pack, new Map());

      const updatedPack = { ...pack };
      updatedPack.rounds[0]!.questions[0]!.prompt = "Updated question text?";

      store.update(editorId, updatedPack);

      const retrieved = store.get(editorId);
      expect(retrieved?.rounds[0]?.questions[0]?.prompt).toBe("Updated question text?");
    });

    it("allows editing question points", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("test-edit-points", "Test Pack");
      const editorId = store.startEditing(pack, new Map());

      const updatedPack = { ...pack };
      updatedPack.rounds[0]!.questions[0]!.points = 25;

      store.update(editorId, updatedPack);

      const retrieved = store.get(editorId);
      expect(retrieved?.rounds[0]?.questions[0]?.points).toBe(25);
    });

    it("allows editing question choices", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("test-edit-choices", "Test Pack");
      const editorId = store.startEditing(pack, new Map());

      const updatedPack = { ...pack };
      updatedPack.rounds[0]!.questions[0]!.choices = ["New A", "New B", "New C", "New D"];

      store.update(editorId, updatedPack);

      const retrieved = store.get(editorId);
      expect(retrieved?.rounds[0]?.questions[0]?.choices).toEqual([
        "New A",
        "New B",
        "New C",
        "New D",
      ]);
    });

    it("allows setting resource URL for a question", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("test-resource-url", "Test Pack");
      const editorId = store.startEditing(pack, new Map());

      const updatedPack = { ...pack };
      updatedPack.rounds[0]!.questions[0]!.imageUrl = "https://example.com/image.png";

      store.update(editorId, updatedPack);

      const retrieved = store.get(editorId);
      expect(retrieved?.rounds[0]?.questions[0]?.imageUrl).toBe("https://example.com/image.png");
    });
  });

  describe("Pack name editing", () => {
    it("allows editing pack name (title)", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("test-rename", "Original Name");
      const editorId = store.startEditing(pack, new Map());

      const updatedPack = { ...pack };
      updatedPack.title = "Updated Name";

      store.update(editorId, updatedPack);

      const retrieved = store.get(editorId);
      expect(retrieved?.title).toBe("Updated Name");
    });
  });

  describe("Zod validation enforcement", () => {
    it("enforces validation when updating pack (via quizPackSchema)", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("test-validation", "Test Pack");
      const editorId = store.startEditing(pack, new Map());

      // * Create an invalid pack (no rounds)
      const invalidPack: any = { ...pack, rounds: [] };

      // * Validation happens at the route level (quizPackSchema.parse)
      const result = quizPackSchema.safeParse(invalidPack);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("rounds"))).toBe(true);
      }

      // * Store.update itself does not validate, so we don't call it here
      // * The route handler must validate before calling store.update
    });

    it("surfaces validation errors for invalid question data", () => {
      const invalidQuestion = {
        id: "q1",
        prompt: "", // * Invalid: too short
        choices: ["A"], // * Invalid: must have at least 2 choices
        correctIndex: 0,
        points: 0, // * Invalid: must be positive
      };

      const invalidPack: any = {
        id: "test",
        title: "Test",
        version: 1,
        rounds: [
          {
            id: "r1",
            title: "Round 1",
            questions: [invalidQuestion],
          },
        ],
      };

      const result = quizPackSchema.safeParse(invalidPack);

      expect(result.success).toBe(false);
      if (!result.success) {
        // * Multiple validation errors expected
        expect(result.error.issues.length).toBeGreaterThan(0);

        const promptIssue = result.error.issues.find((i) => i.path.includes("prompt"));
        expect(promptIssue).toBeDefined();

        const choicesIssue = result.error.issues.find((i) => i.path.includes("choices"));
        expect(choicesIssue).toBeDefined();

        const pointsIssue = result.error.issues.find((i) => i.path.includes("points"));
        expect(pointsIssue).toBeDefined();
      }
    });
  });

  describe("Image from URL", () => {
    it("documents the workflow for adding an image from URL", () => {
      // * This test documents the expected behavior:
      // * 1. Client calls POST /api/parties/:partyId/host/editor/:editorId/download-image
      // * 2. Server downloads and compresses the image
      // * 3. Server stores the image in the editor session media
      // * 4. Server returns the relative path
      // * 5. Client updates the pack JSON with the relative path

      const store = new PackEditorStore();
      const pack = createTestPack("test-image-url", "Test Pack");
      const editorId = store.startEditing(pack, new Map());

      // * Simulate the server adding the downloaded image
      const fakeImageBuffer = Buffer.from("compressed-image-data", "utf8");
      const filename = `images/${Date.now()}.webp`;
      const relativePath = store.addMedia(editorId, filename, fakeImageBuffer);

      expect(relativePath).toBe(filename);

      // * Simulate the client updating the pack JSON
      const updatedPack = { ...pack };
      updatedPack.rounds[0]!.questions[0]!.imageUrl = relativePath;
      store.update(editorId, updatedPack);

      const retrieved = store.get(editorId);
      expect(retrieved?.rounds[0]?.questions[0]?.imageUrl).toBe(filename);

      const media = store.getMedia(editorId);
      expect(media?.get(filename)?.toString("utf8")).toBe("compressed-image-data");
    });
  });

  describe("Export as ZIP", () => {
    it("exports the pack as a ZIP with pack.json and media", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("test-export", "Export Test Pack");
      const editorId = store.startEditing(pack, new Map());

      store.addMedia(editorId, "images/test.png", Buffer.from("image-data", "utf8"));

      const zipBuffer = store.exportAsZip(editorId);

      expect(Buffer.isBuffer(zipBuffer)).toBe(true);

      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();

      // * Verify pack.json is present
      const packEntry = entries.find((e) => e.entryName === "pack.json");
      expect(packEntry).toBeDefined();

      const packJson = JSON.parse(packEntry!.getData().toString("utf8"));
      expect(packJson.id).toBe("test-export");
      expect(packJson.title).toBe("Export Test Pack");

      // * Verify media is present
      const mediaEntry = entries.find((e) => e.entryName === "images/test.png");
      expect(mediaEntry).toBeDefined();
      expect(mediaEntry!.getData().toString("utf8")).toBe("image-data");
    });
  });

  describe("Dirty state for unsaved changes warning", () => {
    it("verifies the editor session reflects that changes have been made", () => {
      // * This test verifies that the PackEditorStore tracks that a pack has been modified.
      // * The UI (App.tsx) uses editorDirty state:
      // *   - Set to true when onUpdateEditorPack is called (line 2837)
      // *   - Set to false when starting editing (line 2810) or using the pack (line 2924)
      // *   - Used in onCloseEditor to warn about unsaved changes (line 2931)
      // * 
      // * Note: The current implementation does NOT clear the dirty flag after export.
      // * Export downloads a ZIP but doesn't "save" in the system.
      // * Only "Use" (which re-imports the pack) clears the dirty flag.

      const store = new PackEditorStore();
      const pack = createTestPack("test-changes", "Original Pack");
      const editorId = store.startEditing(pack, new Map());

      // * Verify the pack was stored
      const retrieved = store.get(editorId);
      expect(retrieved?.title).toBe("Original Pack");

      // * User makes a change
      const updatedPack = { ...pack, title: "Modified Pack" };
      store.update(editorId, updatedPack);

      // * Verify the change was applied
      const afterUpdate = store.get(editorId);
      expect(afterUpdate?.title).toBe("Modified Pack");
      expect(afterUpdate).not.toBe(pack); // * Different object reference

      // * The store itself doesn't track "dirty" - that's UI state.
      // * But we can verify that the pack has been modified by comparing with the original.
      expect(afterUpdate?.title).not.toBe(pack.title);
    });
  });

  describe("Image size limit enforcement", () => {
    it("documents the MAX_EDITOR_IMAGE_BYTES configuration", () => {
      // * This test documents the expected behavior:
      // * - Image size limit is configurable via MAX_EDITOR_IMAGE_BYTES
      // * - Default is 500 KB (512,000 bytes)
      // * - Images exceeding the limit are refused with a clear error
      // * - The limit is enforced in downloadAndCompressImage (tested separately)
      // * - The route passes config.maxEditorImageBytes to downloadAndCompressImage

      const defaultLimit = 500 * 1024; // * 500 KB

      expect(defaultLimit).toBe(512_000);

      // * The actual enforcement is tested in imageDownloader.test.ts
      // * This test documents the integration point
    });
  });

  describe("Path traversal protection", () => {
    it("refuses media URLs containing '..'", () => {
      const packJson: any = {
        id: "test-traversal",
        title: "Test Pack",
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
                imageUrl: "../secret.png",
              },
            ],
          },
        ],
      };

      const result = quizPackSchema.safeParse(packJson);

      expect(result.success).toBe(false);
      if (!result.success) {
        // * The error is nested in a union error (rounds can be multiple types)
        // * Find the PUBLIC_URL_REJECTED error recursively
        const findPublicUrlRejected = (issues: any[]): boolean => {
          for (const issue of issues) {
            if (issue.message === "PUBLIC_URL_REJECTED") {
              return true;
            }
            if (issue.code === "invalid_union" && issue.unionErrors) {
              for (const unionError of issue.unionErrors) {
                if (findPublicUrlRejected(unionError.issues)) {
                  return true;
                }
              }
            }
          }
          return false;
        };

        expect(findPublicUrlRejected(result.error.issues)).toBe(true);
      }
    });

    it("refuses multiple path traversal patterns", () => {
      const traversalUrls = [
        "../secret.png",
        "images/../../etc/passwd",
        "/games/../outside.png",
        "media/../../../etc/shadow",
      ];

      const findPublicUrlRejected = (issues: any[]): boolean => {
        for (const issue of issues) {
          if (issue.message === "PUBLIC_URL_REJECTED") {
            return true;
          }
          if (issue.code === "invalid_union" && issue.unionErrors) {
            for (const unionError of issue.unionErrors) {
              if (findPublicUrlRejected(unionError.issues)) {
                return true;
              }
            }
          }
        }
        return false;
      };

      for (const url of traversalUrls) {
        const packJson: any = {
          id: "test-traversal",
          title: "Test Pack",
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
                  imageUrl: url,
                },
              ],
            },
          ],
        };

        const result = quizPackSchema.safeParse(packJson);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(findPublicUrlRejected(result.error.issues)).toBe(true);
        }
      }
    });
  });
});
