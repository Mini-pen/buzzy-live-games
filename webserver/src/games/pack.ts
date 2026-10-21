import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

import {
  MAX_QUIZ_PACK_JSON_BYTES,
  quizPackSchema,
  validatePackInvariants,
  type QuizPack,
} from "./packModel.js";

export * from "./packModel.js";

/** * Parses and validates a quiz JSON pack from disk. */
export async function loadQuizPackPath(absPath: string): Promise<QuizPack> {
  const raw = await readFile(absPath, "utf8");
  const json: unknown = JSON.parse(raw);
  const parsed = quizPackSchema.parse(json);
  validatePackInvariants(parsed);
  return parsed;
}

/** * Loads `basename` relative to packsDir (`foo` → `foo.json`; subfolders allowed). */
export async function loadQuizPackFile(packsDir: string, basename: string): Promise<QuizPack> {
  const normalized = basename.replace(/\\/gu, "/").replace(/^\//u, "").replace(/\.json$/iu, "");
  const filePath = path.join(packsDir, `${normalized}.json`);
  return loadQuizPackPath(filePath);
}

async function listJsonPackAbsolutePaths(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(inner: string): Promise<void> {
    let dirents: Dirent[];
    try {
      dirents = await readdir(inner, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of dirents) {
      const full = path.join(inner, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) results.push(full);
    }
  }

  await walk(dir);
  results.sort((a, b) => a.localeCompare(b));
  return results;
}

/** * Indexes packs by path relative to `packsDir` without `.json` (e.g. `guess_by_color/quiz_with_images`). */
export async function scanQuizPacks(packsDir: string): Promise<Map<string, QuizPack>> {
  const paths = await listJsonPackAbsolutePaths(packsDir);
  const out = new Map<string, QuizPack>();
  await Promise.all(
    paths.map(async (filePath): Promise<void> => {
      try {
        let byteSize = 0;
        try {
          const st = await stat(filePath);
          if (!st.isFile()) return;
          byteSize = st.size;
        } catch {
          return;
        }
        if (byteSize > MAX_QUIZ_PACK_JSON_BYTES) return;

        const rel = path.relative(packsDir, filePath).replace(/\\/gu, "/");
        const key = rel.replace(/\.json$/iu, "");
        const pack = await loadQuizPackPath(filePath);
        out.set(key, pack);
      } catch {
        /* malformed or non-quiz JSON ignored until explicitly referenced */
      }
    }),
  );
  return out;
}
