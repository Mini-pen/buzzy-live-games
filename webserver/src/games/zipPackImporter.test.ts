import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";

import { DEFAULT_MAX_ZIP_BYTES, ImportedPackStore, importZipPack } from "./zipPackImporter.js";
import type { QuizPack } from "./pack.js";

/**
 * Helper: create a minimal valid pack JSON structure.
 */
function createMinimalPack(id: string): QuizPack {
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

/**
 * Helper: create a ZIP buffer containing a pack JSON and optional media files.
 */
function createZipBuffer(
  packJson: QuizPack,
  mediaFiles: Array<{ path: string; content: Buffer | string }> = [],
): Buffer {
  const zip = new AdmZip();
  zip.addFile("pack.json", Buffer.from(JSON.stringify(packJson, null, 2), "utf8"));
  for (const { path, content } of mediaFiles) {
    const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    zip.addFile(path, buf);
  }
  return zip.toBuffer();
}

describe("importZipPack", () => {
  it("accepts a valid ZIP with one JSON pack and its media", () => {
    const pack: QuizPack = {
      id: "test-pack",
      title: "Pack test-pack",
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
              imageUrl: "images/q1.png",
            },
          ],
        },
      ],
    };

    const zipBuffer = createZipBuffer(pack, [{ path: "images/q1.png", content: Buffer.alloc(100) }]);

    const result = importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set());

    expect(result.pack.id).toBe("test-pack");
    expect(result.pack.title).toBe("Pack test-pack");
    // * Relative path is prefixed to games/..., transformed to /games/..., then normalized to /imported-packs/:packId/...
    expect(result.pack.rounds[0]!.questions![0]!.imageUrl).toBe("/imported-packs/test-pack/images/q1.png");
  });

  it("refuses a ZIP exceeding the size limit", () => {
    const pack = createMinimalPack("big");
    const zipBuffer = createZipBuffer(pack);

    expect(() => importZipPack(zipBuffer, 10, new Set(), new Set())).toThrow(
      "Le fichier ZIP dépasse la limite de 0 Mo.",
    );
  });

  it("refuses a corrupted ZIP", () => {
    const corruptBuffer = Buffer.from("not a zip file", "utf8");

    expect(() => importZipPack(corruptBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set())).toThrow(
      "Le fichier ZIP est corrompu ou invalide.",
    );
  });

  it("documents that AdmZip normalizes path traversal in entry names", () => {
    // * AdmZip automatically normalizes entry names during construction:
    // * - "../evil.txt" becomes "evil.txt"
    // * - "/etc/passwd" becomes "etc/passwd"
    // * - "a/../../etc/passwd" becomes "etc/passwd"
    // * 
    // * This makes the path traversal check in importZipPack currently redundant.
    // * We cannot test importZipPack's entry-name check without building raw ZIP bytes
    // * that bypass AdmZip's normalization.

    const pack = createMinimalPack("traversal");

    // * Verify AdmZip normalizes "../" patterns
    const zip1 = new AdmZip();
    zip1.addFile("pack.json", Buffer.from(JSON.stringify(pack), "utf8"));
    zip1.addFile("../evil.txt", Buffer.from("nope", "utf8"));
    const entries1 = zip1.getEntries();
    const evilEntry = entries1.find((e) => e.entryName.includes("evil"));
    expect(evilEntry?.entryName).toBe("evil.txt"); // * AdmZip normalized away the "../"

    // * Verify AdmZip normalizes absolute paths
    const zip2 = new AdmZip();
    zip2.addFile("pack.json", Buffer.from(JSON.stringify(pack), "utf8"));
    zip2.addFile("/etc/passwd", Buffer.from("nope", "utf8"));
    const entries2 = zip2.getEntries();
    const passwdEntry = entries2.find((e) => e.entryName.includes("passwd"));
    expect(passwdEntry?.entryName).toBe("etc/passwd"); // * AdmZip normalized away the "/"
  });

  it("refuses a pack with path traversal in media URLs", () => {
    // * Test that ".." in imageUrl/videoUrl/audioUrl is rejected with a forbidden-path error.
    // * Include the referenced file in the ZIP so missing-media errors cannot mask acceptance.
    const traversalUrls = [
      { url: "../secret.png", file: "secret.png" },
      { url: "images/../../etc/passwd", file: "etc/passwd" },
      { url: "games/../outside.png", file: "outside.png" },
      { url: "/games/../outside.png", file: "outside.png" },
      { url: "media/../../../etc/shadow", file: "etc/shadow" },
    ];

    for (const { url: maliciousUrl, file: fileName } of traversalUrls) {
      const pack: QuizPack = {
        id: "url-traversal",
        title: "URL Traversal Test",
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
                imageUrl: maliciousUrl,
              },
            ],
          },
        ],
      };

      // * Include the file so missing-media error cannot occur
      const zipBuffer = createZipBuffer(pack, [{ path: fileName, content: Buffer.from("fake", "utf8") }]);

      try {
        importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set());
        // * If we reach here, the importer accepted the traversal URL - FAIL
        throw new Error(`FAIL: Importer accepted traversal URL: ${maliciousUrl}`);
      } catch (err: any) {
        // * Re-throw our own failure
        if (err.message?.startsWith("FAIL:")) throw err;
        // * Must be a forbidden-path error (French: "interdit")
        const msg = err.message?.toLowerCase() || "";
        if (!msg.includes("interdit") && !msg.includes("..")) {
          throw new Error(`FAIL: Wrong error for ${maliciousUrl}: ${err.message}`);
        }
        // * Correct error type received
        expect(msg).toMatch(/interdit|traversée/i);
      }
    }
  });

  it("refuses a ZIP with no JSON file", () => {
    const zip = new AdmZip();
    zip.addFile("readme.txt", Buffer.from("Hello", "utf8"));
    const zipBuffer = zip.toBuffer();

    expect(() => importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set())).toThrow(
      "Le ZIP ne contient aucun fichier JSON de pack.",
    );
  });

  it("refuses a ZIP with several JSON files", () => {
    const pack1 = createMinimalPack("pack1");
    const pack2 = createMinimalPack("pack2");
    const zip = new AdmZip();
    zip.addFile("pack1.json", Buffer.from(JSON.stringify(pack1), "utf8"));
    zip.addFile("pack2.json", Buffer.from(JSON.stringify(pack2), "utf8"));
    const zipBuffer = zip.toBuffer();

    expect(() => importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set())).toThrow(
      "Le ZIP contient plusieurs fichiers JSON. Un seul pack par archive est autorisé.",
    );
  });

  it("refuses invalid JSON", () => {
    const zip = new AdmZip();
    zip.addFile("pack.json", Buffer.from("{ invalid json", "utf8"));
    const zipBuffer = zip.toBuffer();

    expect(() => importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set())).toThrow(
      "Le fichier JSON du pack est invalide ou illisible.",
    );
  });

  it("refuses JSON not conforming to pack schema", () => {
    const invalidPack = { id: "x", title: "X" }; // * missing version and rounds
    const zipBuffer = createZipBuffer(invalidPack as QuizPack);

    expect(() => importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set())).toThrow(
      /Validation du pack échouée/,
    );
  });

  it("refuses pack with id collision (disk pack)", () => {
    const pack = createMinimalPack("existing-disk");
    const zipBuffer = createZipBuffer(pack);
    const existingDiskPacks = new Set(["existing-disk"]);

    expect(() =>
      importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, existingDiskPacks, new Set()),
    ).toThrow('Un pack avec l\'identifiant "existing-disk" existe déjà.');
  });

  it("refuses pack with id collision (already imported)", () => {
    const pack = createMinimalPack("existing-imported");
    const zipBuffer = createZipBuffer(pack);
    const existingImported = new Set(["existing-imported"]);

    expect(() =>
      importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), existingImported),
    ).toThrow('Un pack avec l\'identifiant "existing-imported" existe déjà.');
  });

  it("refuses pack with missing media", () => {
    const pack: QuizPack = {
      id: "missing-media",
      title: "Missing",
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
              imageUrl: "images/missing.png",
            },
          ],
        },
      ],
    };
    const zipBuffer = createZipBuffer(pack); // * No media file added

    expect(() => importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set())).toThrow(
      "Médias manquants dans le ZIP : images/missing.png",
    );
  });

  it("accepts pack with HTTPS URLs (external media)", () => {
    const pack: QuizPack = {
      id: "external",
      title: "External",
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
    const zipBuffer = createZipBuffer(pack);

    const result = importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set());

    expect(result.pack.rounds[0]!.questions![0]!.imageUrl).toBe("https://example.com/img.png");
  });

  it("accepts pack with root-relative URLs (server-side media)", () => {
    const pack: QuizPack = {
      id: "server-side",
      title: "Server Side",
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
              imageUrl: "/avatars/player1.png", // * Server-side path (not /games/)
            },
          ],
        },
      ],
    };
    const zipBuffer = createZipBuffer(pack);

    const result = importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set());

    expect(result.pack.rounds[0]!.questions![0]!.imageUrl).toBe("/avatars/player1.png");
  });

  it("normalizes relative media paths to /imported-packs/:packId/...", () => {
    const pack: QuizPack = {
      id: "normalize",
      title: "Normalize",
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
              imageUrl: "media/q1.png",
            },
          ],
        },
      ],
    };
    const zipBuffer = createZipBuffer(pack, [{ path: "media/q1.png", content: Buffer.alloc(10) }]);

    const result = importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set());

    expect(result.pack.rounds[0]!.questions![0]!.imageUrl).toBe("/imported-packs/normalize/media/q1.png");
  });

  it("validates image_buzz round media references", () => {
    const pack: QuizPack = {
      id: "img-buzz",
      title: "Image Buzz",
      version: 1,
      rounds: [
        {
          kind: "image_buzz",
          id: "r1",
          title: "Series",
          slides: [
            { id: "s1", imageUrl: "img1.png", points: 3 },
            { id: "s2", imageUrl: "img2.png", prompt: "Hint" },
          ],
        },
      ],
    };
    const zipBuffer = createZipBuffer(pack, [
      { path: "img1.png", content: Buffer.alloc(10) },
      { path: "img2.png", content: Buffer.alloc(10) },
    ]);

    const result = importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set());

    const r = result.pack.rounds[0]!;
    if (!("slides" in r)) throw new Error("expected slides");
    expect(r.slides[0]?.imageUrl).toBe("/imported-packs/img-buzz/img1.png");
    expect(r.slides[1]?.imageUrl).toBe("/imported-packs/img-buzz/img2.png");
  });

  it("validates audio_blind round media references", () => {
    const pack: QuizPack = {
      id: "audio",
      title: "Audio",
      version: 1,
      rounds: [
        {
          kind: "audio_blind",
          id: "r1",
          title: "Sounds",
          tracks: [
            { id: "t1", audioUrl: "track1.mp3", revealTitle: "Song" },
          ],
        },
      ],
    };
    const zipBuffer = createZipBuffer(pack, [{ path: "track1.mp3", content: Buffer.alloc(10) }]);

    const result = importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set());

    const r = result.pack.rounds[0]!;
    if (!("tracks" in r)) throw new Error("expected tracks");
    expect(r.tracks[0]?.audioUrl).toBe("/imported-packs/audio/track1.mp3");
  });

  it("validates progressive_guess round media references", () => {
    const pack: QuizPack = {
      id: "prog",
      title: "Progressive",
      version: 1,
      rounds: [
        {
          kind: "progressive_guess",
          id: "r1",
          title: "Movies",
          items: [
            {
              id: "i1",
              clues: [
                { imageUrl: "clue1.png", points: 2 },
                { imageUrl: "clue2.png", points: 1 },
              ],
              reveal: { answer: "Answer", imageUrl: "reveal.png" },
            },
          ],
        },
      ],
    };
    const zipBuffer = createZipBuffer(pack, [
      { path: "clue1.png", content: Buffer.alloc(10) },
      { path: "clue2.png", content: Buffer.alloc(10) },
      { path: "reveal.png", content: Buffer.alloc(10) },
    ]);

    const result = importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set());

    const r = result.pack.rounds[0]!;
    if (!("items" in r)) throw new Error("expected items");
    const item = r.items[0]!;
    expect(item.clues[0]?.imageUrl).toBe("/imported-packs/prog/clue1.png");
    expect(item.clues[1]?.imageUrl).toBe("/imported-packs/prog/clue2.png");
    expect(item.reveal.imageUrl).toBe("/imported-packs/prog/reveal.png");
  });

  it("validates video round media references", () => {
    const pack: QuizPack = {
      id: "video",
      title: "Video",
      version: 1,
      rounds: [
        {
          id: "r1",
          title: "Clip",
          videoUrl: "videos/clip.mp4",
        },
      ],
    };
    const zipBuffer = createZipBuffer(pack, [{ path: "videos/clip.mp4", content: Buffer.alloc(10) }]);

    const result = importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set());

    expect(result.pack.rounds[0]!.videoUrl).toBe("/imported-packs/video/videos/clip.mp4");
  });

  it("reports multiple missing media files with limit of 5", () => {
    const pack: QuizPack = {
      id: "many-missing",
      title: "Many Missing",
      version: 1,
      rounds: [
        {
          kind: "image_buzz",
          id: "r1",
          title: "Missing",
          slides: [
            { id: "s1", imageUrl: "m1.png", points: 1 },
            { id: "s2", imageUrl: "m2.png", points: 1 },
            { id: "s3", imageUrl: "m3.png", points: 1 },
            { id: "s4", imageUrl: "m4.png", points: 1 },
            { id: "s5", imageUrl: "m5.png", points: 1 },
            { id: "s6", imageUrl: "m6.png", points: 1 },
          ],
        },
      ],
    };
    const zipBuffer = createZipBuffer(pack); // * No media files

    expect(() => importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set())).toThrow(
      /Médias manquants dans le ZIP : m1\.png, m2\.png, m3\.png, m4\.png, m5\.png \(et 1 autres\)/,
    );
  });
});

describe("ImportedPackStore", () => {
  it("stores and retrieves packs by id", () => {
    const store = new ImportedPackStore();
    const pack = createMinimalPack("store-test");
    const zip = new AdmZip();
    zip.addFile("pack.json", Buffer.from(JSON.stringify(pack), "utf8"));
    const entries = zip.getEntries();

    store.add(pack, entries);

    expect(store.has("store-test")).toBe(true);
    expect(store.get("store-test")?.title).toBe("Pack store-test");
  });

  it("returns undefined for unknown pack id", () => {
    const store = new ImportedPackStore();

    expect(store.has("unknown")).toBe(false);
    expect(store.get("unknown")).toBeUndefined();
  });

  it("returns all packs as Map", () => {
    const store = new ImportedPackStore();
    const pack1 = createMinimalPack("p1");
    const pack2 = createMinimalPack("p2");
    const zip1 = new AdmZip();
    zip1.addFile("pack1.json", Buffer.from(JSON.stringify(pack1), "utf8"));
    const zip2 = new AdmZip();
    zip2.addFile("pack2.json", Buffer.from(JSON.stringify(pack2), "utf8"));

    store.add(pack1, zip1.getEntries());
    store.add(pack2, zip2.getEntries());

    const all = store.getAll();
    expect(all.size).toBe(2);
    expect(all.get("p1")?.title).toBe("Pack p1");
    expect(all.get("p2")?.title).toBe("Pack p2");
  });

  it("retrieves media entry by path", () => {
    const store = new ImportedPackStore();
    const pack = createMinimalPack("media-test");
    const zip = new AdmZip();
    zip.addFile("pack.json", Buffer.from(JSON.stringify(pack), "utf8"));
    zip.addFile("images/test.png", Buffer.from("fake-image-data", "utf8"));
    const entries = zip.getEntries();

    store.add(pack, entries);

    const buffer = store.getMediaEntry("media-test", "images/test.png");
    expect(buffer).not.toBeNull();
    expect(buffer?.toString("utf8")).toBe("fake-image-data");
  });

  it("returns null for missing media entry", () => {
    const store = new ImportedPackStore();
    const pack = createMinimalPack("missing-media-test");
    const zip = new AdmZip();
    zip.addFile("pack.json", Buffer.from(JSON.stringify(pack), "utf8"));
    const entries = zip.getEntries();

    store.add(pack, entries);

    const buffer = store.getMediaEntry("missing-media-test", "images/nonexistent.png");
    expect(buffer).toBeNull();
  });

  it("returns null for directory entry", () => {
    const store = new ImportedPackStore();
    const pack = createMinimalPack("dir-test");
    const zip = new AdmZip();
    zip.addFile("pack.json", Buffer.from(JSON.stringify(pack), "utf8"));
    zip.addFile("images/", Buffer.alloc(0)); // * Directory entry
    const entries = zip.getEntries();

    store.add(pack, entries);

    const buffer = store.getMediaEntry("dir-test", "images/");
    expect(buffer).toBeNull();
  });

  it("normalizes backslashes in media paths", () => {
    const store = new ImportedPackStore();
    const pack = createMinimalPack("backslash-test");
    const zip = new AdmZip();
    zip.addFile("pack.json", Buffer.from(JSON.stringify(pack), "utf8"));
    zip.addFile("images/test.png", Buffer.from("image-data", "utf8"));
    const entries = zip.getEntries();

    store.add(pack, entries);

    // * Request with backslashes should find the file
    const buffer = store.getMediaEntry("backslash-test", "images\\test.png");
    expect(buffer).not.toBeNull();
    expect(buffer?.toString("utf8")).toBe("image-data");
  });
});

describe("ImportedPackStore · process-scoped (not persistent)", () => {
  it("does not persist across process restart (conceptual test)", () => {
    // * This test documents the expected behavior: the store is in-memory only.
    // * In a real scenario, a process restart would lose all imported packs.
    const store = new ImportedPackStore();
    const pack = createMinimalPack("ephemeral");
    const zip = new AdmZip();
    zip.addFile("pack.json", Buffer.from(JSON.stringify(pack), "utf8"));

    store.add(pack, zip.getEntries());
    expect(store.has("ephemeral")).toBe(true);

    // * Simulate process restart by creating a new store instance
    const newStore = new ImportedPackStore();
    expect(newStore.has("ephemeral")).toBe(false);
  });
});

describe("Import does not write to disk", () => {
  it("does not write into games/ directory or persist on disk", async () => {
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

    // * Snapshot the games/ directory before import
    async function snapshotDirectory(dir: string): Promise<Set<string>> {
      const files = new Set<string>();
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
        for (const entry of entries) {
          const relativePath = path.relative(dir, path.join(entry.path ?? entry.parentPath ?? "", entry.name));
          files.add(relativePath);
        }
      } catch {
        // * Directory may not exist or be inaccessible
      }
      return files;
    }

    const beforeFiles = await snapshotDirectory(gamesDir);

    // * Create a valid pack with media
    const pack: QuizPack = {
      id: "no-disk-write-test",
      title: "No Disk Write",
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
              imageUrl: "test-image.png",
            },
          ],
        },
      ],
    };

    const zipBuffer = createZipBuffer(pack, [
      { path: "test-image.png", content: Buffer.from("fake-image-data", "utf8") },
    ]);

    // * Perform the import (this should NOT write to disk)
    const result = importZipPack(zipBuffer, DEFAULT_MAX_ZIP_BYTES, new Set(), new Set());

    expect(result.pack.id).toBe("no-disk-write-test");

    // * Snapshot the games/ directory after import
    const afterFiles = await snapshotDirectory(gamesDir);

    // * Verify that NO new files were added to games/
    const newFiles = [...afterFiles].filter((f) => !beforeFiles.has(f));
    if (newFiles.length > 0) {
      throw new Error(`FAIL: Import wrote files to games/: ${newFiles.join(", ")}`);
    }

    // * Verify the pack JSON was not written
    const jsonPath = path.join(gamesDir, "no-disk-write-test.json");
    try {
      await fs.access(jsonPath);
      throw new Error(`FAIL: Pack JSON was written to disk at ${jsonPath}`);
    } catch (err: any) {
      if (err.message?.startsWith("FAIL:")) throw err;
      // * File does not exist - good
    }

    // * Verify the media was not written
    const mediaPath = path.join(gamesDir, "test-image.png");
    try {
      await fs.access(mediaPath);
      throw new Error(`FAIL: Media was written to disk at ${mediaPath}`);
    } catch (err: any) {
      if (err.message?.startsWith("FAIL:")) throw err;
      // * File does not exist - good
    }

    // * The files should be equal (no new files)
    expect(afterFiles.size).toBe(beforeFiles.size);
  });
});
