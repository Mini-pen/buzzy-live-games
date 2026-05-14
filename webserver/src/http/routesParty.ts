import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";

import { z } from "zod";

import type { AppConfig } from "../config.js";
import type { PartyStore } from "../domain/store.js";
import type { QuizPack } from "../games/pack.js";
import { readBearer } from "./bearer.js";
import { replyDomain } from "./replyDomain.js";

export interface PartyRouteDeps {
  store: PartyStore;
  packs: Map<string, QuizPack>;
  config: AppConfig;
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
});

const patchSelfSchema = z.object({
  displayName: z.string().min(2).max(48).optional(),
  teamId: z.number().int().min(1).max(500).nullable().optional(),
});

const chatSchema = z.object({
  text: z.string().min(1).max(480),
});

const awardSchema = z.object({
  delta: z.number().int().min(-999).max(999),
});

const packPickSchema = z.object({
  packBasename: z.string().min(1).max(160),
});

const buzzWindowSchema = z.object({
  open: z.boolean(),
});

function requireParty(store: PartyStore, id: string) {
  const normalized = id.trim().toLowerCase();
  const party = store.get(normalized);
  if (!party) {
    const err = Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    throw err;
  }
  return party;
}

export async function registerPartyRoutes(
  app: FastifyInstance,
  deps: PartyRouteDeps,
): Promise<void> {
  const { store, packs, config } = deps;

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

  app.get("/api/packs", async () => ({
    packs: [...packs.entries()].map(([basename, p]) => ({
      basename,
      id: p.id,
      title: p.title,
      version: p.version,
      roundCount: p.rounds.length,
    })),
  }));

  app.get<{ Params: { joinCode: string } }>(
    "/api/parties/meta-by-code/:joinCode",
    async (req, reply) => {
      try {
        const party = store.getByJoinCode(req.params.joinCode);
        if (!party) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
        return { partyId: party.id, snapshot: store.snapshot(party) };
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
        snapshot: store.snapshot(party),
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
        return store.snapshot(party);
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
        const player = store.joinPlayer(party, body.displayName, body.teamId);
        const token = await app.jwt.sign({ pid: party.id, sub: player.id });
        return reply.status(201).send({
          playerId: player.id,
          playerToken: token,
          snapshot: store.snapshot(party),
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
        return store.snapshot(party);
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
        return store.snapshot(party);
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
        const party = requireParty(store, partyId);
        store.buzz(party, playerId);
        return store.snapshot(party);
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  /* ----- Host (admin token) ----- */

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/round/start",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.adminStartRound(party);
        return store.snapshot(party);
      } catch (err) {
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
        return store.snapshot(party);
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
        return store.snapshot(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
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
        return store.snapshot(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.patch<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/pack",
    async (req, reply) => {
      try {
        const body = packPickSchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const basename = body.packBasename.replace(/\.json$/u, "");
        const loaded = packs.get(basename);
        if (!loaded) {
          throw Object.assign(new Error("PACK_NOT_FOUND"), {
            code: "PACK_NOT_FOUND",
          });
        }
        store.setLoadedPack(party, loaded.id);
        return { ok: true, packId: loaded.id, snapshot: store.snapshot(party) };
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

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
        return store.snapshot(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );
}
