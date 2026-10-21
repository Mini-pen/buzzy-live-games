// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { releaseRenderedScreens, showPartyScreen } from "./renderPartyScreen.js";
import { PartyStore } from "./store.js";
import type { Party, PartyPublicSnapshot } from "./types.js";

/**
 * * Normal mode keeps the next question hidden until the buzzer opens.
 *   Autonomous mode still reveals a question only when that buzzer opens.
 *   The first normal cue, shown while the buzzer is closed, is the open CA-60 choice
 *   covered by uncertainCa60FirstQuestion.test.tsx.
 */

const FIRST = "ENONCE_DEJA_JOUE_NORMAL";
const NEXT = "ENONCE_SUIVANT_NORMAL";
const AUTO = "ENONCE_AUTO_PREMIER";

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

function pack(prompts: string[]): QuizPack {
  return {
    id: "pack-gate",
    basename: "pack-gate",
    title: "Pack",
    rounds: [
      {
        title: "Manche",
        questions: prompts.map((prompt, index) => ({
          prompt,
          choices: [`A${index}`, `B${index}`],
          correctIndex: 0,
          points: 1,
        })),
      },
    ],
  };
}

function launch(options: {
  mode: "normal" | "autonomous";
  prompts: string[];
  buzzerSec: number;
}): { store: PartyStore; party: Party; pack: QuizPack; packs: Map<string, QuizPack> } {
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
    score: 0,
    joinedAt: 1,
  });
  const quiz = pack(options.prompts);
  const packs = new Map<string, QuizPack>([[quiz.basename, quiz]]);
  store.hostAppendManche(party, {
    kind: "pack_quiz",
    title: quiz.title,
    packBasename: quiz.basename,
    iframeUrl: null,
    youtubeEmbedUrl: null,
    directVideoUrl: null,
    savedRoundIndex: 0,
    savedQuestionIndex: 0,
    transitionKind: null,
    transitionDurationMs: null,
  });
  store.adminSetCountdownDuration(party, options.buzzerSec);
  store.adminSetNextQuestionCountdownSec(party, 0);
  store.hostLaunchManche(party, party.mancheScript[0]!.id, options.mode, true, packs);
  return { store, party, pack: quiz, packs };
}

function playerSnap(party: Party, packs: Map<string, QuizPack>): PartyPublicSnapshot {
  return partySnapshotWithGame(party, packs, "player");
}

afterEach(async () => {
  await releaseRenderedScreens();
});

describe("question suivante en mode normal", () => {
  it("garde la question suivante masquée jusqu'à l'ouverture du buzzer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
    const { store, party, pack, packs } = launch({
      mode: "normal",
      prompts: [FIRST, NEXT],
      buzzerSec: 5,
    });
    store.adminAdvanceCue(party, pack);
    expect(party.buzzWindowOpen).toBe(false);
    const hidden = playerSnap(party, packs);
    const hiddenRaw = JSON.stringify(hidden);
    expect(hiddenRaw).toContain(FIRST);
    expect(hiddenRaw).not.toContain(NEXT);
    const hiddenPhone = await showPartyScreen(`/party/${party.id}/play`, hidden);
    const hiddenBroadcast = await showPartyScreen(`/party/${party.id}/broadcast`, hidden);
    expect(hiddenPhone.textContent).toContain(FIRST);
    expect(hiddenPhone.textContent).not.toContain(NEXT);
    expect(hiddenBroadcast.textContent).toContain(FIRST);
    expect(hiddenBroadcast.textContent).not.toContain(NEXT);

    store.adminSetBuzzOpen(party, true);
    expect(party.buzzWindowOpen).toBe(true);
    const opened = playerSnap(party, packs);
    const openedRaw = JSON.stringify(opened);
    expect(openedRaw).toContain(NEXT);
    expect(openedRaw).not.toContain(FIRST);
    const phone = await showPartyScreen(`/party/${party.id}/play`, opened);
    const broadcast = await showPartyScreen(`/party/${party.id}/broadcast`, opened);
    expect(phone.textContent).toContain(NEXT);
    expect(phone.textContent).not.toContain(FIRST);
    expect(broadcast.textContent).toContain(NEXT);
    expect(broadcast.textContent).not.toContain(FIRST);
  });
});

describe("mode autonome inchangé", () => {
  it("n'affiche la première question qu'à l'ouverture du buzzer quand le décompte vaut 5 s", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
    const { store, party, packs } = launch({ mode: "autonomous", prompts: [AUTO], buzzerSec: 5 });
    expect(party.autoOpenBuzzOnCueAdvance).toBe(true);
    expect(party.buzzWindowOpen).toBe(false);
    expect(party.questionRevealed).toBe(false);
    const during = playerSnap(party, packs);
    expect(JSON.stringify(during)).not.toContain(AUTO);
    const duringPhone = await showPartyScreen(`/party/${party.id}/play`, during);
    const duringBroadcast = await showPartyScreen(`/party/${party.id}/broadcast`, during);
    expect(duringPhone.textContent).not.toContain(AUTO);
    expect(duringBroadcast.textContent).not.toContain(AUTO);

    const startedAt = party.countdownStartedAt ?? 0;
    vi.setSystemTime(startedAt + 5_000);
    expect(store.maybeOpenBuzzAfterCountdown(party)).toBe(true);
    expect(party.buzzWindowOpen).toBe(true);
    const opened = playerSnap(party, packs);
    expect(JSON.stringify(opened)).toContain(AUTO);
    const phone = await showPartyScreen(`/party/${party.id}/play`, opened);
    const broadcast = await showPartyScreen(`/party/${party.id}/broadcast`, opened);
    expect(phone.textContent).toContain(AUTO);
    expect(broadcast.textContent).toContain(AUTO);
  });

  it("ouvre le buzzer et montre la première question tout de suite quand le décompte vaut 0", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
    const { party, packs } = launch({ mode: "autonomous", prompts: [AUTO], buzzerSec: 0 });
    expect(party.buzzWindowOpen).toBe(true);
    expect(party.questionRevealed).toBe(true);
    const snap = playerSnap(party, packs);
    expect(JSON.stringify(snap)).toContain(AUTO);
    const phone = await showPartyScreen(`/party/${party.id}/play`, snap);
    const broadcast = await showPartyScreen(`/party/${party.id}/broadcast`, snap);
    expect(phone.textContent).toContain(AUTO);
    expect(broadcast.textContent).toContain(AUTO);
    expect(phone.querySelector('button[aria-label="Buzz"]')).not.toBeNull();
  });
});
