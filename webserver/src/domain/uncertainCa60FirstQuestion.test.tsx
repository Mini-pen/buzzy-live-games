// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { releaseRenderedScreens, showPartyScreen } from "./renderPartyScreen.js";
import { PartyStore } from "./store.js";
import type { Party } from "./types.js";

/**
 * * CHOIX INCERTAIN — CA-60, en attente de Minipen (d5556f2).
 *   Le CDC dit qu'une nouvelle question n'apparaît qu'à l'ouverture du buzzer.
 *   Le mode normal affiche pourtant la première question pendant que le buzzer est fermé
 *   (`store.ts`, `openBuzzPolicyAfterGap`, quand `questionHold` est vide).
 *
 *   Pour inverser ce fichier seul si Minipen retient le CDC :
 *   passer `FIRST_CUE_VISIBLE_WHILE_BUZZER_CLOSED` à `false`.
 *   Le test attendra alors l'absence de l'énoncé tant que le buzzer est fermé.
 */

const FIRST_CUE_VISIBLE_WHILE_BUZZER_CLOSED = true;

const PROMPT = "ENONCE_PREMIERE_NORMALE";
const NEXT_PROMPT = "ENONCE_SUIVANTE_NORMALE";

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

function quiz(): QuizPack {
  return {
    id: "pack-ca60",
    basename: "pack-ca60",
    title: "Pack",
    rounds: [
      {
        title: "Manche",
        questions: [
          { prompt: PROMPT, choices: ["A1", "B1"], correctIndex: 0, points: 1 },
          { prompt: NEXT_PROMPT, choices: ["A2", "B2"], correctIndex: 1, points: 1 },
        ],
      },
    ],
  };
}

function launchedNormal(): { party: Party; packs: Map<string, QuizPack> } {
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
  const pack = quiz();
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
  store.adminSetCountdownDuration(party, 5);
  store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", true, packs);
  return { party, packs };
}

afterEach(async () => {
  await releaseRenderedScreens();
});

describe("choix incertain CA-60", () => {
  it("choix incertain CA-60 : en mode normal la première question est affichée buzzer fermé", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
    const { party, packs } = launchedNormal();
    expect(party.buzzWindowOpen).toBe(false);
    expect(party.autoOpenBuzzOnCueAdvance).toBe(false);
    const snap = partySnapshotWithGame(party, packs, "player");
    const raw = JSON.stringify(snap);
    const phone = await showPartyScreen(`/party/${party.id}/play`, snap);
    const broadcast = await showPartyScreen(`/party/${party.id}/broadcast`, snap);
    const phoneText = phone.textContent ?? "";
    const broadcastText = broadcast.textContent ?? "";

    expect(raw).not.toContain(NEXT_PROMPT);
    expect(phoneText).not.toContain(NEXT_PROMPT);
    expect(broadcastText).not.toContain(NEXT_PROMPT);
    expect(phone.querySelector('button[aria-label="Buzz"]')).toBeNull();

    if (FIRST_CUE_VISIBLE_WHILE_BUZZER_CLOSED) {
      expect(party.questionRevealed).toBe(true);
      expect(raw).toContain(PROMPT);
      expect(phoneText).toContain(PROMPT);
      expect(broadcastText).toContain(PROMPT);
      expect(broadcastText).not.toContain("charger un pack quiz");
      return;
    }

    expect(party.questionRevealed).toBe(false);
    expect(raw).not.toContain(PROMPT);
    expect(phoneText).not.toContain(PROMPT);
    expect(broadcastText).not.toContain(PROMPT);
  });
});
