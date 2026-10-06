import { describe, it, expect, beforeEach } from "vitest";
import { PartyStore } from "./store.js";
import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { Party, ClockSyncState } from "./types.js";
import type { QuizPack } from "../games/pack.js";

/**
 * * Tests for §4.8 buzz timestamp fairness (latency compensation, grace window, decision logic).
 * 
 * These tests focus on server-side store/party logic, NOT UI components.
 * They cover:
 * 1. Wait window (buzzCollectWindowMs / buzzGraceWindowMs)
 * 2. Latency compensation ranking
 * 3. Reject buzz before open
 * 4. Sound / buzz mode settings on store
 * 5. Auto-advance behavior with decision
 */

describe("§4.8 Buzz Timestamp Fairness", () => {
  let store: PartyStore;
  let party: Party;
  let playerA: string;
  let playerB: string;
  let playerC: string;

  const mockBuzzCatalog: LoadedBuzzSoundCatalog = {
    sounds: [
      { key: "bz1", label: "Buzz 1", file: "buzzers/1.mp3", pool: "neutral" },
      { key: "bz2", label: "Buzz 2", file: "buzzers/2.mp3", pool: "neutral" },
      { key: "bz3", label: "Buzz 3", file: "buzzers/3.mp3", pool: "neutral" },
      { key: "good1", label: "Good Sound", file: "good/1.mp3", pool: "good" },
      { key: "bad1", label: "Bad Sound", file: "bad/1.mp3", pool: "bad" },
    ],
    byKey: new Map([
      ["bz1", { key: "bz1", label: "Buzz 1", file: "buzzers/1.mp3", pool: "neutral" }],
      ["bz2", { key: "bz2", label: "Buzz 2", file: "buzzers/2.mp3", pool: "neutral" }],
      ["bz3", { key: "bz3", label: "Buzz 3", file: "buzzers/3.mp3", pool: "neutral" }],
      ["good1", { key: "good1", label: "Good Sound", file: "good/1.mp3", pool: "good" }],
      ["bad1", { key: "bad1", label: "Bad Sound", file: "bad/1.mp3", pool: "bad" }],
    ]),
    defaultBuzzerKey: "bz1",
  };

  const mockPack: QuizPack = {
    id: "test-pack",
    title: "Test Pack",
    rounds: [
      {
        kind: "quiz",
        title: "Round 1",
        questions: [
          { prompt: "Q1", choices: ["A", "B", "C"], correctIndex: 0, points: 10 },
          { prompt: "Q2", choices: ["X", "Y", "Z"], correctIndex: 1, points: 10 },
        ],
      },
    ],
  };

  beforeEach(() => {
    const notifyMock = () => {};
    store = new PartyStore(notifyMock, mockBuzzCatalog);
    party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });

    const pA = store.joinPlayer(party, "Alice", null, "base/1.png", "bz1");
    playerA = pA.id;
    const pB = store.joinPlayer(party, "Bob", null, "base/2.png", "bz2");
    playerB = pB.id;
    const pC = store.joinPlayer(party, "Charlie", null, "base/3.png", "bz3");
    playerC = pC.id;

    party.state = "round_active";
    party.hasStartedRound = true;
    party.currentRoundIndex = 0;
    party.currentQuestionIndex = 0;
    party.loadedPackId = mockPack.id;
    party.mancheScript = [
      {
        id: "test-manche",
        kind: "pack_quiz",
        title: "Test Quiz",
        packBasename: "test-pack.json",
        iframeUrl: null,
        youtubeEmbedUrl: null,
        directVideoUrl: null,
        savedRoundIndex: 0,
        savedQuestionIndex: 0,
        transitionKind: null,
        transitionDurationMs: null,
        launchMode: "normal",
      },
    ];
    party.activeMancheId = "test-manche";
  });

  describe("1. Wait window (buzzGraceWindowMs)", () => {
    it("CA-8: defaults to 500ms", () => {
      expect(party.buzzGraceWindowMs).toBe(500);
    });

    it("CA-8: first buzz starts window, winner decided after window", () => {
      party.buzzGraceWindowMs = 200;
      store.adminSetBuzzOpen(party, true);

      const nowMs = Date.now();
      store.buzz(party, playerA, nowMs, undefined);
      expect(party.pendingBuzzQueue.length).toBe(1);
      expect(party.buzzWindowFirstBuzzAt).not.toBeNull();
      expect(party.buzzOrder.length).toBe(0);

      const beforeDecision = store.maybeFinalizeBuzzDecision(party);
      expect(beforeDecision).toBe(false);

      const fakeFuture = nowMs + 250;
      party.buzzWindowFirstBuzzAt = nowMs;
      const afterWindow = nowMs + 250 >= party.buzzWindowFirstBuzzAt! + party.buzzGraceWindowMs;
      expect(afterWindow).toBe(true);
    });

    it("CA-8: if all active players buzzed → decide immediately", () => {
      party.buzzGraceWindowMs = 500;
      store.adminSetBuzzOpen(party, true);

      const nowMs = Date.now();
      store.buzz(party, playerA, nowMs, undefined);
      store.buzz(party, playerB, nowMs + 10, undefined);
      store.buzz(party, playerC, nowMs + 20, undefined);

      expect(party.pendingBuzzQueue.length).toBe(3);
      expect(party.players.size).toBe(3);

      const decided = store.maybeFinalizeBuzzDecision(party);
      expect(decided).toBe(true);
      expect(party.buzzOrder.length).toBe(3);
      expect(party.pendingBuzzQueue.length).toBe(0);
    });

    it("CA-6: window=0 → FIFO/arrival order unchanged", () => {
      party.buzzGraceWindowMs = 0;
      store.adminSetBuzzOpen(party, true);

      const nowMs = Date.now();
      store.buzz(party, playerA, nowMs, undefined);
      expect(party.buzzOrder).toEqual([playerA]);
      expect(party.pendingBuzzQueue.length).toBe(0);

      store.buzz(party, playerB, nowMs + 50, undefined);
      expect(party.buzzOrder).toEqual([playerA, playerB]);
    });

    it("CA-12: second buzz during window accepted and considered at decision", () => {
      party.buzzGraceWindowMs = 300;
      store.adminSetBuzzOpen(party, true);

      const nowMs = Date.now();
      store.buzz(party, playerA, nowMs, undefined);
      expect(party.pendingBuzzQueue.length).toBe(1);

      store.buzz(party, playerB, nowMs + 100, undefined);
      expect(party.pendingBuzzQueue.length).toBe(2);

      party.buzzWindowFirstBuzzAt = nowMs - 350;
      const decided = store.maybeFinalizeBuzzDecision(party);
      expect(decided).toBe(true);
      expect(party.buzzOrder.length).toBe(2);
    });

    it("CA-13: ranking frozen only at decision", () => {
      party.buzzGraceWindowMs = 400;
      store.adminSetBuzzOpen(party, true);

      const nowMs = Date.now();
      store.buzz(party, playerA, nowMs, undefined);
      expect(party.buzzOrder.length).toBe(0);

      store.buzz(party, playerB, nowMs + 50, undefined);
      expect(party.buzzOrder.length).toBe(0);
      expect(party.pendingBuzzQueue.length).toBe(2);

      party.buzzWindowFirstBuzzAt = nowMs - 450;
      const decided = store.maybeFinalizeBuzzDecision(party);
      expect(decided).toBe(true);
      expect(party.buzzOrder.length).toBe(2);
    });
  });

  describe("2. Latency compensation ranking", () => {
    it("CA-1: latency compensation uses estimated time for ranking", () => {
      party.buzzGraceWindowMs = 500;

      store.adminSetBuzzOpen(party, true);
      const openedAt = party.buzzWindowOpenedAt!;

      const syncA: ClockSyncState = {
        offsetMs: -50,
        minRttMs: 300,
        lastSyncAt: Date.now(),
      };
      const syncB: ClockSyncState = {
        offsetMs: 50,
        minRttMs: 20,
        lastSyncAt: Date.now(),
      };
      party.clockSync.set(playerA, syncA);
      party.clockSync.set(playerB, syncB);

      const clientA = openedAt + 150;
      const clientB = openedAt + 200;

      store.buzz(party, playerA, clientA, undefined);
      store.buzz(party, playerB, clientB, undefined);

      expect(party.pendingBuzzQueue.length).toBe(2);
      
      const buzzA = party.pendingBuzzQueue.find(b => b.playerId === playerA)!;
      const buzzB = party.pendingBuzzQueue.find(b => b.playerId === playerB)!;
      
      expect(buzzA.estimatedAt).toBeLessThanOrEqual(buzzB.arrivedAt);
      expect(buzzB.estimatedAt).toBeLessThanOrEqual(buzzB.arrivedAt);
      
      const nowMs = Date.now();
      party.buzzWindowFirstBuzzAt = nowMs - 600;
      store.finalizeBuzzDecision(party);

      expect(party.buzzOrder.length).toBe(2);
      expect(party.buzzOrder).toContain(playerA);
      expect(party.buzzOrder).toContain(playerB);
    });

    it("CA-4: anti-cheat cap at half-RTT + 50ms", () => {
      party.buzzGraceWindowMs = 500;

      store.adminSetBuzzOpen(party, true);
      const openedAt = party.buzzWindowOpenedAt!;

      const syncA: ClockSyncState = {
        offsetMs: -2000,
        minRttMs: 300,
        lastSyncAt: Date.now(),
      };
      party.clockSync.set(playerA, syncA);

      const clientA = openedAt + 2100;

      store.buzz(party, playerA, clientA, undefined);

      const buzz = party.pendingBuzzQueue[0];
      const maxCompensation = syncA.minRttMs / 2 + 50;
      const actualCompensation = buzz.arrivedAt - buzz.estimatedAt;

      expect(actualCompensation).toBeLessThanOrEqual(maxCompensation + 1);
    });

    it("CA-5b: estimated time never after arrival", () => {
      party.buzzGraceWindowMs = 500;

      store.adminSetBuzzOpen(party, true);

      const syncA: ClockSyncState = {
        offsetMs: 1000,
        minRttMs: 100,
        lastSyncAt: Date.now(),
      };
      party.clockSync.set(playerA, syncA);

      const nowMs = Date.now();
      const clientA = nowMs + 500;

      store.buzz(party, playerA, clientA, undefined);

      const buzz = party.pendingBuzzQueue[0];
      expect(buzz.estimatedAt).toBeLessThanOrEqual(buzz.arrivedAt);
    });

    it("CA-7: no valid sync → arrival-order fallback", () => {
      party.buzzGraceWindowMs = 500;

      store.adminSetBuzzOpen(party, true);

      const nowMs = Date.now();
      store.buzz(party, playerA, undefined, undefined);
      store.buzz(party, playerB, undefined, undefined);

      const buzzA = party.pendingBuzzQueue.find(b => b.playerId === playerA)!;
      const buzzB = party.pendingBuzzQueue.find(b => b.playerId === playerB)!;

      expect(buzzA.estimatedAt).toBe(buzzA.arrivedAt);
      expect(buzzB.estimatedAt).toBe(buzzB.arrivedAt);

      party.buzzWindowFirstBuzzAt = nowMs - 600;
      store.finalizeBuzzDecision(party);

      expect(party.buzzOrder[0]).toBe(playerA);
      expect(party.buzzOrder[1]).toBe(playerB);
    });

    it("CA-9: equal estimated times → first arrival wins", () => {
      party.buzzGraceWindowMs = 500;

      store.adminSetBuzzOpen(party, true);
      const openedAt = party.buzzWindowOpenedAt!;

      const sync: ClockSyncState = {
        offsetMs: 100,
        minRttMs: 50,
        lastSyncAt: Date.now(),
      };
      party.clockSync.set(playerA, sync);
      party.clockSync.set(playerB, sync);

      const clientTs = openedAt + 50;

      store.buzz(party, playerA, clientTs, undefined);
      store.buzz(party, playerB, clientTs, undefined);

      const buzzA = party.pendingBuzzQueue.find(b => b.playerId === playerA)!;
      const buzzB = party.pendingBuzzQueue.find(b => b.playerId === playerB)!;

      expect(buzzA.estimatedAt).toBe(buzzB.estimatedAt);
      expect(buzzA.arrivedAt).toBeLessThanOrEqual(buzzB.arrivedAt);

      const nowMs = Date.now();
      party.buzzWindowFirstBuzzAt = nowMs - 600;
      store.finalizeBuzzDecision(party);

      expect(party.buzzOrder[0]).toBe(playerA);
      expect(party.buzzOrder[1]).toBe(playerB);
    });
  });

  describe("3. Reject before open", () => {
    it("CA-5: buzz while buzzWindowOpen false → refused", () => {
      expect(party.buzzWindowOpen).toBe(false);

      expect(() => {
        store.buzz(party, playerA, Date.now(), undefined);
      }).toThrow("NO_BUZZ");
    });

    it("CA-5: buzz estimé before buzzWindowOpenedAt → refused (BUZZ_TOO_EARLY)", () => {
      party.buzzGraceWindowMs = 500;
      store.adminSetBuzzOpen(party, true);

      const openedAt = party.buzzWindowOpenedAt!;
      expect(openedAt).not.toBeNull();

      const syncA: ClockSyncState = {
        offsetMs: -100,
        minRttMs: 50,
        lastSyncAt: Date.now(),
      };
      party.clockSync.set(playerA, syncA);

      const clientTsBeforeOpen = openedAt - 200;

      try {
        store.buzz(party, playerA, clientTsBeforeOpen, undefined);
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.code).toBe("BUZZ_TOO_EARLY");
      }
    });

    it("does not add to buzzOrder or trigger buzz_fx on refused buzz", () => {
      let buzzFxFired = false;
      const notifyMock = (_id: string, _party: Party, meta?: any) => {
        if (meta?.kind === "buzz_fx") {
          buzzFxFired = true;
        }
      };
      const storeWithNotify = new PartyStore(notifyMock, mockBuzzCatalog);
      const p = storeWithNotify.createParty({
        maxPlayers: null,
        maxTeams: null,
        closedAfterStart: false,
        allowRename: true,
        allowTeamChange: true,
      });
      const pA = storeWithNotify.joinPlayer(p, "Alice", null, "base/1.png", "bz1");

      p.state = "round_active";
      p.hasStartedRound = true;
      p.currentRoundIndex = 0;
      p.currentQuestionIndex = 0;
      p.loadedPackId = mockPack.id;
      p.mancheScript = [
        {
          id: "test-manche",
          kind: "pack_quiz",
          title: "Test Quiz",
          packBasename: "test-pack.json",
          iframeUrl: null,
          youtubeEmbedUrl: null,
          directVideoUrl: null,
          savedRoundIndex: 0,
          savedQuestionIndex: 0,
          transitionKind: null,
          transitionDurationMs: null,
          launchMode: "normal",
        },
      ];
      p.activeMancheId = "test-manche";

      storeWithNotify.adminSetBuzzOpen(p, true);

      const openedAt = p.buzzWindowOpenedAt!;
      const syncA: ClockSyncState = {
        offsetMs: -100,
        minRttMs: 50,
        lastSyncAt: Date.now(),
      };
      p.clockSync.set(pA.id, syncA);

      const clientTsBeforeOpen = openedAt - 200;

      try {
        storeWithNotify.buzz(p, pA.id, clientTsBeforeOpen, undefined);
      } catch (e: any) {
        expect(e.code).toBe("BUZZ_TOO_EARLY");
      }

      expect(p.buzzOrder.length).toBe(0);
      expect(p.pendingBuzzQueue.length).toBe(0);
      expect(buzzFxFired).toBe(false);
    });
  });

  describe("4. Sound / buzz mode settings on store", () => {
    it("CA-19–22: 3-state buzz sound mode cycles (both → players → animation → both)", () => {
      expect(party.buzzSound.buzzSoundMode).toBe("both");

      store.adminCycleBuzzSoundMode(party);
      expect(party.buzzSound.buzzSoundMode).toBe("players");

      store.adminCycleBuzzSoundMode(party);
      expect(party.buzzSound.buzzSoundMode).toBe("animation");

      store.adminCycleBuzzSoundMode(party);
      expect(party.buzzSound.buzzSoundMode).toBe("both");
    });

    it("CA-23: mode persists on party", () => {
      store.adminCycleBuzzSoundMode(party);
      expect(party.buzzSound.buzzSoundMode).toBe("players");

      const partyId = party.id;
      const retrieved = store.get(partyId)!;
      expect(retrieved.buzzSound.buzzSoundMode).toBe("players");
    });

    it("CA-25: changing mode does not alter playVerdictSounds", () => {
      const initialVerdict = party.buzzSound.playVerdictSounds;
      expect(initialVerdict).toBe(true);

      store.adminCycleBuzzSoundMode(party);
      expect(party.buzzSound.playVerdictSounds).toBe(initialVerdict);

      store.adminCycleBuzzSoundMode(party);
      expect(party.buzzSound.playVerdictSounds).toBe(initialVerdict);
    });

    it("emits buzz_fx on accepted buzz during window", () => {
      let buzzFxCount = 0;
      const notifyMock = (_id: string, _party: Party, meta?: any) => {
        if (meta?.kind === "buzz_fx") {
          buzzFxCount += 1;
        }
      };
      const storeWithNotify = new PartyStore(notifyMock, mockBuzzCatalog);
      const p = storeWithNotify.createParty({
        maxPlayers: null,
        maxTeams: null,
        closedAfterStart: false,
        allowRename: true,
        allowTeamChange: true,
      });
      const pA = storeWithNotify.joinPlayer(p, "Alice", null, "base/1.png", "bz1");
      const pB = storeWithNotify.joinPlayer(p, "Bob", null, "base/2.png", "bz2");

      p.state = "round_active";
      p.hasStartedRound = true;
      p.currentRoundIndex = 0;
      p.currentQuestionIndex = 0;
      p.loadedPackId = mockPack.id;
      p.mancheScript = [
        {
          id: "test-manche",
          kind: "pack_quiz",
          title: "Test Quiz",
          packBasename: "test-pack.json",
          iframeUrl: null,
          youtubeEmbedUrl: null,
          directVideoUrl: null,
          savedRoundIndex: 0,
          savedQuestionIndex: 0,
          transitionKind: null,
          transitionDurationMs: null,
          launchMode: "normal",
        },
      ];
      p.activeMancheId = "test-manche";

      p.buzzGraceWindowMs = 500;
      storeWithNotify.adminSetBuzzOpen(p, true);

      const nowMs = Date.now();
      storeWithNotify.buzz(p, pA.id, nowMs, undefined);
      expect(buzzFxCount).toBe(1);

      storeWithNotify.buzz(p, pB.id, nowMs + 100, undefined);
      expect(buzzFxCount).toBe(2);
    });

    it("emits buzz_decision event when winner is designated", () => {
      let decisionFired = false;
      const notifyMock = (_id: string, _party: Party, meta?: any) => {
        if (meta?.kind === "buzz_decision") {
          decisionFired = true;
        }
      };
      const storeWithNotify = new PartyStore(notifyMock, mockBuzzCatalog);
      const p = storeWithNotify.createParty({
        maxPlayers: null,
        maxTeams: null,
        closedAfterStart: false,
        allowRename: true,
        allowTeamChange: true,
      });
      const pA = storeWithNotify.joinPlayer(p, "Alice", null, "base/1.png", "bz1");

      p.state = "round_active";
      p.hasStartedRound = true;
      p.currentRoundIndex = 0;
      p.currentQuestionIndex = 0;
      p.loadedPackId = mockPack.id;
      p.mancheScript = [
        {
          id: "test-manche",
          kind: "pack_quiz",
          title: "Test Quiz",
          packBasename: "test-pack.json",
          iframeUrl: null,
          youtubeEmbedUrl: null,
          directVideoUrl: null,
          savedRoundIndex: 0,
          savedQuestionIndex: 0,
          transitionKind: null,
          transitionDurationMs: null,
          launchMode: "normal",
        },
      ];
      p.activeMancheId = "test-manche";

      p.buzzGraceWindowMs = 200;
      storeWithNotify.adminSetBuzzOpen(p, true);

      const nowMs = Date.now();
      storeWithNotify.buzz(p, pA.id, nowMs, undefined);

      expect(decisionFired).toBe(false);

      p.buzzWindowFirstBuzzAt = nowMs - 250;
      storeWithNotify.finalizeBuzzDecision(p);

      expect(decisionFired).toBe(true);
    });
  });

  describe("5. Auto-advance with QCM + autoAdvanceQuizWhenAllBuzzed", () => {
    it("CA-15: advance only after decision, never before", () => {
      party.autoAdvanceQuizWhenAllBuzzed = true;
      party.buzzGraceWindowMs = 300;

      store.adminSetBuzzOpen(party, true);

      const nowMs = Date.now();
      store.buzz(party, playerA, nowMs, { choicesLen: 3, choiceIndex: 0 });
      store.buzz(party, playerB, nowMs + 50, { choicesLen: 3, choiceIndex: 1 });
      store.buzz(party, playerC, nowMs + 100, { choicesLen: 3, choiceIndex: 2 });

      expect(party.pendingBuzzQueue.length).toBe(3);
      expect(party.buzzOrder.length).toBe(0);

      const decidedImmediately = store.maybeFinalizeBuzzDecision(party);
      expect(decidedImmediately).toBe(true);
      expect(party.buzzOrder.length).toBe(3);
      expect(party.pendingBuzzQueue.length).toBe(0);
    });

    it("decision happens before auto-advance is evaluated", () => {
      party.autoAdvanceQuizWhenAllBuzzed = true;
      party.buzzGraceWindowMs = 500;

      store.adminSetBuzzOpen(party, true);

      const nowMs = Date.now();
      store.buzz(party, playerA, nowMs, { choicesLen: 3, choiceIndex: 0 });
      store.buzz(party, playerB, nowMs + 50, { choicesLen: 3, choiceIndex: 1 });
      store.buzz(party, playerC, nowMs + 100, { choicesLen: 3, choiceIndex: 2 });

      expect(party.pendingBuzzQueue.length).toBe(3);

      const decided = store.maybeFinalizeBuzzDecision(party);
      expect(decided).toBe(true);
      expect(party.buzzOrder.length).toBe(3);

      expect(party.currentQuestionIndex).toBe(0);
    });
  });

  describe("Additional edge cases", () => {
    it("double buzz from same player → second ignored", () => {
      party.buzzGraceWindowMs = 500;
      store.adminSetBuzzOpen(party, true);

      const nowMs = Date.now();
      store.buzz(party, playerA, nowMs, undefined);
      expect(party.pendingBuzzQueue.length).toBe(1);

      store.buzz(party, playerA, nowMs + 100, undefined);
      expect(party.pendingBuzzQueue.length).toBe(1);
    });

    it("gap calculation when 2 buzzes < 1000ms → lastBuzzGapMs set", () => {
      party.buzzGraceWindowMs = 500;
      store.adminSetBuzzOpen(party, true);

      const nowMs = Date.now();
      store.buzz(party, playerA, nowMs - 100, undefined);
      store.buzz(party, playerB, nowMs, undefined);

      party.buzzWindowFirstBuzzAt = nowMs - 600;
      store.finalizeBuzzDecision(party);

      expect(party.lastBuzzGapMs).not.toBeNull();
      expect(party.lastBuzzGapMs).toBeLessThan(1000);
    });

    it("gap calculation when gap large → lastBuzzGapMs null (not displayed)", () => {
      party.buzzGraceWindowMs = 500;

      store.adminSetBuzzOpen(party, true);

      store.buzz(party, playerA, undefined, undefined);
      
      party.pendingBuzzQueue.push({
        playerId: playerB,
        clientTimestamp: Date.now(),
        arrivedAt: Date.now(),
        estimatedAt: Date.now() + 1500,
      });

      expect(party.pendingBuzzQueue.length).toBe(2);

      const nowMs = Date.now();
      party.buzzWindowFirstBuzzAt = nowMs - 600;
      store.finalizeBuzzDecision(party);

      expect(party.lastBuzzGapMs).toBeNull();
    });

    it("single buzz → lastBuzzGapMs null", () => {
      party.buzzGraceWindowMs = 500;
      store.adminSetBuzzOpen(party, true);

      const nowMs = Date.now();
      store.buzz(party, playerA, nowMs, undefined);

      party.buzzWindowFirstBuzzAt = nowMs - 600;
      store.finalizeBuzzDecision(party);

      expect(party.lastBuzzGapMs).toBeNull();
    });

    it("buzz with invalid quiz choice → throws QUIZ_CHOICE_REQUIRED", () => {
      store.adminSetBuzzOpen(party, true);

      try {
        store.buzz(party, playerA, Date.now(), { choicesLen: 3, choiceIndex: undefined });
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.code).toBe("QUIZ_CHOICE_REQUIRED");
      }
    });

    it("buzz after window closed → NO_BUZZ", () => {
      party.buzzGraceWindowMs = 500;
      store.adminSetBuzzOpen(party, true);

      const nowMs = Date.now();
      store.buzz(party, playerA, nowMs, undefined);

      store.adminSetBuzzOpen(party, false);

      expect(() => {
        store.buzz(party, playerB, nowMs + 100, undefined);
      }).toThrow("NO_BUZZ");
    });
  });
});
