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
  /** * Relative path under `/avatars/` (scan of repo `avatars/` e.g. `base/…`, `Cousinades_2026/…`). */
  avatarKey: string;
  /** * Key from `/games/sounds/catalog.json`; played on buzz (+ echo on animateur si activé). */
  buzzSoundKey: string;
  /** * 1-based team index when teams are enabled; otherwise null. */
  teamId: number | null;
  score: number;
  joinedAt: number;
}

/** * Buzzer SFX routing for a party (good/bad palettes + playback toggles). */
export interface PartyBuzzSoundPolicy {
  allowedGoodKeys: string[];
  allowedBadKeys: string[];
  playPlayerBuzzTone: boolean;
  echoPlayerBuzzOnHost: boolean;
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
  /**
   * * During an active quiz buzz window, persisted choice index (`0 … n-1`) for each queued buzzer —
   *   cleared alongside `buzzOrder`.
   */
  buzzQuizGuess: Map<string, number>;
  buzzWindowOpen: boolean;
  /**
   * * When true, advancing to the next playable cue (and starting a quiz-style pack manche) opens the buzzer
   *   automatically when the surface supports buzzing (skipped for vidéo seule, révélation progressive, etc.).
   */
  autoOpenBuzzOnCueAdvance: boolean;
  chat: ChatEntry[];
  currentRoundIndex: number | null;
  currentQuestionIndex: number | null;
  loadedPackId: string | null;
  /** * Increments when replaying embedded media or switching surfaces. */
  videoReplaySerial: number;
  /**
   * * During blind test rounds: lets players and broadcast use local `<audio controls>` ;
   *   false by default (sound expected from host room only).
   */
  allowPlayerAudioControl: boolean;
  buzzSound: PartyBuzzSoundPolicy;
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

/** * Video clip or self-hosted stream (pack `videoUrl` or admin `direct_video`). */
export interface PartyGameBoardVideo {
  kind: "video";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  videoUrl: string;
  replaySerial: number;
}

/** * Buzzer-only cue: no choices; host advances “questions” freely. */
export interface PartyGameBoardFreeBuzz {
  kind: "free_buzz";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  questionNumberHuman: number;
  plannedQuestionCount: number | null;
  prompt: string;
}

/** * One full-screen image per step; oral answer after buzz (no listed choices). */
export interface PartyGameBoardImageBuzz {
  kind: "image_buzz";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  slideIndexHuman: number;
  slideCount: number;
  imageUrl: string;
  /** * Host-guarded good-answer value for this slide (from pack JSON, default 1). */
  awardPoints: number;
  /** * Optional line from the pack; absent clients show generic oral instructions. */
  prompt?: string;
}

/** * Progressive clues (same mystery answer) then a reveal slide with poster + answer text. */
export interface PartyGameBoardProgressiveGuess {
  kind: "progressive_guess";
  phase: "clue" | "reveal";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  puzzleIndexHuman: number;
  puzzleCount: number;
  /** * Clue phase only : 1-based clue index among `clueCount`. */
  clueIndexHuman?: number;
  clueCount?: number;
  imageUrl?: string;
  awardPoints?: number;
  playerPrompt?: string;
  answer?: string;
  revealImageUrl?: string;
}

/** * Blind test: players hear `audioUrl`; reveal fields exist only for host snapshots. */
export interface PartyGameBoardAudioBlind {
  kind: "audio_blind";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  trackIndexHuman: number;
  trackCount: number;
  audioUrl: string;
  replaySerial: number;
  revealTitle?: string;
  revealArtist?: string;
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
  | PartyGameBoardFreeBuzz
  | PartyGameBoardImageBuzz
  | PartyGameBoardProgressiveGuess
  | PartyGameBoardAudioBlind
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
    /** * Catalog key for buzz SFX (`/games/sounds/catalog.json`). */
    buzzSoundKey: string;
  }>;
  teamScores: Record<string, number>;
  chatTail: ChatEntry[];
  /** * Indices into loaded pack JSON for pack-driven manches. */
  currentRoundIndex: number | null;
  currentQuestionIndex: number | null;
  /** * Non-null during `round_active` when content resolves. */
  gameBoard: PartyGameBoardSurface | null;
  mancheScript: MancheCatalogItem[];
  activeMancheId: string | null;
  /**
   * * When true during `audio_blind`, clients receive `audioUrl` and may use native audio controls ;
   *   animateur diffusion par défaut (false).
   */
  allowPlayerAudioControl: boolean;
  /** * Buzzer UX flags (voir réglages détaillés côté hôte uniquement dans le tableau animateur). */
  soundBuzzerPublic: {
    playOnPlayerDevice: boolean;
    echoOnHostDevice: boolean;
  };
  /** * Present only when the snapshot targets the authenticated animateur (`audience === "host"`). */
  soundBuzzerHostConfig?: {
    allowedGoodKeys: string[];
    allowedBadKeys: string[];
  };
  /** * Authenticated host only ; parallel to `buzzOrder` on quiz rounds — player pick vs correct key. */
  buzzQuizQueueDetail?: Array<{
    playerId: string;
    choiceIndex: number;
    letter: string;
    choiceLabel: string;
    correct: boolean;
  }>;
  /** * Authenticated host only : reopen buzz automatically after « question / extrait suivant » on compatible cues. */
  autoOpenBuzzOnCueAdvance?: boolean;
}

/** * Stored inside the player JWT (`pid` mandatory; Fastify validates `sub` as player id). */
export interface JwtPlayerPayload {
  pid: string;
  sub?: string;
}
