import { afterEach, describe, expect, it, vi } from "vitest";

import { BuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { PartyStore } from "./store.js";
import type { Party } from "./types.js";

const buzzCatalog: BuzzSoundCatalog = {
  sounds: [
    { key: "good1", label: "Good", pool: "good", file: "buzzers/good1.mp3" },
    { key: "bad1", label: "Bad", pool: "bad", file: "buzzers/bad1.mp3" },
  ],
  goodPool: ["good1"],
  badPool: ["bad1"],
  byKey: new Map([
    ["good1", { key: "good1", label: "Good", pool: "good", file: "buzzers/good1.mp3" }],
    ["bad1", { key: "bad1", label: "Bad", pool: "bad", file: "buzzers/bad1.mp3" }],
  ]),
  defaultBuzzerKey: "good1",
};

function quizWith(count: number): QuizPack {
  return {
    id: "pack-controls",
    basename: "pack-controls",
    title: "Pack",
    rounds: [
      {
        title: "Manche",
        questions: Array.from({ length: count }, (_, index) => ({
          prompt: `Q${index + 1}`,
          choices: ["A", "B"],
          correctIndex: 0,
          points: 1,
        })),
      },
    ],
  };
}

function launched(count: number, mode: "question" | "round" = "round") {
  const store = new PartyStore(() => {}, buzzCatalog);
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
    avatarKey: "a.png",
    buzzSoundKey: "good1",
    teamId: null,
    score: 4,
    joinedAt: 1,
  });
  const quiz = quizWith(count);
  const packs = new Map<string, QuizPack>([[quiz.basename, quiz]]);
  store.hostAppendManche(party, {
    kind: "pack_quiz",
    title: quiz.title,
    packBasename: quiz.basename,
    iframeUrl: null,
    youtubeEmbedUrl: null,
    directVideoUrl: null,
    savedRoundIndex: 0,
    savedQuestionIndex: 0,
    transitionKind: null,
    transitionDurationMs: null,
  });
  store.adminSetWinnerScreenMode(party, mode);
  store.adminSetCountdownDuration(party, 5);
  store.adminSetNextQuestionCountdownSec(party, 0);
  store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", true, packs);
  return { store, party, quiz, packs };
}

describe("host winner button in « Fin de manche »", () => {
  it("does not keep a winner flag through the question, ready step, or open buzzer", () => {
    const { store, party, quiz } = launched(3, "question");
    store.adminSetNextQuestionCountdownSec(party, 5);
    store.adminAdvanceCue(party, quiz);
    expect(party.winnerDisplay).not.toBeNull();

    store.adminSetWinnerScreenMode(party, "round");
    expect(party.winnerScreenMode).toBe("round");
    expect(party.winnerDisplay).toBeNull();
    expect(party.mancheResultOpen).not.toBe(true);

    store.adminSetReadyCheckEnabled(party, true, quiz);
    expect(party.readyPhaseStartedAt === null || party.winnerDisplay === null).toBe(true);
    expect(party.winnerDisplay).toBeNull();

    store.adminSetBuzzOpen(party, true);
    expect(party.buzzWindowOpen).toBe(true);
    expect(party.winnerDisplay).toBeNull();
    expect(party.state).toBe("round_active");
  });

  it("opens the podium from Afficher gagnant without waiting for the last question", () => {
    const { store, party, packs } = launched(3, "round");
    expect(party.winnerDisplay).toBeNull();
    expect(party.mancheResultOpen).not.toBe(true);
    store.adminShowWinner(party);
    expect(party.mancheResultOpen).toBe(true);
    expect(party.winnerDisplay?.playerName).toBe("Alice");
    const snap = partySnapshotWithGame(party, packs, "host");
    expect(snap.manchePodium).toBeDefined();
    expect(party.state).toBe("round_active");
    expect(party.currentQuestionIndex).toBe(0);
  });
});

describe("server countdowns ignore the broadcast tab", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the buzzer from the server clock alone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
    const { store, party, quiz } = launched(2, "round");
    party.countdownStartedAt = Date.now();
    party.appliedCountdownDurationSec = 5;
    party.buzzWindowOpen = false;
    party.nextQuestionCountdownStartedAt = null;
    store.tickLiveRound(party, quiz);
    expect(party.buzzWindowOpen).toBe(false);
    vi.setSystemTime(new Date("2026-10-22T12:00:05.000Z"));
    store.tickLiveRound(party, quiz);
    expect(party.buzzWindowOpen).toBe(true);
    expect(party.currentQuestionIndex).toBe(0);
  });
});

describe("live pause", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("freezes the question and the buzzer countdown, then resumes the remaining time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
    const { store, party, quiz } = launched(2, "round");
    const question = party.currentQuestionIndex;
    party.countdownStartedAt = Date.now();
    party.appliedCountdownDurationSec = 5;
    party.buzzWindowOpen = false;
    party.nextQuestionCountdownStartedAt = null;

    vi.setSystemTime(new Date("2026-10-22T12:00:01.000Z"));
    store.adminToggleLivePause(party);
    expect(party.state).toBe("round_active");
    expect(party.liveRoundPausedAt).toBe(Date.parse("2026-10-22T12:00:01.000Z"));

    vi.setSystemTime(new Date("2026-10-22T12:00:06.000Z"));
    store.tickLiveRound(party, quiz);
    expect(party.buzzWindowOpen).toBe(false);
    expect(party.currentQuestionIndex).toBe(question);
    expect(party.state).toBe("round_active");

    store.adminToggleLivePause(party);
    expect(party.liveRoundPausedAt).toBeNull();
    expect(party.countdownStartedAt).toBe(Date.parse("2026-10-22T12:00:05.000Z"));
    store.tickLiveRound(party, quiz);
    expect(party.buzzWindowOpen).toBe(false);

    vi.setSystemTime(new Date("2026-10-22T12:00:10.000Z"));
    store.tickLiveRound(party, quiz);
    expect(party.buzzWindowOpen).toBe(true);
    expect(party.currentQuestionIndex).toBe(question);
  });
});

describe("jump to a question", () => {
  it("lands on question 70 for the host without stepping the earlier cues", () => {
    const { store, party, quiz } = launched(70, "round");
    store.adminJumpToQuestion(party, quiz, 70);
    expect(party.currentQuestionIndex).toBe(69);
    expect(party.state).toBe("round_active");
    expect(party.winnerDisplay).toBeNull();
    expect(party.mancheResultOpen).not.toBe(true);
    expect(() => store.adminAdvanceCue(party, quiz)).toThrowError(/questions/);
    expect(party.mancheResultOpen).toBe(true);
  });

  it("refuses the jump before the manche is running", () => {
    const store = new PartyStore(() => {}, buzzCatalog);
    const party: Party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    expect(() => store.adminJumpToQuestion(party, quizWith(70), 70)).toThrowError(/Lancez la manche/);
  });
});
