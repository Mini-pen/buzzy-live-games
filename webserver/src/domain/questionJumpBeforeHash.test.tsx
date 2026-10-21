// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import {
  adminRequests,
  flushAdmin,
  releaseAdminScreens,
  showAdminScreen,
  type AdminRequest,
} from "./renderAdminScreen.js";
import { PartyStore } from "./store.js";
import type { Party, PartyPublicSnapshot } from "./types.js";

/**
 * * `?question=70` is read before `#token`.
 *   Out-of-range values stay on the current question and surface the store's sentence.
 */

const TOKEN = "secret-host-token-jump";

const buzzCatalog: LoadedBuzzSoundCatalog = {
  defaultBuzzerKey: "good1",
  sounds: [
    { key: "good1", label: "Good", pool: "good", file: "buzzers/good1.mp3" },
    { key: "bad1", label: "Bad", pool: "bad", file: "buzzers/bad1.mp3" },
  ],
  byKey: new Map([
    ["good1", { key: "good1", label: "Good", pool: "good", file: "buzzers/good1.mp3" }],
  ]),
};

function errorParts(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : "Question invalide.";
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "BAD_QUESTION";
  return { code, message };
}

function partyWith(count: number): {
  store: PartyStore;
  party: Party;
  pack: QuizPack;
  packs: Map<string, QuizPack>;
  host: () => PartyPublicSnapshot;
  player: () => PartyPublicSnapshot;
} {
  const store = new PartyStore(() => {}, {
    ...buzzCatalog,
    sounds: [
      ...buzzCatalog.sounds,
      { key: "bad1", label: "Bad", pool: "bad", file: "buzzers/bad1.mp3" },
    ],
    byKey: new Map([
      ["good1", { key: "good1", label: "Good", pool: "good", file: "buzzers/good1.mp3" }],
      ["bad1", { key: "bad1", label: "Bad", pool: "bad", file: "buzzers/bad1.mp3" }],
    ]),
  });
  const party = store.createParty({
    maxPlayers: null,
    maxTeams: null,
    closedAfterStart: false,
    allowRename: true,
    allowTeamChange: true,
  });
  const pack: QuizPack = {
    id: `pack-jump-${count}`,
    basename: `pack-jump-${count}`,
    title: "Pack",
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
  store.adminSetNextQuestionCountdownSec(party, 0);
  store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", true, packs);
  return {
    store,
    party,
    pack,
    packs,
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

async function openJump(rawQuestion: string, count: number): Promise<{ page: HTMLElement; store: PartyStore; party: Party; pack: QuizPack }> {
  const scene = partyWith(count);
  const id = scene.party.id.toLowerCase();
  localStorage.clear();
  window.location.hash = `#token=${TOKEN}`;
  window.history.replaceState(null, "", `/party/${id}/admin?question=${rawQuestion}#token=${TOKEN}`);
  const respond = (request: AdminRequest): Response | null => {
    if (request.method !== "POST" || !request.url.includes("/host/jump-question")) return null;
    const body = JSON.parse(request.body) as { question?: number };
    try {
      scene.store.adminJumpToQuestion(scene.party, scene.pack, body.question ?? Number.NaN);
      return null;
    } catch (error: unknown) {
      const parts = errorParts(error);
      return new Response(JSON.stringify({ error: parts.code, message: parts.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
  const page = await showAdminScreen(
    `/party/${id}/admin?question=${encodeURIComponent(rawQuestion)}#token=${TOKEN}`,
    scene.host,
    scene.player,
    { hostToken: false, settleOnTokenWall: true, respond },
  );
  for (let i = 0; i < 6; i += 1) await flushAdmin();
  return { page, store: scene.store, party: scene.party, pack: scene.pack };
}

describe("?question avant #token", () => {
  it("saute à la question 70 demandée dans la query, le jeton restant dans le fragment", async () => {
    begin();
    const { page, party } = await openJump("70", 70);
    expect(page.querySelector(".bz-host-controls")).not.toBeNull();
    expect(page.textContent).not.toContain("Jeton animateur absent ou lien incomplet");
    expect(window.location.hash).toContain(`token=${TOKEN}`);
    expect(page.textContent).toContain("ENONCE_70");
    expect(party.currentQuestionIndex).toBe(69);
    const jump = adminRequests.find((request) => request.url.includes("/host/jump-question"));
    expect(jump?.body).toContain('"question":70');
    expect(adminRequests.map((request) => request.url).some((url) => url.includes(TOKEN) || url.includes("token="))).toBe(
      false,
    );
  });

  it("laisse la question en cours pour une valeur hors bornes ou illisible", async () => {
    begin();
    const tooFar = await openJump("99", 2);
    expect(tooFar.page.textContent).toContain("ENONCE_1");
    expect(tooFar.page.textContent).not.toContain("ENONCE_2");
    expect(tooFar.page.querySelector(".bz-err")?.textContent).toContain("Cette manche n'a que 2 questions.");
    expect(tooFar.party.currentQuestionIndex).toBe(0);
    await releaseAdminScreens();

    const zero = await openJump("0", 2);
    expect(zero.page.querySelector(".bz-err")?.textContent).toContain("Numéro de question invalide.");
    expect(zero.party.currentQuestionIndex).toBe(0);
    expect(zero.page.textContent).toContain("ENONCE_1");
    await releaseAdminScreens();

    const negative = await openJump("-4", 2);
    expect(negative.page.querySelector(".bz-err")?.textContent).toContain("Numéro de question invalide.");
    expect(negative.party.currentQuestionIndex).toBe(0);
    await releaseAdminScreens();

    const word = await openJump("abc", 2);
    expect(word.page.textContent).toContain("ENONCE_1");
    expect(word.page.querySelector(".bz-err")).toBeNull();
    expect(word.party.currentQuestionIndex).toBe(0);
    expect(adminRequests.some((request) => request.url.includes("/host/jump-question"))).toBe(false);
  });
});
