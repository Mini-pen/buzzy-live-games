import { describe, it, expect } from "vitest";
import { PartyStore } from "./store.js";
import type { QuizPack } from "../games/pack.js";
import { BuzzSoundCatalog } from "../games/buzzSoundCatalog.js";

const emptyBuzzCatalog: BuzzSoundCatalog = {
  sounds: [
    {
      key: "good1",
      label: "Good Sound",
      pool: "good",
      publicPath: "/sounds/good1.mp3",
    },
    {
      key: "bad1",
      label: "Bad Sound",
      pool: "bad",
      publicPath: "/sounds/bad1.mp3",
    },
  ],
  goodPool: ["good1"],
  badPool: ["bad1"],
  byKey: new Map([
    ["good1", { key: "good1", label: "Good Sound", pool: "good", publicPath: "/sounds/good1.mp3" }],
    ["bad1", { key: "bad1", label: "Bad Sound", pool: "bad", publicPath: "/sounds/bad1.mp3" }],
  ]),
};

function createMockPack(): QuizPack {
  return {
    id: "test-pack",
    basename: "test-pack",
    title: "Test Pack",
    rounds: [
      {
        title: "Round 1",
        questions: [
          {
            prompt: "Q1",
            choices: ["A", "B", "C"],
            correctIndex: 0,
            points: 10,
          },
          {
            prompt: "Q2",
            choices: ["A", "B", "C"],
            correctIndex: 1,
            points: 10,
          },
        ],
      },
    ],
  };
}

describe("Automatic winner screen", () => {
  it("should show winner automatically when winnerScreenMode=question and advancing to next question", () => {
    const store = new PartyStore(() => {}, emptyBuzzCatalog);
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });

    party.players.set("alice", {
      id: "alice",
      displayName: "Alice",
      avatarKey: "avatar1.png",
      buzzSoundKey: "buzz1",
      teamId: null,
      score: 100,
      joinedAt: Date.now(),
    });

    party.players.set("bob", {
      id: "bob",
      displayName: "Bob",
      avatarKey: "avatar2.png",
      buzzSoundKey: "buzz2",
      teamId: null,
      score: 50,
      joinedAt: Date.now(),
    });

    const pack = createMockPack();
    const packs = new Map<string, QuizPack>([[pack.id, pack]]);

    const mancheItem = {
      kind: "pack_quiz" as const,
      title: pack.title,
      packBasename: pack.basename,
      iframeUrl: null,
      youtubeEmbedUrl: null,
      directVideoUrl: null,
      savedRoundIndex: 0,
      savedQuestionIndex: 0,
      transitionKind: null,
      transitionDurationMs: null,
    };

    store.hostAppendManche(party, mancheItem);
    store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", false, packs);

    party.winnerScreenMode = "question";

    expect(party.winnerDisplay).toBeNull();

    store.adminAdvanceCue(party, pack);

    expect(party.winnerDisplay).not.toBeNull();
    expect(party.winnerDisplay?.playerName).toBe("Alice");
    expect(party.winnerDisplay?.score).toBe(100);
  });

  it("should show winner automatically when winnerScreenMode=round at end of round", () => {
    const store = new PartyStore(() => {}, emptyBuzzCatalog);
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });

    party.players.set("alice", {
      id: "alice",
      displayName: "Alice",
      avatarKey: "avatar1.png",
      buzzSoundKey: "buzz1",
      teamId: null,
      score: 100,
      joinedAt: Date.now(),
    });

    const pack = createMockPack();
    const packs = new Map<string, QuizPack>([[pack.id, pack]]);

    const mancheItem = {
      kind: "pack_quiz" as const,
      title: pack.title,
      packBasename: pack.basename,
      iframeUrl: null,
      youtubeEmbedUrl: null,
      directVideoUrl: null,
      savedRoundIndex: 0,
      savedQuestionIndex: 0,
      transitionKind: null,
      transitionDurationMs: null,
    };

    store.hostAppendManche(party, mancheItem);
    store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", false, packs);

    party.winnerScreenMode = "round";

    store.adminAdvanceCue(party, pack);

    expect(party.winnerDisplay).toBeNull();

    try {
      store.adminAdvanceCue(party, pack);
      expect.fail("Should have thrown ROUND_EXHAUSTED");
    } catch (e: unknown) {
      expect((e as { code?: string }).code).toBe("ROUND_EXHAUSTED");
    }

    expect(party.winnerDisplay).not.toBeNull();
    expect(party.winnerDisplay?.playerName).toBe("Alice");
    expect(party.winnerDisplay?.score).toBe(100);
  });

  it("should not show winner if winnerScreenMode is question and we are at round end", () => {
    const store = new PartyStore(() => {}, emptyBuzzCatalog);
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });

    party.players.set("alice", {
      id: "alice",
      displayName: "Alice",
      avatarKey: "avatar1.png",
      buzzSoundKey: "buzz1",
      teamId: null,
      score: 100,
      joinedAt: Date.now(),
    });

    const pack = createMockPack();
    const packs = new Map<string, QuizPack>([[pack.id, pack]]);

    const mancheItem = {
      kind: "pack_quiz" as const,
      title: pack.title,
      packBasename: pack.basename,
      iframeUrl: null,
      youtubeEmbedUrl: null,
      directVideoUrl: null,
      savedRoundIndex: 0,
      savedQuestionIndex: 0,
      transitionKind: null,
      transitionDurationMs: null,
    };

    store.hostAppendManche(party, mancheItem);
    store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", false, packs);

    party.winnerScreenMode = "question";

    store.adminAdvanceCue(party, pack);
    expect(party.winnerDisplay).not.toBeNull();

    party.winnerDisplay = null;

    try {
      store.adminAdvanceCue(party, pack);
      expect.fail("Should have thrown ROUND_EXHAUSTED");
    } catch (e: unknown) {
      expect((e as { code?: string }).code).toBe("ROUND_EXHAUSTED");
    }

    expect(party.winnerDisplay).toBeNull();
  });
});
