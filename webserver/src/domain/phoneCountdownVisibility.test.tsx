// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { releaseRenderedScreens, showPartyScreen } from "./renderPartyScreen.js";
import { PartyStore } from "./store.js";
import type { PartyPublicSnapshot } from "./types.js";

/**
 * * The phone digit follows the server clock when the tab becomes visible.
 *   The broadcast digit is already covered in questionHoldback.test.tsx.
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

function countingPhone(): { id: string; snap: PartyPublicSnapshot; startedAt: number } {
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
  const pack: QuizPack = {
    id: "pack-vis",
    basename: "pack-vis",
    title: "Pack",
    rounds: [{ title: "Manche", questions: [{ prompt: "ENONCE_VISIBLE", choices: ["A", "B"], correctIndex: 0, points: 1 }] }],
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
  store.adminSetCountdownDuration(party, 5);
  store.adminSetNextQuestionCountdownSec(party, 0);
  store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", true, packs);
  const startedAt = Date.now();
  party.countdownStartedAt = startedAt;
  party.appliedCountdownDurationSec = 5;
  party.buzzWindowOpen = false;
  return { id: party.id, snap: partySnapshotWithGame(party, packs, "player"), startedAt };
}

afterEach(async () => {
  await releaseRenderedScreens();
});

describe("chiffre du décompte au retour de l'onglet", () => {
  it("recale le téléphone depuis l'heure serveur, sans avancer tant que l'onglet reste caché", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
    const scene = countingPhone();
    const phone = await showPartyScreen(`/party/${scene.id}/play`, scene.snap);
    const digit = (): string => phone.querySelector(".bz-buzz-count-num")?.textContent ?? "";
    expect(digit()).toBe("5");

    vi.setSystemTime(scene.startedAt + 3_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(digit()).toBe("5");

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(digit()).toBe("2");
  });
});
