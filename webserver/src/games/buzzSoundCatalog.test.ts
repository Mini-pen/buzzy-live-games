import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadBuzzSoundCatalog,
  resolveBuzzSoundPublicUrl,
  isBuzzerClipForPlayerChoice,
  defaultBuzzSoundPolicyFromCatalog,
  type BuzzSoundCatalogEntry,
} from "./buzzSoundCatalog.js";

describe("loadBuzzSoundCatalog", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `buzz-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(tempDir, "sounds"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function writeCatalog(content: unknown) {
    await writeFile(
      join(tempDir, "sounds", "catalog.json"),
      JSON.stringify(content),
      "utf8",
    );
  }

  it("loads a valid catalog", async () => {
    await writeCatalog({
      defaultBuzzerKey: "bang",
      sounds: [
        {
          key: "bang",
          label: "BANG",
          file: "buzzers/BANG.mp3",
          pool: "neutral",
        },
        {
          key: "ding",
          label: "Ding",
          file: "good/ding.mp3",
          pool: "good",
        },
      ],
    });

    const catalog = await loadBuzzSoundCatalog(tempDir);
    expect(catalog.defaultBuzzerKey).toBe("bang");
    expect(catalog.sounds).toHaveLength(2);
    expect(catalog.byKey.size).toBe(2);
    expect(catalog.byKey.get("bang")?.label).toBe("BANG");
  });

  it("rejects path traversal in file", async () => {
    await writeCatalog({
      defaultBuzzerKey: "bad",
      sounds: [
        {
          key: "bad",
          label: "Bad",
          file: "../../../etc/passwd",
          pool: "neutral",
        },
      ],
    });

    await expect(loadBuzzSoundCatalog(tempDir)).rejects.toThrow(
      "Invalid sound path in catalog key=bad",
    );
  });

  it("rejects absolute path", async () => {
    await writeCatalog({
      defaultBuzzerKey: "abs",
      sounds: [
        {
          key: "abs",
          label: "Abs",
          file: "/etc/passwd",
          pool: "neutral",
        },
      ],
    });

    await expect(loadBuzzSoundCatalog(tempDir)).rejects.toThrow(
      "Invalid sound path in catalog key=abs",
    );
  });

  it("rejects duplicate keys", async () => {
    await writeCatalog({
      defaultBuzzerKey: "dup",
      sounds: [
        {
          key: "dup",
          label: "First",
          file: "buzzers/ab.mp3",
          pool: "neutral",
        },
        {
          key: "dup",
          label: "Second",
          file: "buzzers/cd.mp3",
          pool: "neutral",
        },
      ],
    });

    await expect(loadBuzzSoundCatalog(tempDir)).rejects.toThrow(
      "Duplicate buzz sound key: dup",
    );
  });

  it("rejects when defaultBuzzerKey is not in catalog", async () => {
    await writeCatalog({
      defaultBuzzerKey: "missing",
      sounds: [
        {
          key: "existing",
          label: "Existing",
          file: "buzzers/existing.mp3",
          pool: "neutral",
        },
      ],
    });

    await expect(loadBuzzSoundCatalog(tempDir)).rejects.toThrow(
      "defaultBuzzerKey not in catalog: missing",
    );
  });

  it("rejects file with invalid extension", async () => {
    await writeCatalog({
      defaultBuzzerKey: "bad",
      sounds: [
        {
          key: "bad",
          label: "Bad",
          file: "buzzers/file.txt",
          pool: "neutral",
        },
      ],
    });

    await expect(loadBuzzSoundCatalog(tempDir)).rejects.toThrow(
      "Invalid sound path in catalog key=bad",
    );
  });

  it("accepts valid audio extensions", async () => {
    await writeCatalog({
      defaultBuzzerKey: "wav",
      sounds: [
        { key: "wav", label: "WAV", file: "buzzers/ab.wav", pool: "neutral" },
        { key: "ogg", label: "OGG", file: "buzzers/bc.ogg", pool: "good" },
        { key: "opus", label: "OPUS", file: "buzzers/cd.opus", pool: "bad" },
        { key: "m4a", label: "M4A", file: "buzzers/de.m4a", pool: "neutral" },
      ],
    });

    const catalog = await loadBuzzSoundCatalog(tempDir);
    expect(catalog.sounds).toHaveLength(4);
  });

  it("accepts two-level paths", async () => {
    await writeCatalog({
      defaultBuzzerKey: "nested",
      sounds: [
        {
          key: "nested",
          label: "Nested",
          file: "subdir/file.mp3",
          pool: "neutral",
        },
      ],
    });

    const catalog = await loadBuzzSoundCatalog(tempDir);
    expect(catalog.sounds[0]?.file).toBe("subdir/file.mp3");
  });

  it("rejects more than two path segments", async () => {
    await writeCatalog({
      defaultBuzzerKey: "deep",
      sounds: [
        {
          key: "deep",
          label: "Deep",
          file: "a/b/c.mp3",
          pool: "neutral",
        },
      ],
    });

    await expect(loadBuzzSoundCatalog(tempDir)).rejects.toThrow(
      "Invalid sound path in catalog key=deep",
    );
  });
});

describe("resolveBuzzSoundPublicUrl", () => {
  it("generates correct public URL", () => {
    const entry: BuzzSoundCatalogEntry = {
      key: "bang",
      label: "BANG",
      file: "buzzers/BANG.mp3",
      pool: "neutral",
    };
    const url = resolveBuzzSoundPublicUrl(entry);
    expect(url).toBe("/games/sounds/buzzers/BANG.mp3");
  });

  it("encodes special characters in path segments", () => {
    const entry: BuzzSoundCatalogEntry = {
      key: "special",
      label: "Special",
      file: "folder/file-name.mp3",
      pool: "neutral",
    };
    const url = resolveBuzzSoundPublicUrl(entry);
    expect(url).toBe("/games/sounds/folder/file-name.mp3");
  });

  it("returns empty string for invalid file", () => {
    const entry: BuzzSoundCatalogEntry = {
      key: "bad",
      label: "Bad",
      file: "../../../etc/passwd",
      pool: "neutral",
    };
    const url = resolveBuzzSoundPublicUrl(entry);
    expect(url).toBe("");
  });
});

describe("isBuzzerClipForPlayerChoice", () => {
  it("returns true for buzzers/ prefix", () => {
    expect(isBuzzerClipForPlayerChoice({ file: "buzzers/BANG.mp3" })).toBe(true);
    expect(isBuzzerClipForPlayerChoice({ file: "buzzers/Gong.mp3" })).toBe(true);
  });

  it("returns false for good/ prefix", () => {
    expect(isBuzzerClipForPlayerChoice({ file: "good/ding.mp3" })).toBe(false);
  });

  it("returns false for bad/ prefix", () => {
    expect(isBuzzerClipForPlayerChoice({ file: "bad/buzzer-error.mp3" })).toBe(false);
  });

  it("returns false for others/ prefix", () => {
    expect(isBuzzerClipForPlayerChoice({ file: "others/alert.mp3" })).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isBuzzerClipForPlayerChoice({ file: "BUZZERS/BANG.mp3" })).toBe(true);
    expect(isBuzzerClipForPlayerChoice({ file: "Buzzers/Gong.mp3" })).toBe(true);
  });
});

describe("defaultBuzzSoundPolicyFromCatalog", () => {
  it("extracts good and bad pools", async () => {
    const catalog = {
      defaultBuzzerKey: "bang",
      sounds: [
        { key: "bang", label: "BANG", file: "buzzers/BANG.mp3", pool: "neutral" as const },
        { key: "ding", label: "Ding", file: "good/ding.mp3", pool: "good" as const },
        { key: "yippee", label: "Yippee", file: "good/yippee.mp3", pool: "good" as const },
        { key: "buzz_err", label: "Error", file: "bad/error.mp3", pool: "bad" as const },
      ],
      byKey: new Map(),
    };

    const policy = defaultBuzzSoundPolicyFromCatalog(catalog);
    expect(policy.allowedGoodKeys).toEqual(["ding", "yippee"]);
    expect(policy.allowedBadKeys).toEqual(["buzz_err"]);
  });

  it("throws when good pool is empty", () => {
    const catalog = {
      defaultBuzzerKey: "bang",
      sounds: [
        { key: "bang", label: "BANG", file: "buzzers/BANG.mp3", pool: "neutral" as const },
        { key: "buzz_err", label: "Error", file: "bad/error.mp3", pool: "bad" as const },
      ],
      byKey: new Map(),
    };

    expect(() => defaultBuzzSoundPolicyFromCatalog(catalog)).toThrow(
      "Buzz catalog must expose at least one good and one bad pool entry",
    );
  });

  it("throws when bad pool is empty", () => {
    const catalog = {
      defaultBuzzerKey: "bang",
      sounds: [
        { key: "bang", label: "BANG", file: "buzzers/BANG.mp3", pool: "neutral" as const },
        { key: "ding", label: "Ding", file: "good/ding.mp3", pool: "good" as const },
      ],
      byKey: new Map(),
    };

    expect(() => defaultBuzzSoundPolicyFromCatalog(catalog)).toThrow(
      "Buzz catalog must expose at least one good and one bad pool entry",
    );
  });
});
