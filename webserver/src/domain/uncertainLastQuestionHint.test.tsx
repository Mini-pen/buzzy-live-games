// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { adminRequests, flushAdmin, releaseAdminScreens, showAdminScreen } from "./renderAdminScreen.js";
import { PartyStore } from "./store.js";
import type { PartyPublicSnapshot } from "./types.js";

/**
 * * CHOIX INCERTAIN — à la dernière question, « Question suivante → » est inactif
 *   et indique « Afficher gagnant » (App.tsx, cueAdvanceWouldExhaust).
 *   L'autre possibilité, notée dans le code, est de relier ce bouton à « Afficher gagnant ».
 *   En attente de Minipen.
 *
 *   Pour inverser ce fichier seul : passer `LAST_QUESTION_NEXT_STAYS_DISABLED` à `false`.
 *   Le test attendra alors un POST `/host/show-winner` au clic, sans indication d'inactivité.
 */

const LAST_QUESTION_NEXT_STAYS_DISABLED = true;

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

afterEach(async () => {
  await releaseAdminScreens();
  vi.useRealTimers();
});

describe("CHOIX INCERTAIN — dernière question", () => {
  it("désactive Question suivante et indique Afficher gagnant", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
    const store = new PartyStore(() => {}, buzzCatalog);
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    const pack: QuizPack = {
      id: "pack-last",
      basename: "pack-last",
      title: "Pack",
      rounds: [{ title: "Manche", questions: [{ prompt: "ENONCE_DERNIERE", choices: ["A", "B"], correctIndex: 0, points: 1 }] }],
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
    store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", true, packs);
    const host = (): PartyPublicSnapshot => partySnapshotWithGame(party, packs, "host");
    const player = (): PartyPublicSnapshot => partySnapshotWithGame(party, packs, "player");
    const page = await showAdminScreen(`/party/${party.id}/admin`, host, player, { hostToken: "host-token" });
    const button = [...page.querySelectorAll<HTMLButtonElement>(".bz-manche-moment button")].find((item) =>
      (item.textContent ?? "").includes("Question suivante"),
    );
    expect(button).toBeDefined();
    if (button === undefined) return;

    if (!LAST_QUESTION_NEXT_STAYS_DISABLED) {
      button.click();
      await flushAdmin();
      expect(adminRequests.some((request) => request.url.includes("/host/show-winner"))).toBe(true);
      expect(page.textContent).not.toContain("ce bouton est inactif");
      return;
    }

    expect(button.disabled).toBe(true);
    expect(button.title).toContain("Afficher gagnant");
    expect(page.textContent).toContain("Dernière question — ce bouton est inactif. Utilisez « Afficher gagnant ».");
    button.click();
    await flushAdmin();
    expect(adminRequests.some((request) => request.url.includes("/host/cue/next"))).toBe(false);
    expect(adminRequests.some((request) => request.url.includes("/host/show-winner"))).toBe(false);
    expect(party.mancheResultOpen).not.toBe(true);
  });
});
