/** * Lifecycle of a party from the server's perspective. */
export type PartyState = "lobby" | "round_active" | "between_rounds" | "ended";

/** * Big-screen grouping: team totals or one row per player. */
export type BroadcastViewMode = "team" | "individual";

/** * Item in the host's ordered script (manches). */
export type MancheKind = "pack_quiz" | "iframe" | "youtube" | "direct_video" | "transition";

export type TransitionKind = "pause" | "fade" | "countdown";

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
  /** * For transitions: type of transition (pause, fade, countdown, etc.). */
  transitionKind: TransitionKind | null;
  /** * For transitions: duration in milliseconds. */
  transitionDurationMs: number | null;
  /** * Launch mode for this manche: null (not yet launched), 'normal' (with intro), or 'autonomous' (skip intro + auto-chain). */
  launchMode: "normal" | "autonomous" | null;
  /**
   * * Big-screen grouping for this manche. `null` follows `Party.broadcastViewModeGlobal`.
   *   While the manche is active, a non-null value wins over the global setting.
   */
  broadcastViewMode: BroadcastViewMode | null;
}

/** * Automatic play mode state. */
export interface AutoPlayState {
  /** * Whether automatic play mode is currently enabled. */
  enabled: boolean;
  /** * Whether playback is currently paused. */
  paused: boolean;
  /** * Index of the current item in mancheScript being played. */
  currentScriptIndex: number;
  /** * Timestamp when the current item started playing (for progress tracking). */
  currentItemStartedAt: number | null;
  /** * Whether the mode is waiting for a manual host action (e.g., buzz validation). */
  waitingForManualAction: boolean;
  /** * Timestamp when the current item should automatically advance (null if paused or waiting). */
  scheduledAdvanceAt: number | null;
  /** * Pending script modifications to apply after the current item finishes. */
  pendingScriptUpdates: MancheCatalogItem[] | null;
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

/** * Buzz sound mode: where buzz sounds are played. */
export type BuzzSoundMode = "players" | "animation" | "both";

/** * Buzzer SFX routing for a party (good/bad palettes + playback toggles). */
export interface PartyBuzzSoundPolicy {
  allowedGoodKeys: string[];
  allowedBadKeys: string[];
  /** * Buzz sound mode: "players" (joueurs only), "animation" (animation only), "both" (joueurs + animation). */
  buzzSoundMode: BuzzSoundMode;
  /** * Master toggle for good/bad sounds when judging buzz answers. */
  playVerdictSounds: boolean;
}

/** * Clock sync state for a single player (NTP-like). */
export interface ClockSyncState {
  /** * Estimated clock offset (ms): serverTime - clientTime. */
  offsetMs: number;
  /** * Minimal RTT measured during the last sync burst (ms). */
  minRttMs: number;
  /** * Timestamp (server time) of the last successful sync. */
  lastSyncAt: number;
}

/** * Buzz entry during the grace window, before final decision. */
export interface PendingBuzz {
  playerId: string;
  /** * Client timestamp (monotonic, ms). */
  clientTimestamp: number;
  /** * Server timestamp when the buzz was received (ms). */
  arrivedAt: number;
  /** * Estimated server timestamp (corrected by offset, capped). */
  estimatedAt: number;
  /** * For quiz rounds: choice index. */
  quizChoiceIndex?: number;
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
  /**
   * * When true on quiz (QCM) rounds, as soon as every connected player has buzzed, the server scores each pick
   *   vs the correct key, then advances to the next question (same as host « suivant »).
   */
  autoAdvanceQuizWhenAllBuzzed: boolean;
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
  /** * Automatic play mode state. */
  autoPlay: AutoPlayState;
  /** * Game kinds (round types) already seen in this party; used to determine if tutorial should be shown. */
  seenGameKinds: Set<string>;
  /** * Pre-question countdown duration in seconds (3–10). */
  countdownDurationSec: number;
  /** * When to show winner screen: "question" or "round". */
  winnerScreenMode: "question" | "round";
  /** * Player IDs who marked themselves ready for the next question. */
  readyPlayers: Set<string>;
  /** * Timestamp (ms) when the ready phase started; null when not in ready phase. */
  readyPhaseStartedAt: number | null;
  /** * Timestamp (ms) when the countdown actually started; null when not in countdown. */
  countdownStartedAt: number | null;
  /** * Winner screen state: null when not showing, or { playerId, playerName, avatarKey, score }. */
  winnerDisplay: { playerId: string; playerName: string; avatarKey: string; score: number } | null;
  /** * Grace window duration (ms) after first buzz before final decision (0–1000 ms, default 500). */
  buzzGraceWindowMs: number;
  /** * Clock sync state per player (for latency compensation). */
  clockSync: Map<string, ClockSyncState>;
  /** * Pending buzz entries during grace window (cleared at decision or window close). */
  pendingBuzzQueue: PendingBuzz[];
  /** * Timestamp when the first buzz of the current window arrived (null when no pending decision). */
  buzzWindowFirstBuzzAt: number | null;
  /** * Timestamp when the buzz window opened (server time). */
  buzzWindowOpenedAt: number | null;
  /** * Time gap (ms) between 1st and 2nd buzz after finalization (< 1000 ms), for broadcast display. */
  lastBuzzGapMs: number | null;
  /** * Footer (buzz queue + standings) on the projector. */
  broadcastShowRanking: boolean;
  /** * Numeric scores on the projector (ranks only when false). Independent of `playerShowScores`. */
  broadcastShowScores: boolean;
  /** * Score block on player phones. Independent of `broadcastShowScores`. */
  playerShowScores: boolean;
  /** * Gold highlight of the decided buzz winner on the projector. Also gates the 1st/2nd time gap. */
  highlightBuzzWinner: boolean;
  /** * Default projector grouping when the active manche does not override it. */
  broadcastViewModeGlobal: BroadcastViewMode;
  /**
   * * Player id of the buzz winner after the §4.8 decision.
   *   Stays set while the buzzer is closed, until the next question or the buzzer reopens.
   */
  decidedBuzzWinnerId: string | null;
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

/** * Transition between rounds in automatic play mode. */
export interface PartyGameBoardTransition {
  kind: "transition";
  transitionKind: TransitionKind;
  title: string;
  durationMs: number;
  /** * Timestamp when this transition started (for progress calculation). */
  startedAt: number;
}

export type PartyGameBoardSurface =
  | PartyGameBoardQuiz
  | PartyGameBoardVideo
  | PartyGameBoardFreeBuzz
  | PartyGameBoardImageBuzz
  | PartyGameBoardProgressiveGuess
  | PartyGameBoardAudioBlind
  | PartyGameBoardIframe
  | PartyGameBoardYoutube
  | PartyGameBoardTransition;

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
    /** * Buzz sound mode visible to all: "players", "animation", or "both". */
    buzzSoundMode: BuzzSoundMode;
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
  /** * Authenticated host only : QCM — score + question suivante dès que chaque joueur a buzzé. */
  autoAdvanceQuizWhenAllBuzzed?: boolean;
  /** * Grace window duration (ms) after first buzz before final decision (0–1000 ms), host only. */
  buzzGraceWindowMs?: number;
  /** * Time gap in milliseconds between 1st and 2nd buzz (if both exist and gap < 1000 ms). Omitted when highlight is off. */
  buzzTimeGapMs?: number;
  /** * Projector footer visibility (buzz queue + standings). */
  broadcastShowRanking: boolean;
  /** * Numeric scores on projector surfaces. */
  broadcastShowScores: boolean;
  /** * Score block on player phones. */
  playerShowScores: boolean;
  /** * Highlight the decided buzz winner on the projector. */
  highlightBuzzWinner: boolean;
  /** * Party-wide projector grouping. */
  broadcastViewModeGlobal: BroadcastViewMode;
  /** * Decided buzz winner, null before the decision and after the next question or a buzzer reopen. */
  decidedBuzzWinnerId: string | null;
  /** * Automatic play mode state (visible to all). */
  autoPlay?: {
    enabled: boolean;
    paused: boolean;
    currentScriptIndex: number;
    waitingForManualAction: boolean;
  };
  /** * Pre-question countdown duration in seconds (3–10), host only. */
  countdownDurationSec?: number;
  /** * Winner screen mode: "question" or "round", host only. */
  winnerScreenMode?: "question" | "round";
  /** * IDs of players who marked ready for the next question. */
  readyPlayers?: string[];
  /** * Timestamp when ready phase started; null when not in ready phase. */
  readyPhaseStartedAt?: number | null;
  /** * Timestamp when countdown actually started; null when not in countdown. */
  countdownStartedAt?: number | null;
  /** * Winner screen state: null when not showing, or { playerId, playerName, avatarKey, score }. */
  winnerDisplay?: { playerId: string; playerName: string; avatarKey: string; score: number } | null;
}

/** * Stored inside the player JWT (`pid` mandatory; Fastify validates `sub` as player id). */
export interface JwtPlayerPayload {
  pid: string;
  sub?: string;
}
