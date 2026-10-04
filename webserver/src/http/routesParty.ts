import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";

import { z } from "zod";

import type { AppConfig } from "../config.js";
import type { PartyStore, QuizBuzzChoiceOpts } from "../domain/store.js";
import type { Party } from "../domain/types.js";
import { partySnapshotWithGame, quizPackFromLoadedId } from "../domain/partySnapshotPresenter.js";
import type { QuizPack } from "../games/pack.js";
import { isQuizRound, quizPackSchema } from "../games/pack.js";
import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import { GAME_TUTORIALS } from "../domain/tutorials.js";
import type { ImportedPackStore } from "../games/zipPackImporter.js";
import { importZipPack } from "../games/zipPackImporter.js";
import { PackEditorStore } from "../games/packEditor.js";
import { downloadAndCompressImage } from "../games/imageDownloader.js";
import {
  isBuzzerClipForPlayerChoice,
  resolveBuzzSoundPublicUrl,
} from "../games/buzzSoundCatalog.js";
import { readBearer } from "./bearer.js";
import { replyDomain } from "./replyDomain.js";
import {
  avatarPublicRelativePath,
  getAvatarCatalog,
  getDefaultAvatarKey,
} from "../avatars/catalog.js";
import { youtubeWatchUrlToEmbedUrl } from "../domain/youtubeEmbed.js";
import {
  assertDirectVideoUrlForPartyManche,
  listHostedGameVideos,
} from "../games/localVideoCatalog.js";

export interface PartyRouteDeps {
  store: PartyStore;
  packs: Map<string, QuizPack>;
  importedPacks: ImportedPackStore;
  packEditor: PackEditorStore;
  config: AppConfig;
  buzzCatalog: LoadedBuzzSoundCatalog;
}

const createPartySchema = z
  .object({
    playersUnlimited: z.boolean(),
    teamsUnlimited: z.boolean(),
    maxPlayers: z.number().int().min(2).max(500).optional(),
    maxTeams: z.number().int().min(2).max(40).optional(),
    closedAfterStart: z.boolean(),
    allowRename: z.boolean(),
    allowTeamChange: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (!d.playersUnlimited && d.maxPlayers === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "maxPlayers is required unless playersUnlimited=true",
        path: ["maxPlayers"],
      });
    }
    if (!d.teamsUnlimited && d.maxTeams === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "maxTeams is required unless teamsUnlimited=true",
        path: ["maxTeams"],
      });
    }
  });

const joinBodySchema = z.object({
  displayName: z.string().min(2).max(48),
  teamId: z.number().int().min(1).max(500).nullable().optional(),
  avatarKey: z.string().min(1).max(48).optional(),
  buzzSoundKey: z.string().min(1).max(64).optional(),
});

const patchSelfSchema = z.object({
  displayName: z.string().min(2).max(48).optional(),
  teamId: z.number().int().min(1).max(500).nullable().optional(),
  avatarKey: z.string().min(1).max(48).optional(),
  buzzSoundKey: z.string().min(1).max(64).optional(),
});

const chatSchema = z.object({
  text: z.string().min(1).max(480),
});

const awardSchema = z.object({
  delta: z.number().int().min(-999).max(999),
});

const buzzWindowSchema = z.object({
  open: z.boolean(),
});

const buzzAutoCueAdvanceSchema = z.object({
  enabled: z.boolean(),
});

const buzzBodySchema = z.object({
  quizChoiceIndex: z.number().int().min(0).max(255).optional(),
});

const buzzResolveSchema = z.object({
  playerId: z.string().uuid(),
  verdict: z.enum(["good", "bad"]),
});

const playerAudioAllowSchema = z.object({
  allowed: z.boolean(),
});

const buzzSoundPolicySchema = z.object({
  allowedGoodKeys: z.array(z.string().min(1).max(64)).min(1),
  allowedBadKeys: z.array(z.string().min(1).max(64)).min(1),
  playPlayerBuzzTone: z.boolean(),
  echoPlayerBuzzOnHost: z.boolean(),
});

const mancheIdSchema = z.object({
  id: z.string().min(1).max(40),
});

const mancheLaunchSchema = z.object({
  id: z.string().min(1).max(40),
  mode: z.enum(["normal", "autonomous"]),
  skipIntro: z.boolean().optional(),
});

const mancheMoveSchema = z.object({
  id: z.string().min(1).max(40),
  direction: z.enum(["up", "down"]),
});

const addManchePackBody = z.object({
  kind: z.literal("pack_quiz"),
  title: z.string().min(1).max(160),
  packBasename: z.string().min(1).max(180),
});

const addMancheYoutubeBody = z.object({
  kind: z.literal("youtube"),
  title: z.string().min(1).max(160),
  url: z.string().min(1).max(500),
});

const addMancheDirectVideoBody = z.object({
  kind: z.literal("direct_video"),
  title: z.string().min(1).max(160),
  url: z.string().min(1).max(2048),
});

const addMancheTransitionBody = z.object({
  kind: z.literal("transition"),
  title: z.string().min(1).max(160),
  transitionKind: z.enum(["pause", "fade", "countdown"]),
  durationMs: z.number().int().min(1000).max(60000),
});

const autoPlayToggleSchema = z.object({
  enabled: z.boolean(),
});

const autoPlayPauseResumeSchema = z.object({
  paused: z.boolean(),
});

const addMancheBody = z.union([
  addManchePackBody,
  addMancheYoutubeBody,
  addMancheDirectVideoBody,
  addMancheTransitionBody,
]);

function requireParty(store: PartyStore, id: string) {
  const normalized = id.trim().toLowerCase();
  const party = store.get(normalized);
  if (!party) {
    const err = Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    throw err;
  }
  return party;
}

function quizBuzzOptsForRequest(
  party: Party,
  packs: Map<string, QuizPack>,
  quizChoiceIndex: number | undefined,
): QuizBuzzChoiceOpts | undefined {
  const loaded = quizPackFromLoadedId(packs, party.loadedPackId);
  if (!loaded || party.state !== "round_active" || !party.buzzWindowOpen)
    return undefined;
  const ri = party.currentRoundIndex;
  const qi = party.currentQuestionIndex;
  if (
    ri === null ||
    qi === null ||
    ri < 0 ||
    qi < 0 ||
    ri >= loaded.rounds.length
  )
    return undefined;
  const round = loaded.rounds[ri];
  if (!isQuizRound(round)) return undefined;
  const question = round.questions[qi];
  if (!question || question.choices.length < 1) return undefined;
  return {
    choicesLen: question.choices.length,
    choiceIndex: quizChoiceIndex,
  };
}

function quizPickFeedbackAfterBuzz(
  packs: Map<string, QuizPack>,
  party: Party,
  quizBuzz: QuizBuzzChoiceOpts | undefined,
  newlyBuzzed: boolean,
): { choiceIndex: number } | undefined {
  if (!newlyBuzzed || quizBuzz?.choicesLen === undefined) return undefined;
  const ix = quizBuzz.choiceIndex;
  if (typeof ix !== "number") return undefined;
  const loaded = quizPackFromLoadedId(packs, party.loadedPackId);
  const ri = party.currentRoundIndex;
  const qi = party.currentQuestionIndex;
  if (!loaded || ri === null || qi === null || ri < 0 || qi < 0) return undefined;
  const round = loaded.rounds[ri];
  if (!isQuizRound(round)) return undefined;
  const q = round.questions[qi];
  if (!q) return undefined;
  return { choiceIndex: ix };
}

export async function registerPartyRoutes(
  app: FastifyInstance,
  deps: PartyRouteDeps,
): Promise<void> {
  const { store, packs, importedPacks, config, buzzCatalog } = deps;

  const allPacks = (): Map<string, QuizPack> => {
    return new Map([...packs, ...importedPacks.getAll()]);
  };

  const snapPlayer = (party: Party): ReturnType<typeof partySnapshotWithGame> =>
    partySnapshotWithGame(party, allPacks(), "player");

  const snapHost = (party: Party): ReturnType<typeof partySnapshotWithGame> =>
    partySnapshotWithGame(party, allPacks(), "host");

  const gatePlayerJwt: preHandlerHookHandler = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "UNAUTHORIZED" });
    }
  };

  app.get("/api/health", async () => ({
    ok: true,
    ts: Date.now(),
  }));

  app.get("/api/packs", async () => {
    const diskPacks = [...packs.entries()].map(([basename, p]) => ({
      basename,
      id: p.id,
      title: p.title,
      version: p.version,
      roundCount: p.rounds.length,
      source: "disk" as const,
    }));

    const imported = [...importedPacks.getAll().entries()].map(([id, p]) => ({
      basename: id,
      id: p.id,
      title: p.title,
      version: p.version,
      roundCount: p.rounds.length,
      source: "imported" as const,
    }));

    return { packs: [...diskPacks, ...imported] };
  });

  app.get("/api/games/video-files", async () => ({
    videos: await listHostedGameVideos(config.gamesDir),
  }));

  app.get("/api/avatars", async () => ({
    defaultKey: getDefaultAvatarKey(),
    avatars: getAvatarCatalog().map((entry) => ({
      key: entry.key,
      label: entry.label,
      url: avatarPublicRelativePath(entry.key),
    })),
  }));

  app.get("/api/sounds", async () => {
    const selectable = buzzCatalog.sounds.filter((s) => isBuzzerClipForPlayerChoice(s));
    const defaultInList = selectable.some((s) => s.key === buzzCatalog.defaultBuzzerKey);
    const defaultBuzzerKey = defaultInList
      ? buzzCatalog.defaultBuzzerKey
      : (selectable[0]?.key ?? buzzCatalog.defaultBuzzerKey);

    return {
      defaultBuzzerKey,
      sounds: selectable.map((s) => ({
        key: s.key,
        label: s.label,
        pool: s.pool,
        url: resolveBuzzSoundPublicUrl(s),
      })),
    };
  });

  app.get<{ Params: { joinCode: string } }>(
    "/api/parties/meta-by-code/:joinCode",
    async (req, reply) => {
      try {
        const party = store.getByJoinCode(req.params.joinCode);
        if (!party) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
        return { partyId: party.id, snapshot: snapPlayer(party) };
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.post("/api/parties", async (req, reply) => {
    try {
      const body = createPartySchema.parse(req.body ?? {});
      const maxPlayers = body.playersUnlimited ? null : body.maxPlayers ?? null;
      const maxTeams = body.teamsUnlimited ? null : body.maxTeams ?? null;
      if (body.playersUnlimited !== true && maxPlayers === null) {
        return reply.status(400).send({ error: "INVALID_PAYLOAD" });
      }
      if (body.teamsUnlimited !== true && (maxTeams === null || maxTeams < 2)) {
        return reply.status(400).send({ error: "INVALID_PAYLOAD" });
      }

      const party = store.createParty({
        maxPlayers,
        maxTeams,
        closedAfterStart: body.closedAfterStart,
        allowRename: body.allowRename,
        allowTeamChange: body.allowTeamChange,
      });

      const joinRelative = `/join?code=${encodeURIComponent(party.joinCode)}`;

      const joinUrl = `${config.publicUrl}${joinRelative}`;
      const adminUrl = `${config.publicUrl}/party/${party.id}/admin#token=${encodeURIComponent(party.adminToken)}`;

      return reply.status(201).send({
        partyId: party.id,
        joinCode: party.joinCode,
        adminToken: party.adminToken,
        joinUrl,
        adminUrl,
        joinRelative,
        snapshot: snapPlayer(party),
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
      }
      return replyDomain(reply, err);
    }
  });

  app.get<{ Params: { partyId: string } }>(
    "/api/parties/:partyId",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (typeof token === "string" && token.trim() !== "") {
          if (store.verifyAdminToken(party, token)) return snapHost(party);
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        }
        return snapPlayer(party);
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/join",
    async (req, reply) => {
      try {
        const body = joinBodySchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const player = store.joinPlayer(
          party,
          body.displayName,
          body.teamId,
          body.avatarKey,
          body.buzzSoundKey,
        );
        const token = await app.jwt.sign({ pid: party.id, sub: player.id });
        return reply.status(201).send({
          playerId: player.id,
          playerToken: token,
          snapshot: snapPlayer(party),
        });
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.patch<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/me",
    {
      preHandler: [gatePlayerJwt],
    },
    async (req, reply) => {
      try {
        const parsed = patchSelfSchema.parse(req.body ?? {});
        const principal = req.user instanceof Object ? req.user : null;
        interface U {
          pid?: string;
          sub?: string;
        }
        const u = principal as U;
        const partyId = u.pid;
        const playerId = u.sub;
        if (typeof partyId !== "string" || typeof playerId !== "string") {
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        }
        if (partyId !== req.params.partyId) {
          return reply.status(403).send({ error: "FORBIDDEN" });
        }
        const party = requireParty(store, partyId);
        store.patchPlayerSelf(party, playerId, parsed);
        return snapPlayer(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/me/chat",
    {
      preHandler: [gatePlayerJwt],
    },
    async (req, reply) => {
      try {
        const body = chatSchema.parse(req.body ?? {});
        const principal = req.user instanceof Object ? req.user : null;
        const u = principal as { pid?: string; sub?: string };
        const partyId = u.pid;
        const playerId = u.sub;
        if (typeof partyId !== "string" || typeof playerId !== "string") {
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        }
        if (partyId !== req.params.partyId)
          return reply.status(403).send({ error: "FORBIDDEN" });
        const party = requireParty(store, partyId);
        const player = party.players.get(playerId);
        if (!player) return reply.status(410).send({ error: "PLAYER_GONE" });
        store.appendChat(party, playerId, player.displayName, body.text);
        return snapPlayer(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/me/buzz",
    {
      preHandler: [gatePlayerJwt],
    },
    async (req, reply) => {
      try {
        const principal = req.user instanceof Object ? req.user : null;
        const u = principal as { pid?: string; sub?: string };
        const partyId = u.pid;
        const playerId = u.sub;
        if (typeof partyId !== "string" || typeof playerId !== "string") {
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        }
        if (partyId !== req.params.partyId)
          return reply.status(403).send({ error: "FORBIDDEN" });
        const parsedBody = buzzBodySchema.safeParse(req.body ?? {});
        if (!parsedBody.success) {
          return reply.status(400).send({ error: "VALIDATION", issues: parsedBody.error.issues });
        }
        const party = requireParty(store, partyId);
        const alreadyInQueue = party.buzzOrder.some((idBuzz) => idBuzz === playerId);
        const quizBuzz = quizBuzzOptsForRequest(
          party,
          allPacks(),
          parsedBody.data.quizChoiceIndex,
        );
        store.buzz(party, playerId, quizBuzz);
        const loadedAfterBuzz = quizPackFromLoadedId(allPacks(), party.loadedPackId);
        store.maybeAutoResolveQuizWhenEveryPlayerBuzzed(party, loadedAfterBuzz);
        const snapshot = snapPlayer(party);
        let buzzToneUrl: string | undefined;
        if (!alreadyInQueue && party.buzzSound.playPlayerBuzzTone) {
          const plNow = party.players.get(playerId);
          const sfx = plNow ? buzzCatalog.byKey.get(plNow.buzzSoundKey) : undefined;
          if (sfx) buzzToneUrl = resolveBuzzSoundPublicUrl(sfx) || undefined;
        }
        const quizPickFeedback = quizPickFeedbackAfterBuzz(allPacks(), party, quizBuzz, !alreadyInQueue);
        return {
          snapshot,
          buzzToneUrl,
          ...(quizPickFeedback !== undefined ? { quizPickFeedback } : {}),
        };
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  /* ----- Host (admin token) ----- */

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/cue/next",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const loaded = quizPackFromLoadedId(allPacks(), party.loadedPackId);
        if (!loaded)
          throw Object.assign(new Error("PACK_NOT_FOUND"), { code: "PACK_NOT_FOUND" });
        store.adminAdvanceCue(party, loaded);
        return snapHost(party);
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/cue/replay",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const loaded = quizPackFromLoadedId(allPacks(), party.loadedPackId);
        if (!loaded)
          throw Object.assign(new Error("PACK_NOT_FOUND"), { code: "PACK_NOT_FOUND" });
        store.adminReplayMediaCue(party, loaded);
        return snapHost(party);
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/player-audio-control",
    async (req, reply) => {
      try {
        const body = playerAudioAllowSchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const loaded = quizPackFromLoadedId(allPacks(), party.loadedPackId);
        if (!loaded)
          throw Object.assign(new Error("PACK_NOT_FOUND"), { code: "PACK_NOT_FOUND" });
        store.adminSetAllowPlayerAudioControl(party, loaded, body.allowed);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/sound-policy",
    async (req, reply) => {
      try {
        const body = buzzSoundPolicySchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.adminUpdateBuzzSoundPolicy(party, body);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/round/pause",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.adminPauseToLobby(party);
        return snapHost(party);
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/buzz-window",
    async (req, reply) => {
      try {
        const body = buzzWindowSchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.adminSetBuzzOpen(party, body.open);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/buzz-auto-cue-advance",
    async (req, reply) => {
      try {
        const body = buzzAutoCueAdvanceSchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.adminSetAutoOpenBuzzOnCueAdvance(party, body.enabled);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/quiz-auto-all-buzzed",
    async (req, reply) => {
      try {
        const body = buzzAutoCueAdvanceSchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.adminSetAutoAdvanceQuizWhenAllBuzzed(party, body.enabled);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/buzz-resolve",
    async (req, reply) => {
      try {
        const body = buzzResolveSchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const loaded = quizPackFromLoadedId(allPacks(), party.loadedPackId);
        if (!loaded)
          throw Object.assign(new Error("PACK_NOT_FOUND"), { code: "PACK_NOT_FOUND" });
        store.adminValidateBuzzAnswer(party, body.playerId, body.verdict, loaded);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string; playerId: string } }>(
    "/api/parties/:partyId/host/players/:playerId/kick",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.adminKickPlayer(party, req.params.playerId);
        return snapHost(party);
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/delete",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.adminDeleteParty(party);
        return reply.status(204).send();
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.patch<{ Params: { partyId: string; playerId: string } }>(
    "/api/parties/:partyId/host/players/:playerId/score",
    async (req, reply) => {
      try {
        const deltaBody = awardSchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.adminAwardPoints(party, req.params.playerId, deltaBody.delta);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/manche/add",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const body = addMancheBody.parse(req.body ?? {});

        if (body.kind === "pack_quiz") {
          const basename = body.packBasename.replace(/\.json$/u, "");
          if (!allPacks().get(basename)) {
            throw Object.assign(new Error("PACK_NOT_FOUND"), {
              code: "PACK_NOT_FOUND",
            });
          }
          store.hostAppendManche(party, {
            kind: "pack_quiz",
            title: body.title.trim(),
            packBasename: basename,
            iframeUrl: null,
            youtubeEmbedUrl: null,
            directVideoUrl: null,
            savedRoundIndex: 0,
            savedQuestionIndex: 0,
            transitionKind: null,
            transitionDurationMs: null,
          });
        } else if (body.kind === "youtube") {
          const embed = youtubeWatchUrlToEmbedUrl(body.url);
          if (embed === null) {
            throw Object.assign(new Error("BAD_YOUTUBE_URL"), {
              code: "BAD_YOUTUBE_URL",
            });
          }
          store.hostAppendManche(party, {
            kind: "youtube",
            title: body.title.trim(),
            packBasename: null,
            iframeUrl: null,
            youtubeEmbedUrl: embed,
            directVideoUrl: null,
            savedRoundIndex: 0,
            savedQuestionIndex: 0,
            transitionKind: null,
            transitionDurationMs: null,
          });
        } else if (body.kind === "direct_video") {
          const safeUrl = assertDirectVideoUrlForPartyManche(config.gamesDir, body.url);
          store.hostAppendManche(party, {
            kind: "direct_video",
            title: body.title.trim(),
            packBasename: null,
            iframeUrl: null,
            youtubeEmbedUrl: null,
            directVideoUrl: safeUrl,
            savedRoundIndex: 0,
            savedQuestionIndex: 0,
            transitionKind: null,
            transitionDurationMs: null,
          });
        } else {
          store.hostAppendManche(party, {
            kind: "transition",
            title: body.title.trim(),
            packBasename: null,
            iframeUrl: null,
            youtubeEmbedUrl: null,
            directVideoUrl: null,
            savedRoundIndex: 0,
            savedQuestionIndex: 0,
            transitionKind: body.transitionKind,
            transitionDurationMs: body.durationMs,
          });
        }

        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/manche/remove",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.hostRemoveManche(party, mancheIdSchema.parse(req.body ?? {}).id);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/manche/move",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const b = mancheMoveSchema.parse(req.body ?? {});
        store.hostMoveManche(party, b.id, b.direction === "up" ? -1 : 1);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/manche/launch",
    async (req, reply) => {
      try {
        const body = mancheLaunchSchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const result = store.hostLaunchManche(
          party,
          body.id,
          body.mode,
          body.skipIntro ?? false,
          allPacks(),
        );
        return { ...snapHost(party), tutorialInfo: result };
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/manche/play",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.hostPlayMancheById(party, mancheIdSchema.parse(req.body ?? {}).id, allPacks());
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.get("/api/tutorials", async (_req, reply) => {
    return reply.send({ tutorials: GAME_TUTORIALS });
  });

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/chat",
    async (req, reply) => {
      try {
        const body = chatSchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.appendHostChat(party, body.text);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/auto-play/toggle",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const body = autoPlayToggleSchema.parse(req.body ?? {});
        const autoPlayConfig = {
          questionDurationMs: config.autoPlayQuestionDurationMs,
          roundDurationMs: config.autoPlayRoundDurationMs,
          transitionDurationMs: config.autoPlayTransitionDurationMs,
        };
        store.adminToggleAutoPlay(party, body.enabled, autoPlayConfig, allPacks());
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/auto-play/pause-resume",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const body = autoPlayPauseResumeSchema.parse(req.body ?? {});
        store.adminAutoPlayPauseResume(party, body.paused);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/auto-play/skip-forward",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const autoPlayConfig = {
          questionDurationMs: config.autoPlayQuestionDurationMs,
          roundDurationMs: config.autoPlayRoundDurationMs,
          transitionDurationMs: config.autoPlayTransitionDurationMs,
        };
        store.adminAutoPlaySkipForward(party, autoPlayConfig, allPacks());
        return snapHost(party);
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/auto-play/skip-backward",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const autoPlayConfig = {
          questionDurationMs: config.autoPlayQuestionDurationMs,
          roundDurationMs: config.autoPlayRoundDurationMs,
          transitionDurationMs: config.autoPlayTransitionDurationMs,
        };
        store.adminAutoPlaySkipBackward(party, autoPlayConfig, allPacks());
        return snapHost(party);
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/import-pack-zip",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });

        const data = await req.file();
        if (!data) {
          return reply.status(400).send({ error: "NO_FILE" });
        }

        const buffer = await data.toBuffer();

        const existingDiskPackIds = new Set([...packs.values()].map((p) => p.id));
        const existingImportedPackIds = new Set([...importedPacks.getAll().values()].map((p) => p.id));

        const { pack, zipEntries } = importZipPack(
          buffer,
          config.maxZipPackBytes,
          existingDiskPackIds,
          existingImportedPackIds,
        );

        importedPacks.add(pack, zipEntries);

        app.log.info({ packId: pack.id, title: pack.title }, "ZIP pack imported");

        return reply.status(201).send({
          pack: {
            id: pack.id,
            title: pack.title,
            version: pack.version,
            roundCount: pack.rounds.length,
          },
        });
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  const { packEditor } = deps;

  app.post<{ Params: { partyId: string }; Body: { packId: string } }>(
    "/api/parties/:partyId/host/editor/start",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });

        const body = z.object({ packId: z.string().min(1) }).parse(req.body);

        let pack = packs.get(body.packId);
        const existingMedia = new Map<string, Buffer>();

        if (!pack) {
          pack = importedPacks.get(body.packId);
          if (!pack) {
            return reply.status(404).send({ error: "PACK_NOT_FOUND" });
          }
          // * For imported packs, collect existing media
          // * (Media paths in imported packs are already normalized to /imported-packs/:id/...)
        }

        const editorId = packEditor.startEditing(pack, existingMedia);

        app.log.info({ partyId: party.id, packId: body.packId, editorId }, "Pack editor started");

        return reply.status(200).send({
          editorId,
          pack,
        });
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.get<{ Params: { partyId: string; editorId: string } }>(
    "/api/parties/:partyId/host/editor/:editorId",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });

        const pack = packEditor.get(req.params.editorId);
        if (!pack) {
          return reply.status(404).send({ error: "EDITOR_SESSION_NOT_FOUND" });
        }

        return reply.status(200).send({ pack });
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.put<{ Params: { partyId: string; editorId: string }; Body: { pack: unknown } }>(
    "/api/parties/:partyId/host/editor/:editorId",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });

        const body = z.object({ pack: z.unknown() }).parse(req.body);
        const validated = quizPackSchema.parse(body.pack);

        packEditor.update(req.params.editorId, validated);

        app.log.info(
          { partyId: party.id, editorId: req.params.editorId, packId: validated.id },
          "Pack editor updated",
        );

        return reply.status(200).send({ pack: validated });
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string; editorId: string }; Body: { imageUrl: string } }>(
    "/api/parties/:partyId/host/editor/:editorId/download-image",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });

        const body = z.object({ imageUrl: z.string().url() }).parse(req.body);

        const { buffer, format } = await downloadAndCompressImage(
          body.imageUrl,
          config.maxEditorImageBytes,
        );

        const filename = `images/${Date.now()}.${format}`;
        const relativePath = packEditor.addMedia(req.params.editorId, filename, buffer);

        app.log.info(
          {
            partyId: party.id,
            editorId: req.params.editorId,
            imageUrl: body.imageUrl,
            filename,
            size: buffer.length,
          },
          "Image downloaded and added to pack",
        );

        return reply.status(200).send({
          relativePath,
          size: buffer.length,
        });
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.get<{ Params: { partyId: string; editorId: string } }>(
    "/api/parties/:partyId/host/editor/:editorId/export",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });

        const zipBuffer = packEditor.exportAsZip(req.params.editorId);
        const pack = packEditor.get(req.params.editorId);

        if (!pack) {
          return reply.status(404).send({ error: "EDITOR_SESSION_NOT_FOUND" });
        }

        app.log.info(
          { partyId: party.id, editorId: req.params.editorId, packId: pack.id },
          "Pack exported as ZIP",
        );

        return reply
          .status(200)
          .header("Content-Type", "application/zip")
          .header("Content-Disposition", `attachment; filename="${pack.id}.zip"`)
          .send(zipBuffer);
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string; editorId: string } }>(
    "/api/parties/:partyId/host/editor/:editorId/use",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });

        const pack = packEditor.get(req.params.editorId);
        if (!pack) {
          return reply.status(404).send({ error: "EDITOR_SESSION_NOT_FOUND" });
        }

        const media = packEditor.getMedia(req.params.editorId);
        if (!media) {
          return reply.status(404).send({ error: "EDITOR_SESSION_NOT_FOUND" });
        }

        // * Create a synthetic ZIP to re-import the edited pack
        const zipBuffer = packEditor.exportAsZip(req.params.editorId);

        const existingDiskPackIds = new Set([...packs.values()].map((p) => p.id));
        const existingImportedPackIds = new Set([...importedPacks.getAll().values()].map((p) => p.id));

        // * Remove the existing imported pack with the same id if it exists
        existingImportedPackIds.delete(pack.id);

        const { pack: importedPack, zipEntries } = importZipPack(
          zipBuffer,
          config.maxZipPackBytes,
          existingDiskPackIds,
          existingImportedPackIds,
        );

        importedPacks.add(importedPack, zipEntries);

        app.log.info(
          { partyId: party.id, editorId: req.params.editorId, packId: pack.id },
          "Edited pack imported for immediate use",
        );

        return reply.status(200).send({
          pack: {
            id: importedPack.id,
            title: importedPack.title,
            version: importedPack.version,
            roundCount: importedPack.rounds.length,
          },
        });
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.delete<{ Params: { partyId: string; editorId: string } }>(
    "/api/parties/:partyId/host/editor/:editorId",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });

        packEditor.close(req.params.editorId);

        app.log.info(
          { partyId: party.id, editorId: req.params.editorId },
          "Pack editor session closed",
        );

        return reply.status(204).send();
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );
}
