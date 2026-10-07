import type { BroadcastViewMode } from "./types.js";

export type { BroadcastViewMode };

/** * Player row used to build projector standings and the phone score table. */
export interface ScorePlayer {
  id: string;
  displayName: string;
  avatarUrl: string;
  teamId: number | null;
  score: number;
}

/** * One ranked line on the projector (a team total or a player). */
export interface BroadcastStandingRow {
  key: string;
  label: string;
  score: number;
  rank: number;
  avatarUrl: string | null;
}

/** * Projector standings for the active view. */
export interface BroadcastStanding {
  view: BroadcastViewMode;
  rows: BroadcastStandingRow[];
  /** * Players with `teamId === null` in team view. Empty when nobody is unteamed, or in individual view. */
  unteamed: BroadcastStandingRow[];
}

/** * One group of the phone « Par équipe » table. */
export interface TeamScoreGroup<T> {
  teamId: number | null;
  title: string;
  players: T[];
}

interface ViewManche {
  id: string;
  broadcastViewMode?: BroadcastViewMode | null;
}

/** * Default grouping: teams when the party has them, otherwise one row per player. */
export function defaultBroadcastViewMode(maxTeams: number | null): BroadcastViewMode {
  return maxTeams !== null && maxTeams >= 2 ? "team" : "individual";
}

/**
 * * Active projector grouping.
 *   An active manche with a non-null `broadcastViewMode` wins over the global setting.
 *   Parties without teams are always individual.
 */
export function resolveBroadcastViewMode(input: {
  maxTeams: number | null;
  state: string;
  activeMancheId: string | null;
  broadcastViewModeGlobal: BroadcastViewMode;
  mancheScript: readonly ViewManche[];
}): BroadcastViewMode {
  if (input.maxTeams === null || input.maxTeams < 2) return "individual";
  if (input.state === "round_active" && input.activeMancheId !== null) {
    const manche = input.mancheScript.find((item) => item.id === input.activeMancheId);
    const override = manche?.broadcastViewMode;
    if (override === "team" || override === "individual") return override;
  }
  return input.broadcastViewModeGlobal === "team" ? "team" : "individual";
}

/** * French rank label used when numeric scores are hidden on the projector (`1er`, `2ème`, …). */
export function frenchOrdinal(rank: number): string {
  if (rank === 1) return "1er";
  return `${rank}ème`;
}

/**
 * * Competition rank of `score` among `scores` (1 + number of strictly higher scores).
 *   Tied scores share a rank; the next distinct score skips.
 */
export function competitionRankForScore(scores: readonly number[], score: number): number {
  let ahead = 0;
  for (const value of scores) {
    if (value > score) ahead += 1;
  }
  return ahead + 1;
}

/** * Assigns competition ranks to scores that are already sorted descending. */
export function competitionRanksForDescendingScores(scoresDesc: readonly number[]): number[] {
  const ranks: number[] = [];
  let lastScore: number | null = null;
  let lastRank = 0;
  scoresDesc.forEach((score, index) => {
    if (lastScore !== null && score === lastScore) {
      ranks.push(lastRank);
      return;
    }
    lastRank = index + 1;
    lastScore = score;
    ranks.push(lastRank);
  });
  return ranks;
}

/** * Phone table « Par score »: total ascending, then `displayName` in French locale. */
export function sortPlayersByTotalScoreAsc<T extends { displayName: string; score: number }>(
  players: readonly T[],
): T[] {
  return [...players].sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.displayName.localeCompare(b.displayName, "fr");
  });
}

/** * Phone table « Par équipe »: teams by `teamId` ascending, score ascending inside each team. */
export function groupPlayersByTeam<
  T extends { displayName: string; score: number; teamId: number | null },
>(players: readonly T[]): TeamScoreGroup<T>[] {
  const unteamed = players.filter((player) => player.teamId === null);
  const teamed = players.filter((player) => player.teamId !== null);
  const ids = [...new Set(teamed.map((player) => player.teamId as number))].sort((a, b) => a - b);
  const groups: TeamScoreGroup<T>[] = ids.map((id) => ({
    teamId: id,
    title: `Éq. ${id}`,
    players: sortPlayersByTotalScoreAsc(teamed.filter((player) => player.teamId === id)),
  }));
  if (unteamed.length > 0) {
    groups.push({
      teamId: null,
      title: "Sans équipe",
      players: sortPlayersByTotalScoreAsc(unteamed),
    });
  }
  return groups;
}

function playerRows(players: readonly ScorePlayer[]): BroadcastStandingRow[] {
  const sorted = [...players].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.displayName.localeCompare(b.displayName, "fr");
  });
  const ranks = competitionRanksForDescendingScores(sorted.map((player) => player.score));
  return sorted.map((player, index) => ({
    key: player.id,
    label: player.displayName,
    score: player.score,
    rank: ranks[index] ?? index + 1,
    avatarUrl: player.avatarUrl,
  }));
}

/** * Builds the projector footer / final standings for the resolved view. */
export function buildBroadcastStanding(args: {
  view: BroadcastViewMode;
  players: readonly ScorePlayer[];
  teamScores: Record<string, number>;
}): BroadcastStanding {
  if (args.view === "individual") {
    return { view: "individual", rows: playerRows(args.players), unteamed: [] };
  }
  const teams = Object.entries(args.teamScores).map(([id, score]) => ({
    id: Number(id),
    score,
  }));
  teams.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.id - b.id;
  });
  const ranks = competitionRanksForDescendingScores(teams.map((team) => team.score));
  const rows: BroadcastStandingRow[] = teams.map((team, index) => ({
    key: `team-${team.id}`,
    label: `Équipe ${team.id}`,
    score: team.score,
    rank: ranks[index] ?? index + 1,
    avatarUrl: null,
  }));
  const unteamed = playerRows(args.players.filter((player) => player.teamId === null));
  return { view: "team", rows, unteamed };
}

/**
 * * Gap shown next to the buzz-winner highlight.
 *   Hidden when highlight is off, when there is no second buzz, or when the gap is at least 1s.
 */
export function visibleBuzzGapMs(
  highlightBuzzWinner: boolean,
  gapMs: number | null | undefined,
): number | null {
  if (!highlightBuzzWinner) return null;
  if (typeof gapMs !== "number" || !Number.isFinite(gapMs)) return null;
  if (gapMs < 0 || gapMs >= 1000) return null;
  return gapMs;
}

/**
 * * Whether the admin should ask to switch the projector to team view.
 *   Fires once per transition from « no teams » to « teams enabled », and only while the global view is still individual.
 */
export function shouldPromptTeamViewSwitch(args: {
  previousMaxTeams: number | null | undefined;
  nextMaxTeams: number | null;
  broadcastViewModeGlobal: BroadcastViewMode;
  alreadyPrompted: boolean;
}): boolean {
  if (args.alreadyPrompted) return false;
  if (args.broadcastViewModeGlobal === "team") return false;
  if (args.previousMaxTeams === undefined) return false;
  const previousOff = args.previousMaxTeams === null || args.previousMaxTeams < 2;
  const nextOn = args.nextMaxTeams !== null && args.nextMaxTeams >= 2;
  return previousOff && nextOn;
}
