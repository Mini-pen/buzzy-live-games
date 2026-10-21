/**
 * * End-of-manche result (CA-73). The footer ranking stays in broadcastDisplay.
 *   Two open readings are each one option below.
 */

export type TieRankMode = "dense" | "skip";

// INCERTAIN: Design UI, 2026-10-21, égalités en 1, 1, 2, 3 (autre lecture 1, 1, 3), à confirmer par Minipen
export const PODIUM_TIE_RANK_MODE: TieRankMode = "dense";

export type DisconnectedStanding = "keep" | "drop";

// INCERTAIN: Coding Agent, 2026-10-21, un joueur déconnecté pendant la manche garde ses points et sa place, à confirmer par Minipen
export const PODIUM_DISCONNECTED_STANDING: DisconnectedStanding = "keep";

const PODIUM_STEP_LIMIT = 3;
const SIDE_ROW_LIMIT = 5;

export interface PodiumInputPlayer {
  id: string;
  displayName: string;
  score: number;
  teamId: number | null;
  /** * Absent means the player is still in the manche. Only `false` can drop them. */
  connected?: boolean;
}

export interface PodiumRow {
  id: string;
  rank: number;
  rankLabel: string;
  name: string;
  initial: string;
  score: number;
  scoreLabel: string;
  scoreShort: string;
  teamLabel: string | null;
  playerIds: string[];
  memberCount: number | null;
  bestPlayerName: string | null;
  contributions: Array<{ playerId: string; score: number }>;
}

export interface PodiumStep {
  rank: number;
  rankLabel: string;
  tied: boolean;
  members: PodiumRow[];
}

export interface ManchePodium {
  mancheNumber: number;
  questionCount: number;
  participantCount: number;
  kind: "players" | "teams";
  title: string;
  subtitle: string;
  /** * Visual order: 2nd, 1st, 3rd when three steps exist. */
  steps: PodiumStep[];
  side: PodiumRow[];
  othersLabel: string | null;
  /** * Every standing row, best rank first. The phone card reads this list. */
  ranked: PodiumRow[];
}

export interface PodiumPhoneFocus {
  placeLabel: string;
  neighbors: Array<{ rankLabel: string; name: string; scoreShort: string; you: boolean }>;
  teamLine: string | null;
  contributionLine: string | null;
  bestPlayerLine: string | null;
}

/**
 * * Ranks for scores already sorted descending.
 *   `dense` is 1, 1, 2, 3. `skip` is 1, 1, 3, 4. The default is `PODIUM_TIE_RANK_MODE`.
 */
export function ranksForDescendingScores(
  scoresDesc: readonly number[],
  mode: TieRankMode = PODIUM_TIE_RANK_MODE,
): number[] {
  const ranks: number[] = [];
  let lastScore: number | null = null;
  let lastRank = 0;
  scoresDesc.forEach((score, index) => {
    if (lastScore !== null && score === lastScore) {
      ranks.push(lastRank);
      return;
    }
    lastRank = mode === "dense" ? lastRank + 1 : index + 1;
    lastScore = score;
    ranks.push(lastRank);
  });
  return ranks;
}

/** * Whether this player is still ranked. `keep` ignores `connected`. */
export function playerStaysOnPodium(
  connected: boolean | undefined,
  policy: DisconnectedStanding = PODIUM_DISCONNECTED_STANDING,
): boolean {
  if (policy === "keep") return true;
  return connected !== false;
}

export function podiumPlaceLabel(rank: number, kind: "players" | "teams"): string {
  if (rank === 1) return kind === "teams" ? "1re" : "1er";
  return `${rank}e`;
}

export function podiumPointsLabel(score: number, surface: "step" | "row"): string {
  const n = Number.isFinite(score) ? score : 0;
  const shown = Number.isInteger(n) ? String(n) : String(n);
  const one = Math.abs(n) === 1;
  if (surface === "row") return `${shown} ${one ? "pt" : "pts"}`;
  return `${shown} ${one ? "point" : "points"}`;
}

function firstGrapheme(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") return "?";
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter !== undefined) {
    const segment = new Segmenter("fr", { granularity: "grapheme" }).segment(trimmed)[Symbol.iterator]().next()
      .value?.segment;
    if (typeof segment === "string" && segment !== "") return segment.toLocaleUpperCase("fr");
  }
  const first = Array.from(trimmed)[0];
  return first === undefined ? "?" : first.toLocaleUpperCase("fr");
}

function byScoreThenName(
  a: { score: number; displayName: string; id: string },
  b: { score: number; displayName: string; id: string },
): number {
  if (a.score !== b.score) return b.score - a.score;
  const name = a.displayName.localeCompare(b.displayName, "fr");
  if (name !== 0) return name;
  return a.id.localeCompare(b.id, "fr");
}

function teamName(teamId: number): string {
  return `Équipe ${teamId}`;
}

/**
 * * Steps for ranks that have someone on them.
 *   A missing rank (the 1, 1, 3 reading) does not leave an empty step.
 */
function stepsFromRows(rows: readonly PodiumRow[]): PodiumStep[] {
  // INCERTAIN: Design UI, 2026-10-21, les marches vides ne sont pas affichées, à confirmer par Minipen
  const byRank = new Map<number, PodiumRow[]>();
  for (const row of rows) {
    const list = byRank.get(row.rank) ?? [];
    list.push(row);
    byRank.set(row.rank, list);
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b).slice(0, PODIUM_STEP_LIMIT);
  return ranks.map((rank) => {
    const members = byRank.get(rank) ?? [];
    return {
      rank,
      rankLabel: members[0]?.rankLabel ?? podiumPlaceLabel(rank, "players"),
      tied: members.length > 1,
      members,
    };
  });
}

function visualSteps(steps: readonly PodiumStep[]): PodiumStep[] {
  if (steps.length >= 3) return [steps[1]!, steps[0]!, steps[2]!];
  if (steps.length === 2) return [steps[1]!, steps[0]!];
  return [...steps];
}

function othersText(count: number, kind: "players" | "teams"): string | null {
  if (count <= 0) return null;
  if (kind === "teams") return count === 1 ? "+ 1 autre équipe" : `+ ${count} autres équipes`;
  return count === 1 ? "+ 1 autre joueur" : `+ ${count} autres joueurs`;
}

function subtitle(questionCount: number, participantCount: number, kind: "players" | "teams"): string {
  const questions = questionCount === 1 ? "1 question" : `${questionCount} questions`;
  const people =
    kind === "teams"
      ? participantCount === 1
        ? "1 équipe"
        : `${participantCount} équipes`
      : participantCount === 1
        ? "1 joueur"
        : `${participantCount} joueurs`;
  return `${questions} · ${people}`;
}

function rowFromPlayer(
  player: PodiumInputPlayer,
  rank: number,
  kind: "players" | "teams",
): PodiumRow {
  return {
    id: player.id,
    rank,
    rankLabel: podiumPlaceLabel(rank, kind),
    name: player.displayName,
    initial: firstGrapheme(player.displayName),
    score: player.score,
    scoreLabel: podiumPointsLabel(player.score, "step"),
    scoreShort: podiumPointsLabel(player.score, "row"),
    teamLabel: player.teamId === null ? null : teamName(player.teamId),
    playerIds: [player.id],
    memberCount: null,
    bestPlayerName: null,
    contributions: [{ playerId: player.id, score: player.score }],
  };
}

export function buildManchePodium(input: {
  players: readonly PodiumInputPlayer[];
  maxTeams: number | null;
  mancheNumber: number;
  questionCount: number;
  tieRankMode?: TieRankMode;
  disconnected?: DisconnectedStanding;
}): ManchePodium {
  const mode = input.tieRankMode ?? PODIUM_TIE_RANK_MODE;
  const policy = input.disconnected ?? PODIUM_DISCONNECTED_STANDING;
  const standing = input.players.filter((player) => playerStaysOnPodium(player.connected, policy));
  const kind: "players" | "teams" = input.maxTeams !== null && input.maxTeams >= 2 ? "teams" : "players";
  const ranked = kind === "teams" ? teamRows(standing, mode) : playerRows(standing, mode);
  const rankOrder = stepsFromRows(ranked);
  const podiumRanks = new Set(rankOrder.map((step) => step.rank));
  const after = ranked.filter((row) => !podiumRanks.has(row.rank));
  const side = after.slice(0, SIDE_ROW_LIMIT);
  const hidden = after.length - side.length;
  const mancheNumber = Number.isInteger(input.mancheNumber) && input.mancheNumber > 0 ? input.mancheNumber : 1;
  return {
    mancheNumber,
    questionCount: Math.max(0, input.questionCount),
    participantCount: ranked.length,
    kind,
    title: `Fin de la manche ${mancheNumber}`,
    subtitle: subtitle(Math.max(0, input.questionCount), ranked.length, kind),
    steps: visualSteps(rankOrder),
    side,
    othersLabel: othersText(hidden, kind),
    ranked,
  };
}

function playerRows(players: readonly PodiumInputPlayer[], mode: TieRankMode): PodiumRow[] {
  const sorted = [...players].sort(byScoreThenName);
  const ranks = ranksForDescendingScores(
    sorted.map((player) => player.score),
    mode,
  );
  return sorted.map((player, index) => rowFromPlayer(player, ranks[index] ?? index + 1, "players"));
}

function teamRows(players: readonly PodiumInputPlayer[], mode: TieRankMode): PodiumRow[] {
  // INCERTAIN: Design UI, 2026-10-21, en mode équipes le téléphone ajoute « Votre apport » et le meilleur joueur, à confirmer par Minipen
  const ids = [...new Set(players.map((player) => player.teamId).filter((id): id is number => id !== null))].sort(
    (a, b) => a - b,
  );
  const groups = ids.map((teamId) => {
    const members = players.filter((player) => player.teamId === teamId).sort(byScoreThenName);
    const score = members.reduce((sum, player) => sum + player.score, 0);
    const best = members[0];
    return { teamId, members, score, best };
  });
  groups.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.teamId - b.teamId;
  });
  const ranks = ranksForDescendingScores(
    groups.map((group) => group.score),
    mode,
  );
  return groups.map((group, index) => {
    const rank = ranks[index] ?? index + 1;
    const best = group.best;
    return {
      id: `team-${group.teamId}`,
      rank,
      rankLabel: podiumPlaceLabel(rank, "teams"),
      name: teamName(group.teamId),
      initial: String(group.teamId),
      score: group.score,
      scoreLabel: podiumPointsLabel(group.score, "step"),
      scoreShort: podiumPointsLabel(group.score, "row"),
      teamLabel: null,
      playerIds: group.members.map((player) => player.id),
      memberCount: group.members.length,
      bestPlayerName: best === undefined ? null : best.displayName,
      contributions: group.members.map((player) => ({ playerId: player.id, score: player.score })),
    };
  });
}

/** * Yellow card on the phone. Null when this player is not in the standing. */
export function podiumPhoneFocus(podium: ManchePodium, playerId: string): PodiumPhoneFocus | null {
  const index = podium.ranked.findIndex((row) => row.playerIds.includes(playerId) || row.id === playerId);
  if (index < 0) return null;
  const row = podium.ranked[index];
  if (row === undefined) return null;
  const onStep = podium.steps.some((step) => step.rank === row.rank);
  const neighbors = onStep
    ? []
    : [podium.ranked[index - 1], row, podium.ranked[index + 1]]
        .filter((item): item is PodiumRow => item !== undefined)
        .map((item) => ({
          rankLabel: item.rankLabel,
          name: item.id === row.id || item.playerIds.includes(playerId) ? "Vous" : item.name,
          scoreShort: item.scoreShort,
          you: item.playerIds.includes(playerId) || item.id === row.id,
        }));
  const contribution = row.contributions.find((item) => item.playerId === playerId);
  const teamLine = podium.kind === "teams" ? `Votre équipe : ${row.name}` : null;
  const contributionLine =
    podium.kind === "teams" && contribution !== undefined
      ? `Votre apport : ${podiumPointsLabel(contribution.score, "step")}`
      : null;
  const bestPlayerLine =
    podium.kind === "teams" && row.bestPlayerName !== null ? `Meilleur joueur : ${row.bestPlayerName}` : null;
  return {
    placeLabel: `${row.rankLabel} sur ${podium.participantCount}`,
    neighbors,
    teamLine,
    contributionLine,
    bestPlayerLine,
  };
}
