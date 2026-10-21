import type { PackRound, QuizPack } from "../games/pack.js";
import {
  isAudioBlindRound,
  isFreeBuzzRound,
  isImageBuzzRound,
  isProgressiveGuessRound,
  isQuizRound,
  isVideoRound,
  progressiveGuessDecode,
} from "../games/pack.js";
import { withBasePath } from "../basePath.js";
import { canonicalYoutubeEmbedIframeSrc } from "./youtubeEmbed.js";
import { visibleBuzzGapMs } from "./broadcastDisplay.js";
import { buildManchePodium } from "./manchePodium.js";
import { publicSnapshotForParty } from "./partyLogic.js";
import {
  isQuestionRevealed,
  readyPhaseHidesQuestion,
  shouldWithholdNextQuestion,
} from "./questionReveal.js";
import type {
  Party,
  PartyGameBoardAudioBlind,
  PartyGameBoardQuiz,
  PartyGameBoardReadyHold,
  PartyGameBoardSurface,
  PartyPublicSnapshot,
} from "./types.js";

function deriveBuzzQuizQueueDetail(
  party: Party,
  board: PartyGameBoardSurface | null,
): PartyPublicSnapshot["buzzQuizQueueDetail"] {
  if (board === null || board.kind !== "quiz") return undefined;
  const ci = board.correctChoiceIndex;
  if (typeof ci !== "number" || ci < 0 || ci >= board.choices.length) return undefined;
  return party.buzzOrder.map((playerId) => {
    const rawIx = party.buzzQuizGuess.get(playerId);
    const choiceIndex =
      typeof rawIx === "number" &&
      rawIx >= 0 &&
      rawIx < board.choices.length
        ? rawIx
        : -1;
    const letter = choiceIndex >= 0 ? String.fromCharCode(65 + choiceIndex) : "?";
    const choiceLabel = choiceIndex >= 0 ? board.choices[choiceIndex]! : "—";
    const correct = choiceIndex === ci;
    return {
      playerId,
      choiceIndex,
      letter,
      choiceLabel,
      correct,
    };
  });
}

/** * Finds a scanned pack whose `QuizPack.id` matches `party.loadedPackId`. */
export function quizPackFromLoadedId(
  packs: Map<string, QuizPack>,
  loadedId: string | null,
): QuizPack | null {
  if (loadedId === null || loadedId === "") return null;
  for (const pack of packs.values()) {
    if (pack.id === loadedId) return pack;
  }
  return null;
}

/** * Editor lookup: the map key (disk basename or imported id), then `QuizPack.id`. */
export function findPackByKeyOrId(packs: Map<string, QuizPack>, key: string): QuizPack | null {
  if (key === "") return null;
  const direct = packs.get(key);
  if (direct !== undefined) return direct;
  return quizPackFromLoadedId(packs, key);
}

function questionCountForRound(round: PackRound | undefined): number {
  if (round === undefined) return 1;
  if (isQuizRound(round)) return Math.max(1, round.questions.length);
  if (isAudioBlindRound(round)) return Math.max(1, round.tracks.length);
  if (isImageBuzzRound(round)) return Math.max(1, round.slides.length);
  return 1;
}

function deriveGameBoard(
  party: Party,
  pack: QuizPack | null,
  audience: "player" | "host",
): PartyGameBoardSurface | null {
  if (party.activeMancheId === null) return null;
  const item = party.mancheScript.find((m) => m.id === party.activeMancheId);
  if (item === undefined) return null;

  if (item.kind === "transition") {
    if (item.transitionKind === null || item.transitionDurationMs === null) return null;
    return {
      kind: "transition",
      transitionKind: item.transitionKind,
      title: item.title,
      durationMs: item.transitionDurationMs,
      startedAt: party.autoPlay.currentItemStartedAt ?? Date.now(),
    };
  }

  if (party.state !== "round_active") return null;

  if (item.kind === "iframe") {
    if (typeof item.iframeUrl !== "string" || item.iframeUrl.trim() === "")
      return null;
    return {
      kind: "iframe",
      title: item.title,
      url: withBasePath(item.iframeUrl),
      replaySerial: party.videoReplaySerial,
    };
  }

  if (item.kind === "youtube") {
    if (
      typeof item.youtubeEmbedUrl !== "string" ||
      item.youtubeEmbedUrl.trim() === ""
    )
      return null;
    const embedUrl = canonicalYoutubeEmbedIframeSrc(item.youtubeEmbedUrl);
    if (embedUrl === null) return null;
    return {
      kind: "youtube",
      title: item.title,
      embedUrl,
      replaySerial: party.videoReplaySerial,
    };
  }

  if (item.kind === "direct_video") {
    if (
      typeof item.directVideoUrl !== "string" ||
      item.directVideoUrl.trim() === ""
    )
      return null;
    return {
      kind: "video",
      packTitle: item.title,
      roundIndex: 0,
      roundTitle: item.title,
      roundNumberHuman: 1,
      videoUrl: withBasePath(item.directVideoUrl),
      replaySerial: party.videoReplaySerial,
    };
  }

  if (pack === null) return null;

  if (readyPhaseHidesQuestion(party)) return deriveReadyHold(party, pack);

  const held = shouldWithholdNextQuestion(party) ? party.questionHold ?? null : null;
  const ri = held ? held.roundIndex : party.currentRoundIndex;
  const qi = held ? held.questionIndex : party.currentQuestionIndex;
  if (!isQuestionRevealed(party) && held == null) return null;
  if (
    ri === null ||
    qi === null ||
    ri < 0 ||
    qi < 0 ||
    ri >= pack.rounds.length
  )
    return null;

  const round = pack.rounds[ri];

  if (isVideoRound(round)) {
    return {
      kind: "video",
      packTitle: pack.title,
      roundIndex: ri,
      roundTitle: round.title,
      roundNumberHuman: ri + 1,
      videoUrl: withBasePath(round.videoUrl),
      replaySerial: party.videoReplaySerial,
    };
  }

  if (isFreeBuzzRound(round)) {
    const planned =
      round.plannedQuestionCount === undefined ? null : round.plannedQuestionCount;
    return {
      kind: "free_buzz",
      packTitle: pack.title,
      roundIndex: ri,
      roundTitle: round.title,
      roundNumberHuman: ri + 1,
      questionNumberHuman: qi + 1,
      plannedQuestionCount: planned,
      prompt: round.playerPrompt,
    };
  }

  if (isImageBuzzRound(round)) {
    if (qi >= round.slides.length) return null;
    const slide = round.slides[qi];
    const url = slide.imageUrl.trim();
    if (url === "") return null;
    const awardPoints =
      typeof slide.points === "number" && slide.points > 0 ? slide.points : 1;
    const base = {
      kind: "image_buzz" as const,
      packTitle: pack.title,
      roundIndex: ri,
      roundTitle: round.title,
      roundNumberHuman: ri + 1,
      slideIndexHuman: qi + 1,
      slideCount: round.slides.length,
      imageUrl: withBasePath(url),
      awardPoints,
    };
    const cap = slide.prompt?.trim();
    return cap !== undefined && cap !== "" ? { ...base, prompt: cap } : base;
  }

  if (isAudioBlindRound(round)) {
    if (qi >= round.tracks.length) return null;
    const t = round.tracks[qi];
    const base: PartyGameBoardAudioBlind = {
      kind: "audio_blind",
      packTitle: pack.title,
      roundIndex: ri,
      roundTitle: round.title,
      roundNumberHuman: ri + 1,
      trackIndexHuman: qi + 1,
      trackCount: round.tracks.length,
      audioUrl:
        audience === "host" || party.allowPlayerAudioControl
          ? withBasePath(t.audioUrl)
          : "",
      replaySerial: party.videoReplaySerial,
    };
    if (audience === "host") {
      return {
        ...base,
        revealTitle: t.revealTitle,
        ...(t.revealArtist !== undefined ? { revealArtist: t.revealArtist } : {}),
      };
    }
    return base;
  }

  if (isProgressiveGuessRound(round)) {
    const decoded = progressiveGuessDecode(round, qi);
    if (decoded === null) return null;
    const puzzleIdx = round.items.indexOf(decoded.item);
    if (puzzleIdx < 0) return null;
    const baseMeta = {
      packTitle: pack.title,
      roundIndex: ri,
      roundTitle: round.title,
      roundNumberHuman: ri + 1,
      puzzleIndexHuman: puzzleIdx + 1,
      puzzleCount: round.items.length,
    };
    if (decoded.clueIndex !== null) {
      const clue = decoded.item.clues[decoded.clueIndex];
      if (clue === undefined) return null;
      const url = clue.imageUrl.trim();
      if (url === "") return null;
      const clueBase = {
        kind: "progressive_guess" as const,
        phase: "clue" as const,
        ...baseMeta,
        clueIndexHuman: decoded.clueIndex + 1,
        clueCount: decoded.item.clues.length,
        imageUrl: withBasePath(url),
        awardPoints: clue.points,
      };
      const pr = decoded.item.playerPrompt?.trim();
      return pr !== undefined && pr !== "" ? { ...clueBase, playerPrompt: pr } : clueBase;
    }
    const revImg = decoded.item.reveal.imageUrl.trim();
    const ans = decoded.item.reveal.answer.trim();
    return {
      kind: "progressive_guess",
      phase: "reveal",
      ...baseMeta,
      answer: ans,
      revealImageUrl: withBasePath(revImg),
    };
  }

  if (!isQuizRound(round)) return null;
  if (qi >= round.questions.length) return null;
  const question = round.questions[qi];
  const surface: PartyGameBoardQuiz = {
    kind: "quiz",
    packTitle: pack.title,
    roundIndex: ri,
    roundTitle: round.title,
    roundNumberHuman: ri + 1,
    questionIndexInRound: qi,
    prompt: question.prompt,
    choices: [...question.choices],
    points: question.points,
  };
  if (question.imageUrl !== undefined && question.imageUrl.trim() !== "") {
    surface.imageUrl = withBasePath(question.imageUrl.trim());
  }
  const result = party.quizResult ?? null;
  const resultPublic =
    held != null &&
    result != null &&
    held.roundIndex === ri &&
    held.questionIndex === qi;
  if (audience === "host" || resultPublic) surface.correctChoiceIndex = question.correctIndex;
  if (resultPublic && result) surface.choiceCounts = result.counts;
  return surface;
}

function deriveReadyHold(party: Party, pack: QuizPack): PartyGameBoardReadyHold {
  let questionNumberHuman = 1;
  let questionCount = 1;
  let roundNumberHuman = 1;
  const roundIndex = party.currentRoundIndex;
  const questionIndex = party.currentQuestionIndex;
  if (roundIndex !== null && roundIndex >= 0 && roundIndex < pack.rounds.length) {
    roundNumberHuman = roundIndex + 1;
    const round = pack.rounds[roundIndex];
    if (round !== undefined && isQuizRound(round)) {
      questionCount = Math.max(1, round.questions.length);
      questionNumberHuman = (questionIndex ?? 0) + 1;
    }
  }
  return {
    kind: "ready_hold",
    tagline: party.readyPhaseTagline ?? "",
    questionNumberHuman,
    questionCount,
    roundNumberHuman,
  };
}

/** * Assembles REST/socket snapshots with playable surfaces (`gameBoard`). */
export function partySnapshotWithGame(
  party: Party,
  packs: Map<string, QuizPack>,
  audience: "player" | "host",
): PartyPublicSnapshot {
  const pack = quizPackFromLoadedId(packs, party.loadedPackId);
  const base = publicSnapshotForParty(party);
  const gameBoard = deriveGameBoard(party, pack, audience);
  const roundIndex = party.currentRoundIndex;
  const manchePodium =
    party.mancheResultOpen === true
      ? buildManchePodium({
          players: [...party.players.values()].map((player) => ({
            id: player.id,
            displayName: player.displayName,
            score: player.score,
            teamId: player.teamId,
          })),
          maxTeams: party.maxTeams,
          mancheNumber: (roundIndex ?? 0) + 1,
          questionCount: questionCountForRound(
            pack !== null && roundIndex !== null ? pack.rounds[roundIndex] : undefined,
          ),
        })
      : undefined;
  const hostSound =
    audience === "host"
      ? {
          soundBuzzerHostConfig: {
            allowedGoodKeys: [...party.buzzSound.allowedGoodKeys],
            allowedBadKeys: [...party.buzzSound.allowedBadKeys],
          },
          playVerdictSounds: party.buzzSound.playVerdictSounds,
          autoOpenBuzzOnCueAdvance: party.autoOpenBuzzOnCueAdvance === true,
          autoAdvanceQuizWhenAllBuzzed: party.autoAdvanceQuizWhenAllBuzzed === true,
          buzzGraceWindowMs: party.buzzGraceWindowMs,
        }
      : {};
  const buzzQuizQueueDetail =
    audience === "host" ? deriveBuzzQuizQueueDetail(party, gameBoard) : undefined;
  const readyFields = {
    readyPlayers: party.readyPlayers ? [...party.readyPlayers] : [],
    readyPhaseStartedAt: party.readyPhaseStartedAt,
    countdownStartedAt: party.countdownStartedAt,
    countdownDurationSec: party.countdownDurationSec,
    appliedCountdownDurationSec: party.appliedCountdownDurationSec,
    nextQuestionCountdownSec: party.nextQuestionCountdownSec,
    appliedNextQuestionCountdownSec: party.appliedNextQuestionCountdownSec,
    nextQuestionCountdownStartedAt: party.nextQuestionCountdownStartedAt,
    pointAward: party.pointAward,
    readyCheckEnabled: party.readyCheckEnabled === true,
    readyTimeoutSec: party.readyTimeoutSec,
    winnerDisplay: party.winnerDisplay,
  };
  const hostExtraFields =
    audience === "host"
      ? {
          winnerScreenMode: party.winnerScreenMode,
        }
      : {};

  const gapMs = visibleBuzzGapMs(party.highlightBuzzWinner, party.lastBuzzGapMs);
  const broadcastGap = gapMs !== null ? { buzzTimeGapMs: gapMs } : {};

  return {
    ...base,
    ...hostSound,
    ...readyFields,
    ...hostExtraFields,
    ...broadcastGap,
    gameBoard,
    ...(manchePodium !== undefined ? { manchePodium } : {}),
    ...(buzzQuizQueueDetail !== undefined ? { buzzQuizQueueDetail } : {}),
  };
}
