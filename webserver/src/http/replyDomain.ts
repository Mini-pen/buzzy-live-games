import type { FastifyReply } from "fastify";

export function replyDomain(reply: FastifyReply, err: unknown): FastifyReply {
  if (!(err instanceof Error)) {
    return reply.status(500).send({ error: "INTERNAL" });
  }

  interface WithCode extends Error {
    code?: string;
  }

  const rawCode = (err as WithCode).code;
  const code: string = typeof rawCode === "string" ? rawCode : "BAD_REQUEST";

  const map: Record<string, number> = {
    NOT_FOUND: 404,
    PARTY_CLOSED: 409,
    PARTY_FULL: 409,
    PARTY_GONE: 410,
    FORBIDDEN: 403,
    NO_BUZZ: 409,
    BAD_PHASE: 409,
    BAD_MESSAGE: 400,
    BAD_POINTS: 400,
    INVALID_NAME: 400,
    TEAM_REQUIRED: 400,
    TEAMS_DISABLED: 400,
    INVALID_TEAM: 400,
    TEAM_OUT_OF_RANGE: 400,
    UNAUTHORIZED: 401,
    JOIN_CODE_EXHAUSTED: 503,
    PACK_NOT_FOUND: 404,
    BAD_ROUND: 400,
    BAD_QUESTION: 400,
    ROUND_EXHAUSTED: 409,
    BAD_MOVE: 400,
    BAD_YOUTUBE_URL: 400,
    BAD_VIDEO_URL: 400,
    BAD_VIDEO_EXT: 400,
    HOSTED_VIDEO_NOT_FOUND: 404,
    BAD_AVATAR: 400,
    MEDIA_REPLAY_NOT_APPLICABLE: 400,
    PLAYER_AUDIO_FLAG_NOT_APPLICABLE: 400,
    BUZZ_SOUND_INVALID: 400,
    BAD_SOUND_POLICY: 400,
    AVATAR_CATALOG_EMPTY: 503,
    NOT_IN_BUZZ_QUEUE: 409,
    QUIZ_CHOICE_REQUIRED: 400,
    PLAYER_GONE: 410,
  };

  const status = map[code] ?? 400;
  return reply.status(status).send({ error: code, message: err.message });
}
