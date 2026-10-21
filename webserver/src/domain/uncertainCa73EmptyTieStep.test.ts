import { describe, expect, it } from "vitest";

import { buildManchePodium, ranksForDescendingScores, type PodiumInputPlayer } from "./manchePodium.js";

/**
 * * CHOIX INCERTAIN — CA-73, classement 1, 1, 3 (CDC, Design UI).
 *   Design UI veut la 2e marche vide. Le code ne crée pas de marche sans occupant
 *   (`manchePodium.ts`, `stepsFromRows`). Minipen n'a pas décidé.
 *
 *   Pour inverser ce fichier seul si Minipen retient la marche vide :
 *   passer `HIDE_EMPTY_SECOND_STEP` à `false`.
 *   Le test attendra alors une marche de rang 2 sans membre.
 */

const HIDE_EMPTY_SECOND_STEP = true;

function players(scores: number[]): PodiumInputPlayer[] {
  return scores.map((score, index) => ({
    id: `p${index}`,
    displayName: `J${index + 1}`,
    score,
    teamId: null,
  }));
}

describe("choix incertain CA-73", () => {
  it("choix incertain CA-73 : en classement 1, 1, 3 la 2e marche vide est masquée", () => {
    const scores = [12, 12, 7];
    expect(ranksForDescendingScores(scores, "skip")).toEqual([1, 1, 3]);
    const podium = buildManchePodium({
      players: players(scores),
      maxTeams: null,
      mancheNumber: 1,
      questionCount: 3,
      tieRankMode: "skip",
    });
    const second = podium.steps.find((step) => step.rank === 2);

    if (HIDE_EMPTY_SECOND_STEP) {
      expect(second).toBeUndefined();
      expect(podium.steps.every((step) => step.members.length > 0)).toBe(true);
      expect(podium.steps.map((step) => step.rank).sort((a, b) => a - b)).toEqual([1, 3]);
      return;
    }

    expect(second).toBeDefined();
    expect(second?.members).toEqual([]);
    expect(podium.steps.map((step) => step.rank).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});
