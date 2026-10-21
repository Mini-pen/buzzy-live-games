// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import {
  flushAdmin,
  httpError,
  releaseAdminScreens,
  showAdminScreen,
  type AdminRequest,
} from "./renderAdminScreen.js";
import { PartyStore } from "./store.js";
import type { Party, PartyPublicSnapshot } from "./types.js";

/**
 * * « Afficher gagnant » in « Fin de manche ».
 *   Before f81d3ec the button was `disabled={snap.winnerDisplay !== null}` (App.tsx, old line 4876)
 *   and `adminSetWinnerScreenMode` did not clear that flag (store.ts, old line 1614).
 *   The button stays usable through the question, « Prêt ? » and the open buzzer,
 *   opens the podium the presenter actually builds, and is usable again on the next manche.
 */

const HOST_TOKEN = "host-token";

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

function quiz(count: number, basename: string): QuizPack {
  return {
    id: basename,
    basename,
    title: basename,
    rounds: [
      {
        title: "Manche",
        questions: Array.from({ length: count }, (_, index) => ({
          prompt: `ENONCE_${index + 1}`,
          choices: ["A", "B"],
          correctIndex: 0,
          points: 1,
        })),
      },
    ],
  };
}

function scriptItem(pack: QuizPack) {
  return {
    kind: "pack_quiz" as const,
    title: pack.title,
    packBasename: pack.basename,
    iframeUrl: null,
    youtubeEmbedUrl: null,
    directVideoUrl: null,
    savedRoundIndex: 0,
    savedQuestionIndex: 0,
    transitionKind: null,
    transitionDurationMs: null,
  };
}

function hostOf(party: Party, packs: Map<string, QuizPack>): PartyPublicSnapshot {
  return partySnapshotWithGame(party, packs, "host");
}

function playerOf(party: Party, packs: Map<string, QuizPack>): PartyPublicSnapshot {
  return partySnapshotWithGame(party, packs, "player");
}

function winnerButton(root: ParentNode): HTMLButtonElement {
  const button = [...root.querySelectorAll<HTMLButtonElement>(".bz-host-controls button")].find((item) =>
    (item.textContent ?? "").includes("Afficher gagnant"),
  );
  if (button === undefined) throw new Error("Afficher gagnant button missing");
  return button;
}

function begin(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
}

afterEach(async () => {
  await releaseAdminScreens();
  vi.useRealTimers();
});

describe("Afficher gagnant en Fin de manche", () => {
  it("reste cliquable en question, en Prêt ? et buzzer ouvert, après un gagnant de fin de question", async () => {
    begin();
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
      score: 8,
      joinedAt: 1,
    });
    party.players.set("bob", {
      id: "bob",
      displayName: "Bob",
      avatarKey: "a.png",
      buzzSoundKey: "good1",
      teamId: null,
      score: 3,
      joinedAt: 2,
    });
    const pack = quiz(2, "pack-winner-phases");
    const packs = new Map<string, QuizPack>([[pack.basename, pack]]);
    store.hostAppendManche(party, scriptItem(pack));
    // * A fin-de-question winner used to stick after the switch to « Fin de manche ».
    store.adminSetWinnerScreenMode(party, "question");
    store.adminSetNextQuestionCountdownSec(party, 5);
    store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", true, packs);
    store.adminAdvanceCue(party, pack);
    expect(party.winnerDisplay?.playerName).toBe("Alice");
    expect(party.mancheResultOpen).not.toBe(true);

    store.adminSetWinnerScreenMode(party, "round");
    expect(party.winnerScreenMode).toBe("round");
    expect(party.winnerDisplay).toBeNull();
    vi.setSystemTime(new Date("2026-10-22T12:00:06.000Z"));
    expect(store.maybeFinishNextQuestionCountdown(party, pack)).toBe(true);
    expect(party.winnerDisplay).toBeNull();
    expect(party.currentQuestionIndex).toBe(1);
    expect(party.buzzWindowOpen).toBe(false);
    expect(hostOf(party, packs).manchePodium).toBeUndefined();

    const onQuestion = await showAdminScreen(
      `/party/${party.id}/admin`,
      () => hostOf(party, packs),
      () => playerOf(party, packs),
      { hostToken: HOST_TOKEN },
    );
    // * The next prompt stays held until the buzzer opens. The host still sees the question screen.
    expect(onQuestion.textContent).toContain("ENONCE_1");
    expect(onQuestion.textContent).not.toContain("ENONCE_2");
    expect(onQuestion.textContent).not.toContain("Lancer la question");
    expect(onQuestion.textContent).not.toContain("buzzer ouvert");
    expect(winnerButton(onQuestion).disabled).toBe(false);
    await releaseAdminScreens();

    store.adminSetReadyCheckEnabled(party, true, pack);
    expect(party.readyPhaseStartedAt).not.toBeNull();
    expect(party.winnerDisplay).toBeNull();
    const onReady = await showAdminScreen(
      `/party/${party.id}/admin`,
      () => hostOf(party, packs),
      () => playerOf(party, packs),
      { hostToken: HOST_TOKEN },
    );
    expect(onReady.textContent).toContain("Lancer la question");
    expect(onReady.textContent).toContain("Prêt ?");
    expect(winnerButton(onReady).disabled).toBe(false);
    await releaseAdminScreens();

    store.adminSetBuzzOpen(party, true);
    expect(party.buzzWindowOpen).toBe(true);
    expect(party.winnerDisplay).toBeNull();
    const onBuzz = await showAdminScreen(
      `/party/${party.id}/admin`,
      () => hostOf(party, packs),
      () => playerOf(party, packs),
      { hostToken: HOST_TOKEN },
    );
    expect(onBuzz.textContent).toContain("buzzer ouvert");
    expect(onBuzz.textContent).toContain("ENONCE_2");
    expect(winnerButton(onBuzz).disabled).toBe(false);
  });

  it("ouvre le podium réel, se grise avec lui, et redevient utilisable à la manche suivante", async () => {
    begin();
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
      score: 8,
      joinedAt: 1,
    });
    party.players.set("bob", {
      id: "bob",
      displayName: "Bob",
      avatarKey: "a.png",
      buzzSoundKey: "good1",
      teamId: null,
      score: 3,
      joinedAt: 2,
    });
    const first = quiz(2, "pack-winner-open");
    const second = quiz(1, "pack-winner-next");
    second.rounds[0]!.questions[0]!.prompt = "ENONCE_MANCHE_SUIVANTE";
    const packs = new Map<string, QuizPack>([
      [first.basename, first],
      [second.basename, second],
    ]);
    store.hostAppendManche(party, scriptItem(first));
    store.hostAppendManche(party, scriptItem(second));
    const secondId = party.mancheScript[1]!.id;
    store.adminSetWinnerScreenMode(party, "round");
    store.adminSetNextQuestionCountdownSec(party, 0);
    store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", true, packs);
    expect(hostOf(party, packs).manchePodium).toBeUndefined();

    const respond = (request: AdminRequest): Response | null => {
      if (request.method === "POST" && request.url.includes("/host/show-winner")) {
        store.adminShowWinner(party);
        return null;
      }
      return null;
    };
    const admin = await showAdminScreen(
      `/party/${party.id}/admin`,
      () => hostOf(party, packs),
      () => playerOf(party, packs),
      { hostToken: HOST_TOKEN, respond },
    );
    expect(winnerButton(admin).disabled).toBe(false);
    await act(async () => {
      winnerButton(admin).click();
    });
    await flushAdmin();

    const shown = hostOf(party, packs);
    // * Visual order is second place, then first. The empty third step is not in the model.
    expect(shown.manchePodium?.steps.map((step) => step.rank)).toEqual([2, 1]);
    expect(shown.manchePodium?.steps.map((step) => step.members.map((member) => member.name))).toEqual([
      ["Bob"],
      ["Alice"],
    ]);
    expect(winnerButton(admin).disabled).toBe(true);
    expect(winnerButton(admin).title).toBe("Le podium est déjà affiché");
    await releaseAdminScreens();

    const phone = await showAdminScreen(
      `/party/${party.id}/play`,
      () => hostOf(party, packs),
      () => playerOf(party, packs),
      { playerId: "bob" },
    );
    const phoneAlice = phone.querySelector('[data-rank="1"]');
    expect(phoneAlice?.textContent).toContain("Alice");
    expect(phone.querySelector('[data-rank="2"]')?.textContent).toContain("Bob");
    expect(phone.querySelector(".bz-podium")).not.toBeNull();
    await releaseAdminScreens();

    store.hostLaunchManche(party, secondId, "normal", true, packs);
    expect(party.mancheResultOpen).not.toBe(true);
    expect(party.winnerDisplay).toBeNull();
    expect(hostOf(party, packs).manchePodium).toBeUndefined();
    const next = await showAdminScreen(
      `/party/${party.id}/admin`,
      () => hostOf(party, packs),
      () => playerOf(party, packs),
      { hostToken: HOST_TOKEN },
    );
    expect(next.textContent).toContain("ENONCE_MANCHE_SUIVANTE");
    expect(winnerButton(next).disabled).toBe(false);
    expect(winnerButton(next).title).toBe("Afficher le podium");
  });
});

describe("partie absente du serveur", () => {
  it("écrit la phrase française sur Suivant et sur Question suivante, pas 404:NOT_FOUND", async () => {
    begin();
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
      score: 4,
      joinedAt: 1,
    });
    const pack = quiz(2, "pack-missing");
    const packs = new Map<string, QuizPack>([[pack.basename, pack]]);
    store.hostAppendManche(party, scriptItem(pack));
    store.adminSetWinnerScreenMode(party, "round");
    store.adminSetNextQuestionCountdownSec(party, 0);
    store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", true, packs);
    store.adminShowWinner(party);

    const respond = (request: AdminRequest): Response | null => {
      if (request.method !== "POST") return null;
      if (request.url.includes("/host/dismiss-winner") || request.url.includes("/host/cue/next")) {
        return httpError(404, "404:NOT_FOUND");
      }
      return null;
    };
    const admin = await showAdminScreen(
      `/party/${party.id}/admin`,
      () => hostOf(party, packs),
      () => playerOf(party, packs),
      { hostToken: HOST_TOKEN, respond },
    );
    const suivant = [...admin.querySelectorAll<HTMLButtonElement>(".bz-manche-moment button")].find(
      (button) => (button.textContent ?? "").trim() === "Suivant",
    );
    expect(suivant).toBeDefined();
    await act(async () => {
      suivant?.click();
    });
    await flushAdmin();
    expect(admin.querySelector(".bz-err")?.textContent).toBe(
      "Partie introuvable. Cette partie n'est plus sur le serveur.",
    );
    expect(admin.textContent).not.toContain("404:NOT_FOUND");

    const next = [...admin.querySelectorAll<HTMLButtonElement>(".bz-manche-moment button")].find((button) =>
      (button.textContent ?? "").includes("Question suivante"),
    );
    expect(next?.disabled).toBe(false);
    await act(async () => {
      next?.click();
    });
    await flushAdmin();
    expect(admin.querySelector(".bz-err")?.textContent).toBe(
      "Partie introuvable. Cette partie n'est plus sur le serveur.",
    );
    expect(admin.textContent).not.toContain("404:NOT_FOUND");
  });
});
