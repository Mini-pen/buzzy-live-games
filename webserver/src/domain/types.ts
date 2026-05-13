/** * Lifecycle of a party from the server's perspective. */
export type PartyState = "lobby" | "round_active" | "between_rounds" | "ended";

export interface ChatEntry {
  id: string;
  playerId: string;
  /** * Display snapshot at send time — avoids lookups if player leaves. */
  displayName: string;
  text: string;
  at: number;
}

export interface Player {
  id: string;
  displayName: string;
  /** * 1-based team index when teams are enabled; otherwise null. */
  teamId: number | null;
  score: number;
  joinedAt: number;
}

export interface Party {
  id: string;
  joinCode: string;
  /** * Opaque Bearer token for the host UI (never share in QR/player links). */
  adminToken: string;
  createdAt: number;
  updatedAt: number;
  state: PartyState;
  /** * Once true, joins are forbidden if `closedAfterStart` holds. */
  hasStartedRound: boolean;
  maxPlayers: number | null;
  maxTeams: number | null;
  closedAfterStart: boolean;
  allowRename: boolean;
  allowTeamChange: boolean;
  players: Map<string, Player>;
  /** * Player IDs in buzz order during an active buzz window. */
  buzzOrder: string[];
  buzzWindowOpen: boolean;
  chat: ChatEntry[];
  currentRoundIndex: number | null;
  currentQuestionIndex: number | null;
  loadedPackId: string | null;
}

export interface PartyPublicSnapshot {
  id: string;
  joinCode: string;
  createdAt: number;
  updatedAt: number;
  state: PartyState;
  hasStartedRound: boolean;
  maxPlayers: number | null;
  maxTeams: number | null;
  closedAfterStart: boolean;
  allowRename: boolean;
  allowTeamChange: boolean;
  playerCount: number;
  buzzOrder: string[];
  buzzWindowOpen: boolean;
  players: Array<{
    id: string;
    displayName: string;
    teamId: number | null;
    score: number;
  }>;
  teamScores: Record<string, number>;
  chatTail: ChatEntry[];
  /** * Minimal sync — richer round payloads arrive later via sockets. */
  currentRoundIndex: number | null;
  currentQuestionIndex: number | null;
}

/** * Stored inside the player JWT. */
export interface JwtPlayerPayload {
  /** * Party UUID */
  pid: string;
  /** * Player UUID (JWT subject) */
  sub: string;
}

/** * Stored inside player JWT cookie alternative (Fastify JWT). */
export interface JwtPlayerPayload {
  /** * Party UUID */
  pid: string;
}
