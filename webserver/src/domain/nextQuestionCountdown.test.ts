import { describe, expect, it } from "vitest";

import { BuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import {
  forgetHostToken,
  hostAdminPath,
  hostTokenLocalStorageKey,
  readHostToken,
  rememberHostToken,
  shouldShowHostReturnLink,
} from "./hostReturnLink.js";
import {
  BROADCAST_POINT_MODAL_CLOSE_MS,
  isPointModalVisible,
  isValidNextQuestionCountdownSec,
  NEXT_QUESTION_COUNTDOWN_DEFAULT_SEC,
  nextQuestionCountdownProgress,
  nextQuestionCountdownRemainingSec,
  PLAYER_POINT_MODAL_CLOSE_MS,
  pointAwardLabel,
} from "./nextQuestionCountdown.js";
import { PartyStore } from "./store.js";

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

function pack(): QuizPack {
  return {
    id: "pack-nq",
    basename: "pack-nq",
    title: "Pack",
    rounds: [
      {
        title: "Manche",
        questions: [
          { prompt: "Q1", choices: ["A", "B"], correctIndex: 0, points: 10 },
          { prompt: "Q2", choices: ["A", "B"], correctIndex: 1, points: 10 },
        ],
      },
    ],
  };
}

function launchedParty(mode: "normal" | "autonomous" = "normal") {
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
    score: 0,
    joinedAt: 1,
  });
  const quiz = pack();
  const packs = new Map<string, QuizPack>([[quiz.id, quiz]]);
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
  store.hostLaunchManche(party, party.mancheScript[0]!.id, mode, true, packs);
  return { store, party, quiz, packs };
}

describe("next-question countdown", () => {
  it("defaults to 5 s and does not reuse the pre-buzzer countdown", () => {
    const store = new PartyStore(() => {}, buzzCatalog);
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    expect(party.nextQuestionCountdownSec).toBe(NEXT_QUESTION_COUNTDOWN_DEFAULT_SEC);
    expect(party.nextQuestionCountdownSec).toBe(5);
    expect(party.countdownDurationSec).toBe(5);
    expect(party.nextQuestionCountdownStartedAt).toBeNull();

    store.adminSetNextQuestionCountdownSec(party, 12);
    expect(party.nextQuestionCountdownSec).toBe(12);
    expect(party.countdownDurationSec).toBe(5);

    expect(() => store.adminSetNextQuestionCountdownSec(party, 2)).toThrow(/3 et 30/);
    expect(() => store.adminSetNextQuestionCountdownSec(party, 31)).toThrow(/3 et 30/);
    expect(isValidNextQuestionCountdownSec(3)).toBe(true);
    expect(isValidNextQuestionCountdownSec(30)).toBe(true);
    expect(isValidNextQuestionCountdownSec(10.5)).toBe(false);
  });

  it("starts on the next question, including when auto-open is on, and not on the first launch", () => {
    const manual = launchedParty("normal");
    expect(manual.party.nextQuestionCountdownStartedAt).toBeNull();
    expect(manual.party.countdownStartedAt).toBeNull();

    manual.store.adminAdvanceCue(manual.party, manual.quiz);
    expect(manual.party.currentQuestionIndex).toBe(1);
    expect(manual.party.nextQuestionCountdownStartedAt).not.toBeNull();
    expect(manual.party.countdownStartedAt).toBeNull();
    expect(manual.party.buzzWindowOpen).toBe(false);
    expect(manual.party.pointAward).toBeNull();

    const auto = launchedParty("autonomous");
    expect(auto.party.autoOpenBuzzOnCueAdvance).toBe(true);
    expect(auto.party.autoAdvanceQuizWhenAllBuzzed).toBe(true);
    // INCERTAIN: the same pause runs before the next question in autonomous mode.
    auto.store.adminAdvanceCue(auto.party, auto.quiz);
    expect(auto.party.nextQuestionCountdownStartedAt).not.toBeNull();
    expect(auto.party.readyPhaseStartedAt).toBeNull();
  });

  it("records who scored, then opens the ready phase only after the pause", () => {
    const { store, party, quiz } = launchedParty("autonomous");
    party.buzzOrder = ["alice"];
    party.buzzWindowOpen = true;
    store.adminValidateBuzzAnswer(party, "alice", "good", quiz);
    const before = party.countdownDurationSec;
    store.adminAdvanceCue(party, quiz);

    expect(party.pointAward).toEqual({
      playerId: "alice",
      playerName: "Alice",
      avatarKey: "a.png",
      points: 10,
    });
    expect(party.countdownDurationSec).toBe(before);
    expect(party.readyPhaseStartedAt).toBeNull();

    const startedAt = party.nextQuestionCountdownStartedAt!;
    expect(store.maybeFinishNextQuestionCountdown(party, quiz, startedAt + 4_999)).toBe(false);
    expect(party.pointAward).not.toBeNull();

    expect(store.maybeFinishNextQuestionCountdown(party, quiz, startedAt + 5_000)).toBe(true);
    expect(party.nextQuestionCountdownStartedAt).toBeNull();
    expect(party.pointAward).toBeNull();
    expect(party.winnerDisplay).toBeNull();
    expect(party.readyPhaseStartedAt).not.toBeNull();
    expect(party.countdownStartedAt).toBeNull();
    expect(party.countdownDurationSec).toBe(before);
  });

  it("refuses « Prêt » while the next-question pause is running", () => {
    const { store, party, quiz } = launchedParty("normal");
    store.adminAdvanceCue(party, quiz);
    expect(() => store.playerMarkReady(party, "alice", 30_000)).toThrow(/pas encore ouverte/);
    expect(party.countdownStartedAt).toBeNull();
  });

  it("derives the visible second, the drain, and the modal deadline from one server timestamp", () => {
    const startedAt = 1_000_000;
    expect(nextQuestionCountdownRemainingSec(startedAt, 5, startedAt)).toBe(5);
    expect(nextQuestionCountdownRemainingSec(startedAt, 5, startedAt + 1_001)).toBe(4);
    expect(nextQuestionCountdownRemainingSec(startedAt, 5, startedAt + 5_000)).toBe(0);
    expect(nextQuestionCountdownRemainingSec(null, 5, startedAt)).toBeNull();

    expect(nextQuestionCountdownProgress(startedAt, 5, startedAt)).toBe(1);
    expect(nextQuestionCountdownProgress(startedAt, 5, startedAt + 2_500)).toBeCloseTo(0.5);
    expect(nextQuestionCountdownProgress(startedAt, 5, startedAt + 5_000)).toBe(0);

    const base = {
      dismissed: false,
      startedAt,
      durationSec: 5,
      nowMs: startedAt + 2_000,
    };
    expect(isPointModalVisible({ ...base, closeAfterMs: PLAYER_POINT_MODAL_CLOSE_MS })).toBe(true);
    expect(
      isPointModalVisible({ ...base, nowMs: startedAt + 4_000, closeAfterMs: PLAYER_POINT_MODAL_CLOSE_MS }),
    ).toBe(false);
    expect(
      isPointModalVisible({ ...base, nowMs: startedAt + 3_000, closeAfterMs: BROADCAST_POINT_MODAL_CLOSE_MS }),
    ).toBe(false);
    expect(
      isPointModalVisible({
        ...base,
        durationSec: 3,
        nowMs: startedAt + 3_000,
        closeAfterMs: PLAYER_POINT_MODAL_CLOSE_MS,
      }),
    ).toBe(false);
    expect(
      isPointModalVisible({
        ...base,
        durationSec: 3,
        nowMs: startedAt + 2_999,
        closeAfterMs: PLAYER_POINT_MODAL_CLOSE_MS,
      }),
    ).toBe(true);
    expect(isPointModalVisible({ ...base, dismissed: true, closeAfterMs: PLAYER_POINT_MODAL_CLOSE_MS })).toBe(
      false,
    );
    expect(pointAwardLabel(1)).toBe("+1 point");
    expect(pointAwardLabel(10)).toBe("+10 points");
  });
});

describe("broadcast host return link", () => {
  it("keeps the token out of the admin path and shows the link only when a token is stored", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    };
    const partyId = "Party-ABC";
    const token = "secret-host-token";
    expect(shouldShowHostReturnLink(null)).toBe(false);
    expect(shouldShowHostReturnLink("")).toBe(false);

    rememberHostToken(storage, partyId, token);
    expect(readHostToken(storage, partyId)).toBe(token);
    expect(hostTokenLocalStorageKey(partyId)).toBe("partygames:hostToken:party-abc");
    expect(shouldShowHostReturnLink(readHostToken(storage, partyId))).toBe(true);

    const path = hostAdminPath(partyId);
    expect(path).toBe("/party/party-abc/admin");
    expect(path.includes(token)).toBe(false);
    expect(path.includes("token=")).toBe(false);
    expect(path.includes("#")).toBe(false);

    forgetHostToken(storage, partyId);
    expect(readHostToken(storage, partyId)).toBeNull();
    expect(shouldShowHostReturnLink(readHostToken(storage, partyId))).toBe(false);
  });
});
