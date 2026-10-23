// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { releaseRenderedScreens, showPartyScreen } from "./renderPartyScreen.js";
import { PartyStore } from "./store.js";

/**
 * * CHOIX INCERTAIN (Specs Writer, 2026-10-23) — libellé du compteur sous le bouton joueur.
 *   Ne tranche pas. Le CDC §4.5 fixe l'accord, pas cette phrase :
 *   singulier pour 1 (« 1 joueur », correction 601fa63), pluriel sinon, y compris 0.
 *   La phrase « 3 / 5 joueurs prêts » reste une proposition de Design UI.
 *
 *   Le code a457182 accorde sur le nombre de prêts :
 *   « 1 / 3 joueur prêt », « 0 / 3 joueurs prêts ».
 *
 *   Pour revenir à l'accord sur le total (« 1 / 3 joueurs prêts ») :
 *   passer `PLAYER_LABEL_FOLLOWS_THE_READY_COUNT` à `false`.
 *   Zéro reste au pluriel dans les deux cas.
 */

const PLAYER_LABEL_FOLLOWS_THE_READY_COUNT = true;

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

function phoneWithReady(readyCount: number): Promise<HTMLElement> {
  const store = new PartyStore(() => {}, buzzCatalog);
  const party = store.createParty({
    maxPlayers: null,
    maxTeams: null,
    closedAfterStart: false,
    allowRename: true,
    allowTeamChange: true,
  });
  for (const [id, name] of [
    ["alice", "Alice"],
    ["bob", "Bob"],
    ["cara", "Cara"],
  ] as const) {
    party.players.set(id, {
      id,
      displayName: name,
      avatarKey: "a.png",
      buzzSoundKey: "good1",
      teamId: null,
      score: 0,
      joinedAt: 1,
    });
  }
  const pack: QuizPack = {
    id: "pack-ready-label",
    basename: "pack-ready-label",
    title: "Pack",
    rounds: [{ title: "Manche", questions: [{ prompt: "Q", choices: ["A", "B"], correctIndex: 0, points: 1 }] }],
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
  store.adminSetReadyCheckEnabled(party, true, null);
  store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", true, packs);
  if (readyCount >= 1) store.playerSetReady(party, "alice", true);
  const snap = partySnapshotWithGame(party, packs, "player");
  return showPartyScreen(`/party/${party.id}/play`, snap);
}

function countText(page: HTMLElement): string {
  return page.querySelector(".bz-ready-count")?.textContent?.trim() ?? "";
}

afterEach(async () => {
  await releaseRenderedScreens();
});

describe("CHOIX INCERTAIN — libellé du compteur joueur", () => {
  it("affiche 0 au pluriel, et le singulier de 1 selon l'accord retenu", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    // * Read the zero screen before the next mount: fetch serves only the latest snapshot.
    const none = await phoneWithReady(0);
    expect(countText(none)).toBe("0 / 3 joueurs prêts");
    const one = await phoneWithReady(1);
    if (PLAYER_LABEL_FOLLOWS_THE_READY_COUNT) {
      expect(countText(one)).toBe("1 / 3 joueur prêt");
    } else {
      expect(countText(one)).toBe("1 / 3 joueurs prêts");
    }
  });
});
