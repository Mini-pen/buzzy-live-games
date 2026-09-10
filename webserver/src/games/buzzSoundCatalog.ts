import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { withBasePath } from "../basePath.js";

const catalogSchema = z
  .object({
    defaultBuzzerKey: z.string().min(1),
    sounds: z
      .array(
        z
          .object({
            key: z.string().min(1).max(64),
            label: z.string().min(1).max(120),
            /** * Path relative to `GAMES_DIR/sounds/` (e.g. `buzzers/BANG.mp3`). */
            file: z.string().min(1).max(240),
            pool: z.enum(["good", "bad", "neutral"]),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type BuzzSoundCatalogEntry = z.infer<
  typeof catalogSchema
>["sounds"][number];

export interface LoadedBuzzSoundCatalog extends z.infer<typeof catalogSchema> {
  byKey: Map<string, BuzzSoundCatalogEntry>;
}

/** * Rejects traversal; allows one or two path segments ending in known audio suffix. */
function safeRelativeSoundFile(raw: string): string | null {
  const norm = raw.replace(/\\/gu, "/").trim();
  if (norm === "" || norm.includes("..") || norm.startsWith("/")) return null;
  const parts = norm.split("/").filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return null;
  for (const seg of parts) {
    if (seg === "." || seg === "..") return null;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/u.test(seg)) return null;
  }
  const last = parts[parts.length - 1]!;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]+\.(?:wav|ogg|opus|mp3|m4a)$/iu.test(last)) {
    return null;
  }
  return parts.join("/");
}

/** * Parses `GAMES_DIR/sounds/catalog.json`. */
export async function loadBuzzSoundCatalog(gamesDir: string): Promise<LoadedBuzzSoundCatalog> {
  const abs = path.join(gamesDir, "sounds", "catalog.json");
  const raw = JSON.parse(await readFile(abs, "utf8")) as unknown;
  const parsed = catalogSchema.parse(raw);
  const byKey = new Map<string, BuzzSoundCatalogEntry>();
  for (const s of parsed.sounds) {
    const safe = safeRelativeSoundFile(s.file);
    if (safe === null || safe !== s.file.trim()) {
      throw new Error(`Invalid sound path in catalog key=${s.key}`);
    }
    if (byKey.has(s.key)) throw new Error(`Duplicate buzz sound key: ${s.key}`);
    byKey.set(s.key, s);
  }
  if (!byKey.has(parsed.defaultBuzzerKey)) {
    throw new Error(`defaultBuzzerKey not in catalog: ${parsed.defaultBuzzerKey}`);
  }
  return { ...parsed, byKey };
}

export function resolveBuzzSoundPublicUrl(entry: BuzzSoundCatalogEntry): string {
  const rel = safeRelativeSoundFile(entry.file);
  if (rel === null) return "";
  return withBasePath(
    `/games/sounds/${rel
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/")}`,
  );
}

/** * Only files under `sounds/buzzers/` may be chosen as a player buzz tone (not good/bad/others). */
export function isBuzzerClipForPlayerChoice(entry: Pick<BuzzSoundCatalogEntry, "file">): boolean {
  const n = entry.file.replace(/\\/gu, "/").trim().toLowerCase();
  return n.startsWith("buzzers/");
}

export function defaultBuzzSoundPolicyFromCatalog(
  cat: LoadedBuzzSoundCatalog,
): {
  allowedGoodKeys: string[];
  allowedBadKeys: string[];
} {
  const good: string[] = [];
  const bad: string[] = [];
  for (const s of cat.sounds) {
    if (s.pool === "good") good.push(s.key);
    if (s.pool === "bad") bad.push(s.key);
  }
  if (good.length === 0 || bad.length === 0) {
    throw new Error("Buzz catalog must expose at least one good and one bad pool entry");
  }
  return {
    allowedGoodKeys: [...good],
    allowedBadKeys: [...bad],
  };
}
