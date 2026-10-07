import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fastifyJwt from "@fastify/jwt";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "../config.js";
import { PartyStore } from "../domain/store.js";
import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import { PackEditorStore } from "../games/packEditor.js";
import { ImportedPackStore } from "../games/zipPackImporter.js";
import { registerPartyRoutes } from "./routesParty.js";
import {
  PLAYER_TIME_SYNC_METHOD,
  PLAYER_TIME_SYNC_ROUTE,
  clockSyncFromSamples,
  playerTimeSyncPathOnServer,
  playerTimeSyncUrl,
  shouldStopClockSyncBurst,
} from "./playerTimeSyncUrl.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const mockBuzzCatalog: LoadedBuzzSoundCatalog = {
  sounds: [
    { key: "bz1", label: "Buzz 1", file: "buzzers/1.mp3", pool: "neutral" },
    { key: "good1", label: "Good Sound", file: "good/1.mp3", pool: "good" },
    { key: "bad1", label: "Bad Sound", file: "bad/1.mp3", pool: "bad" },
  ],
  byKey: new Map([
    ["bz1", { key: "bz1", label: "Buzz 1", file: "buzzers/1.mp3", pool: "neutral" }],
    ["good1", { key: "good1", label: "Good Sound", file: "good/1.mp3", pool: "good" }],
    ["bad1", { key: "bad1", label: "Bad Sound", file: "bad/1.mp3", pool: "bad" }],
  ]),
  defaultBuzzerKey: "bz1",
};

function testConfig(): AppConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    publicUrl: "http://127.0.0.1:3000",
    jwtSecret: "test-secret",
    basePath: "",
    partySweepMaxAgeMs: 60_000,
    partySweepIntervalMs: 60_000,
    gamesDir: path.resolve(MODULE_DIR, "../../../games"),
    corsOrigin: false,
    maxZipPackBytes: 1024,
    maxEditorImageBytes: 1024,
    autoPlayQuestionDurationMs: 1000,
    autoPlayRoundDurationMs: 1000,
    autoPlayTransitionDurationMs: 1000,
    readyTimeoutMs: 1000,
  };
}

describe("player time-sync URL vs registered route", () => {
  let app: FastifyInstance;
  let store: PartyStore;
  const registered: Array<{ method: string; url: string }> = [];

  beforeAll(async () => {
    store = new PartyStore(() => {}, mockBuzzCatalog);
    app = Fastify({ logger: false });
    await app.register(fastifyJwt, { secret: "test-secret" });
    app.addHook("onRoute", (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        registered.push({ method, url: route.url });
      }
    });
    await registerPartyRoutes(app, {
      store,
      packs: new Map(),
      importedPacks: new ImportedPackStore(),
      packEditor: new PackEditorStore(),
      config: testConfig(),
      buzzCatalog: mockBuzzCatalog,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers POST /api/parties/:partyId/me/time-sync next to the other player routes", () => {
    expect(registered).toContainEqual({
      method: PLAYER_TIME_SYNC_METHOD,
      url: PLAYER_TIME_SYNC_ROUTE,
    });
    expect(registered).toContainEqual({
      method: "POST",
      url: "/api/parties/:partyId/me/buzz",
    });
    expect(registered).not.toContainEqual({
      method: "POST",
      url: "/me/time-sync",
    });
    expect(registered).not.toContainEqual({
      method: "POST",
      url: "/buzzy-live-games/api/parties/:partyId/me/time-sync",
    });
  });

  it("builds the same path locally and under /buzzy-live-games after the proxy strips the prefix", () => {
    const partyId = "11111111-1111-4111-8111-111111111111";
    const rootUrl = playerTimeSyncUrl(partyId, "");
    const mountedUrl = playerTimeSyncUrl(partyId, "/buzzy-live-games/");

    expect(rootUrl).toBe(`/api/parties/${partyId}/me/time-sync`);
    expect(mountedUrl).toBe(`/buzzy-live-games/api/parties/${partyId}/me/time-sync`);
    expect(playerTimeSyncPathOnServer(partyId, "")).toBe(rootUrl);
    expect(playerTimeSyncPathOnServer(partyId, "/buzzy-live-games")).toBe(rootUrl);
    expect(playerTimeSyncPathOnServer(partyId, "buzzy-live-games")).toBe(rootUrl);
  });

  it("resolves POST on the server path and 404s the unprefixed public path and the wrong method", async () => {
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    const player = store.joinPlayer(party, "Alice", null, "base/1.png", "bz1");
    const token = await app.jwt.sign({ pid: party.id, sub: player.id });
    const headers = { authorization: `Bearer ${token}` };
    const payload = { clientTimestamp: 1_500 };

    const local = await app.inject({
      method: "POST",
      url: playerTimeSyncUrl(party.id, ""),
      headers,
      payload,
    });
    expect(local.statusCode).toBe(200);
    const localBody = local.json<{ clientTimestamp: number; serverTimestamp: number }>();
    expect(localBody.clientTimestamp).toBe(1_500);
    expect(typeof localBody.serverTimestamp).toBe("number");

    const afterStrip = await app.inject({
      method: "POST",
      url: playerTimeSyncPathOnServer(party.id, "/buzzy-live-games"),
      headers,
      payload,
    });
    expect(afterStrip.statusCode).toBe(200);

    const stillPrefixed = await app.inject({
      method: "POST",
      url: playerTimeSyncUrl(party.id, "/buzzy-live-games"),
      headers,
      payload,
    });
    expect(stillPrefixed.statusCode).toBe(404);

    const bare = await app.inject({
      method: "POST",
      url: "/me/time-sync",
      headers,
      payload,
    });
    expect(bare.statusCode).toBe(404);

    const getOnRoute = await app.inject({
      method: "GET",
      url: playerTimeSyncUrl(party.id, ""),
      headers,
    });
    expect(getOnRoute.statusCode).toBe(404);

    const missingToken = await app.inject({
      method: "POST",
      url: playerTimeSyncUrl(party.id, ""),
      payload,
    });
    expect(missingToken.statusCode).toBe(401);
  });

  it("player client builds the URL with the shared helper and the Vite mount path", () => {
    const clientSrc = readFileSync(
      path.join(MODULE_DIR, "../../client/src/clientClockSync.ts"),
      "utf8",
    );
    expect(clientSrc).toContain("playerTimeSyncUrl(partyId, BASE_PATH)");
    expect(clientSrc).not.toContain("fetch(`/api/parties/");
    expect(clientSrc).not.toContain('fetch("/api/parties/');
    expect(clientSrc).not.toContain("fetch('/api/parties/");
  });
});

describe("clock sync failure policy", () => {
  it("stops the burst on the first failure so a 404 is not retried four more times", () => {
    expect(shouldStopClockSyncBurst(0, true)).toBe(true);
    expect(shouldStopClockSyncBurst(1, true)).toBe(false);
    expect(shouldStopClockSyncBurst(0, false)).toBe(false);
  });

  it("falls back to offset 0 when every ping failed", () => {
    expect(clockSyncFromSamples([], 10_000)).toEqual({
      offsetMs: 0,
      minRttMs: 0,
      lastSyncAt: 10_000,
    });
  });

  it("keeps the lowest RTT sample when pings succeed", () => {
    expect(
      clockSyncFromSamples(
        [
          { offsetMs: 40, rttMs: 80 },
          { offsetMs: 12, rttMs: 20 },
          { offsetMs: 30, rttMs: 50 },
        ],
        10_000,
      ),
    ).toEqual({
      offsetMs: 12,
      minRttMs: 20,
      lastSyncAt: 10_000,
    });
  });
});
