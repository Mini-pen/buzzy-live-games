/** * Lifecycle of a party from the server's perspective. */
export type PartyState = "lobby" | "round_active" | "between_rounds" | "ended";

/** * Item in the host's ordered script (manches). */
export type MancheKind = "pack_quiz" | "iframe" | "youtube" | "direct_video";

export interface MancheCatalogItem {
  id: string;
  kind: MancheKind;
  title: string;
  /** * Basename keys `games/*.json` when `kind === pack_quiz`. */
  packBasename: string | null;
  iframeUrl: string | null;
  /** * Canonical iframe `src` (`youtube-nocookie.com/embed/{id}?…`). */
  youtubeEmbedUrl: string | null;
  directVideoUrl: string | null;
  /** * Saved quiz position inside the loaded pack while this item is active. */
  savedRoundIndex: number;
  savedQuestionIndex: number;
}

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
  /** * Basename under `/avatars/` (see `webserver/client/public/avatars`; built to `dist/client/avatars`). */
  avatarKey: string;
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
  /** * Increments when replaying embedded media or switching surfaces. */
  videoReplaySerial: number;
  /** * Host-defined ordered manches; index 0 is launched by « Play ». */
  mancheScript: MancheCatalogItem[];
  /** * Matches `mancheScript[0].id` while a manche is actively running. */
  activeMancheId: string | null;
}

/** * Buzzer-visible quiz surface (`kind: quiz`). */
export interface PartyGameBoardQuiz {
  kind: "quiz";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  questionIndexInRound: number;
  prompt: string;
  choices: string[];
  points: number;
  /** * Optional illustration; absolute URL or `/…` path served by this app (e.g. `/games/…`). */
  imageUrl?: string;
  /** * Present only when the snapshot is assembled for an authenticated host. */
  correctChoiceIndex?: number;
}

/** * Video segment surface from a quiz pack JSON round. */
export interface PartyGameBoardVideo {
  kind: "video";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  videoUrl: string;
  replaySerial: number;
}

/** * Host-provided iframe manche. */
export interface PartyGameBoardIframe {
  kind: "iframe";
  title: string;
  url: string;
  replaySerial: number;
}

/** * Host-provided YouTube embed manche. */
export interface PartyGameBoardYoutube {
  kind: "youtube";
  title: string;
  embedUrl: string;
  replaySerial: number;
}

export type PartyGameBoardSurface =
  | PartyGameBoardQuiz
  | PartyGameBoardVideo
  | PartyGameBoardIframe
  | PartyGameBoardYoutube;

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
    /** * Resolved path for `<img src>` (same-origin). */
    avatarUrl: string;
    teamId: number | null;
    score: number;
  }>;
  teamScores: Record<string, number>;
  chatTail: ChatEntry[];
  /** * Indices into loaded pack JSON when `gameBoard.kind === quiz|video` from pack. */
  currentRoundIndex: number | null;
  currentQuestionIndex: number | null;
  /** * Non-null during `round_active` when content resolves. */
  gameBoard: PartyGameBoardSurface | null;
  mancheScript: MancheCatalogItem[];
  activeMancheId: string | null;
}

/** * Stored inside the player JWT (`pid` mandatory; Fastify validates `sub` as player id). */
export interface JwtPlayerPayload {
  pid: string;
  sub?: string;
}
