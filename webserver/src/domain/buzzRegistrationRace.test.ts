import path from "node:path";
import { fileURLToPath } from "node:url";

import fastifyJwt from "@fastify/jwt";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../config.js";
import { convertToServerTime } from "../../client/src/clientClockSync.js";
import { PartyStore } from "./store.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import type { Party, PartyPublicSnapshot, Player } from "./types.js";
import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import { ImportedPackStore } from "../games/zipPackImporter.js";
import { PackEditorStore } from "../games/packEditor.js";
import { registerPartyRoutes } from "../http/routesParty.js";

/**
 * * One accepted buzz must become visible without a second press.
 *   The grace window parks the buzz outside the snapshot the clients read.
 */

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const buzzCatalog: LoadedBuzzSoundCatalog = {
  defaultBuzzerKey: "good1",
  sounds: [
    { key: "good1", label: "Good", pool: "good", file: "buzzers/good1.mp3" },
    { key: "bad1", label: "Bad", pool: "bad", file: "buzzers/bad1.mp3" },
  ],
  byKey: new Map([
    ["good1", { key: "good1", label: "Good", pool: "good", file: "buzzers/good1.mp3" }],
    ["bad1", { key: "bad1", label: "Bad", pool: "bad", file: "buzzers/bad1.mp3" }],
  ]),
};

interface BuzzPayload {
  buzzOrder: string[];
  pendingBuzzPlayerIds?: string[];
}

function errorCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return "";
}

function player(id: string, name: string): Player {
  return {
    id,
    displayName: name,
    avatarKey: "a.png",
    buzzSoundKey: "good1",
    teamId: null,
    score: 0,
    joinedAt: 1,
  };
}

function openParty(names: string[]): { store: PartyStore; party: Party; ids: string[] } {
  const store = new PartyStore(() => {}, buzzCatalog);
  const party = store.createParty({
    maxPlayers: null,
    maxTeams: null,
    closedAfterStart: false,
    allowRename: true,
    allowTeamChange: true,
  });
  const ids = names.map((name, index) => {
    const id = `p${index}-${name.toLowerCase()}`;
    party.players.set(id, player(id, name));
    return id;
  });
  party.state = "round_active";
  party.hasStartedRound = true;
  party.buzzWindowOpen = true;
  party.buzzWindowOpenedAt = Date.now();
  return { store, party, ids };
}

/** * Same two calls the buzz route makes before it returns the snapshot. */
function routeBuzz(store: PartyStore, party: Party, playerId: string, clientTimestamp?: number): void {
  store.buzz(party, playerId, clientTimestamp);
  store.maybeFinalizeBuzzDecision(party);
}

function payload(party: Party): PartyPublicSnapshot & BuzzPayload {
  return partySnapshotWithGame(party, new Map(), "player") as PartyPublicSnapshot & BuzzPayload;
}

function buzzVisible(snap: BuzzPayload, playerId: string): boolean {
  return snap.buzzOrder.includes(playerId) || (snap.pendingBuzzPlayerIds?.includes(playerId) ?? false);
}

describe("buzz registration without a second press", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the default grace window, so a lone player is decided on the first buzz", () => {
    const { store, party, ids } = openParty(["Alice"]);
    expect(party.buzzGraceWindowMs).toBe(500);
    routeBuzz(store, party, ids[0]!);
    expect(party.buzzOrder).toEqual([ids[0]]);
    expect(buzzVisible(payload(party), ids[0]!)).toBe(true);
  });

  it("keeps the first of two players when the second buzz closes the grace window", () => {
    const { store, party, ids } = openParty(["Alice", "Bob"]);
    const [alice, bob] = ids;
    routeBuzz(store, party, alice!);
    expect(party.buzzOrder).not.toContain(alice);
    routeBuzz(store, party, bob!);
    expect(party.buzzOrder).toEqual([alice, bob]);
    expect(party.pendingBuzzQueue).toHaveLength(0);
  });

  it("records a buzz immediately when the grace window is 0", () => {
    const { store, party, ids } = openParty(["Alice", "Bob", "Chloé"]);
    store.adminSetBuzzGraceWindow(party, 0);
    routeBuzz(store, party, ids[0]!);
    expect(party.buzzOrder).toEqual([ids[0]]);
    expect(buzzVisible(payload(party), ids[0]!)).toBe(true);
  });

  it("keeps the first buzz when the same player posts again before the decision", () => {
    const { store, party, ids } = openParty(["Alice", "Bob", "Chloé"]);
    routeBuzz(store, party, ids[0]!);
    routeBuzz(store, party, ids[0]!);
    expect(party.pendingBuzzQueue.map((row) => row.playerId)).toEqual([ids[0]]);
    expect(party.buzzOrder).toEqual([]);
  });

  it.fails("publishes the first buzz in the player snapshot while the grace window is still open", () => {
    const { store, party, ids } = openParty(["Alice", "Bob", "Chloé"]);
    routeBuzz(store, party, ids[0]!);
    expect(party.pendingBuzzQueue.map((row) => row.playerId)).toEqual([ids[0]]);
    expect(buzzVisible(payload(party), ids[0]!)).toBe(true);
  });

  it.fails("moves that buzz into buzzOrder once the grace window elapses, with no second buzz", async () => {
    vi.useFakeTimers();
    const { store, party, ids } = openParty(["Alice", "Bob", "Chloé"]);
    routeBuzz(store, party, ids[0]!);
    await vi.advanceTimersByTimeAsync(party.buzzGraceWindowMs);
    expect(party.buzzOrder).toContain(ids[0]);
    expect(buzzVisible(payload(party), ids[0]!)).toBe(true);
  });

  it.fails("keeps both near-simultaneous buzzes when a third player never buzzes", async () => {
    vi.useFakeTimers();
    const { store, party, ids } = openParty(["Alice", "Bob", "Chloé"]);
    const [alice, bob] = ids;
    routeBuzz(store, party, alice!);
    await vi.advanceTimersByTimeAsync(5);
    routeBuzz(store, party, bob!);
    await vi.advanceTimersByTimeAsync(party.buzzGraceWindowMs);
    expect(party.buzzOrder).toEqual([alice, bob]);
  });
});

describe("buzz at the countdown boundary", () => {
  it.fails("accepts a buzz once countdownDurationSec has elapsed, before the 500 ms tick", () => {
    const { store, party, ids } = openParty(["Alice", "Bob"]);
    const durationSec = 5;
    party.buzzWindowOpen = false;
    party.buzzWindowOpenedAt = null;
    party.appliedCountdownDurationSec = durationSec;
    party.countdownDurationSec = durationSec;
    party.countdownStartedAt = Date.now() - durationSec * 1000;
    expect(party.buzzWindowOpen).toBe(false);
    expect(() => store.buzz(party, ids[0]!, Date.now())).not.toThrow();
    expect(party.pendingBuzzQueue.some((row) => row.playerId === ids[0]) || party.buzzOrder.includes(ids[0]!)).toBe(
      true,
    );
  });
});

describe("a refused buzz does not stick", () => {
  it("accepts the next open after a buzz during the between-question pause", () => {
    const { store, party, ids } = openParty(["Alice", "Bob"]);
    party.buzzWindowOpen = false;
    party.nextQuestionCountdownStartedAt = Date.now();
    expect(() => store.buzz(party, ids[0]!, Date.now())).toThrow();
    try {
      store.buzz(party, ids[0]!, Date.now());
    } catch (err) {
      expect(errorCode(err)).toBe("NO_BUZZ");
    }
    expect(party.pendingBuzzQueue).toHaveLength(0);
    expect(party.buzzOrder).toEqual([]);

    party.nextQuestionCountdownStartedAt = null;
    party.buzzWindowOpen = true;
    party.buzzWindowOpenedAt = Date.now();
    routeBuzz(store, party, ids[0]!);
    expect(party.pendingBuzzQueue.map((row) => row.playerId)).toEqual([ids[0]]);
  });

  it("accepts the next open after a buzz during « Prêt ? »", () => {
    const { store, party, ids } = openParty(["Alice"]);
    party.buzzWindowOpen = false;
    party.readyCheckEnabled = true;
    party.readyPhaseStartedAt = Date.now();
    try {
      store.buzz(party, ids[0]!, Date.now());
      expect.fail("buzz should be refused");
    } catch (err) {
      expect(errorCode(err)).toBe("NO_BUZZ");
    }
    expect(party.pendingBuzzQueue).toHaveLength(0);

    party.readyPhaseStartedAt = null;
    party.buzzWindowOpen = true;
    party.buzzWindowOpenedAt = Date.now();
    routeBuzz(store, party, ids[0]!);
    expect(party.buzzOrder).toEqual([ids[0]]);
  });

  it("does not park a buzz the server rejects as too early, then accepts a later one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
    const { store, party, ids } = openParty(["Alice", "Bob"]);
    const openedAt = Date.now();
    party.buzzWindowOpenedAt = openedAt;
    store.updatePlayerClockSync(party, ids[0]!, 0, 10);
    vi.setSystemTime(openedAt + 20);
    try {
      store.buzz(party, ids[0]!, openedAt - 50);
      expect.fail("early buzz should be refused");
    } catch (err) {
      expect(errorCode(err)).toBe("BUZZ_TOO_EARLY");
    }
    expect(party.pendingBuzzQueue).toHaveLength(0);

    store.buzz(party, ids[0]!, openedAt + 10);
    expect(party.pendingBuzzQueue.map((row) => row.playerId)).toEqual([ids[0]]);
    vi.useRealTimers();
  });
});

describe("clock sync is not the live double-buzz", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a client timestamp slightly before the open when the server has no sync", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
    const { store, party, ids } = openParty(["Alice", "Bob"]);
    const openedAt = Date.now();
    party.buzzWindowOpenedAt = openedAt;
    vi.setSystemTime(openedAt + 15);
    store.buzz(party, ids[0]!, openedAt - 30);
    expect(party.pendingBuzzQueue).toHaveLength(1);
    expect(party.pendingBuzzQueue[0]?.estimatedAt).toBe(openedAt + 15);
  });

  it("accepts a buzz exactly at the open when the client has not stored a server offset", () => {
    const { store, party, ids } = openParty(["Alice", "Bob"]);
    const openedAt = party.buzzWindowOpenedAt ?? Date.now();
    const clientTimestamp = convertToServerTime(openedAt, null);
    store.buzz(party, ids[0]!, clientTimestamp);
    expect(party.pendingBuzzQueue.map((row) => row.playerId)).toEqual([ids[0]]);
  });

  it("accepts a raw monotonic client timestamp when the server never stored a sync", () => {
    const { store, party, ids } = openParty(["Alice", "Bob"]);
    const clientTimestamp = convertToServerTime(25, null);
    expect(clientTimestamp).toBe(25);
    expect(party.buzzWindowOpenedAt).toBeGreaterThan(clientTimestamp);
    store.buzz(party, ids[0]!, clientTimestamp);
    expect(party.pendingBuzzQueue).toHaveLength(1);
  });

  it.fails("does not add the offset again when the client timestamp is already converted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
    const { store, party, ids } = openParty(["Alice", "Bob"]);
    const openedAt = Date.now();
    party.buzzWindowOpenedAt = openedAt;
    const offsetMs = 1_000_000;
    vi.setSystemTime(openedAt + 100);
    store.updatePlayerClockSync(party, ids[0]!, offsetMs, 40);
    const clientTimestamp = openedAt + 40;
    store.buzz(party, ids[0]!, clientTimestamp);
    expect(party.pendingBuzzQueue[0]?.estimatedAt).toBe(clientTimestamp);
  });
});

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

describe("buzz and time-sync HTTP", () => {
  let app: FastifyInstance;
  let store: PartyStore;

  beforeAll(async () => {
    store = new PartyStore(() => {}, buzzCatalog);
    app = Fastify({ logger: false });
    await app.register(fastifyJwt, { secret: "test-secret" });
    await registerPartyRoutes(app, {
      store,
      packs: new Map(),
      importedPacks: new ImportedPackStore(),
      packEditor: new PackEditorStore(),
      config: testConfig(),
      buzzCatalog,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function partyWithPlayers(count: number): Promise<{ party: Party; tokens: string[]; ids: string[] }> {
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    const ids: string[] = [];
    const tokens: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const joined = store.joinPlayer(party, `Joueur ${i + 1}`, null, "base/1.png", "good1");
      ids.push(joined.id);
      tokens.push(await app.jwt.sign({ pid: party.id, sub: joined.id }));
    }
    party.state = "round_active";
    party.hasStartedRound = true;
    party.buzzWindowOpen = true;
    party.buzzWindowOpenedAt = Date.now();
    return { party, tokens, ids };
  }

  it("registers the only player's first POST in the returned snapshot", async () => {
    const { party, tokens, ids } = await partyWithPlayers(1);
    const res = await app.inject({
      method: "POST",
      url: `/api/parties/${party.id}/me/buzz`,
      headers: { authorization: `Bearer ${tokens[0]}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ snapshot: BuzzPayload }>();
    expect(body.snapshot.buzzOrder).toContain(ids[0]);
  });

  it.fails("returns the accepted buzz in the POST snapshot while other players have not buzzed", async () => {
    const { party, tokens, ids } = await partyWithPlayers(3);
    const res = await app.inject({
      method: "POST",
      url: `/api/parties/${party.id}/me/buzz`,
      headers: { authorization: `Bearer ${tokens[0]}` },
      payload: { clientTimestamp: Date.now() },
    });
    expect(res.statusCode).toBe(200);
    expect(buzzVisible(res.json<{ snapshot: BuzzPayload }>().snapshot, ids[0]!)).toBe(true);
  });

  it.fails("shows that buzz on a later GET once the grace window has elapsed", async () => {
    const { party, tokens, ids } = await partyWithPlayers(3);
    store.adminSetBuzzGraceWindow(party, 40);
    const posted = await app.inject({
      method: "POST",
      url: `/api/parties/${party.id}/me/buzz`,
      headers: { authorization: `Bearer ${tokens[0]}` },
      payload: {},
    });
    expect(posted.statusCode).toBe(200);
    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
    const fetched = await app.inject({
      method: "GET",
      url: `/api/parties/${party.id}`,
    });
    expect(fetched.statusCode).toBe(200);
    const snap = fetched.json<BuzzPayload>();
    expect(snap.buzzOrder).toContain(ids[0]);
  });

  it("answers a time-sync ping with both timestamps", async () => {
    const { party, tokens } = await partyWithPlayers(1);
    const res = await app.inject({
      method: "POST",
      url: `/api/parties/${party.id}/me/time-sync`,
      headers: { authorization: `Bearer ${tokens[0]}` },
      payload: { clientTimestamp: 1500 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ clientTimestamp: number; serverTimestamp: number }>();
    expect(body.clientTimestamp).toBe(1500);
    expect(typeof body.serverTimestamp).toBe("number");
  });

  it.fails("stores that player's clock sync from the time-sync ping", async () => {
    const { party, tokens, ids } = await partyWithPlayers(1);
    const res = await app.inject({
      method: "POST",
      url: `/api/parties/${party.id}/me/time-sync`,
      headers: { authorization: `Bearer ${tokens[0]}` },
      payload: { clientTimestamp: 1500 },
    });
    expect(res.statusCode).toBe(200);
    expect(party.clockSync.get(ids[0]!)).toBeDefined();
  });
});
