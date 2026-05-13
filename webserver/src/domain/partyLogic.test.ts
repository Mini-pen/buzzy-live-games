import { describe, expect, it } from "vitest";

import { evaluateJoin, normalizeTeamChoice } from "./partyLogic.js";

describe("evaluateJoin", () => {
  it("allows join when seats remain", () => {
    expect(
      evaluateJoin({
        closedAfterStart: true,
        hasStartedRound: false,
        maxPlayers: 2,
        playerCount: 1,
      }).ok,
    ).toBe(true);
  });

  it("blocks closed party", () => {
    const r = evaluateJoin({
      closedAfterStart: true,
      hasStartedRound: true,
      maxPlayers: 10,
      playerCount: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PARTY_CLOSED");
  });

  it("blocks full party", () => {
    const r = evaluateJoin({
      closedAfterStart: false,
      hasStartedRound: false,
      maxPlayers: 2,
      playerCount: 2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PARTY_FULL");
  });
});

describe("normalizeTeamChoice", () => {
  it("disables teams when maxTeams absent", () => {
    expect(normalizeTeamChoice(null, null)).toEqual({ ok: true, teamId: null });
  });

  it("requires team when enabled", () => {
    expect(normalizeTeamChoice(undefined, 3).ok).toBe(false);
  });
});
