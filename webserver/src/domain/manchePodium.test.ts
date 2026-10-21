import { describe, expect, it } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import {
  buildManchePodium,
  playerStaysOnPodium,
  podiumPhoneFocus,
  ranksForDescendingScores,
  type PodiumInputPlayer,
} from "./manchePodium.js";
import { PartyStore } from "./store.js";
import type { Party } from "./types.js";

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

function players(scores: number[]): PodiumInputPlayer[] {
  return scores.map((score, index) => ({
    id: `p${index}`,
    displayName: `J${index + 1}`,
    score,
    teamId: null,
  }));
}

describe("manche podium ranking", () => {
  it("builds a three-step podium, five side rows, and + N autres for 18 players", () => {
    const podium = buildManchePodium({
      players: players(Array.from({ length: 18 }, (_, index) => 18 - index)),
      maxTeams: null,
      mancheNumber: 2,
      questionCount: 10,
    });
    expect(podium.title).toBe("Fin de la manche 2");
    expect(podium.subtitle).toBe("10 questions · 18 joueurs");
    expect(podium.steps.map((step) => step.rank)).toEqual([2, 1, 3]);
    expect(podium.steps[1]?.members[0]?.rankLabel).toBe("1er");
    expect(podium.steps[1]?.members[0]?.initial).toBe("J");
    expect(podium.side.map((row) => row.rankLabel)).toEqual(["4e", "5e", "6e", "7e", "8e"]);
    expect(podium.othersLabel).toBe("+ 10 autres joueurs");
    expect(podium.steps[1]?.members[0]?.scoreLabel).toBe("18 points");
    expect(podium.side[0]?.scoreShort).toBe("15 pts");
  });

  it("uses dense ties by default and skip when asked, with Ex æquo and no empty step", () => {
    expect(ranksForDescendingScores([10, 10, 8, 5])).toEqual([1, 1, 2, 3]);
    expect(ranksForDescendingScores([10, 10, 8, 5], "skip")).toEqual([1, 1, 3, 4]);
    const dense = buildManchePodium({
      players: players([10, 10, 8, 5]),
      maxTeams: null,
      mancheNumber: 1,
      questionCount: 4,
    });
    expect(dense.steps.find((step) => step.rank === 1)?.tied).toBe(true);
    expect(dense.steps.map((step) => step.rank)).toEqual([2, 1, 3]);
    const skip = buildManchePodium({
      players: players([10, 10, 8, 5]),
      maxTeams: null,
      mancheNumber: 1,
      questionCount: 4,
      tieRankMode: "skip",
    });
    expect(skip.steps.map((step) => step.rank)).toEqual([3, 1, 4]);
    expect(skip.steps.some((step) => step.members.length === 0)).toBe(false);
  });

  it("hides empty steps when fewer than three players stand", () => {
    const one = buildManchePodium({
      players: players([4]),
      maxTeams: null,
      mancheNumber: 1,
      questionCount: 1,
    });
    expect(one.steps).toHaveLength(1);
    expect(one.steps[0]?.rank).toBe(1);
    expect(one.side).toEqual([]);
    expect(one.othersLabel).toBeNull();
    expect(one.subtitle).toBe("1 question · 1 joueur");
    const two = buildManchePodium({
      players: players([4, 2]),
      maxTeams: null,
      mancheNumber: 1,
      questionCount: 3,
    });
    expect(two.steps.map((step) => step.rank)).toEqual([2, 1]);
  });

  it("still shows the podium when every score is zero", () => {
    const podium = buildManchePodium({
      players: players([0, 0]),
      maxTeams: null,
      mancheNumber: 1,
      questionCount: 2,
    });
    expect(podium.participantCount).toBe(2);
    expect(podium.steps[0]?.members[0]?.scoreLabel).toBe("0 points");
  });

  it("ranks teams, and the phone card names the contribution and the best player", () => {
    const roster: PodiumInputPlayer[] = [
      { id: "alice", displayName: "Alice", score: 8, teamId: 1 },
      { id: "bob", displayName: "Bob", score: 3, teamId: 1 },
      { id: "chloe", displayName: "Chloé", score: 5, teamId: 2 },
    ];
    const podium = buildManchePodium({
      players: roster,
      maxTeams: 2,
      mancheNumber: 1,
      questionCount: 6,
    });
    expect(podium.kind).toBe("teams");
    expect(podium.steps.map((step) => step.members[0]?.name)).toEqual(["Équipe 2", "Équipe 1"]);
    expect(podium.steps[0]?.members[0]?.memberCount).toBe(1);
    expect(podium.steps[1]?.members[0]?.memberCount).toBe(2);
    expect(podium.steps[1]?.members[0]?.score).toBe(11);
    expect(podium.steps[1]?.members[0]?.initial).toBe("1");
    expect(podium.subtitle).toContain("équipes");
    const focus = podiumPhoneFocus(podium, "bob");
    expect(focus?.teamLine).toBe("Votre équipe : Équipe 1");
    expect(focus?.contributionLine).toBe("Votre apport : 3 points");
    expect(focus?.bestPlayerLine).toBe("Meilleur joueur : Alice");
    expect(focus?.placeLabel).toBe("1re sur 2");
  });

  it("keeps a disconnected player by default and can drop them", () => {
    const roster: PodiumInputPlayer[] = [
      { id: "alice", displayName: "Alice", score: 9, teamId: null, connected: false },
      { id: "bob", displayName: "Bob", score: 4, teamId: null, connected: true },
    ];
    expect(playerStaysOnPodium(false)).toBe(true);
    const kept = buildManchePodium({
      players: roster,
      maxTeams: null,
      mancheNumber: 1,
      questionCount: 1,
    });
    expect(kept.ranked.map((row) => row.name)).toEqual(["Alice", "Bob"]);
    const dropped = buildManchePodium({
      players: roster,
      maxTeams: null,
      mancheNumber: 1,
      questionCount: 1,
      disconnected: "drop",
    });
    expect(dropped.ranked.map((row) => row.name)).toEqual(["Bob"]);
  });
});

function quiz(questions: 1 | 2): QuizPack {
  const rows = [
    { prompt: "Q1", choices: ["A", "B"], correctIndex: 0, points: 2 },
    { prompt: "Q2", choices: ["A", "B"], correctIndex: 1, points: 2 },
  ].slice(0, questions);
  return {
    id: "pack-podium",
    basename: "pack-podium",
    title: "Pack",
    rounds: [{ title: "Manche", questions: rows }],
  };
}

function play(questions: 1 | 2): { store: PartyStore; party: Party; pack: QuizPack } {
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
  const pack = quiz(questions);
  const packs = new Map<string, QuizPack>([[pack.basename, pack]]);
  store.hostAppendManche(party, {
    kind: "pack_quiz",
    title: pack.title,
    packBasename: pack.basename,
    iframeUrl: null,
    youtubeEmbedUrl: null,
    directVideoUrl: null,
    savedRoundIndex: 0,
    savedQuestionIndex: 0,
    transitionKind: null,
    transitionDurationMs: null,
  });
  store.adminSetCountdownDuration(party, 0);
  store.adminSetBuzzGraceWindow(party, 0);
  store.hostLaunchManche(party, party.mancheScript[0]!.id, "autonomous", true, packs);
  store.buzz(party, "alice", Date.now(), { choicesLen: 2, choiceIndex: 0 });
  store.maybeFinalizeBuzzDecision(party);
  store.maybeAutoResolveQuizWhenEveryPlayerBuzzed(party, pack);
  return { store, party, pack };
}

describe("manche podium on the party", () => {
  it("opens at the end of the manche, stays round_active, and waits for the host", () => {
    const { store, party, pack } = play(1);
    expect(party.state).toBe("round_active");
    expect(party.mancheResultOpen).toBe(true);
    const packs = new Map([[pack.basename, pack]]);
    const snap = partySnapshotWithGame(party, packs, "player");
    expect(snap.manchePodium?.title).toBe("Fin de la manche 1");
    expect(snap.manchePodium?.subtitle).toContain("1 question");
    expect(store.maybeFinishNextQuestionCountdown(party, pack, Date.now() + 60_000)).toBe(false);
    expect(party.mancheResultOpen).toBe(true);

    store.adminDismissWinnerScreen(party);
    expect(party.mancheResultOpen).toBe(false);
    expect(party.state).toBe("round_active");
  });

  it("does not open between two questions of the same manche", () => {
    const { party } = play(2);
    expect(party.mancheResultOpen).toBe(false);
    expect(party.nextQuestionCountdownStartedAt).not.toBeNull();
    expect(party.state).toBe("round_active");
  });

  it("closes when the host pauses or launches another manche", () => {
    const paused = play(1);
    paused.store.adminPauseToLobby(paused.party);
    expect(paused.party.mancheResultOpen).toBe(false);
    expect(paused.party.state).toBe("lobby");

    const launched = play(1);
    const pack = launched.pack;
    const packs = new Map<string, QuizPack>([[pack.basename, pack]]);
    launched.store.hostAppendManche(launched.party, {
      kind: "pack_quiz",
      title: "Encore",
      packBasename: pack.basename,
      iframeUrl: null,
      youtubeEmbedUrl: null,
      directVideoUrl: null,
      savedRoundIndex: 0,
      savedQuestionIndex: 0,
      transitionKind: null,
      transitionDurationMs: null,
    });
    const nextId = launched.party.mancheScript.find((row) => row.title === "Encore")?.id;
    expect(nextId).toBeTypeOf("string");
    launched.store.hostLaunchManche(launched.party, nextId ?? "", "normal", true, packs);
    expect(launched.party.mancheResultOpen).toBe(false);
    expect(launched.party.state).toBe("round_active");
  });
});
