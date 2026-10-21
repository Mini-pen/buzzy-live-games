// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { adminRequests, releaseAdminScreens, showAdminScreen } from "./renderAdminScreen.js";
import { PartyStore } from "./store.js";
import type { Party, PartyPublicSnapshot } from "./types.js";

/**
 * * CDC §2.5 and CA-48.
 *   One localStorage entry per party. The broadcast and the phone never show the token
 *   and never receive it in a query string. A reload with only that entry keeps the host in control.
 */

const TOKEN_A = "secret-host-token-party-a";
const TOKEN_B = "secret-host-token-party-b";

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

function launched(prompt: string): { party: Party; host: () => PartyPublicSnapshot; player: () => PartyPublicSnapshot } {
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
    score: 1,
    joinedAt: 1,
  });
  const pack: QuizPack = {
    id: `pack-${prompt}`,
    basename: `pack-${prompt}`,
    title: "Pack",
    rounds: [{ title: "Manche", questions: [{ prompt, choices: ["A", "B"], correctIndex: 0, points: 1 }] }],
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

function tokenKey(partyId: string): string {
  return `partygames:hostToken:${partyId.toLowerCase()}`;
}

function begin(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
}

function urlsLeak(token: string): string[] {
  return adminRequests
    .map((request) => request.url)
    .filter((url) => url.includes(token) || url.includes("token="));
}

afterEach(async () => {
  await releaseAdminScreens();
  vi.useRealTimers();
});

describe("jeton animateur hors de l'adresse", () => {
  it("range une entrée localStorage par partie, jamais dans sessionStorage", async () => {
    begin();
    const first = launched("ENONCE_PARTIE_A");
    const second = launched("ENONCE_PARTIE_B");
    const idA = first.party.id.toLowerCase();
    const idB = second.party.id.toLowerCase();
    window.location.hash = `#token=${TOKEN_A}`;
    const pageA = await showAdminScreen(`/party/${idA}/admin`, first.host, first.player, {
      hostToken: false,
      settleOnTokenWall: true,
    });
    expect(pageA.querySelector(".bz-host-controls")).not.toBeNull();
    expect(localStorage.getItem(tokenKey(idA))).toBe(TOKEN_A);
    expect(urlsLeak(TOKEN_A)).toEqual([]);
    expect(adminRequests.some((request) => request.authorization === `Bearer ${TOKEN_A}`)).toBe(true);
    await releaseAdminScreens({ keepStorage: true, keepHash: true });

    window.location.hash = `#token=${TOKEN_B}`;
    const pageB = await showAdminScreen(`/party/${idB}/admin`, second.host, second.player, {
      hostToken: false,
      settleOnTokenWall: true,
    });
    expect(pageB.querySelector(".bz-host-controls")).not.toBeNull();
    expect(localStorage.getItem(tokenKey(idA))).toBe(TOKEN_A);
    expect(localStorage.getItem(tokenKey(idB))).toBe(TOKEN_B);
    const stored = [...Array(localStorage.length).keys()]
      .map((index) => localStorage.key(index))
      .filter((key): key is string => key !== null && key.startsWith("partygames:hostToken:"));
    expect(stored.sort()).toEqual([tokenKey(idA), tokenKey(idB)].sort());
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i) ?? "";
      expect(key.startsWith("partygames:adminToken:")).toBe(false);
      expect(sessionStorage.getItem(key)).not.toContain(TOKEN_A);
      expect(sessionStorage.getItem(key)).not.toContain(TOKEN_B);
    }
  });

  it("n'apparaît ni dans le rendu ni dans le snapshot de la diffusion ou du téléphone", async () => {
    begin();
    const { party, host, player } = launched("ENONCE_PUBLIC");
    const id = party.id.toLowerCase();
    localStorage.setItem(tokenKey(id), TOKEN_A);
    expect(JSON.stringify(player())).not.toContain(TOKEN_A);
    expect(JSON.stringify(host())).not.toContain(TOKEN_A);

    window.location.hash = "";
    const broadcast = await showAdminScreen(`/party/${id}/broadcast`, host, player, { hostToken: false });
    expect(broadcast.innerHTML).not.toContain(TOKEN_A);
    expect(broadcast.innerHTML).not.toContain("token=");
    expect(broadcast.textContent).toContain("retour tableau");
    expect(urlsLeak(TOKEN_A)).toEqual([]);
    await releaseAdminScreens({ keepStorage: true });

    const phone = await showAdminScreen(`/party/${id}/play`, host, player, {
      hostToken: false,
      playerId: "alice",
    });
    expect(phone.innerHTML).not.toContain(TOKEN_A);
    expect(phone.innerHTML).not.toContain("token=");
    expect(phone.textContent).toContain("ENONCE_PUBLIC");
    expect(urlsLeak(TOKEN_A)).toEqual([]);
  });

  it("au rechargement sans #token, le localStorage de cette partie suffit à garder la main", async () => {
    begin();
    const { party, host, player } = launched("ENONCE_RELOAD");
    const id = party.id.toLowerCase();
    // * A previous visit stored the token. This load is a reload: the address has no fragment.
    localStorage.setItem(tokenKey(id), TOKEN_A);
    window.location.hash = "";
    window.history.replaceState(null, "", `/party/${id}/admin`);
    const page = await showAdminScreen(`/party/${id}/admin`, host, player, {
      hostToken: false,
      settleOnTokenWall: true,
    });
    expect(page.textContent).not.toContain("Jeton animateur absent ou lien incomplet");
    expect(page.querySelector(".bz-host-controls")).not.toBeNull();
    expect(page.textContent).toContain("ENONCE_RELOAD");
    expect(localStorage.getItem(tokenKey(id))).toBe(TOKEN_A);
    expect(urlsLeak(TOKEN_A)).toEqual([]);
    expect(adminRequests.some((request) => request.authorization === `Bearer ${TOKEN_A}`)).toBe(true);
    expect(window.location.hash.includes("token=")).toBe(false);
  });
});
