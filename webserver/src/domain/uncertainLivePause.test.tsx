// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { releaseRenderedScreens, showPartyScreen } from "./renderPartyScreen.js";
import { PartyStore } from "./store.js";
import type { Party, PartyPublicSnapshot } from "./types.js";

/**
 * * CHOIX INCERTAIN — la pause gèle l'écran et les décomptes.
 *   Le CDC §2.5 dit encore « Mettre en pause / retour lobby » (`adminPauseToLobby`, store.ts:1453).
 *   Le code gèle (`adminToggleLivePause`, store.ts:1427) et ne renvoie pas au salon.
 *   En attente de Minipen.
 *
 *   Pour inverser ce fichier seul : passer `PAUSE_FREEZES_THE_ROUND` à `false`.
 *   Le test attendra alors l'écran du salon.
 */

const PAUSE_FREEZES_THE_ROUND = true;

const T0 = Date.parse("2026-10-22T12:00:00.000Z");

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

function scene(): { store: PartyStore; party: Party; packs: Map<string, QuizPack> } {
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
    id: "pack-pause",
    basename: "pack-pause",
    title: "Pack",
    rounds: [
      {
        title: "Manche",
        questions: [{ prompt: "ENONCE_PAUSE", choices: ["A", "B"], correctIndex: 0, points: 1 }],
      },
    ],
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
  party.countdownStartedAt = T0;
  party.appliedCountdownDurationSec = 5;
  party.buzzWindowOpen = false;
  return { store, party, packs };
}

function snap(party: Party, packs: Map<string, QuizPack>): PartyPublicSnapshot {
  return partySnapshotWithGame(party, packs, "player");
}

async function paint(party: Party, packs: Map<string, QuizPack>, route: "play" | "broadcast"): Promise<HTMLElement> {
  return showPartyScreen(`/party/${party.id}/${route}`, snap(party, packs));
}

afterEach(async () => {
  await releaseRenderedScreens();
});

describe("CHOIX INCERTAIN — la pause gèle la manche", () => {
  it("gèle l'écran et les décomptes, ne renvoie pas au salon, et reprend le temps restant", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { store, party, packs } = scene();
    vi.setSystemTime(T0 + 1_000);
    store.adminToggleLivePause(party);

    const phone = await paint(party, packs, "play");
    const broadcast = await paint(party, packs, "broadcast");
    const phoneDigit = (): string => phone.querySelector(".bz-buzz-count-num")?.textContent ?? "";
    const broadcastDigit = (): string => broadcast.querySelector(".bz-countdown-digit")?.textContent ?? "";

    if (!PAUSE_FREEZES_THE_ROUND) {
      expect(phone.textContent).toContain("En attente des joueurs");
      expect(broadcast.textContent).toContain("En attente des joueurs");
      return;
    }

    expect(party.state).toBe("round_active");
    expect(phone.textContent).toContain("ENONCE_PAUSE");
    expect(broadcast.textContent).toContain("ENONCE_PAUSE");
    expect(phone.textContent).not.toContain("En attente des joueurs");
    expect(broadcast.textContent).not.toContain("En attente des joueurs");
    expect(phoneDigit()).toBe("4");
    expect(broadcastDigit()).toBe("4");

    vi.setSystemTime(T0 + 20_000);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(phoneDigit()).toBe("4");
    expect(broadcastDigit()).toBe("4");
    expect(phone.textContent).toContain("ENONCE_PAUSE");
    expect(broadcast.textContent).toContain("ENONCE_PAUSE");

    vi.setSystemTime(T0 + 6_000);
    store.adminToggleLivePause(party);
    expect(party.liveRoundPausedAt).toBeNull();
    expect(party.state).toBe("round_active");
    await releaseRenderedScreens();
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 6_000);

    const resumedPhone = await paint(party, packs, "play");
    const resumedBroadcast = await paint(party, packs, "broadcast");
    expect(resumedPhone.querySelector(".bz-buzz-count-num")?.textContent).toBe("4");
    expect(resumedBroadcast.querySelector(".bz-countdown-digit")?.textContent).toBe("4");
    expect(resumedPhone.textContent).toContain("ENONCE_PAUSE");
    expect(resumedBroadcast.textContent).not.toContain("En attente des joueurs");

    vi.setSystemTime(T0 + 7_000);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(resumedPhone.querySelector(".bz-buzz-count-num")?.textContent).toBe("3");
    expect(resumedBroadcast.querySelector(".bz-countdown-digit")?.textContent).toBe("3");
  });
});
