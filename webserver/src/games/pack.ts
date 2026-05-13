import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const questionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  choices: z.array(z.string()).min(2),
  correctIndex: z.number().int().nonnegative(),
  points: z.number().int().positive(),
});

const roundSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  questions: z.array(questionSchema).min(1),
});

export const quizPackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  version: z.number().int().positive(),
  rounds: z.array(roundSchema).min(1),
});

export type QuizPack = z.infer<typeof quizPackSchema>;


/** * Parses and validates a quiz JSON pack from disk. */
export async function loadQuizPackFile(
  packsDir: string,
  basename: string,
): Promise<QuizPack> {
  const filePath = path.join(packsDir, basename.endsWith(".json") ? basename : `${basename}.json`);
  const raw = await readFile(filePath, "utf8");
  const json: unknown = JSON.parse(raw);
  const parsed = quizPackSchema.parse(json);
  for (const r of parsed.rounds) {
    for (const q of r.questions) {
      if (q.correctIndex >= q.choices.length) {
        throw new Error(`Question ${q.id}: correctIndex out of bounds`);
      }
    }
  }
  return parsed;
}

/** * Indexes packs by basename for lookups. */
export async function scanQuizPacks(
  packsDir: string,
): Promise<Map<string, QuizPack>> {
  const { readdir } = await import("node:fs/promises");
  const names = await readdir(packsDir).catch(() => [] as string[]);
  const out = new Map<string, QuizPack>();
  await Promise.all(
    names.map(async (n) => {
      if (!n.endsWith(".json")) return;
      try {
        const pack = await loadQuizPackFile(packsDir, n);
        const key = n.replace(/\.json$/u, "") ?? "";
        out.set(key, pack);
      } catch {
        /* malformed pack ignored until explicitly requested */
      }
    }),
  );
  return out;
}
