import { describe, expect, it, beforeEach } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { PartyStore } from "./store.js";
import type { MancheCatalogItem, Party } from "./types.js";

describe("PartyStore - Automatic Evening Mode", () => {
  let store: PartyStore;
  let party: Party;
  let packs: Map<string, QuizPack>;

  const mockBuzzCatalog: LoadedBuzzSoundCatalog = {
    sounds: [
      {
        key: "good1",
        label: "Good Sound",
        file: "good/sound1.mp3",
        pool: "good",
      },
      {
        key: "bad1",
        label: "Bad Sound",
        file: "bad/sound1.mp3",
        pool: "bad",
      },
    ],
    byKey: new Map([
      [
        "good1",
        {
          key: "good1",
          label: "Good Sound",
          file: "good/sound1.mp3",
          pool: "good",
        },
      ],
      [
        "bad1",
        {
          key: "bad1",
          label: "Bad Sound",
          file: "bad/sound1.mp3",
          pool: "bad",
        },
      ],
    ]),
    defaultBuzzerKey: "buzz1",
  };

  const config = {
    questionDurationMs: 30_000,
    roundDurationMs: 300_000,
    transitionDurationMs: 3_000,
  };

  beforeEach(() => {
    store = new PartyStore(() => {}, mockBuzzCatalog);
    party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });

    packs = new Map();

    const mockPack: QuizPack = {
      id: "pack-1",
      title: "Test Pack",
      rounds: [
        {
          kind: "quiz",
          title: "Round 1",
          questions: [
            {
              prompt: "Question 1",
              choices: ["A", "B", "C"],
              correctIndex: 0,
              points: 10,
            },
            {
              prompt: "Question 2",
              choices: ["A", "B", "C"],
              correctIndex: 1,
              points: 10,
            },
          ],
        },
      ],
    };

    packs.set("pack-1", mockPack);

    const item1: Omit<MancheCatalogItem, "id"> = {
      kind: "pack_quiz",
      title: "Quiz 1",
      packBasename: "pack-1.json",
      iframeUrl: null,
      youtubeEmbedUrl: null,
      directVideoUrl: null,
      savedRoundIndex: 0,
      savedQuestionIndex: 0,
      transitionKind: null,
      transitionDurationMs: null,
    };

    const item2: Omit<MancheCatalogItem, "id"> = {
      kind: "transition",
      title: "Pause",
      packBasename: null,
      iframeUrl: null,
      youtubeEmbedUrl: null,
      directVideoUrl: null,
      savedRoundIndex: 0,
      savedQuestionIndex: 0,
      transitionKind: "pause",
      transitionDurationMs: 5_000,
    };

    store.hostAppendManche(party, item1);
    store.hostAppendManche(party, item2);
  });

  describe("adminToggleAutoPlay", () => {
    it("enables automatic play and schedules first item", () => {
      const before = Date.now();
      store.adminToggleAutoPlay(party, true, config, packs);

      expect(party.autoPlay.enabled).toBe(true);
      expect(party.autoPlay.paused).toBe(false);
      expect(party.autoPlay.currentScriptIndex).toBe(0);
      expect(party.autoPlay.waitingForManualAction).toBe(false);
      expect(party.autoPlay.currentItemStartedAt).toBeGreaterThanOrEqual(before);
      expect(party.autoPlay.scheduledAdvanceAt).not.toBeNull();
      
      const expectedAdvanceTime = party.autoPlay.currentItemStartedAt! + config.questionDurationMs;
      expect(party.autoPlay.scheduledAdvanceAt).toBe(expectedAdvanceTime);
    });

    it("disables automatic play and clears schedule", () => {
      store.adminToggleAutoPlay(party, true, config, packs);
      store.adminToggleAutoPlay(party, false, config, packs);

      expect(party.autoPlay.enabled).toBe(false);
      expect(party.autoPlay.scheduledAdvanceAt).toBeNull();
      expect(party.autoPlay.currentItemStartedAt).toBeNull();
    });

    it("throws when enabling with empty script", () => {
      const emptyParty = store.createParty({
        maxPlayers: null,
        maxTeams: null,
        closedAfterStart: false,
        allowRename: true,
        allowTeamChange: true,
      });

      expect(() => {
        store.adminToggleAutoPlay(emptyParty, true, config, packs);
      }).toThrow("aucune manche dans le script");
    });
  });

  describe("tickAutoPlay", () => {
    it("advances playback when scheduled time is reached", () => {
      const now = 1000;
      store.adminToggleAutoPlay(party, true, config, packs);
      
      party.autoPlay.currentItemStartedAt = now;
      party.autoPlay.scheduledAdvanceAt = now + config.questionDurationMs;
      party.autoPlay.currentScriptIndex = 0;

      const tickTime = now + config.questionDurationMs;
      store.tickAutoPlay(party, config, packs, tickTime);

      expect(party.autoPlay.currentScriptIndex).toBe(1);
    });

    it("does not advance before scheduled time", () => {
      const now = 1000;
      store.adminToggleAutoPlay(party, true, config, packs);
      
      party.autoPlay.currentItemStartedAt = now;
      party.autoPlay.scheduledAdvanceAt = now + config.questionDurationMs;
      party.autoPlay.currentScriptIndex = 0;

      const tickTime = now + config.questionDurationMs - 1000;
      store.tickAutoPlay(party, config, packs, tickTime);

      expect(party.autoPlay.currentScriptIndex).toBe(0);
    });

    it("does not advance when paused", () => {
      const now = 1000;
      store.adminToggleAutoPlay(party, true, config, packs);
      
      party.autoPlay.currentItemStartedAt = now;
      party.autoPlay.scheduledAdvanceAt = now + config.questionDurationMs;
      party.autoPlay.currentScriptIndex = 0;
      party.autoPlay.paused = true;

      const tickTime = now + config.questionDurationMs;
      store.tickAutoPlay(party, config, packs, tickTime);

      expect(party.autoPlay.currentScriptIndex).toBe(0);
    });

    it("does not advance when waiting for manual action", () => {
      const now = 1000;
      store.adminToggleAutoPlay(party, true, config, packs);
      
      party.autoPlay.currentItemStartedAt = now;
      party.autoPlay.scheduledAdvanceAt = now + config.questionDurationMs;
      party.autoPlay.currentScriptIndex = 0;
      party.autoPlay.waitingForManualAction = true;

      const tickTime = now + config.questionDurationMs;
      store.tickAutoPlay(party, config, packs, tickTime);

      expect(party.autoPlay.currentScriptIndex).toBe(0);
    });

    it("does not advance when scheduledAdvanceAt is null", () => {
      const now = 1000;
      store.adminToggleAutoPlay(party, true, config, packs);
      
      party.autoPlay.currentItemStartedAt = now;
      party.autoPlay.scheduledAdvanceAt = null;
      party.autoPlay.currentScriptIndex = 0;

      const tickTime = now + config.questionDurationMs;
      store.tickAutoPlay(party, config, packs, tickTime);

      expect(party.autoPlay.currentScriptIndex).toBe(0);
    });
  });

  describe("adminAutoPlayPauseResume", () => {
    it("pauses automatic play and freezes remaining time", () => {
      const now = 1000;
      store.adminToggleAutoPlay(party, true, config, packs);
      
      party.autoPlay.currentItemStartedAt = now;
      party.autoPlay.scheduledAdvanceAt = now + config.questionDurationMs;

      const pauseTime = now + 10_000;
      store.adminAutoPlayPauseResume(party, true);

      expect(party.autoPlay.paused).toBe(true);
      expect(party.autoPlay.currentItemStartedAt).toBe(now);
      expect(party.autoPlay.scheduledAdvanceAt).toBe(now + config.questionDurationMs);
    });

    it("resumes from remaining time after pause", () => {
      store.adminToggleAutoPlay(party, true, config, packs);
      
      const startTime = Date.now();
      party.autoPlay.currentItemStartedAt = startTime;
      party.autoPlay.scheduledAdvanceAt = startTime + config.questionDurationMs;
      party.autoPlay.paused = false;

      store.adminAutoPlayPauseResume(party, true);

      expect(party.autoPlay.paused).toBe(true);

      store.adminAutoPlayPauseResume(party, false);

      expect(party.autoPlay.paused).toBe(false);
      expect(party.autoPlay.currentItemStartedAt).toBeGreaterThanOrEqual(startTime);
      expect(party.autoPlay.scheduledAdvanceAt).not.toBeNull();
      
      const newRemaining = party.autoPlay.scheduledAdvanceAt! - party.autoPlay.currentItemStartedAt!;
      expect(newRemaining).toBeGreaterThan(0);
      expect(newRemaining).toBeLessThanOrEqual(config.questionDurationMs);
    });

    it("throws when auto play is not enabled", () => {
      expect(() => {
        store.adminAutoPlayPauseResume(party, true);
      }).toThrow("mode automatique n'est pas activé");
    });
  });

  describe("adminAutoPlaySkipForward", () => {
    it("skips to next item and reschedules from new item", () => {
      const now = 1000;
      store.adminToggleAutoPlay(party, true, config, packs);
      
      party.autoPlay.currentItemStartedAt = now;
      party.autoPlay.scheduledAdvanceAt = now + config.questionDurationMs;
      party.autoPlay.currentScriptIndex = 0;

      store.adminAutoPlaySkipForward(party, config, packs);

      expect(party.autoPlay.currentScriptIndex).toBe(1);
      expect(party.autoPlay.currentItemStartedAt).toBeGreaterThanOrEqual(now);
      
      const expectedDuration = party.mancheScript[1]!.transitionDurationMs ?? config.transitionDurationMs;
      const expectedAdvanceTime = party.autoPlay.currentItemStartedAt! + expectedDuration;
      expect(party.autoPlay.scheduledAdvanceAt).toBe(expectedAdvanceTime);
    });

    it("throws when auto play is not enabled", () => {
      expect(() => {
        store.adminAutoPlaySkipForward(party, config, packs);
      }).toThrow("mode automatique n'est pas activé");
    });
  });

  describe("adminAutoPlaySkipBackward", () => {
    it("skips to previous item and reschedules from new item", () => {
      const now = 1000;
      store.adminToggleAutoPlay(party, true, config, packs);
      store.adminAutoPlaySkipForward(party, config, packs);
      
      const beforeBackward = Date.now();
      store.adminAutoPlaySkipBackward(party, config, packs);

      expect(party.autoPlay.currentScriptIndex).toBe(0);
      expect(party.autoPlay.currentItemStartedAt).toBeGreaterThanOrEqual(beforeBackward);
      
      const expectedAdvanceTime = party.autoPlay.currentItemStartedAt! + config.questionDurationMs;
      expect(party.autoPlay.scheduledAdvanceAt).toBe(expectedAdvanceTime);
    });

    it("does nothing when at first item", () => {
      const now = 1000;
      store.adminToggleAutoPlay(party, true, config, packs);
      
      party.autoPlay.currentItemStartedAt = now;
      party.autoPlay.scheduledAdvanceAt = now + config.questionDurationMs;
      party.autoPlay.currentScriptIndex = 0;

      store.adminAutoPlaySkipBackward(party, config, packs);

      expect(party.autoPlay.currentScriptIndex).toBe(0);
    });

    it("throws when auto play is not enabled", () => {
      expect(() => {
        store.adminAutoPlaySkipBackward(party, config, packs);
      }).toThrow("mode automatique n'est pas activé");
    });
  });

  describe("script modifications during automatic play", () => {
    it("defers adding item while playing", () => {
      store.adminToggleAutoPlay(party, true, config, packs);
      
      const initialScriptLength = party.mancheScript.length;

      const newItem: Omit<MancheCatalogItem, "id"> = {
        kind: "transition",
        title: "New Pause",
        packBasename: null,
        iframeUrl: null,
        youtubeEmbedUrl: null,
        directVideoUrl: null,
        savedRoundIndex: 0,
        savedQuestionIndex: 0,
        transitionKind: "fade",
        transitionDurationMs: 2_000,
      };

      store.hostAppendManche(party, newItem);

      expect(party.mancheScript.length).toBe(initialScriptLength);
      expect(party.autoPlay.pendingScriptUpdates).not.toBeNull();
      expect(party.autoPlay.pendingScriptUpdates!.length).toBe(initialScriptLength + 1);
    });

    it("applies deferred item when advancing", () => {
      const now = 1000;
      store.adminToggleAutoPlay(party, true, config, packs);
      
      party.autoPlay.currentItemStartedAt = now;
      party.autoPlay.scheduledAdvanceAt = now + config.questionDurationMs;
      party.autoPlay.currentScriptIndex = 0;

      const newItem: Omit<MancheCatalogItem, "id"> = {
        kind: "transition",
        title: "New Pause",
        packBasename: null,
        iframeUrl: null,
        youtubeEmbedUrl: null,
        directVideoUrl: null,
        savedRoundIndex: 0,
        savedQuestionIndex: 0,
        transitionKind: "fade",
        transitionDurationMs: 2_000,
      };

      store.hostAppendManche(party, newItem);

      const tickTime = now + config.questionDurationMs;
      store.tickAutoPlay(party, config, packs, tickTime);

      expect(party.mancheScript.length).toBe(3);
      expect(party.autoPlay.pendingScriptUpdates).toBeNull();
    });

    it("defers removing item while playing", () => {
      store.adminToggleAutoPlay(party, true, config, packs);
      
      const mancheIdToRemove = party.mancheScript[1]!.id;
      const initialScriptLength = party.mancheScript.length;

      store.hostRemoveManche(party, mancheIdToRemove);

      expect(party.mancheScript.length).toBe(initialScriptLength);
      expect(party.autoPlay.pendingScriptUpdates).not.toBeNull();
      expect(party.autoPlay.pendingScriptUpdates!.length).toBe(initialScriptLength - 1);
    });

    it("defers reordering item while playing", () => {
      store.adminToggleAutoPlay(party, true, config, packs);
      
      const mancheIdToMove = party.mancheScript[1]!.id;
      const originalFirstItemId = party.mancheScript[0]!.id;

      store.hostMoveManche(party, mancheIdToMove, -1);

      expect(party.mancheScript[0]!.id).toBe(originalFirstItemId);
      expect(party.autoPlay.pendingScriptUpdates).not.toBeNull();
      expect(party.autoPlay.pendingScriptUpdates![0]!.id).toBe(mancheIdToMove);
    });

    it("applies modifications immediately when paused", () => {
      store.adminToggleAutoPlay(party, true, config, packs);
      store.adminAutoPlayPauseResume(party, true);
      
      const initialScriptLength = party.mancheScript.length;

      const newItem: Omit<MancheCatalogItem, "id"> = {
        kind: "transition",
        title: "New Pause",
        packBasename: null,
        iframeUrl: null,
        youtubeEmbedUrl: null,
        directVideoUrl: null,
        savedRoundIndex: 0,
        savedQuestionIndex: 0,
        transitionKind: "fade",
        transitionDurationMs: 2_000,
      };

      store.hostAppendManche(party, newItem);

      expect(party.mancheScript.length).toBe(initialScriptLength + 1);
      expect(party.autoPlay.pendingScriptUpdates).toBeNull();
    });

    it("applies modifications immediately when auto play is off", () => {
      const initialScriptLength = party.mancheScript.length;

      const newItem: Omit<MancheCatalogItem, "id"> = {
        kind: "transition",
        title: "New Pause",
        packBasename: null,
        iframeUrl: null,
        youtubeEmbedUrl: null,
        directVideoUrl: null,
        savedRoundIndex: 0,
        savedQuestionIndex: 0,
        transitionKind: "fade",
        transitionDurationMs: 2_000,
      };

      store.hostAppendManche(party, newItem);

      expect(party.mancheScript.length).toBe(initialScriptLength + 1);
      expect(party.autoPlay.pendingScriptUpdates).toBeNull();
    });
  });

  describe("duration calculation", () => {
    it("uses question duration for quiz rounds", () => {
      store.adminToggleAutoPlay(party, true, config, packs);

      const expectedAdvanceTime = party.autoPlay.currentItemStartedAt! + config.questionDurationMs;
      expect(party.autoPlay.scheduledAdvanceAt).toBe(expectedAdvanceTime);
    });

    it("uses transition duration from item when specified", () => {
      store.adminToggleAutoPlay(party, true, config, packs);
      store.adminAutoPlaySkipForward(party, config, packs);

      const item = party.mancheScript[1]!;
      expect(item.kind).toBe("transition");
      expect(item.transitionDurationMs).toBe(5_000);

      const expectedAdvanceTime = party.autoPlay.currentItemStartedAt! + 5_000;
      expect(party.autoPlay.scheduledAdvanceAt).toBe(expectedAdvanceTime);
    });

    it("uses default transition duration when item duration is null", () => {
      const itemWithNullDuration: Omit<MancheCatalogItem, "id"> = {
        kind: "transition",
        title: "Fade",
        packBasename: null,
        iframeUrl: null,
        youtubeEmbedUrl: null,
        directVideoUrl: null,
        savedRoundIndex: 0,
        savedQuestionIndex: 0,
        transitionKind: "fade",
        transitionDurationMs: null,
      };

      const newParty = store.createParty({
        maxPlayers: null,
        maxTeams: null,
        closedAfterStart: false,
        allowRename: true,
        allowTeamChange: true,
      });

      store.hostAppendManche(newParty, itemWithNullDuration);
      store.adminToggleAutoPlay(newParty, true, config, packs);

      const expectedAdvanceTime = newParty.autoPlay.currentItemStartedAt! + config.transitionDurationMs;
      expect(newParty.autoPlay.scheduledAdvanceAt).toBe(expectedAdvanceTime);
    });
  });

  describe("waiting for manual action", () => {
    it("clears schedule when waiting for manual action", () => {
      store.adminToggleAutoPlay(party, true, config, packs);
      
      expect(party.autoPlay.scheduledAdvanceAt).not.toBeNull();

      store.adminAutoPlayWaitForManualAction(party, true);

      expect(party.autoPlay.waitingForManualAction).toBe(true);
      expect(party.autoPlay.scheduledAdvanceAt).toBeNull();
    });

    it("resumes scheduling after manual action is completed", () => {
      store.adminToggleAutoPlay(party, true, config, packs);
      store.adminAutoPlayWaitForManualAction(party, true);

      const beforeResume = Date.now();
      store.adminAutoPlayResumeAfterManualAction(party, config, packs);

      expect(party.autoPlay.waitingForManualAction).toBe(false);
      expect(party.autoPlay.currentItemStartedAt).toBeGreaterThanOrEqual(beforeResume);
      expect(party.autoPlay.scheduledAdvanceAt).not.toBeNull();
    });

    it("does nothing if not waiting for manual action", () => {
      store.adminToggleAutoPlay(party, true, config, packs);
      
      const scheduledBefore = party.autoPlay.scheduledAdvanceAt;
      store.adminAutoPlayResumeAfterManualAction(party, config, packs);

      expect(party.autoPlay.scheduledAdvanceAt).toBe(scheduledBefore);
    });
  });

  describe("environment variable configuration", () => {
    it("uses custom question duration from config", () => {
      const customConfig = {
        questionDurationMs: 60_000,
        roundDurationMs: 300_000,
        transitionDurationMs: 3_000,
      };

      store.adminToggleAutoPlay(party, true, customConfig, packs);

      const expectedAdvanceTime = party.autoPlay.currentItemStartedAt! + customConfig.questionDurationMs;
      expect(party.autoPlay.scheduledAdvanceAt).toBe(expectedAdvanceTime);
    });

    it("uses custom round duration from config", () => {
      const customConfig = {
        questionDurationMs: 30_000,
        roundDurationMs: 600_000,
        transitionDurationMs: 3_000,
      };

      const videoItem: Omit<MancheCatalogItem, "id"> = {
        kind: "youtube",
        title: "Video",
        packBasename: null,
        iframeUrl: null,
        youtubeEmbedUrl: "https://www.youtube-nocookie.com/embed/test",
        directVideoUrl: null,
        savedRoundIndex: 0,
        savedQuestionIndex: 0,
        transitionKind: null,
        transitionDurationMs: null,
      };

      const newParty = store.createParty({
        maxPlayers: null,
        maxTeams: null,
        closedAfterStart: false,
        allowRename: true,
        allowTeamChange: true,
      });

      store.hostAppendManche(newParty, videoItem);
      store.adminToggleAutoPlay(newParty, true, customConfig, packs);

      const expectedAdvanceTime = newParty.autoPlay.currentItemStartedAt! + customConfig.roundDurationMs;
      expect(newParty.autoPlay.scheduledAdvanceAt).toBe(expectedAdvanceTime);
    });

    it("uses custom transition duration from config", () => {
      const customConfig = {
        questionDurationMs: 30_000,
        roundDurationMs: 300_000,
        transitionDurationMs: 10_000,
      };

      const transitionItem: Omit<MancheCatalogItem, "id"> = {
        kind: "transition",
        title: "Fade",
        packBasename: null,
        iframeUrl: null,
        youtubeEmbedUrl: null,
        directVideoUrl: null,
        savedRoundIndex: 0,
        savedQuestionIndex: 0,
        transitionKind: "fade",
        transitionDurationMs: null,
      };

      const newParty = store.createParty({
        maxPlayers: null,
        maxTeams: null,
        closedAfterStart: false,
        allowRename: true,
        allowTeamChange: true,
      });

      store.hostAppendManche(newParty, transitionItem);
      store.adminToggleAutoPlay(newParty, true, customConfig, packs);

      const expectedAdvanceTime = newParty.autoPlay.currentItemStartedAt! + customConfig.transitionDurationMs;
      expect(newParty.autoPlay.scheduledAdvanceAt).toBe(expectedAdvanceTime);
    });
  });
});
