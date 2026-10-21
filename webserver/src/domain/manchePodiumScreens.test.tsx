// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManchePodiumView } from "../../client/src/manchePodiumView";
import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { buildManchePodium } from "./manchePodium.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { releaseRenderedScreens, settleScreen, showPartyScreen } from "./renderPartyScreen.js";
import { PartyStore } from "./store.js";
import type { Party, PartyPublicSnapshot } from "./types.js";

/**
 * * Phone and broadcast podium (CA-73, 8159db8).
 *   Ranking rules already locked in manchePodium.test.ts are not repeated.
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

interface RosterPlayer {
  id: string;
  name: string;
  score: number;
  teamId: number | null;
}

function packWith(prompt: string): QuizPack {
  return {
    id: "pack-podium-ui",
    basename: "pack-podium-ui",
    title: "Pack",
    rounds: [{ title: "Manche", questions: [{ prompt, choices: ["A", "B"], correctIndex: 0, points: 1 }] }],
  };
}

function isRoundExhausted(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "ROUND_EXHAUSTED";
}

function endedParty(options: {
  players: RosterPlayer[];
  maxTeams: number | null;
  winnerMode: "question" | "round";
  prompt: string;
}): { party: Party; packs: Map<string, QuizPack>; store: PartyStore } {
  const store = new PartyStore(() => {}, buzzCatalog);
  const party = store.createParty({
    maxPlayers: null,
    maxTeams: options.maxTeams,
    closedAfterStart: false,
    allowRename: true,
    allowTeamChange: true,
  });
  for (const player of options.players) {
    party.players.set(player.id, {
      id: player.id,
      displayName: player.name,
      avatarKey: "a.png",
      buzzSoundKey: "good1",
      teamId: player.teamId,
      score: player.score,
      joinedAt: 1,
    });
  }
  const pack = packWith(options.prompt);
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
  store.adminSetWinnerScreenMode(party, options.winnerMode);
  store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", true, packs);
  try {
    store.adminAdvanceCue(party, pack);
  } catch (error: unknown) {
    if (!isRoundExhausted(error)) throw error;
  }
  return { party, packs, store };
}

function snapOf(party: Party, packs: Map<string, QuizPack>): PartyPublicSnapshot {
  return partySnapshotWithGame(party, packs, "player");
}

function stepRanks(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".bz-podium-step")].map((step) => step.getAttribute("data-rank") ?? "");
}

function begin(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
}

afterEach(async () => {
  await releaseRenderedScreens();
});

describe("podium on the phone and the broadcast", () => {
  it("montre un podium à 3 places à la place de l'écran noir, jusqu'à l'animateur", async () => {
    begin();
    const prompt = "QUESTION_PODIUM_TROIS";
    const { party, packs, store } = endedParty({
      players: [
        { id: "alice", name: "Alice", score: 30, teamId: null },
        { id: "bob", name: "Bob", score: 20, teamId: null },
        { id: "chloe", name: "Chloe", score: 10, teamId: null },
      ],
      maxTeams: null,
      winnerMode: "round",
      prompt,
    });
    expect(party.state).toBe("round_active");
    expect(party.mancheResultOpen).toBe(true);
    expect(party.winnerDisplay).not.toBeNull();
    const snap = snapOf(party, packs);
    expect(snap.manchePodium?.steps.map((step) => step.rank)).toEqual([2, 1, 3]);

    for (const route of [`/party/${party.id}/broadcast`, `/party/${party.id}/play`] as const) {
      const screen = await showPartyScreen(route, snap);
      expect(stepRanks(screen)).toEqual(["2", "1", "3"]);
      expect(screen.textContent).toContain("Alice");
      expect(screen.textContent).toContain("30 points");
      expect(screen.textContent).toContain("Bob");
      expect(screen.textContent).toContain("Chloe");
      expect(screen.textContent).toContain("Fin de la manche");
      expect(screen.textContent).toContain("En attente de l'animateur");
      expect(screen.querySelector(".bz-winner-screen")).toBeNull();
      expect(screen.textContent).not.toContain(prompt);
      await settleScreen(120_000);
      expect(screen.querySelector(".bz-podium")).not.toBeNull();
      expect(screen.querySelector(".bz-winner-screen")).toBeNull();
    }

    store.adminDismissWinnerScreen(party);
    expect(party.mancheResultOpen).toBe(false);
    const after = snapOf(party, packs);
    const phone = await showPartyScreen(`/party/${party.id}/play`, after);
    const broadcast = await showPartyScreen(`/party/${party.id}/broadcast`, after);
    expect(phone.querySelector(".bz-podium")).toBeNull();
    expect(broadcast.querySelector(".bz-podium")).toBeNull();
    expect(phone.querySelector(".bz-winner-screen")).toBeNull();
    expect(broadcast.querySelector(".bz-winner-screen")).toBeNull();
    expect(phone.textContent).toContain(prompt);
    expect(broadcast.textContent).toContain(prompt);
  });

  it("masque les marches vides pour 1 et 2 joueurs, sur les deux écrans", async () => {
    begin();
    const one = endedParty({
      players: [{ id: "alice", name: "Alice", score: 4, teamId: null }],
      maxTeams: null,
      winnerMode: "question",
      prompt: "Q_UN",
    });
    const oneSnap = snapOf(one.party, one.packs);
    const onePhone = await showPartyScreen(`/party/${one.party.id}/play`, oneSnap);
    const oneBroadcast = await showPartyScreen(`/party/${one.party.id}/broadcast`, oneSnap);
    expect(stepRanks(onePhone)).toEqual(["1"]);
    expect(stepRanks(oneBroadcast)).toEqual(["1"]);
    expect(onePhone.textContent).toContain("4 points");
    expect(oneBroadcast.querySelector(".bz-winner-screen")).toBeNull();

    const two = endedParty({
      players: [
        { id: "alice", name: "Alice", score: 4, teamId: null },
        { id: "bob", name: "Bob", score: 2, teamId: null },
      ],
      maxTeams: null,
      winnerMode: "question",
      prompt: "Q_DEUX",
    });
    const twoSnap = snapOf(two.party, two.packs);
    const twoPhone = await showPartyScreen(`/party/${two.party.id}/play`, twoSnap);
    const twoBroadcast = await showPartyScreen(`/party/${two.party.id}/broadcast`, twoSnap);
    expect(stepRanks(twoPhone)).toEqual(["2", "1"]);
    expect(stepRanks(twoBroadcast)).toEqual(["2", "1"]);
    expect(twoPhone.querySelector('[data-rank="3"]')).toBeNull();
    expect(twoBroadcast.querySelector(".bz-winner-screen")).toBeNull();
  });

  it("affiche le podium sans joueur et quand personne n'a de point", async () => {
    begin();
    const empty = endedParty({
      players: [],
      maxTeams: null,
      winnerMode: "question",
      prompt: "Q_VIDE",
    });
    expect(empty.party.players.size).toBe(0);
    const emptySnap = snapOf(empty.party, empty.packs);
    expect(emptySnap.manchePodium?.participantCount).toBe(0);
    expect(emptySnap.manchePodium?.steps).toEqual([]);
    const emptyBroadcast = await showPartyScreen(`/party/${empty.party.id}/broadcast`, emptySnap);
    const emptyPhone = await showPartyScreen(`/party/${empty.party.id}/play`, emptySnap);
    for (const screen of [emptyBroadcast, emptyPhone]) {
      expect(screen.querySelector(".bz-podium")).not.toBeNull();
      expect(screen.textContent).toContain("Fin de la manche");
      expect(screen.textContent).toContain("0 joueurs");
      expect(stepRanks(screen)).toEqual([]);
      expect(screen.querySelector(".bz-winner-screen")).toBeNull();
    }

    const zeroes = endedParty({
      players: [
        { id: "alice", name: "Alice", score: 0, teamId: null },
        { id: "bob", name: "Bob", score: 0, teamId: null },
      ],
      maxTeams: null,
      winnerMode: "question",
      prompt: "Q_ZERO",
    });
    const zeroSnap = snapOf(zeroes.party, zeroes.packs);
    const zeroPhone = await showPartyScreen(`/party/${zeroes.party.id}/play`, zeroSnap);
    const zeroBroadcast = await showPartyScreen(`/party/${zeroes.party.id}/broadcast`, zeroSnap);
    for (const screen of [zeroPhone, zeroBroadcast]) {
      expect(screen.textContent).toContain("0 points");
      expect(screen.textContent).toContain("Ex æquo");
      expect(screen.querySelector(".bz-winner-screen")).toBeNull();
      expect(stepRanks(screen)).toEqual(["1"]);
    }
  });

  it("garde sur les deux écrans la place et les points d'un joueur marqué déconnecté", async () => {
    begin();
    const podium = buildManchePodium({
      players: [
        { id: "alice", displayName: "Alice", score: 9, teamId: null, connected: false },
        { id: "bob", displayName: "Bob", score: 4, teamId: null, connected: true },
      ],
      maxTeams: null,
      mancheNumber: 1,
      questionCount: 1,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <>
          <ManchePodiumView podium={podium} surface="broadcast" />
          <ManchePodiumView podium={podium} surface="phone" playerId="alice" />
        </>,
      );
    });
    const screens = [...container.querySelectorAll(".bz-podium")];
    expect(screens).toHaveLength(2);
    for (const screen of screens) {
      expect(screen.textContent).toContain("Alice");
      expect(screen.textContent).toContain("9 points");
    }
    const phone = container.querySelector(".bz-podium--phone");
    expect(phone?.textContent).toContain("Votre place");
    expect(phone?.textContent).toContain("1er sur 2");
    await act(async () => {
      root.unmount();
    });
  });

  it("montre au joueur hors podium sa place et son score sur le téléphone", async () => {
    begin();
    const { party, packs } = endedParty({
      players: [
        { id: "alice", name: "Alice", score: 40, teamId: null },
        { id: "bob", name: "Bob", score: 30, teamId: null },
        { id: "chloe", name: "Chloe", score: 20, teamId: null },
        { id: "dave", name: "Dave", score: 5, teamId: null },
      ],
      maxTeams: null,
      winnerMode: "question",
      prompt: "Q_HORS",
    });
    const snap = snapOf(party, packs);
    const phone = await showPartyScreen(`/party/${party.id}/play`, snap, "dave");
    const card = phone.querySelector(".bz-podium-you");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Votre place");
    expect(card?.textContent).toContain("4e sur 4");
    expect(card?.textContent).toContain("Vous");
    expect(card?.textContent).toContain("5 pts");
    expect(stepRanks(phone)).toEqual(["2", "1", "3"]);
    expect(phone.querySelector('[data-rank="1"]')?.textContent).not.toContain("Dave");
    const broadcast = await showPartyScreen(`/party/${party.id}/broadcast`, snap);
    expect(broadcast.textContent).toContain("Dave");
    expect(broadcast.textContent).toContain("5 pts");
    expect(broadcast.querySelector(".bz-podium-you")).toBeNull();
  });

  it("classe les équipes et donne l'apport et le meilleur joueur sur le téléphone", async () => {
    begin();
    const { party, packs } = endedParty({
      players: [
        { id: "alice", name: "Alice", score: 8, teamId: 1 },
        { id: "bob", name: "Bob", score: 3, teamId: 1 },
        { id: "chloe", name: "Chloe", score: 5, teamId: 2 },
      ],
      maxTeams: 2,
      winnerMode: "question",
      prompt: "Q_EQUIPE",
    });
    const snap = snapOf(party, packs);
    expect(snap.manchePodium?.kind).toBe("teams");
    const teamOne = snap.manchePodium?.ranked.find((row) => row.name === "Équipe 1");
    expect(teamOne?.memberCount).toBe(2);
    expect(teamOne?.score).toBe(11);

    const broadcast = await showPartyScreen(`/party/${party.id}/broadcast`, snap);
    expect(broadcast.textContent).toContain("Équipe 1");
    expect(broadcast.textContent).toContain("Équipe 2");
    expect(broadcast.textContent).toContain("11 points");
    const winningStep = broadcast.querySelector('[data-rank="1"]');
    expect(winningStep?.textContent).toContain("Équipe 1");
    expect(winningStep?.textContent).not.toMatch(/\d+\s+joueurs/);

    const phone = await showPartyScreen(`/party/${party.id}/play`, snap, "bob");
    const card = phone.querySelector(".bz-podium-you");
    expect(card?.textContent).toContain("Votre équipe : Équipe 1");
    expect(card?.textContent).toContain("Votre apport : 3 points");
    expect(card?.textContent).toContain("Meilleur joueur : Alice");
    expect(card?.textContent).toContain("1re sur 2");
  });
});
