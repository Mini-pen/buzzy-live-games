// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { releaseAdminScreens, showAdminScreen } from "./renderAdminScreen.js";
import { PartyStore } from "./store.js";
import type { Party, PartyPublicSnapshot } from "./types.js";

/**
 * * CHOIX INCERTAIN — le jeton animateur reste dans l'adresse (`#token`) depuis f81d3ec.
 *   En attente de Minipen. Coding Agent prévoit de retirer ce fragment.
 *
 *   Pour retirer ce choix : supprimer ce fichier.
 *   Le rechargement sans fragment, le localStorage, et l'absence du jeton
 *   sur la diffusion et le téléphone sont dans `hostTokenPlacement.test.tsx`.
 *
 *   Pour inverser l'attente sans supprimer le fichier :
 *   passer `KEEP_HOST_TOKEN_IN_THE_ADDRESS` à `false`.
 *   Le test attendra alors que le fragment soit retiré au montage.
 */

const KEEP_HOST_TOKEN_IN_THE_ADDRESS = true;

const TOKEN = "secret-host-token-address";

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

function launched(): { party: Party; host: () => PartyPublicSnapshot; player: () => PartyPublicSnapshot } {
  const store = new PartyStore(() => {}, buzzCatalog);
  const party = store.createParty({
    maxPlayers: null,
    maxTeams: null,
    closedAfterStart: false,
    allowRename: true,
    allowTeamChange: true,
  });
  const pack: QuizPack = {
    id: "pack-token-hash",
    basename: "pack-token-hash",
    title: "Pack",
    rounds: [{ title: "Manche", questions: [{ prompt: "ENONCE_JETON", choices: ["A", "B"], correctIndex: 0, points: 1 }] }],
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
  return {
    party,
    host: () => partySnapshotWithGame(party, packs, "host"),
    player: () => partySnapshotWithGame(party, packs, "player"),
  };
}

function begin(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
}

afterEach(async () => {
  await releaseAdminScreens();
  vi.useRealTimers();
});

describe("CHOIX INCERTAIN — fragment #token dans l'adresse", () => {
  it("survit au rechargement de la page animateur", async () => {
    begin();
    const { party, host, player } = launched();
    const id = party.id.toLowerCase();
    localStorage.clear();
    window.location.hash = `#token=${TOKEN}`;
    const first = await showAdminScreen(`/party/${id}/admin`, host, player, {
      hostToken: false,
      settleOnTokenWall: true,
    });
    expect(first.querySelector(".bz-host-controls")).not.toBeNull();
    expect(first.textContent).not.toContain("Jeton animateur absent ou lien incomplet");

    // * Reload: the document is gone, the address bar still has the fragment.
    await releaseAdminScreens({ keepStorage: true, keepHash: true });
    localStorage.clear();
    const second = await showAdminScreen(`/party/${id}/admin`, host, player, {
      hostToken: false,
      settleOnTokenWall: true,
    });
    expect(second.querySelector(".bz-host-controls")).not.toBeNull();
    expect(second.textContent).not.toContain("Jeton animateur absent ou lien incomplet");
    if (KEEP_HOST_TOKEN_IN_THE_ADDRESS) {
      expect(window.location.hash).toContain(`token=${TOKEN}`);
    } else {
      expect(window.location.hash.includes("token=")).toBe(false);
    }
  });
});
