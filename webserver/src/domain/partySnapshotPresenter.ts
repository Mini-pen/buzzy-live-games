import type { QuizPack } from "../games/pack.js";
import {
  isAudioBlindRound,
  isFreeBuzzRound,
  isImageBuzzRound,
  isProgressiveGuessRound,
  isQuizRound,
  isVideoRound,
  progressiveGuessDecode,
} from "../games/pack.js";
import { canonicalYoutubeEmbedIframeSrc } from "./youtubeEmbed.js";
import { publicSnapshotForParty } from "./partyLogic.js";
import type {
  Party,
  PartyGameBoardAudioBlind,
  PartyGameBoardQuiz,
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

function deriveGameBoard(
  party: Party,
  pack: QuizPack | null,
  audience: "player" | "host",
): PartyGameBoardSurface | null {
  if (party.state !== "round_active") return null;
  if (party.activeMancheId === null) return null;
  const item = party.mancheScript.find((m) => m.id === party.activeMancheId);
  if (item === undefined) return null;

  if (item.kind === "iframe") {
    if (typeof item.iframeUrl !== "string" || item.iframeUrl.trim() === "")
      return null;
    return {
      kind: "iframe",
      title: item.title,
      url: item.iframeUrl,
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
      videoUrl: item.directVideoUrl,
      replaySerial: party.videoReplaySerial,
    };
  }

  if (pack === null) return null;

  const ri = party.currentRoundIndex;
  const qi = party.currentQuestionIndex;
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
      videoUrl: round.videoUrl,
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
      imageUrl: url,
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
        audience === "host" || party.allowPlayerAudioControl ? t.audioUrl : "",
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
        imageUrl: url,
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
      revealImageUrl: revImg,
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
    surface.imageUrl = question.imageUrl.trim();
  }
  if (audience === "host") surface.correctChoiceIndex = question.correctIndex;
  return surface;
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
  const hostSound =
    audience === "host"
      ? {
          soundBuzzerHostConfig: {
            allowedGoodKeys: [...party.buzzSound.allowedGoodKeys],
            allowedBadKeys: [...party.buzzSound.allowedBadKeys],
          },
          autoOpenBuzzOnCueAdvance: party.autoOpenBuzzOnCueAdvance === true,
        }
      : {};
  const buzzQuizQueueDetail =
    audience === "host" ? deriveBuzzQuizQueueDetail(party, gameBoard) : undefined;
  return {
    ...base,
    ...hostSound,
    gameBoard,
    ...(buzzQuizQueueDetail !== undefined ? { buzzQuizQueueDetail } : {}),
  };
}
