import { describe, expect, test } from "vitest";

import type { QuizPack } from "../games/pack.js";
import type { Party } from "./types.js";
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
    buzzWindowOpen: false,
    chat: [],
    currentRoundIndex: null,
    currentQuestionIndex: null,
    loadedPackId: null,
  };
  return { ...base, ...over };
}

describe("partySnapshotWithGame", () => {
  const packs = new Map([["example", demoPack]]);

  test("adds gameBoard for host only with correct index", () => {
    const party = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 0,
      loadedPackId: "demo-quiz-v1",
      hasStartedRound: true,
    });
    const hostSnap = partySnapshotWithGame(party, packs, "host");
    expect(hostSnap.gameBoard).not.toBeNull();
    expect(hostSnap.gameBoard?.correctChoiceIndex).toBe(1);
    const playSnap = partySnapshotWithGame(party, packs, "player");
    expect(playSnap.gameBoard?.correctChoiceIndex).toBeUndefined();
  });

  test("omits gameBoard when no pack is loaded", () => {
    const party = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 0,
      loadedPackId: null,
    });
    expect(partySnapshotWithGame(party, packs, "host").gameBoard).toBeNull();
  });
});
