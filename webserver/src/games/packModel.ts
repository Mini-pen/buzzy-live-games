/**
 * * Quiz pack model shared by the server and the browser.
 *   No `node:` import: the client bundle pulls this file in.
 *   Disk loading stays in `pack.ts`.
 */

import { z } from "zod";

/** * Skip huge JSON blobs (e.g. data exports) mistaken for quiz packs. */
export const MAX_QUIZ_PACK_JSON_BYTES = 520_000;

/** * HTTPS, localhost http, root-relative path, or `games/…` (normalized to `/games/…`). */
export const optionalPublicUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((s) => !s.includes(".."), {
    message: "PUBLIC_URL_REJECTED",
  })
  .refine((s) => !/^\s*javascript:/iu.test(s), {
    message: "PUBLIC_URL_REJECTED",
  })
  .refine(
    (s) =>
      s.startsWith("/") ||
      /^https:\/\/[^/\s]+/iu.test(s) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\S+/iu.test(s) ||
      /^games\/[a-zA-Z0-9][a-zA-Z0-9_./@-]*$/u.test(s),
    {
      message: "PUBLIC_URL_REJECTED",
    },
  )
  .transform((s): string => (s.startsWith("games/") ? `/${s}` : s));

const questionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  choices: z.array(z.string()).min(2),
  correctIndex: z.number().int().nonnegative(),
  points: z.number().int().positive(),
  imageUrl: optionalPublicUrlSchema.optional(),
});

export const quizRoundSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    questions: z.array(questionSchema).min(1),
  })
  .strict();

/** * Classic video segment (`videoUrl`). No `kind` field (legacy packs). */
export const videoRoundSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    videoUrl: z.string().min(1),
  })
  .strict();

/** * Buzzer-only prompts; index is host-advanced, optional soft cap for player display. */
export const freeBuzzRoundSchema = z
  .object({
    kind: z.literal("free_buzz"),
    id: z.string().min(1),
    title: z.string().min(1),
    playerPrompt: z.string().min(1),
    plannedQuestionCount: z.number().int().positive().nullable().optional(),
  })
  .strict();

const imageBuzzSlideSchema = z.object({
  id: z.string().min(1),
  imageUrl: optionalPublicUrlSchema,
  /** * Optional caption; when absent the client shows a generic oral-answer hint. */
  prompt: z.string().min(1).optional(),
  /** * Points when the host validates a correct oral answer (default 1 if omitted). */
  points: z.number().int().positive().optional(),
});

/** * One image per step; players buzz and answer out loud (no on-screen choices). */
export const imageBuzzRoundSchema = z
  .object({
    kind: z.literal("image_buzz"),
    id: z.string().min(1),
    title: z.string().min(1),
    slides: z.array(imageBuzzSlideSchema).min(1),
  })
  .strict();

/** * Path suffix must look like an audio asset (streaming URLs without suffix may use localhost HTTP for dev). */
function pathnameEndsWithKnownAudioSuffix(pathWithoutQuery: string): boolean {
  const p = pathWithoutQuery.trim();
  return /\.(?:mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/iu.test(p);
}

export const audioPublicUrlSchema = optionalPublicUrlSchema.superRefine((s, ctx) => {
  if (/^http:\/\/(localhost|127\.0\.0\.1)/iu.test(s)) return;
  const qIx = s.indexOf("?");
  const withoutQuery = qIx >= 0 ? s.slice(0, qIx) : s;
  let pathPortion = withoutQuery;
  try {
    if (!s.startsWith("/")) pathPortion = new URL(s).pathname;
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "AUDIO_PUBLIC_URL_REJECTED" });
    return;
  }
  if (!pathnameEndsWithKnownAudioSuffix(pathPortion)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "AUDIO_PUBLIC_URL_REJECTED" });
  }
});

const audioBlindTrackSchema = z.object({
  id: z.string().min(1),
  audioUrl: audioPublicUrlSchema,
  revealTitle: z.string().min(1),
  revealArtist: z.string().min(1).optional(),
});

export const audioBlindRoundSchema = z
  .object({
    kind: z.literal("audio_blind"),
    id: z.string().min(1),
    title: z.string().min(1),
    tracks: z.array(audioBlindTrackSchema).min(1),
  })
  .strict();

const progressiveGuessClueSchema = z
  .object({
    id: z.string().min(1).optional(),
    imageUrl: optionalPublicUrlSchema,
    points: z.number().int().positive(),
  })
  .strict();

const progressiveGuessRevealSchema = z
  .object({
    answer: z.string().min(1).max(200),
    imageUrl: optionalPublicUrlSchema,
  })
  .strict();

const progressiveGuessItemSchema = z
  .object({
    id: z.string().min(1),
    playerPrompt: z.string().min(1).max(480).optional(),
    clues: z.array(progressiveGuessClueSchema).min(2),
    reveal: progressiveGuessRevealSchema,
  })
  .strict();

/** * Succession d’images puis écran révélation (réponse figurant dans le JSON). */
export const progressiveGuessRoundSchema = z
  .object({
    kind: z.literal("progressive_guess"),
    id: z.string().min(1),
    title: z.string().min(1),
    items: z.array(progressiveGuessItemSchema).min(1),
  })
  .strict();

export type ProgressiveGuessRound = z.infer<typeof progressiveGuessRoundSchema>;
export type ProgressiveGuessItem = ProgressiveGuessRound["items"][number];

export function progressiveGuessTotalFlatSteps(round: ProgressiveGuessRound): number {
  return round.items.reduce((acc, it) => acc + it.clues.length + 1, 0);
}

export function progressiveGuessDecode(
  round: ProgressiveGuessRound,
  flatQi: number,
): { item: ProgressiveGuessItem; clueIndex: number | null } | null {
  let offset = 0;
  for (const item of round.items) {
    const span = item.clues.length + 1;
    const local = flatQi - offset;
    if (local >= 0 && local < span) {
      if (local < item.clues.length) return { item, clueIndex: local };
      return { item, clueIndex: null };
    }
    offset += span;
  }
  return null;
}

export const roundSchema = z.union([
  freeBuzzRoundSchema,
  imageBuzzRoundSchema,
  audioBlindRoundSchema,
  progressiveGuessRoundSchema,
  videoRoundSchema,
  quizRoundSchema,
]);

export type QuizRound = z.infer<typeof quizRoundSchema>;
export type VideoRound = z.infer<typeof videoRoundSchema>;
export type FreeBuzzRound = z.infer<typeof freeBuzzRoundSchema>;
export type ImageBuzzRound = z.infer<typeof imageBuzzRoundSchema>;
export type AudioBlindRound = z.infer<typeof audioBlindRoundSchema>;
export type PackRound = z.infer<typeof roundSchema>;
export type QuizQuestion = z.infer<typeof questionSchema>;

/** * Legacy video round: has `videoUrl` and no explicit `kind`. */
export function isVideoRound(r: PackRound): r is VideoRound {
  return "videoUrl" in r && !("kind" in r);
}

export function isFreeBuzzRound(r: PackRound): r is FreeBuzzRound {
  return (r as { kind?: string }).kind === "free_buzz";
}

export function isImageBuzzRound(r: PackRound): r is ImageBuzzRound {
  return (r as { kind?: string }).kind === "image_buzz";
}

export function isProgressiveGuessRound(r: PackRound): r is ProgressiveGuessRound {
  return (r as { kind?: string }).kind === "progressive_guess";
}

/** * Classic multi-choice quiz round (`questions` array, no explicit `kind`). */
export function isQuizRound(r: PackRound): r is QuizRound {
  return (
    !isVideoRound(r) &&
    !isFreeBuzzRound(r) &&
    !isImageBuzzRound(r) &&
    !isAudioBlindRound(r) &&
    !isProgressiveGuessRound(r)
  );
}

export function isAudioBlindRound(r: PackRound): r is AudioBlindRound {
  return (r as { kind?: string }).kind === "audio_blind";
}

export const quizPackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  version: z.number().int().positive(),
  rounds: z.array(roundSchema).min(1),
});

export type QuizPack = z.infer<typeof quizPackSchema>;

export function validatePackInvariants(parsed: QuizPack): void {
  for (const r of parsed.rounds) {
    if (
      isVideoRound(r) ||
      isFreeBuzzRound(r) ||
      isImageBuzzRound(r) ||
      isAudioBlindRound(r) ||
      isProgressiveGuessRound(r)
    ) {
      continue;
    }
    if (!isQuizRound(r)) continue;
    for (const q of r.questions) {
      if (q.correctIndex >= q.choices.length) {
        throw new Error(`Question ${q.id}: correctIndex out of bounds`);
      }
    }
  }
}

