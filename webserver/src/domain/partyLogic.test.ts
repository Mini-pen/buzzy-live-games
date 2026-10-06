import { describe, expect, it } from "vitest";

import {
  evaluateJoin,
  normalizeTeamChoice,
  publicSnapshotForParty,
  teamScoresFromPlayers,
} from "./partyLogic.js";
import type { Player } from "./types.js";

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

  it("allows join when maxPlayers is null", () => {
    expect(
      evaluateJoin({
        closedAfterStart: false,
        hasStartedRound: false,
        maxPlayers: null,
        playerCount: 999,
      }).ok,
    ).toBe(true);
  });
});

describe("normalizeTeamChoice", () => {
  it("disables teams when maxTeams absent", () => {
    expect(normalizeTeamChoice(null, null)).toEqual({ ok: true, teamId: null });
  });

  it("requires team when enabled", () => {
    expect(normalizeTeamChoice(undefined, 3).ok).toBe(false);
  });

  it("rejects non-integer teamId when teams disabled", () => {
    const r = normalizeTeamChoice("invalid", null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_TEAM");
  });

  it("rejects team id when teams are disabled", () => {
    const r = normalizeTeamChoice(2, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TEAMS_DISABLED");
  });

  it("requires team when teams are enabled", () => {
    const r = normalizeTeamChoice(null, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TEAM_REQUIRED");
  });

  it("rejects out of range team id", () => {
    const r = normalizeTeamChoice(5, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TEAM_OUT_OF_RANGE");
  });

  it("rejects zero team id", () => {
    const r = normalizeTeamChoice(0, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TEAM_OUT_OF_RANGE");
  });

  it("accepts valid team id when teams enabled", () => {
    const r = normalizeTeamChoice(2, 3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.teamId).toBe(2);
  });
});

describe("teamScoresFromPlayers", () => {
  it("returns empty object when no teams", () => {
    const players: Player[] = [
      {
        id: "p1",
        displayName: "Alice",
        avatarKey: "base/1.png",
        buzzSoundKey: "bz1",
        teamId: null,
        score: 10,
        joinedAt: 0,
      },
    ];
    expect(teamScoresFromPlayers(players, null)).toEqual({});
  });

  it("returns empty object when maxTeams is 1", () => {
    const players: Player[] = [
      {
        id: "p1",
        displayName: "Alice",
        avatarKey: "base/1.png",
        buzzSoundKey: "bz1",
        teamId: 1,
        score: 10,
        joinedAt: 0,
      },
    ];
    expect(teamScoresFromPlayers(players, 1)).toEqual({});
  });

  it("computes per-team totals", () => {
    const players: Player[] = [
      {
        id: "p1",
        displayName: "Alice",
        avatarKey: "base/1.png",
        buzzSoundKey: "bz1",
        teamId: 1,
        score: 10,
        joinedAt: 0,
      },
      {
        id: "p2",
        displayName: "Bob",
        avatarKey: "base/2.png",
        buzzSoundKey: "bz2",
        teamId: 2,
        score: 5,
        joinedAt: 0,
      },
      {
        id: "p3",
        displayName: "Charlie",
        avatarKey: "base/3.png",
        buzzSoundKey: "bz3",
        teamId: 1,
        score: 3,
        joinedAt: 0,
      },
    ];
    expect(teamScoresFromPlayers(players, 2)).toEqual({ "1": 13, "2": 5 });
  });

  it("ignores players with null teamId", () => {
    const players: Player[] = [
      {
        id: "p1",
        displayName: "Alice",
        avatarKey: "base/1.png",
        buzzSoundKey: "bz1",
        teamId: 1,
        score: 10,
        joinedAt: 0,
      },
      {
        id: "p2",
        displayName: "Bob",
        avatarKey: "base/2.png",
        buzzSoundKey: "bz2",
        teamId: null,
        score: 100,
        joinedAt: 0,
      },
    ];
    expect(teamScoresFromPlayers(players, 2)).toEqual({ "1": 10, "2": 0 });
  });
});

describe("publicSnapshotForParty", () => {
  it("sorts players by displayName with French locale", () => {
    const players = new Map([
      [
        "p1",
        {
          id: "p1",
          displayName: "Zoé",
          avatarKey: "base/1.png",
          buzzSoundKey: "bz1",
          teamId: null,
          score: 0,
          joinedAt: 0,
        },
      ],
      [
        "p2",
        {
          id: "p2",
          displayName: "Alice",
          avatarKey: "base/2.png",
          buzzSoundKey: "bz2",
          teamId: null,
          score: 0,
          joinedAt: 0,
        },
      ],
      [
        "p3",
        {
          id: "p3",
          displayName: "Étienne",
          avatarKey: "base/3.png",
          buzzSoundKey: "bz3",
          teamId: null,
          score: 0,
          joinedAt: 0,
        },
      ],
    ]);

    const snap = publicSnapshotForParty({
      id: "party-1",
      joinCode: "ABCD",
      adminToken: "test",
      createdAt: 0,
      updatedAt: 1,
      state: "lobby",
      hasStartedRound: false,
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
      players,
      buzzOrder: [],
      buzzQuizGuess: new Map(),
      buzzWindowOpen: false,
      autoOpenBuzzOnCueAdvance: false,
      autoAdvanceQuizWhenAllBuzzed: false,
      chat: [],
      currentRoundIndex: null,
      currentQuestionIndex: null,
      loadedPackId: null,
      videoReplaySerial: 0,
      mancheScript: [],
      activeMancheId: null,
      allowPlayerAudioControl: false,
      buzzSound: {
        allowedGoodKeys: [],
        allowedBadKeys: [],
        buzzSoundMode: "players",
        playVerdictSounds: true,
      },
      autoPlay: {
        enabled: false,
        paused: false,
        currentScriptIndex: 0,
        currentItemStartedAt: null,
        waitingForManualAction: false,
        scheduledAdvanceAt: null,
        pendingScriptUpdates: null,
      },
      seenGameKinds: new Set(),
      countdownDurationSec: 5,
      winnerScreenMode: "question",
      readyPlayers: new Set(),
      readyPhaseStartedAt: null,
      countdownStartedAt: null,
      winnerDisplay: null,
      buzzGraceWindowMs: 500,
      clockSync: new Map(),
      pendingBuzzQueue: [],
      buzzWindowFirstBuzzAt: null,
      buzzWindowOpenedAt: null,
    });

    expect(snap.players.map((p) => p.displayName)).toEqual(["Alice", "Étienne", "Zoé"]);
  });

  it("truncates chat to last 50 entries", () => {
    const chat = Array.from({ length: 100 }, (_, i) => ({
      id: `msg-${i}`,
      playerId: "p1",
      displayName: "Alice",
      text: `Message ${i}`,
      at: i,
    }));

    const snap = publicSnapshotForParty({
      id: "party-1",
      joinCode: "ABCD",
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
      chat,
      currentRoundIndex: null,
      currentQuestionIndex: null,
      mancheScript: [],
      activeMancheId: null,
      allowPlayerAudioControl: false,
      buzzSound: {
        allowedGoodKeys: [],
        allowedBadKeys: [],
        playPlayerBuzzTone: true,
        echoPlayerBuzzOnHost: false,
      },
      autoPlay: {
        enabled: false,
        paused: false,
        currentScriptIndex: 0,
        currentItemStartedAt: null,
        waitingForManualAction: false,
        scheduledAdvanceAt: null,
        pendingScriptUpdates: null,
      },
    });

    expect(snap.chatTail).toHaveLength(50);
    expect(snap.chatTail[0]?.text).toBe("Message 50");
    expect(snap.chatTail[49]?.text).toBe("Message 99");
  });

  it("includes team scores when teams enabled", () => {
    const players = new Map([
      [
        "p1",
        {
          id: "p1",
          displayName: "Alice",
          avatarKey: "base/1.png",
          buzzSoundKey: "bz1",
          teamId: 1,
          score: 10,
          joinedAt: 0,
        },
      ],
      [
        "p2",
        {
          id: "p2",
          displayName: "Bob",
          avatarKey: "base/2.png",
          buzzSoundKey: "bz2",
          teamId: 2,
          score: 5,
          joinedAt: 0,
        },
      ],
    ]);

    const snap = publicSnapshotForParty({
      id: "party-1",
      joinCode: "ABCD",
      createdAt: 0,
      updatedAt: 1,
      state: "lobby",
      hasStartedRound: false,
      maxPlayers: null,
      maxTeams: 2,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
      players,
      buzzOrder: [],
      buzzWindowOpen: false,
      chat: [],
      currentRoundIndex: null,
      currentQuestionIndex: null,
      mancheScript: [],
      activeMancheId: null,
      allowPlayerAudioControl: false,
      buzzSound: {
        allowedGoodKeys: [],
        allowedBadKeys: [],
        buzzSoundMode: "players",
        playVerdictSounds: true,
      },
      buzzQuizGuess: new Map(),
      videoReplaySerial: 0,
      adminToken: "test",
      seenGameKinds: new Set(),
      countdownDurationSec: 5,
      winnerScreenMode: "question",
      readyPlayers: new Set(),
      readyPhaseStartedAt: null,
      countdownStartedAt: null,
      winnerDisplay: null,
      buzzGraceWindowMs: 500,
      clockSync: new Map(),
      pendingBuzzQueue: [],
      buzzWindowFirstBuzzAt: null,
      buzzWindowOpenedAt: null,
      loadedPackId: null,
      autoOpenBuzzOnCueAdvance: false,
      autoAdvanceQuizWhenAllBuzzed: false,
      autoPlay: {
        enabled: false,
        paused: false,
        currentScriptIndex: 0,
        currentItemStartedAt: null,
        waitingForManualAction: false,
        scheduledAdvanceAt: null,
        pendingScriptUpdates: null,
      },
    });

    expect(snap.teamScores).toEqual({ "1": 10, "2": 5 });
  });

  it("exposes sound buzzer public flags", () => {
    const snap = publicSnapshotForParty({
      id: "party-1",
      joinCode: "ABCD",
      adminToken: "test",
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
      autoAdvanceQuizWhenAllBuzzed: false,
      chat: [],
      currentRoundIndex: null,
      currentQuestionIndex: null,
      loadedPackId: null,
      videoReplaySerial: 0,
      mancheScript: [],
      activeMancheId: null,
      allowPlayerAudioControl: false,
      buzzSound: {
        allowedGoodKeys: [],
        allowedBadKeys: [],
        buzzSoundMode: "both",
        playVerdictSounds: true,
      },
      autoPlay: {
        enabled: false,
        paused: false,
        currentScriptIndex: 0,
        currentItemStartedAt: null,
        waitingForManualAction: false,
        scheduledAdvanceAt: null,
        pendingScriptUpdates: null,
      },
      seenGameKinds: new Set(),
      countdownDurationSec: 5,
      winnerScreenMode: "question",
      readyPlayers: new Set(),
      readyPhaseStartedAt: null,
      countdownStartedAt: null,
      winnerDisplay: null,
      buzzGraceWindowMs: 500,
      clockSync: new Map(),
      pendingBuzzQueue: [],
      buzzWindowFirstBuzzAt: null,
      buzzWindowOpenedAt: null,
    });

    expect(snap.soundBuzzerPublic.playOnPlayerDevice).toBe(true);
    expect(snap.soundBuzzerPublic.echoOnHostDevice).toBe(true);
    expect(snap.soundBuzzerPublic.buzzSoundMode).toBe("both");
  });
});
