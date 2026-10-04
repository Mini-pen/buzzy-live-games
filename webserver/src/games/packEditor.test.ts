import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";

import { PackEditorStore } from "./packEditor.js";
import type { QuizPack } from "./pack.js";

/**
 * Helper: create a minimal valid pack JSON structure.
 */
function createTestPack(id: string): QuizPack {
  return {
    id,
    title: `Pack ${id}`,
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
          },
        ],
      },
    ],
  };
}

describe("PackEditorStore", () => {
  describe("startEditing", () => {
    it("starts an editor session and returns a session ID", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("test-pack");
      const media = new Map<string, Buffer>();

      const editorId = store.startEditing(pack, media);

      expect(editorId).toBeTruthy();
      expect(typeof editorId).toBe("string");
    });

    it("clones the pack (mutations do not affect the original)", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("clone-test");
      const editorId = store.startEditing(pack, new Map());

      const retrieved = store.get(editorId);
      expect(retrieved).not.toBe(pack); // * Different object references
      expect(retrieved?.id).toBe(pack.id);

      // * Mutate the retrieved pack
      retrieved!.title = "Modified Title";

      // * Original pack is unchanged
      expect(pack.title).toBe("Pack clone-test");
    });

    it("clones the media map (mutations do not affect the original)", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("media-clone-test");
      const media = new Map<string, Buffer>([["img.png", Buffer.from("data", "utf8")]]);
      const editorId = store.startEditing(pack, media);

      const retrieved = store.getMedia(editorId);
      expect(retrieved).not.toBe(media); // * Different map instance
      expect(retrieved?.get("img.png")?.toString("utf8")).toBe("data");

      // * Mutate the retrieved media
      retrieved!.set("new.png", Buffer.from("new-data", "utf8"));

      // * Original media map is unchanged
      expect(media.has("new.png")).toBe(false);
    });
  });

  describe("get", () => {
    it("retrieves the pack being edited", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("get-test");
      const editorId = store.startEditing(pack, new Map());

      const retrieved = store.get(editorId);

      expect(retrieved?.id).toBe("get-test");
      expect(retrieved?.title).toBe("Pack get-test");
    });

    it("returns undefined for unknown session ID", () => {
      const store = new PackEditorStore();

      const retrieved = store.get("unknown-session-id");

      expect(retrieved).toBeUndefined();
    });
  });

  describe("update", () => {
    it("updates the pack being edited", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("update-test");
      const editorId = store.startEditing(pack, new Map());

      const updatedPack = { ...pack, title: "Updated Pack" };
      store.update(editorId, updatedPack);

      const retrieved = store.get(editorId);
      expect(retrieved?.title).toBe("Updated Pack");
    });

    it("throws an error for unknown session ID", () => {
      const store = new PackEditorStore();

      expect(() => store.update("unknown", createTestPack("x"))).toThrow("Editor session not found");
    });

    it("clones the updated pack (mutations do not affect the stored version)", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("update-clone-test");
      const editorId = store.startEditing(pack, new Map());

      const updatedPack = { ...pack, title: "Updated" };
      store.update(editorId, updatedPack);

      // * Mutate the updatedPack after update
      updatedPack.title = "Mutated";

      const retrieved = store.get(editorId);
      expect(retrieved?.title).toBe("Updated"); // * Not "Mutated"
    });
  });

  describe("addMedia", () => {
    it("adds a media file and returns the filename", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("add-media-test");
      const editorId = store.startEditing(pack, new Map());

      const filename = "images/test.png";
      const buffer = Buffer.from("image-data", "utf8");

      const relativePath = store.addMedia(editorId, filename, buffer);

      expect(relativePath).toBe(filename);

      const media = store.getMedia(editorId);
      expect(media?.get(filename)?.toString("utf8")).toBe("image-data");
    });

    it("throws an error for unknown session ID", () => {
      const store = new PackEditorStore();

      expect(() => store.addMedia("unknown", "img.png", Buffer.alloc(10))).toThrow(
        "Editor session not found",
      );
    });

    it("allows multiple media files", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("multi-media-test");
      const editorId = store.startEditing(pack, new Map());

      store.addMedia(editorId, "img1.png", Buffer.from("data1", "utf8"));
      store.addMedia(editorId, "img2.png", Buffer.from("data2", "utf8"));

      const media = store.getMedia(editorId);
      expect(media?.size).toBe(2);
      expect(media?.get("img1.png")?.toString("utf8")).toBe("data1");
      expect(media?.get("img2.png")?.toString("utf8")).toBe("data2");
    });

    it("overwrites media with the same filename", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("overwrite-test");
      const editorId = store.startEditing(pack, new Map());

      store.addMedia(editorId, "img.png", Buffer.from("original", "utf8"));
      store.addMedia(editorId, "img.png", Buffer.from("overwritten", "utf8"));

      const media = store.getMedia(editorId);
      expect(media?.size).toBe(1);
      expect(media?.get("img.png")?.toString("utf8")).toBe("overwritten");
    });
  });

  describe("exportAsZip", () => {
    it("exports the pack as a ZIP buffer", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("export-test");
      const editorId = store.startEditing(pack, new Map());

      const zipBuffer = store.exportAsZip(editorId);

      expect(Buffer.isBuffer(zipBuffer)).toBe(true);
      expect(zipBuffer.length).toBeGreaterThan(0);

      // * Verify the ZIP contains pack.json
      const zip = new AdmZip(zipBuffer);
      const packEntry = zip.getEntry("pack.json");
      expect(packEntry).not.toBeNull();

      const packJson = JSON.parse(packEntry!.getData().toString("utf8"));
      expect(packJson.id).toBe("export-test");
    });

    it("exports media files in the ZIP", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("export-media-test");
      const editorId = store.startEditing(pack, new Map());

      store.addMedia(editorId, "images/test.png", Buffer.from("image-data", "utf8"));

      const zipBuffer = store.exportAsZip(editorId);
      const zip = new AdmZip(zipBuffer);

      const mediaEntry = zip.getEntry("images/test.png");
      expect(mediaEntry).not.toBeNull();
      expect(mediaEntry!.getData().toString("utf8")).toBe("image-data");
    });

    it("throws an error for unknown session ID", () => {
      const store = new PackEditorStore();

      expect(() => store.exportAsZip("unknown")).toThrow("Editor session not found");
    });
  });

  describe("close", () => {
    it("closes an editor session and frees memory", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("close-test");
      const editorId = store.startEditing(pack, new Map());

      expect(store.get(editorId)).toBeDefined();

      store.close(editorId);

      expect(store.get(editorId)).toBeUndefined();
    });

    it("does not throw for unknown session ID (idempotent)", () => {
      const store = new PackEditorStore();

      expect(() => store.close("unknown")).not.toThrow();
    });
  });

  describe("getMedia", () => {
    it("retrieves all media files for a session", () => {
      const store = new PackEditorStore();
      const pack = createTestPack("get-media-test");
      const editorId = store.startEditing(pack, new Map());

      store.addMedia(editorId, "img1.png", Buffer.from("data1", "utf8"));
      store.addMedia(editorId, "img2.png", Buffer.from("data2", "utf8"));

      const media = store.getMedia(editorId);

      expect(media?.size).toBe(2);
      expect(media?.get("img1.png")?.toString("utf8")).toBe("data1");
      expect(media?.get("img2.png")?.toString("utf8")).toBe("data2");
    });

    it("returns undefined for unknown session ID", () => {
      const store = new PackEditorStore();

      const media = store.getMedia("unknown");

      expect(media).toBeUndefined();
    });
  });
});

describe("PackEditorStore · session-scoped (not persistent)", () => {
  it("does not persist across store instances (conceptual test)", () => {
    const store1 = new PackEditorStore();
    const pack = createTestPack("ephemeral");
    const editorId = store1.startEditing(pack, new Map());

    expect(store1.get(editorId)).toBeDefined();

    // * Simulate a new store instance (e.g. after server restart)
    const store2 = new PackEditorStore();
    expect(store2.get(editorId)).toBeUndefined();
  });
});

describe("Export and edit stay out of games/", () => {
  it("does not write to the games/ directory", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    // * Find the real games/ directory
    const gamesDir = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "..",
      "..",
      "..",
      "games",
    );

    // * Snapshot the games/ directory before editing
    async function snapshotDirectory(dir: string): Promise<Set<string>> {
      const files = new Set<string>();
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
        for (const entry of entries) {
          const relativePath = path.relative(
            dir,
            path.join(entry.path ?? entry.parentPath ?? "", entry.name),
          );
          files.add(relativePath);
        }
      } catch {
        // * Directory may not exist or be inaccessible
      }
      return files;
    }

    const beforeFiles = await snapshotDirectory(gamesDir);

    // * Perform editor operations
    const store = new PackEditorStore();
    const pack = createTestPack("no-disk-write");
    const editorId = store.startEditing(pack, new Map());

    store.addMedia(editorId, "images/test.png", Buffer.from("image-data", "utf8"));
    store.update(editorId, { ...pack, title: "Updated" });
    const zipBuffer = store.exportAsZip(editorId);
    store.close(editorId);

    // * Snapshot the games/ directory after editing
    const afterFiles = await snapshotDirectory(gamesDir);

    // * Verify that NO new files were added to games/
    const newFiles = [...afterFiles].filter((f) => !beforeFiles.has(f));
    if (newFiles.length > 0) {
      throw new Error(`FAIL: Editor wrote files to games/: ${newFiles.join(", ")}`);
    }

    expect(afterFiles.size).toBe(beforeFiles.size);
    expect(zipBuffer.length).toBeGreaterThan(0); // * Export succeeded
  });
});
