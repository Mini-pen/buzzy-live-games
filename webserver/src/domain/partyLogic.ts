import type { ChatEntry, PartyPublicSnapshot, Player } from "./types.js";

interface PartyMeta {
  closedAfterStart: boolean;
  hasStartedRound: boolean;
  maxPlayers: number | null;
  playerCount: number;
}

/** * Validates whether a player may newly join — pure for unit tests. */
export function evaluateJoin(meta: PartyMeta): { ok: true } | { ok: false; code: string } {
  if (meta.closedAfterStart && meta.hasStartedRound) {
    return { ok: false, code: "PARTY_CLOSED" };
  }
  if (meta.maxPlayers !== null && meta.playerCount >= meta.maxPlayers) {
    return { ok: false, code: "PARTY_FULL" };
  }
  return { ok: true };
}

/** * Validates team id when caps exist */
export function normalizeTeamChoice(
  teamId: unknown,
  maxTeams: number | null,
): { ok: true; teamId: number | null } | { ok: false; code: string } {
  if (maxTeams === null || maxTeams < 2) {
    if (teamId === undefined || teamId === null) return { ok: true, teamId: null };
    if (typeof teamId !== "number" || !Number.isInteger(teamId)) {
      return { ok: false, code: "INVALID_TEAM" };
    }
    return { ok: false, code: "TEAMS_DISABLED" };
  }

  if (teamId === undefined || teamId === null) {
    return { ok: false, code: "TEAM_REQUIRED" };
  }
  if (typeof teamId !== "number" || !Number.isInteger(teamId)) {
    return { ok: false, code: "INVALID_TEAM" };
  }
  if (teamId < 1 || teamId > maxTeams) {
    return { ok: false, code: "TEAM_OUT_OF_RANGE" };
  }
  return { ok: true, teamId };
}

/** * Computes per-team score totals for snapshots. */
export function teamScoresFromPlayers(
  players: Iterable<Player>,
  maxTeams: number | null,
): Record<string, number> {
  if (maxTeams === null || maxTeams < 2) return {};
  const acc: Record<string, number> = {};
  for (let t = 1; t <= maxTeams; t += 1) {
    acc[String(t)] = 0;
  }
  for (const p of players) {
    if (p.teamId === null) continue;
    const k = String(p.teamId);
    acc[k] = (acc[k] ?? 0) + p.score;
  }
  return acc;
}

export function publicSnapshotForParty(part: {
  id: string;
  joinCode: string;
  createdAt: number;
  updatedAt: number;
  state: PartyPublicSnapshot["state"];
  hasStartedRound: boolean;
  maxPlayers: number | null;
  maxTeams: number | null;
  closedAfterStart: boolean;
  allowRename: boolean;
  allowTeamChange: boolean;
  players: Map<string, Player>;
  buzzOrder: string[];
  buzzWindowOpen: boolean;
  chat: ChatEntry[];
  currentRoundIndex: number | null;
  currentQuestionIndex: number | null;
}): PartyPublicSnapshot {
  const playersArr = [...part.players.values()].map((p) => ({
    id: p.id,
    displayName: p.displayName,
    teamId: p.teamId,
    score: p.score,
  }));
  playersArr.sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
  const tailLen = 50;
  const chatTail =
    part.chat.length <= tailLen ? [...part.chat] : part.chat.slice(-tailLen);

  return {
    id: part.id,
    joinCode: part.joinCode,
    createdAt: part.createdAt,
    updatedAt: part.updatedAt,
    state: part.state,
    hasStartedRound: part.hasStartedRound,
    maxPlayers: part.maxPlayers,
    maxTeams: part.maxTeams,
    closedAfterStart: part.closedAfterStart,
    allowRename: part.allowRename,
    allowTeamChange: part.allowTeamChange,
    playerCount: part.players.size,
    buzzOrder: [...part.buzzOrder],
    buzzWindowOpen: part.buzzWindowOpen,
    players: playersArr,
    teamScores: teamScoresFromPlayers(part.players.values(), part.maxTeams),
    chatTail,
    currentRoundIndex: part.currentRoundIndex,
    currentQuestionIndex: part.currentQuestionIndex,
  };
}
