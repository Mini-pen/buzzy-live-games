import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { PartyStore } from "./store.js";
import type { Party, PartyPublicSnapshot } from "./types.js";

/**
 * * One launched quiz party for admin and broadcast screen tests.
 *   The prompt is the visible marker that the host snapshot actually rendered.
 *   Kept as a test helper (tsx) so the server build does not emit it.
 */

const buzzCatalog: LoadedBuzzSoundCatalog = {
  defaultBuzzerKey: "good1",
  sounds: [
    { key: "good1", label: "Good", pool: "good", file: "buzzers/good1.mp3" },
    { key: "bad1", label: "Bad", pool: "bad", file: "buzzers/bad1.mp3" },
  ],
  byKey: new Map([
    ["good1", { key: "good1", label: "Good", pool: "good", file: "buzzers/good1.mp3" }],
    ["bad1", { key: "bad1", label: "Bad", pool: "bad", file: "buzzers/bad1.mp3" }],
  ]),
};

export interface LaunchedQuiz {
  party: Party;
  host: () => PartyPublicSnapshot;
  player: () => PartyPublicSnapshot;
}

/** * Creates a party, appends one quiz manche, and launches it in normal mode. */
export function launchedQuizParty(prompt: string): LaunchedQuiz {
  const store = new PartyStore(() => {}, buzzCatalog);
  const party = store.createParty({
    maxPlayers: null,
    maxTeams: null,
    closedAfterStart: false,
    allowRename: true,
    allowTeamChange: true,
  });
  party.players.set("alice", {
    id: "alice",
    displayName: "Alice",
    avatarKey: "a.png",
    buzzSoundKey: "good1",
    teamId: null,
    score: 1,
    joinedAt: 1,
  });
  const pack: QuizPack = {
    id: `pack-${prompt}`,
    basename: `pack-${prompt}`,
    title: "Pack",
    rounds: [{ title: "Manche", questions: [{ prompt, choices: ["A", "B"], correctIndex: 0, points: 1 }] }],
  };
  const packs = new Map<string, QuizPack>([[pack.basename, pack]]);
  store.hostAppendManche(party, {
    kind: "pack_quiz",
    title: pack.title,
    packBasename: pack.basename,
    iframeUrl: null,
    youtubeEmbedUrl: null,
    directVideoUrl: null,
    savedRoundIndex: 0,
    savedQuestionIndex: 0,
    transitionKind: null,
    transitionDurationMs: null,
  });
  const mancheId = party.mancheScript[0]?.id;
  if (mancheId === undefined) throw new Error("launched quiz is missing its manche");
  store.hostLaunchManche(party, mancheId, "normal", true, packs);
  return {
    party,
    host: () => partySnapshotWithGame(party, packs, "host"),
    player: () => partySnapshotWithGame(party, packs, "player"),
  };
}
