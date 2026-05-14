import type { QuizPack } from "../games/pack.js";
import { publicSnapshotForParty } from "./partyLogic.js";
import type { Party, PartyGameBoardSurface, PartyPublicSnapshot } from "./types.js";

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
  if (qi >= round.questions.length) return null;
  const question = round.questions[qi];
  const surface: PartyGameBoardSurface = {
    packTitle: pack.title,
    roundIndex: ri,
    roundTitle: round.title,
    roundNumberHuman: ri + 1,
    questionIndexInRound: qi,
    prompt: question.prompt,
    choices: [...question.choices],
    points: question.points,
  };
  if (audience === "host") surface.correctChoiceIndex = question.correctIndex;
  return surface;
}

/** * Assembles REST/socket snapshots with Buzzer-visible question text (`gameBoard`). */
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
