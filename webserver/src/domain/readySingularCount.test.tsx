// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { releaseRenderedScreens, showPartyScreen } from "./renderPartyScreen.js";
import { PartyStore } from "./store.js";

/**
 * * CDC §4.5, correction 601fa63, not a choice: the singular stays for 1, « 1 joueur ».
 *   One ready player of one. The open label for several players is uncertainPlayerReadyLabel.test.tsx.
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

afterEach(async () => {
  await releaseRenderedScreens();
});

describe("compteur Prêt au singulier", () => {
  it("écrit 1 / 1 joueur prêt quand le seul joueur est vert", async () => {
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
      id: "pack-ready-one",
      basename: "pack-ready-one",
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
    // * Marking the only player ready ends the phase. The line is what the phone renders
    //   while the snapshot still says one ready player and the phase is on screen.
    party.readyPlayers.add("alice");
    const snap = partySnapshotWithGame(party, packs, "player");
    const phone = await showPartyScreen(`/party/${party.id}/play`, snap);
    expect(phone.querySelector(".bz-ready-count")?.textContent?.trim()).toBe("1 / 1 joueur prêt");
  });
});
