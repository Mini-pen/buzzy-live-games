import { describe, expect, test } from "vitest";

import type { QuizPack } from "../games/pack.js";
import type { MancheCatalogItem, Party } from "./types.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";

const demoPack: QuizPack = {
  id: "demo-quiz-v1",
  title: "Demo",
  version: 1,
  rounds: [
    {
      id: "r1",
      title: "R",
      questions: [
        {
          id: "q1",
          prompt: "?",
          choices: ["a", "b"],
          correctIndex: 1,
          points: 2,
        },
      ],
    },
  ],
};

const videoRoundPack: QuizPack = {
  id: "demo-video-v1",
  title: "Vidéo",
  version: 1,
  rounds: [
    {
      id: "v1",
      title: "Clip",
      videoUrl: "https://example.com/x.webm",
    },
  ],
};

const freeBuzzPack: QuizPack = {
  id: "fb-v1",
  title: "Free",
  version: 1,
  rounds: [
    {
      kind: "free_buzz",
      id: "fr",
      title: "Oral",
      playerPrompt: "Buzz",
      plannedQuestionCount: 3,
    },
  ],
};

const audioBlindPack: QuizPack = {
  id: "ab-v1",
  title: "Blind",
  version: 1,
  rounds: [
    {
      kind: "audio_blind",
      id: "ar",
      title: "Son",
      tracks: [
        { id: "t1", audioUrl: "/games/a.mp3", revealTitle: "Titre A" },
        { id: "t2", audioUrl: "/games/b.mp3", revealTitle: "Titre B", revealArtist: "Art B" },
      ],
    },
  ],
};

const imageBuzzPack: QuizPack = {
  id: "ib-v1",
  title: "Images",
  version: 1,
  rounds: [
    {
      kind: "image_buzz",
      id: "ib",
      title: "Visuels",
      slides: [
        { id: "s1", imageUrl: "/games/a.png", prompt: "Décris" },
        { id: "s2", imageUrl: "/games/b.png" },
      ],
    },
  ],
};

const progressiveGuessPack: QuizPack = {
  id: "pg-v1",
  title: "Progressif",
  version: 1,
  rounds: [
    {
      kind: "progressive_guess",
      id: "pg",
      title: "Films",
      items: [
        {
          id: "m1",
          playerPrompt: "Devine le film.",
          clues: [
            { imageUrl: "/games/a.png", points: 3 },
            { imageUrl: "/games/b.png", points: 1 },
          ],
          reveal: { answer: "Réponse", imageUrl: "/games/c.png" },
        },
      ],
    },
  ],
};

function partyStub(over: Partial<Party>): Party {
  const base: Party = {
    id: "party-uuid",
    joinCode: "ABCD",
    adminToken: "sec",
    createdAt: 0,
    updatedAt: 1,
    state: "lobby",
    hasStartedRound: false,
    maxPlayers: null,
    maxTeams: null,
    closedAfterStart: false,
    allowRename: true,
    allowTeamChange: true,
    players: new Map(),
    buzzOrder: [],
    buzzQuizGuess: new Map(),
    buzzWindowOpen: false,
    autoOpenBuzzOnCueAdvance: false,
    chat: [],
    currentRoundIndex: null,
    currentQuestionIndex: null,
    loadedPackId: null,
    videoReplaySerial: 0,
    allowPlayerAudioControl: false,
    buzzSound: {
      allowedGoodKeys: ["g1"],
      allowedBadKeys: ["b1"],
      playPlayerBuzzTone: true,
      echoPlayerBuzzOnHost: true,
    },
    mancheScript: [],
    activeMancheId: null,
  };
  return { ...base, ...over };
}

function quizMancheOverPack(basenameKey: string, idForItem = "mid-quiz"): MancheCatalogItem {
  return {
    id: idForItem,
    kind: "pack_quiz",
    title: basenameKey,
    packBasename: basenameKey,
    iframeUrl: null,
    youtubeEmbedUrl: null,
    directVideoUrl: null,
    savedRoundIndex: 0,
    savedQuestionIndex: 0,
  };
}

describe("partySnapshotWithGame", () => {
  const packs = new Map<string, QuizPack>([
    ["example", demoPack],
    ["vid", videoRoundPack],
    ["free", freeBuzzPack],
    ["aud", audioBlindPack],
    ["imgb", imageBuzzPack],
    ["prog", progressiveGuessPack],
  ]);

  test("quiz host snapshot includes correct index", () => {
    const party = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 0,
      loadedPackId: "demo-quiz-v1",
      hasStartedRound: true,
      mancheScript: [quizMancheOverPack("example")],
      activeMancheId: "mid-quiz",
    });
    const hostSnap = partySnapshotWithGame(party, packs, "host");
    expect(hostSnap.gameBoard).not.toBeNull();
    expect(hostSnap.gameBoard?.kind).toBe("quiz");
    if (hostSnap.gameBoard?.kind !== "quiz") throw new Error("expected quiz");
    expect(hostSnap.gameBoard.correctChoiceIndex).toBe(1);
    const playSnap = partySnapshotWithGame(party, packs, "player");
    expect(playSnap.gameBoard?.kind).toBe("quiz");
    if (playSnap.gameBoard?.kind !== "quiz") throw new Error("expected quiz");
    expect(playSnap.gameBoard.correctChoiceIndex).toBeUndefined();
  });

  test("host snapshot lists buzz quiz picks for the queue", () => {
    const party = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 0,
      loadedPackId: "demo-quiz-v1",
      hasStartedRound: true,
      mancheScript: [quizMancheOverPack("example")],
      activeMancheId: "mid-quiz",
      buzzWindowOpen: true,
      buzzOrder: ["player-a", "player-b"],
      buzzQuizGuess: new Map([
        ["player-a", 1],
        ["player-b", 0],
      ]),
    });
    const hostSnap = partySnapshotWithGame(party, packs, "host");
    expect(hostSnap.buzzQuizQueueDetail).toHaveLength(2);
    expect(hostSnap.buzzQuizQueueDetail?.[0]).toMatchObject({
      playerId: "player-a",
      choiceIndex: 1,
      letter: "B",
      choiceLabel: "b",
      correct: true,
    });
    expect(hostSnap.buzzQuizQueueDetail?.[1]).toMatchObject({
      playerId: "player-b",
      choiceIndex: 0,
      letter: "A",
      choiceLabel: "a",
      correct: false,
    });

    const playSnap = partySnapshotWithGame(party, packs, "player");
    expect(playSnap.buzzQuizQueueDetail).toBeUndefined();
  });

  test("host snapshot exposes buzz auto-open-after-advance preference", () => {
    const partyOn = partyStub({ autoOpenBuzzOnCueAdvance: true });
    expect(partySnapshotWithGame(partyOn, packs, "host").autoOpenBuzzOnCueAdvance).toBe(true);
    expect(partySnapshotWithGame(partyOn, packs, "player").autoOpenBuzzOnCueAdvance).toBeUndefined();

    const partyOff = partyStub({ autoOpenBuzzOnCueAdvance: false });
    expect(partySnapshotWithGame(partyOff, packs, "host").autoOpenBuzzOnCueAdvance).toBe(false);
  });

  test("video round exposes replay serial", () => {
    const party = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 0,
      loadedPackId: "demo-video-v1",
      hasStartedRound: true,
      videoReplaySerial: 3,
      mancheScript: [quizMancheOverPack("vid")],
      activeMancheId: "mid-quiz",
    });
    const s = partySnapshotWithGame(party, packs, "player");
    expect(s.gameBoard?.kind).toBe("video");
    if (s.gameBoard?.kind !== "video") throw new Error("expected video");
    expect(s.gameBoard.replaySerial).toBe(3);
    expect(s.gameBoard.videoUrl).toContain("example.com");
  });

  test("image_buzz shows slide without quiz choices payload", () => {
    const party = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 0,
      loadedPackId: "ib-v1",
      hasStartedRound: true,
      mancheScript: [quizMancheOverPack("imgb", "mid-img")],
      activeMancheId: "mid-img",
    });
    const s = partySnapshotWithGame(party, packs, "player");
    expect(s.gameBoard?.kind).toBe("image_buzz");
    if (s.gameBoard?.kind !== "image_buzz") throw new Error("image_buzz");
    expect(s.gameBoard.imageUrl).toBe("/games/a.png");
    expect(s.gameBoard.slideIndexHuman).toBe(1);
    expect(s.gameBoard.slideCount).toBe(2);
    expect(s.gameBoard.prompt).toBe("Décris");
    expect(s.gameBoard.awardPoints).toBe(1);
  });

  test("progressive_guess clue then reveal surface", () => {
    const mid = "mid-pg";
    const partyClue = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 0,
      loadedPackId: "pg-v1",
      hasStartedRound: true,
      mancheScript: [quizMancheOverPack("prog", mid)],
      activeMancheId: mid,
    });
    const s0 = partySnapshotWithGame(partyClue, packs, "player");
    expect(s0.gameBoard?.kind).toBe("progressive_guess");
    if (s0.gameBoard?.kind !== "progressive_guess") throw new Error("pg");
    expect(s0.gameBoard.phase).toBe("clue");
    expect(s0.gameBoard.awardPoints).toBe(3);
    const partyReveal = partyStub({
      ...partyClue,
      currentQuestionIndex: 2,
    });
    const s2 = partySnapshotWithGame(partyReveal, packs, "player");
    if (s2.gameBoard?.kind !== "progressive_guess") throw new Error("pg2");
    expect(s2.gameBoard.phase).toBe("reveal");
    expect(s2.gameBoard.answer).toBe("Réponse");
  });

  test("audio blind hides reveal from players", () => {
    const party = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 1,
      loadedPackId: "ab-v1",
      hasStartedRound: true,
      mancheScript: [quizMancheOverPack("aud", "mid-a")],
      activeMancheId: "mid-a",
    });
    const play = partySnapshotWithGame(party, packs, "player");
    expect(play.gameBoard?.kind).toBe("audio_blind");
    if (play.gameBoard?.kind !== "audio_blind") throw new Error("audio");
    expect(play.gameBoard.revealTitle).toBeUndefined();
    expect(play.gameBoard.audioUrl).toBe("");
    const host = partySnapshotWithGame(party, packs, "host");
    if (host.gameBoard?.kind !== "audio_blind") throw new Error("audio host");
    expect(host.gameBoard.revealTitle).toBe("Titre B");
    expect(host.gameBoard.revealArtist).toBe("Art B");
  });

  test("snapshot carries allowPlayerAudioControl", () => {
    const party = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 0,
      loadedPackId: "ab-v1",
      hasStartedRound: true,
      allowPlayerAudioControl: true,
      mancheScript: [quizMancheOverPack("aud", "mid-a")],
      activeMancheId: "mid-a",
    });
    expect(partySnapshotWithGame(party, packs, "player").allowPlayerAudioControl).toBe(true);
  });

  test("audio blind exposes stream URL to players when control is allowed", () => {
    const party = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 0,
      loadedPackId: "ab-v1",
      hasStartedRound: true,
      allowPlayerAudioControl: true,
      mancheScript: [quizMancheOverPack("aud", "mid-a")],
      activeMancheId: "mid-a",
    });
    const play = partySnapshotWithGame(party, packs, "player");
    if (play.gameBoard?.kind !== "audio_blind") throw new Error("audio");
    expect(play.gameBoard.audioUrl).toBe("/games/a.mp3");
  });

  test("omits gameBoard when no round manche is targeted", () => {
    const party = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 0,
      loadedPackId: null,
      activeMancheId: null,
    });
    expect(partySnapshotWithGame(party, packs, "host").gameBoard).toBeNull();
  });
});
