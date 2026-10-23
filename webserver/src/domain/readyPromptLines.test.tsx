// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { releaseRenderedScreens, showPartyScreen } from "./renderPartyScreen.js";
import { PartyStore } from "./store.js";
import type { Party, PartyPublicSnapshot } from "./types.js";

/**
 * * « Prêt ? » on the phone: the instruction and the ready count are two nodes.
 *   Overlap of those lines is left to Playwright.
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

function readyParty(markAlice: boolean): { party: Party; snap: PartyPublicSnapshot } {
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
    id: "pack-ready-lines",
    basename: "pack-ready-lines",
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
  if (markAlice) store.playerSetReady(party, "alice", true);
  return { party, snap: partySnapshotWithGame(party, packs, "player") };
}

function pair(container: HTMLElement): { caption: Element; count: Element } {
  const stack = container.querySelector(".bz-ready-stack");
  const caption = stack?.querySelector(".bz-buzz-caption");
  const count = stack?.querySelector(".bz-ready-count");
  expect(caption).not.toBeNull();
  expect(count).not.toBeNull();
  if (caption === null || count === null) throw new Error("ready lines missing");
  expect(caption.contains(count)).toBe(false);
  expect(count.contains(caption)).toBe(false);
  expect(caption.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  return { caption, count };
}

afterEach(async () => {
  await releaseRenderedScreens();
});

describe("consigne et compteur Prêt", () => {
  it("met la consigne avant le compteur, en orange comme en vert", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));

    const orangeParty = readyParty(false);
    const orange = await showPartyScreen(`/party/${orangeParty.party.id}/play`, orangeParty.snap);
    const orangeButton = orange.querySelector("button.bz-buzz-ready");
    expect(orangeButton?.classList.contains("is-ready")).toBe(false);
    expect(orangeButton?.textContent?.trim()).toBe("Prêt ?");
    const orangeLines = pair(orange);
    expect(orangeLines.caption.textContent?.trim()).toBe("Touchez quand vous êtes prêt");
    expect(orangeLines.count.textContent?.trim()).toBe("0 / 2 joueurs prêts");

    const greenParty = readyParty(true);
    const green = await showPartyScreen(`/party/${greenParty.party.id}/play`, greenParty.snap);
    const greenButton = green.querySelector("button.bz-buzz-ready");
    expect(greenButton?.classList.contains("is-ready")).toBe(true);
    expect(greenButton?.textContent?.trim()).toBe("Prêt !");
    const greenLines = pair(green);
    expect(greenLines.caption.textContent?.trim()).toBe("Touchez à nouveau pour annuler");
    expect(greenLines.count.textContent?.trim()).toBe("1 / 2 joueur prêt");
  });

  it.todo("Playwright");
});
