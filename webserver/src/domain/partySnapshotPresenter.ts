import type { QuizPack } from "../games/pack.js";
import { isVideoRound } from "../games/pack.js";
import { canonicalYoutubeEmbedIframeSrc } from "./youtubeEmbed.js";
import { publicSnapshotForParty } from "./partyLogic.js";
import type {
  Party,
  PartyGameBoardQuiz,
  PartyGameBoardSurface,
  PartyPublicSnapshot,
} from "./types.js";

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
  return {
    ...base,
    gameBoard: deriveGameBoard(party, pack, audience),
  };
}
