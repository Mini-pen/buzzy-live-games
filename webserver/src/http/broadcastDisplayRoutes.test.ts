import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import type { AppConfig } from "../config.js";
import { PartyStore } from "../domain/store.js";
import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import { PackEditorStore } from "../games/packEditor.js";
import { ImportedPackStore } from "../games/zipPackImporter.js";
import { registerPartyRoutes } from "./routesParty.js";

const mockBuzzCatalog: LoadedBuzzSoundCatalog = {
  sounds: [
    { key: "bz1", label: "Buzz 1", file: "buzzers/1.mp3", pool: "neutral" },
    { key: "good1", label: "Good", file: "good/1.mp3", pool: "good" },
    { key: "bad1", label: "Bad", file: "bad/1.mp3", pool: "bad" },
  ],
  byKey: new Map([
    ["bz1", { key: "bz1", label: "Buzz 1", file: "buzzers/1.mp3", pool: "neutral" }],
    ["good1", { key: "good1", label: "Good", file: "good/1.mp3", pool: "good" }],
    ["bad1", { key: "bad1", label: "Bad", file: "bad/1.mp3", pool: "bad" }],
  ]),
  defaultBuzzerKey: "bz1",
};

const testConfig: AppConfig = {
  host: "127.0.0.1",
  port: 0,
  publicUrl: "http://127.0.0.1:3000",
  jwtSecret: "test-secret",
  basePath: "",
  partySweepMaxAgeMs: 60_000,
  partySweepIntervalMs: 60_000,
  gamesDir: "games",
  corsOrigin: false,
  maxZipPackBytes: 1024,
  maxEditorImageBytes: 1024,
  autoPlayQuestionDurationMs: 1000,
  autoPlayRoundDurationMs: 1000,
  autoPlayTransitionDurationMs: 1000,
  readyTimeoutMs: 1000,
};

function createStore(): PartyStore {
  return new PartyStore(() => {}, mockBuzzCatalog);
}

async function withRoutes(
  run: (ctx: { app: FastifyInstance; store: PartyStore }) => Promise<void>,
): Promise<void> {
  const store = createStore();
  const app = Fastify({ logger: false });
  await registerPartyRoutes(app, {
    store,
    packs: new Map(),
    importedPacks: new ImportedPackStore(),
    packEditor: new PackEditorStore(),
    config: testConfig,
    buzzCatalog: mockBuzzCatalog,
  });
  await app.ready();
  try {
    await run({ app, store });
  } finally {
    await app.close();
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

function readError(payload: unknown): { error: string; messages: string[] } {
  const body = asRecord(payload);
  if (typeof body.error !== "string") {
    throw new Error("Expected an error code");
  }
  const messages: string[] = [];
  if (Array.isArray(body.issues)) {
    for (const issue of body.issues) {
      const row = asRecord(issue);
      if (typeof row.message === "string") messages.push(row.message);
    }
  }
  if (typeof body.message === "string") messages.push(body.message);
  return { error: body.error, messages };
}

describe("broadcast display admin routes", () => {
  it("rejects an empty or mistyped broadcast-display body and accepts a partial patch", async () => {
    await withRoutes(async ({ app, store }) => {
      const party = store.createParty({
        maxPlayers: null,
        maxTeams: 2,
        closedAfterStart: false,
        allowRename: true,
        allowTeamChange: true,
      });
      const url = `/api/parties/${party.id}/host/broadcast-display`;
      const auth = { authorization: `Bearer ${party.adminToken}` };

      const empty = await app.inject({ method: "POST", url, headers: auth, payload: {} });
      expect(empty.statusCode).toBe(400);
      const emptyBody = readError(empty.json());
      expect(emptyBody.error).toBe("VALIDATION");
      expect(emptyBody.messages).toContain("Au moins un réglage d'affichage est requis.");

      const badView = await app.inject({
        method: "POST",
        url,
        headers: auth,
        payload: { broadcastViewModeGlobal: "groups" },
      });
      expect(badView.statusCode).toBe(400);
      expect(readError(badView.json()).error).toBe("VALIDATION");

      const badFlag = await app.inject({
        method: "POST",
        url,
        headers: auth,
        payload: { highlightBuzzWinner: "true", broadcastShowScores: null },
      });
      expect(badFlag.statusCode).toBe(400);
      expect(readError(badFlag.json()).error).toBe("VALIDATION");

      const missingAuth = await app.inject({
        method: "POST",
        url,
        payload: { highlightBuzzWinner: false },
      });
      expect(missingAuth.statusCode).toBe(401);
      expect(readError(missingAuth.json()).error).toBe("UNAUTHORIZED");

      const wrongToken = await app.inject({
        method: "POST",
        url,
        headers: { authorization: "Bearer not-the-token" },
        payload: { highlightBuzzWinner: false },
      });
      expect(wrongToken.statusCode).toBe(401);

      const missingParty = await app.inject({
        method: "POST",
        url: "/api/parties/missing-party/host/broadcast-display",
        headers: auth,
        payload: { playerShowScores: false },
      });
      expect(missingParty.statusCode).toBe(404);
      expect(readError(missingParty.json()).error).toBe("NOT_FOUND");

      const stripped = await app.inject({
        method: "POST",
        url,
        headers: auth,
        payload: { broadcastShowRanking: false, unexpected: true },
      });
      expect(stripped.statusCode).toBe(200);
      const hostBody = asRecord(stripped.json());
      expect(hostBody.broadcastShowRanking).toBe(false);
      expect(hostBody.broadcastShowScores).toBe(true);
      expect(hostBody.playerShowScores).toBe(true);
      expect(hostBody.highlightBuzzWinner).toBe(true);
      expect(hostBody.broadcastViewModeGlobal).toBe("team");
      expect(hostBody.decidedBuzzWinnerId).toBeNull();
      expect(hostBody).not.toHaveProperty("buzzTimeGapMs");
      expect(hostBody).toHaveProperty("soundBuzzerHostConfig");

      const playerView = await app.inject({ method: "GET", url: `/api/parties/${party.id}` });
      expect(playerView.statusCode).toBe(200);
      const playerBody = asRecord(playerView.json());
      expect(playerBody.broadcastShowRanking).toBe(false);
      expect(playerBody.broadcastShowScores).toBe(true);
      expect(playerBody.playerShowScores).toBe(true);
      expect(playerBody.highlightBuzzWinner).toBe(true);
      expect(playerBody.decidedBuzzWinnerId).toBeNull();
      expect(playerBody).not.toHaveProperty("soundBuzzerHostConfig");
      expect(playerBody).not.toHaveProperty("buzzTimeGapMs");

      const solo = store.createParty({
        maxPlayers: null,
        maxTeams: null,
        closedAfterStart: false,
        allowRename: true,
        allowTeamChange: true,
      });
      const teamRejected = await app.inject({
        method: "POST",
        url: `/api/parties/${solo.id}/host/broadcast-display`,
        headers: { authorization: `Bearer ${solo.adminToken}` },
        payload: { broadcastViewModeGlobal: "team" },
      });
      expect(teamRejected.statusCode).toBe(400);
      const teamBody = readError(teamRejected.json());
      expect(teamBody.error).toBe("TEAMS_DISABLED");
      expect(teamBody.messages.some((message) => message.includes("équipe"))).toBe(true);
    });
  });

  it("validates the per-manche broadcast view body", async () => {
    await withRoutes(async ({ app, store }) => {
      const party = store.createParty({
        maxPlayers: null,
        maxTeams: 2,
        closedAfterStart: false,
        allowRename: true,
        allowTeamChange: true,
      });
      store.hostAppendManche(party, {
        kind: "pack_quiz",
        title: "Quiz",
        packBasename: "pack",
        iframeUrl: null,
        youtubeEmbedUrl: null,
        directVideoUrl: null,
        savedRoundIndex: 0,
        savedQuestionIndex: 0,
        transitionKind: null,
        transitionDurationMs: null,
      });
      const mancheId = party.mancheScript[0]?.id;
      expect(mancheId).toEqual(expect.any(String));
      if (mancheId === undefined) return;

      const url = `/api/parties/${party.id}/host/manche/broadcast-view`;
      const auth = { authorization: `Bearer ${party.adminToken}` };

      const emptyId = await app.inject({
        method: "POST",
        url,
        headers: auth,
        payload: { id: "", broadcastViewMode: "individual" },
      });
      expect(emptyId.statusCode).toBe(400);
      expect(readError(emptyId.json()).error).toBe("VALIDATION");

      const longId = await app.inject({
        method: "POST",
        url,
        headers: auth,
        payload: { id: "x".repeat(41), broadcastViewMode: null },
      });
      expect(longId.statusCode).toBe(400);
      expect(readError(longId.json()).error).toBe("VALIDATION");

      const badMode = await app.inject({
        method: "POST",
        url,
        headers: auth,
        payload: { id: mancheId, broadcastViewMode: "squad" },
      });
      expect(badMode.statusCode).toBe(400);
      expect(readError(badMode.json()).error).toBe("VALIDATION");

      const missingMode = await app.inject({
        method: "POST",
        url,
        headers: auth,
        payload: { id: mancheId },
      });
      expect(missingMode.statusCode).toBe(400);
      expect(readError(missingMode.json()).error).toBe("VALIDATION");

      const unknown = await app.inject({
        method: "POST",
        url,
        headers: auth,
        payload: { id: "not-a-manche", broadcastViewMode: "individual" },
      });
      expect(unknown.statusCode).toBe(404);
      expect(readError(unknown.json()).error).toBe("NOT_FOUND");

      const cleared = await app.inject({
        method: "POST",
        url,
        headers: auth,
        payload: { id: mancheId, broadcastViewMode: null },
      });
      expect(cleared.statusCode).toBe(200);
      const clearedBody = asRecord(cleared.json());
      const script = clearedBody.mancheScript;
      expect(Array.isArray(script)).toBe(true);
      if (!Array.isArray(script)) return;
      const first = asRecord(script[0]);
      expect(first.broadcastViewMode).toBeNull();

      const solo = store.createParty({
        maxPlayers: null,
        maxTeams: null,
        closedAfterStart: false,
        allowRename: true,
        allowTeamChange: true,
      });
      store.hostAppendManche(solo, {
        kind: "pack_quiz",
        title: "Quiz",
        packBasename: "pack",
        iframeUrl: null,
        youtubeEmbedUrl: null,
        directVideoUrl: null,
        savedRoundIndex: 0,
        savedQuestionIndex: 0,
        transitionKind: null,
        transitionDurationMs: null,
      });
      const soloMancheId = solo.mancheScript[0]?.id ?? "";
      const teamRejected = await app.inject({
        method: "POST",
        url: `/api/parties/${solo.id}/host/manche/broadcast-view`,
        headers: { authorization: `Bearer ${solo.adminToken}` },
        payload: { id: soloMancheId, broadcastViewMode: "team" },
      });
      expect(teamRejected.statusCode).toBe(400);
      expect(readError(teamRejected.json()).error).toBe("TEAMS_DISABLED");

      const applied = await app.inject({
        method: "POST",
        url,
        headers: auth,
        payload: { id: mancheId, broadcastViewMode: "individual" },
      });
      expect(applied.statusCode).toBe(200);
      expect(party.mancheScript[0]?.broadcastViewMode).toBe("individual");
      expect(party.broadcastViewModeGlobal).toBe("team");
    });
  });
});
