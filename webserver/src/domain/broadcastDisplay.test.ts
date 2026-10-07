import { describe, expect, it } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { PartyStore } from "./store.js";
import type { Party } from "./types.js";
import {
  buildBroadcastStanding,
  competitionRankForScore,
  defaultBroadcastViewMode,
  frenchOrdinal,
  groupPlayersByTeam,
  resolveBroadcastViewMode,
  shouldPromptTeamViewSwitch,
  sortPlayersByTotalScoreAsc,
  visibleBuzzGapMs,
} from "./broadcastDisplay.js";

const mockBuzzCatalog: LoadedBuzzSoundCatalog = {
  sounds: [
    { key: "bz1", label: "Buzz 1", file: "buzzers/1.mp3", pool: "neutral" },
    { key: "good1", label: "Good", file: "good/1.mp3", pool: "good" },
    { key: "bad1", label: "Bad", file: "bad/1.mp3", pool: "bad" },
  ],
  byKey: new Map([
    ["bz1", { key: "bz1", label: "Buzz 1", file: "buzzers/1.mp3", pool: "neutral" }],
    ["good1", { key: "good1", label: "Good", file: "good/1.mp3", pool: "good" }],
    ["bad1", { key: "bad1", label: "Bad", file: "bad/1.mp3", pool: "bad" }],
  ]),
  defaultBuzzerKey: "bz1",
};

function createStore(): PartyStore {
  return new PartyStore(() => {}, mockBuzzCatalog);
}

describe("broadcast display defaults and settings", () => {
  it("defaults both score toggles and highlight on, and picks the view from maxTeams", () => {
    const store = createStore();
    const solo = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    expect(defaultBroadcastViewMode(null)).toBe("individual");
    expect(solo.broadcastShowRanking).toBe(true);
    expect(solo.broadcastShowScores).toBe(true);
    expect(solo.playerShowScores).toBe(true);
    expect(solo.highlightBuzzWinner).toBe(true);
    expect(solo.broadcastViewModeGlobal).toBe("individual");
    expect(solo.decidedBuzzWinnerId).toBeNull();

    const teams = store.createParty({
      maxPlayers: null,
      maxTeams: 3,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    expect(teams.broadcastViewModeGlobal).toBe("team");
  });

  it("keeps projector scores and player scores independent, including while ranking is hidden", () => {
    const store = createStore();
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: 2,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    store.adminSetBroadcastDisplay(party, { broadcastShowScores: false });
    expect(party.playerShowScores).toBe(true);
    expect(party.broadcastShowScores).toBe(false);

    store.adminSetBroadcastDisplay(party, { playerShowScores: false });
    expect(party.broadcastShowScores).toBe(false);
    expect(party.playerShowScores).toBe(false);

    store.adminSetBroadcastDisplay(party, { broadcastShowRanking: false });
    expect(party.broadcastShowScores).toBe(false);
    store.adminSetBroadcastDisplay(party, { broadcastShowRanking: true });
    expect(party.broadcastShowScores).toBe(false);

    const snap = partySnapshotWithGame(party, new Map(), "host");
    expect(snap.broadcastShowRanking).toBe(true);
    expect(snap.broadcastShowScores).toBe(false);
    expect(snap.playerShowScores).toBe(false);
    expect(snap.highlightBuzzWinner).toBe(true);
    expect(snap.broadcastViewModeGlobal).toBe("team");
  });

  it("rejects team view when teams are disabled and does not overwrite a manche override", () => {
    const store = createStore();
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    expect(() =>
      store.adminSetBroadcastDisplay(party, { broadcastViewModeGlobal: "team" }),
    ).toThrowError(/équipe/u);
    try {
      store.adminSetBroadcastDisplay(party, { broadcastViewModeGlobal: "team" });
    } catch (err) {
      expect((err as { code?: string }).code).toBe("TEAMS_DISABLED");
    }

    const withTeams = store.createParty({
      maxPlayers: null,
      maxTeams: 2,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    store.hostAppendManche(withTeams, {
      kind: "pack_quiz",
      title: "Quiz",
      packBasename: "pack",
      iframeUrl: null,
      youtubeEmbedUrl: null,
      directVideoUrl: null,
      savedRoundIndex: 0,
      savedQuestionIndex: 0,
      transitionKind: null,
      transitionDurationMs: null,
    });
    const mancheId = withTeams.mancheScript[0]!.id;
    expect(withTeams.mancheScript[0]!.broadcastViewMode).toBeNull();
    store.adminSetMancheBroadcastView(withTeams, mancheId, "individual");
    store.adminSetBroadcastDisplay(withTeams, { broadcastViewModeGlobal: "team" });
    expect(withTeams.broadcastViewModeGlobal).toBe("team");
    expect(withTeams.mancheScript[0]!.broadcastViewMode).toBe("individual");

    const snap = partySnapshotWithGame(withTeams, new Map(), "player");
    expect(snap.mancheScript[0]!.broadcastViewMode).toBe("individual");
    expect(snap.playerShowScores).toBe(true);
    expect(snap.broadcastShowScores).toBe(true);
  });

  it("omits the buzz gap unless highlight is on, for host and player snapshots", () => {
    const store = createStore();
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    party.lastBuzzGapMs = 420;
    party.highlightBuzzWinner = false;
    expect(partySnapshotWithGame(party, new Map(), "player").buzzTimeGapMs).toBeUndefined();
    expect(partySnapshotWithGame(party, new Map(), "host").buzzTimeGapMs).toBeUndefined();
    party.highlightBuzzWinner = true;
    expect(partySnapshotWithGame(party, new Map(), "host").buzzTimeGapMs).toBe(420);
    expect(partySnapshotWithGame(party, new Map(), "player").buzzTimeGapMs).toBe(420);
    party.lastBuzzGapMs = 1000;
    expect(partySnapshotWithGame(party, new Map(), "player").buzzTimeGapMs).toBeUndefined();
  });
});

describe("buzz winner highlight lifetime", () => {
  function armedParty(): { store: PartyStore; party: Party; playerId: string } {
    const store = createStore();
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    const player = store.joinPlayer(party, "Alice", null, "base/1.png", "bz1");
    party.state = "round_active";
    return { store, party, playerId: player.id };
  }

  it("does not name a winner during the grace window, then keeps it after the buzzer closes", () => {
    const { store, party, playerId } = armedParty();
    party.buzzGraceWindowMs = 500;
    store.adminSetBuzzOpen(party, true);
    store.buzz(party, playerId, Date.now());
    expect(party.decidedBuzzWinnerId).toBeNull();
    expect(party.buzzOrder).toEqual([]);
    expect(partySnapshotWithGame(party, new Map(), "player").decidedBuzzWinnerId).toBeNull();

    store.finalizeBuzzDecision(party);
    expect(party.decidedBuzzWinnerId).toBe(playerId);
    expect(party.buzzOrder[0]).toBe(playerId);

    store.adminSetBuzzOpen(party, false);
    expect(party.buzzOrder).toEqual([]);
    expect(party.decidedBuzzWinnerId).toBe(playerId);

    store.adminSetBuzzOpen(party, true);
    expect(party.decidedBuzzWinnerId).toBeNull();
  });

  it("records the winner immediately when the grace window is 0", () => {
    const { store, party, playerId } = armedParty();
    party.buzzGraceWindowMs = 0;
    store.adminSetBuzzOpen(party, true);
    store.buzz(party, playerId, Date.now());
    expect(party.decidedBuzzWinnerId).toBe(playerId);
    expect(party.buzzOrder).toEqual([playerId]);
  });
});

describe("broadcast standing and player table order", () => {
  const players = [
    { id: "a", displayName: "Zoé", avatarUrl: "/a.png", teamId: 2, score: 8 },
    { id: "b", displayName: "alice", avatarUrl: "/b.png", teamId: 1, score: 8 },
    { id: "c", displayName: "Émile", avatarUrl: "/c.png", teamId: null, score: 3 },
    { id: "d", displayName: "Bob", avatarUrl: "/d.png", teamId: 1, score: 10 },
  ];

  it("shares a rank on ties (two 2ème) and lists unteamed players apart from team totals", () => {
    const standing = buildBroadcastStanding({
      view: "team",
      players,
      teamScores: { "1": 18, "2": 8 },
    });
    expect(standing.rows.map((row) => `${frenchOrdinal(row.rank)} ${row.label} ${row.score}`)).toEqual([
      "1er Équipe 1 18",
      "2ème Équipe 2 8",
    ]);
    expect(standing.unteamed.map((row) => row.label)).toEqual(["Émile"]);
    expect(standing.unteamed).toHaveLength(1);

    const tied = buildBroadcastStanding({
      view: "individual",
      players: [
        { id: "p1", displayName: "A", avatarUrl: "", teamId: null, score: 10 },
        { id: "p2", displayName: "B", avatarUrl: "", teamId: null, score: 8 },
        { id: "p3", displayName: "C", avatarUrl: "", teamId: null, score: 8 },
        { id: "p4", displayName: "D", avatarUrl: "", teamId: null, score: 3 },
      ],
      teamScores: {},
    });
    expect(tied.rows.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
    expect(tied.rows.filter((row) => row.rank === 2).map((row) => frenchOrdinal(row.rank))).toEqual([
      "2ème",
      "2ème",
    ]);
    expect(tied.unteamed).toEqual([]);
    expect(competitionRankForScore([10, 8, 8, 3], 8)).toBe(2);
    expect(competitionRankForScore([10, 8, 8, 3], 3)).toBe(4);
  });

  it("omits the unteamed section when every player has a team", () => {
    const standing = buildBroadcastStanding({
      view: "team",
      players: players.filter((player) => player.teamId !== null),
      teamScores: { "1": 18, "2": 8 },
    });
    expect(standing.unteamed).toEqual([]);
  });

  it("sorts the phone table by ascending score, then by team id", () => {
    expect(sortPlayersByTotalScoreAsc(players).map((player) => player.displayName)).toEqual([
      "Émile",
      "alice",
      "Zoé",
      "Bob",
    ]);
    const groups = groupPlayersByTeam(players);
    expect(groups.map((group) => group.title)).toEqual(["Éq. 1", "Éq. 2", "Sans équipe"]);
    expect(groups[0]!.players.map((player) => player.displayName)).toEqual(["alice", "Bob"]);
    expect(groups[2]!.players.map((player) => player.displayName)).toEqual(["Émile"]);
  });

  it("lets an active manche override the global view, and forces individual without teams", () => {
    expect(
      resolveBroadcastViewMode({
        maxTeams: 2,
        state: "round_active",
        activeMancheId: "m1",
        broadcastViewModeGlobal: "team",
        mancheScript: [{ id: "m1", broadcastViewMode: "individual" }],
      }),
    ).toBe("individual");
    expect(
      resolveBroadcastViewMode({
        maxTeams: 2,
        state: "between_rounds",
        activeMancheId: "m1",
        broadcastViewModeGlobal: "team",
        mancheScript: [{ id: "m1", broadcastViewMode: "individual" }],
      }),
    ).toBe("team");
    expect(
      resolveBroadcastViewMode({
        maxTeams: null,
        state: "round_active",
        activeMancheId: "m1",
        broadcastViewModeGlobal: "team",
        mancheScript: [{ id: "m1", broadcastViewMode: "team" }],
      }),
    ).toBe("individual");
  });
});

describe("team-view toast", () => {
  it("prompts only on the transition to teams while the global view is still individual", () => {
    expect(
      shouldPromptTeamViewSwitch({
        previousMaxTeams: null,
        nextMaxTeams: 2,
        broadcastViewModeGlobal: "individual",
        alreadyPrompted: false,
      }),
    ).toBe(true);
    expect(
      shouldPromptTeamViewSwitch({
        previousMaxTeams: null,
        nextMaxTeams: 2,
        broadcastViewModeGlobal: "team",
        alreadyPrompted: false,
      }),
    ).toBe(false);
    expect(
      shouldPromptTeamViewSwitch({
        previousMaxTeams: null,
        nextMaxTeams: 2,
        broadcastViewModeGlobal: "individual",
        alreadyPrompted: true,
      }),
    ).toBe(false);
    expect(
      shouldPromptTeamViewSwitch({
        previousMaxTeams: undefined,
        nextMaxTeams: 2,
        broadcastViewModeGlobal: "individual",
        alreadyPrompted: false,
      }),
    ).toBe(false);
    expect(
      shouldPromptTeamViewSwitch({
        previousMaxTeams: 2,
        nextMaxTeams: 2,
        broadcastViewModeGlobal: "individual",
        alreadyPrompted: false,
      }),
    ).toBe(false);
  });
});

describe("visible buzz gap", () => {
  it("shows a sub-second gap only when the winner highlight is on", () => {
    expect(visibleBuzzGapMs(true, 999)).toBe(999);
    expect(visibleBuzzGapMs(true, 0)).toBe(0);
    expect(visibleBuzzGapMs(true, 1000)).toBeNull();
    expect(visibleBuzzGapMs(true, null)).toBeNull();
    expect(visibleBuzzGapMs(false, 12)).toBeNull();
  });
});
