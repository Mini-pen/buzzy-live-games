import { describe, expect, it } from "vitest";

import { BuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import {
  forgetHostToken,
  forgetLegacyHostToken,
  hostAdminPath,
  hostTokenLocalStorageKey,
  listStoredHostPartyIds,
  migrateLegacyHostTokens,
  readHostToken,
  rememberHostToken,
  shouldShowHostReturnLink,
  type HostTokenBucket,
} from "./hostReturnLink.js";
import type { Party } from "./types.js";
import {
  BROADCAST_POINT_MODAL_CLOSE_MS,
  isPointModalVisible,
  isValidNextQuestionCountdownSec,
  isValidReadyTimeoutSec,
  NEXT_QUESTION_COUNTDOWN_DEFAULT_SEC,
  READY_TIMEOUT_DEFAULT_SEC,
  nextQuestionCountdownProgress,
  nextQuestionCountdownRemainingSec,
  POINT_MODAL_CLOSE_MS,
  pointAwardLabel,
  readyStatusLabel,
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

function launchedParty(
  mode: "normal" | "autonomous" = "normal",
  prepare?: (store: PartyStore, party: Party) => void,
) {
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
  prepare?.(store, party);
  store.hostLaunchManche(party, party.mancheScript[0]!.id, mode, true, packs);
  return { store, party, quiz, packs };
}

function tokenBucket(): HostTokenBucket {
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    },
    removeItem: (key) => {
      memory.delete(key);
    },
    get length() {
      return memory.size;
    },
    key: (index) => [...memory.keys()][index] ?? null,
  };
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
    expect(party.appliedNextQuestionCountdownSec).toBe(5);
    expect(party.countdownDurationSec).toBe(5);

    store.adminSetNextQuestionCountdownSec(party, 0);
    expect(party.nextQuestionCountdownSec).toBe(0);
    expect(party.countdownDurationSec).toBe(5);

    expect(() => store.adminSetNextQuestionCountdownSec(party, -1)).toThrow(/0 et 30/);
    expect(() => store.adminSetNextQuestionCountdownSec(party, 31)).toThrow(/0 et 30/);
    expect(isValidNextQuestionCountdownSec(0)).toBe(true);
    expect(isValidNextQuestionCountdownSec(30)).toBe(true);
    expect(isValidNextQuestionCountdownSec(10.5)).toBe(false);

    store.adminSetCountdownDuration(party, 0);
    expect(party.countdownDurationSec).toBe(0);
    expect(party.nextQuestionCountdownSec).toBe(0);
    expect(() => store.adminSetCountdownDuration(party, -1)).toThrow(/0 et 10/);
    expect(() => store.adminSetCountdownDuration(party, 11)).toThrow(/0 et 10/);
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
    auto.store.adminAdvanceCue(auto.party, auto.quiz);
    expect(auto.party.nextQuestionCountdownStartedAt).not.toBeNull();
    expect(auto.party.readyPhaseStartedAt).toBeNull();
  });

  it("records who scored, then opens the ready phase only after the pause", () => {
    const { store, party, quiz } = launchedParty("autonomous");
    store.adminSetReadyCheckEnabled(party, true, quiz);
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
      teamName: null,
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

  it("skips the pause and the point when the between-question delay is 0", () => {
    const { store, party, quiz } = launchedParty("autonomous");
    store.adminSetReadyCheckEnabled(party, true, quiz);
    store.adminSetNextQuestionCountdownSec(party, 0);
    party.buzzOrder = ["alice"];
    party.buzzWindowOpen = true;
    store.adminValidateBuzzAnswer(party, "alice", "good", quiz);
    store.adminAdvanceCue(party, quiz);
    expect(party.nextQuestionCountdownStartedAt).toBeNull();
    expect(party.pointAward).toBeNull();
    expect(party.winnerDisplay).toBeNull();
    expect(party.readyPhaseStartedAt).not.toBeNull();
    expect(party.countdownStartedAt).toBeNull();
  });

  it("opens the buzzer at once when the pre-buzzer countdown is 0 before the question starts", () => {
    const { store, party } = launchedParty("normal", (s, p) => {
      s.adminSetReadyCheckEnabled(p, true, null);
      s.adminSetCountdownDuration(p, 0);
    });
    expect(party.appliedCountdownDurationSec).toBe(0);
    expect(party.readyPhaseStartedAt).not.toBeNull();
    store.playerSetReady(party, "alice", true);
    expect(party.buzzWindowOpen).toBe(true);
    expect(party.countdownStartedAt).toBeNull();
    expect(party.readyPhaseStartedAt).toBeNull();
  });

  it("keeps the current question's countdowns when the host edits them mid-question", () => {
    const { store, party, quiz } = launchedParty("normal", (s, p) => {
      s.adminSetReadyCheckEnabled(p, true, null);
    });
    store.adminSetCountdownDuration(party, 0);
    store.adminSetNextQuestionCountdownSec(party, 0);
    store.playerSetReady(party, "alice", true);
    expect(party.appliedCountdownDurationSec).toBe(5);
    expect(party.buzzWindowOpen).toBe(false);
    expect(party.countdownStartedAt).not.toBeNull();
    expect(store.maybeOpenBuzzAfterCountdown(party)).toBe(false);

    store.adminAdvanceCue(party, quiz);
    expect(party.appliedCountdownDurationSec).toBe(0);
    expect(party.appliedNextQuestionCountdownSec).toBe(0);
    expect(party.nextQuestionCountdownStartedAt).toBeNull();
    expect(party.buzzWindowOpen).toBe(false);
    store.playerSetReady(party, "alice", true);
    expect(party.buzzWindowOpen).toBe(true);
    expect(party.countdownStartedAt).toBeNull();
  });

  it("does not shorten a pause that has already started", () => {
    const { store, party, quiz } = launchedParty("autonomous");
    store.adminAdvanceCue(party, quiz);
    const startedAt = party.nextQuestionCountdownStartedAt;
    expect(startedAt).not.toBeNull();
    store.adminSetNextQuestionCountdownSec(party, 0);
    expect(party.nextQuestionCountdownSec).toBe(0);
    expect(party.appliedNextQuestionCountdownSec).toBe(5);
    expect(store.maybeFinishNextQuestionCountdown(party, quiz, startedAt! + 1_000)).toBe(false);
    expect(store.maybeFinishNextQuestionCountdown(party, quiz, startedAt! + 5_000)).toBe(true);
  });

  it("refuses « Prêt » while the next-question pause is running", () => {
    const { store, party, quiz } = launchedParty("normal");
    store.adminAdvanceCue(party, quiz);
    expect(() => store.playerSetReady(party, "alice", true)).toThrow(/pas encore ouverte/);
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
    expect(isPointModalVisible({ ...base, closeAfterMs: POINT_MODAL_CLOSE_MS })).toBe(true);
    expect(
      isPointModalVisible({ ...base, nowMs: startedAt + 2_999, closeAfterMs: POINT_MODAL_CLOSE_MS }),
    ).toBe(true);
    expect(
      isPointModalVisible({ ...base, nowMs: startedAt + 3_000, closeAfterMs: POINT_MODAL_CLOSE_MS }),
    ).toBe(false);
    expect(
      isPointModalVisible({ ...base, nowMs: startedAt + 3_000, closeAfterMs: BROADCAST_POINT_MODAL_CLOSE_MS }),
    ).toBe(false);
    expect(
      isPointModalVisible({
        ...base,
        durationSec: 2,
        nowMs: startedAt + 2_000,
        closeAfterMs: POINT_MODAL_CLOSE_MS,
      }),
    ).toBe(false);
    expect(
      isPointModalVisible({
        ...base,
        durationSec: 2,
        nowMs: startedAt + 1_999,
        closeAfterMs: POINT_MODAL_CLOSE_MS,
      }),
    ).toBe(true);
    expect(
      isPointModalVisible({ ...base, durationSec: 0, nowMs: startedAt, closeAfterMs: POINT_MODAL_CLOSE_MS }),
    ).toBe(false);
    expect(isPointModalVisible({ ...base, dismissed: true, closeAfterMs: POINT_MODAL_CLOSE_MS })).toBe(
      false,
    );
    expect(pointAwardLabel(1)).toBe("+ 1 point");
    expect(pointAwardLabel(10)).toBe("+ 10 points");
    expect(pointAwardLabel(1, "2")).toBe("+ 1 point pour l'équipe 2");
    expect(pointAwardLabel(10, "2")).toBe("+ 10 points pour l'équipe 2");
    expect(readyStatusLabel(3, 5, "player")).toBe("3 / 5 joueurs prêts");
    expect(readyStatusLabel(1, 5, "player")).toBe("1 / 5 joueurs prêt");
    expect(readyStatusLabel(3, 5, "summary")).toBe("3/5 prêts");
    expect(readyStatusLabel(1, 5, "summary")).toBe("1/5 prêt");
  });

  it("toggles Prêt, waits for a late joiner, then starts the buzzer countdown", () => {
    const { store, party } = launchedParty("normal", (s, p) => {
      s.adminSetReadyCheckEnabled(p, true, null);
    });
    expect(party.readyPhaseStartedAt).not.toBeNull();
    party.players.set("bob", {
      id: "bob",
      displayName: "Bob",
      avatarKey: "b.png",
      buzzSoundKey: "good1",
      teamId: null,
      score: 0,
      joinedAt: 2,
    });
    store.notePlayerJoinedDuringQuestion(party, "bob");
    store.playerSetReady(party, "alice", true);
    expect(party.countdownStartedAt).toBeNull();
    store.playerSetReady(party, "alice", false);
    expect(party.readyPlayers.has("alice")).toBe(false);
    store.playerSetReady(party, "alice", true);
    expect(party.buzzWindowOpen).toBe(false);
    expect(party.countdownStartedAt).toBeNull();
    store.playerSetReady(party, "bob", true);
    expect(party.countdownStartedAt).not.toBeNull();
    expect(party.buzzWindowOpen).toBe(false);

    party.players.set("carol", {
      id: "carol",
      displayName: "Carol",
      avatarKey: "c.png",
      buzzSoundKey: "good1",
      teamId: null,
      score: 0,
      joinedAt: 3,
    });
    store.notePlayerJoinedDuringQuestion(party, "carol");
    expect(party.readyPlayers.has("carol")).toBe(true);
    expect(party.countdownStartedAt).not.toBeNull();

    party.countdownStartedAt = Date.now() - 10_000;
    expect(store.maybeOpenBuzzAfterCountdown(party)).toBe(true);
    party.players.set("dave", {
      id: "dave",
      displayName: "Dave",
      avatarKey: "d.png",
      buzzSoundKey: "good1",
      teamId: null,
      score: 0,
      joinedAt: 4,
    });
    store.notePlayerJoinedDuringQuestion(party, "dave");
    expect(party.readyPlayers.has("carol")).toBe(true);
    expect(party.readyPlayers.has("dave")).toBe(true);
    expect(party.buzzWindowOpen).toBe(true);
  });

  it("starts the buzzer countdown from the host timeout or from Lancer la question", () => {
    const { store, party } = launchedParty("normal", (s, p) => {
      s.adminSetReadyCheckEnabled(p, true, null);
    });
    expect(party.readyTimeoutSec).toBe(READY_TIMEOUT_DEFAULT_SEC);
    expect(isValidReadyTimeoutSec(0)).toBe(true);
    expect(isValidReadyTimeoutSec(5)).toBe(true);
    expect(isValidReadyTimeoutSec(60)).toBe(true);
    expect(isValidReadyTimeoutSec(4)).toBe(false);
    expect(isValidReadyTimeoutSec(61)).toBe(false);
    expect(() => store.adminSetReadyTimeoutSec(party, 4)).toThrow(/5 et 60/);
    store.adminSetReadyTimeoutSec(party, 0);
    party.readyPhaseStartedAt = Date.now() - 120_000;
    expect(store.maybeStartCountdownIfReady(party)).toBe(false);

    store.adminSetReadyTimeoutSec(party, 15);
    party.readyPhaseStartedAt = Date.now() - 14_000;
    expect(store.maybeStartCountdownIfReady(party)).toBe(false);
    party.readyPhaseStartedAt = Date.now() - 15_000;
    expect(store.maybeStartCountdownIfReady(party)).toBe(true);
    expect(party.countdownStartedAt).not.toBeNull();
    expect(party.buzzWindowOpen).toBe(false);

    const manual = launchedParty("normal", (s, p) => {
      s.adminSetReadyCheckEnabled(p, true, null);
    });
    manual.party.players.set("bob", {
      id: "bob",
      displayName: "Bob",
      avatarKey: "b.png",
      buzzSoundKey: "good1",
      teamId: null,
      score: 0,
      joinedAt: 2,
    });
    manual.store.adminLaunchQuestion(manual.party);
    expect(manual.party.countdownStartedAt).not.toBeNull();
    expect(manual.party.buzzWindowOpen).toBe(false);
    expect(manual.party.readyPlayers.has("bob")).toBe(false);

    const instant = launchedParty("normal", (s, p) => {
      s.adminSetReadyCheckEnabled(p, true, null);
      s.adminSetCountdownDuration(p, 0);
    });
    instant.store.adminLaunchQuestion(instant.party);
    expect(instant.party.buzzWindowOpen).toBe(true);
    expect(instant.party.countdownStartedAt).toBeNull();
  });

  it("names the team on the point pill when the scorer has a team", () => {
    const { store, party, quiz } = launchedParty("autonomous");
    party.maxTeams = 2;
    party.players.get("alice")!.teamId = 1;
    party.buzzOrder = ["alice"];
    party.buzzWindowOpen = true;
    store.adminValidateBuzzAnswer(party, "alice", "good", quiz);
    store.adminAdvanceCue(party, quiz);
    expect(party.pointAward?.teamName).toBe("1");
    expect(pointAwardLabel(party.pointAward?.points ?? 0, party.pointAward?.teamName)).toBe(
      "+ 10 points pour l'équipe 1",
    );
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

  it("copies a legacy sessionStorage host token into localStorage once, then drops the session copy", () => {
    const session = tokenBucket();
    const local = tokenBucket();
    session.setItem("partygames:adminToken:Party-ABC", "legacy-token");
    migrateLegacyHostTokens(session, local);
    expect(readHostToken(local, "party-abc")).toBe("legacy-token");
    expect(session.length).toBe(0);
    expect(listStoredHostPartyIds(local)).toEqual(["party-abc"]);

    session.setItem("partygames:adminToken:party-abc", "stale");
    migrateLegacyHostTokens(session, local);
    expect(readHostToken(local, "Party-ABC")).toBe("legacy-token");
    expect(session.getItem("partygames:adminToken:party-abc")).toBeNull();

    session.setItem("partygames:adminToken:Other", "gone");
    forgetLegacyHostToken(session, "other");
    expect(session.length).toBe(0);
    expect(readHostToken(local, "other")).toBeNull();
  });
});
