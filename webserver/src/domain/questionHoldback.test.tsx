// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../../client/src/App";
import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { READY_PHASE_TAGLINES } from "./readyPhaseTaglines.js";
import { phoneQuizAnswerFrame } from "./playLayout.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { PartyStore } from "./store.js";
import type { Party, PartyPublicSnapshot } from "./types.js";

/**
 * * The next question stays off every screen until the countdowns that already have a rule are over.
 *   « Prêt ? » shows neither question. The next question appears only when the buzzer opens.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const socketBox = vi.hoisted(() => {
  const sockets: Array<Record<string, (payload: unknown) => void>> = [];
  return { sockets };
});

vi.mock("socket.io-client", () => ({
  io: () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    socketBox.sockets.push(handlers);
    return {
      on: (event: string, cb: (payload: unknown) => void) => {
        handlers[event] = cb;
      },
      off: (event: string) => {
        delete handlers[event];
      },
      disconnect: () => undefined,
      emit: () => undefined,
    };
  },
}));

function emitSocket(event: string, payload: unknown): void {
  const found = [...socketBox.sockets].reverse().find((handlers) => typeof handlers[event] === "function");
  found?.[event]?.(payload);
}

const PREV_PROMPT = "ENONCE_DEJA_JOUE";
const PREV_A = "REPONSE_DEJA_A";
const PREV_B = "REPONSE_DEJA_B";
const NEXT_PROMPT = "ENONCE_SUIVANT";
const NEXT_A = "REPONSE_SUIVANTE_A";
const NEXT_B = "REPONSE_SUIVANTE_B";
const QUESTION_TOKENS = [PREV_PROMPT, PREV_A, PREV_B, NEXT_PROMPT, NEXT_A, NEXT_B];

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

interface HoldOptions {
  questions: 1 | 2;
  points: number;
  pauseSec: number;
  buzzerSec: number;
  ready: boolean;
  maxTeams: number | null;
  teamId: number | null;
  winnerMode: "question" | "round";
  players: 1 | 2;
}

interface ScreenSnaps {
  player: PartyPublicSnapshot;
  host: PartyPublicSnapshot;
}

const roots: Root[] = [];
const renderErrors: unknown[] = [];

function holdPack(opts: HoldOptions): QuizPack {
  const questions = [
    {
      prompt: PREV_PROMPT,
      choices: [PREV_A, PREV_B],
      correctIndex: 0,
      points: opts.points,
    },
  ];
  if (opts.questions === 2) {
    questions.push({
      prompt: NEXT_PROMPT,
      choices: [NEXT_A, NEXT_B],
      correctIndex: 1,
      points: 10,
    });
  }
  return {
    id: "pack-hold",
    basename: "pack-hold",
    title: "Pack",
    rounds: [{ title: "Manche", questions }],
  };
}

function addPlayer(party: Party, id: string, name: string, teamId: number | null): void {
  party.players.set(id, {
    id,
    displayName: name,
    avatarKey: "a.png",
    buzzSoundKey: "good1",
    teamId,
    score: teamId === 2 ? 4 : 10,
    joinedAt: 1,
  });
}

function answeredParty(opts: HoldOptions, stopBeforePlay = false): {
  store: PartyStore;
  party: Party;
  quiz: QuizPack;
  packs: Map<string, QuizPack>;
} {
  const store = new PartyStore(() => {}, buzzCatalog);
  const party = store.createParty({
    maxPlayers: null,
    maxTeams: opts.maxTeams,
    closedAfterStart: false,
    allowRename: true,
    allowTeamChange: true,
  });
  addPlayer(party, "alice", "Alice", opts.teamId);
  if (opts.players === 2) addPlayer(party, "bob", "Bob", opts.teamId === null ? null : 2);
  const quiz = holdPack(opts);
  const packs = new Map<string, QuizPack>([[quiz.basename, quiz]]);
  store.hostAppendManche(party, {
    kind: "pack_quiz",
    title: quiz.title,
    packBasename: quiz.basename,
    iframeUrl: null,
    youtubeEmbedUrl: null,
    directVideoUrl: null,
    savedRoundIndex: 0,
    savedQuestionIndex: 0,
    transitionKind: null,
    transitionDurationMs: null,
  });
  store.adminSetNextQuestionCountdownSec(party, opts.pauseSec);
  store.adminSetCountdownDuration(party, opts.buzzerSec);
  store.adminSetWinnerScreenMode(party, opts.winnerMode);
  if (opts.ready) store.adminSetReadyCheckEnabled(party, true, quiz);
  store.hostLaunchManche(party, party.mancheScript[0]!.id, "autonomous", true, packs);
  if (stopBeforePlay) return { store, party, quiz, packs };
  if (opts.ready) {
    store.playerSetReady(party, "alice", true);
    if (opts.players === 2) store.playerSetReady(party, "bob", true);
  }
  store.adminSetBuzzGraceWindow(party, 0);
  const choice = { choicesLen: 2, choiceIndex: 0 };
  store.buzz(party, "alice", Date.now(), choice);
  if (opts.players === 2) store.buzz(party, "bob", Date.now(), choice);
  store.maybeFinalizeBuzzDecision(party);
  store.maybeAutoResolveQuizWhenEveryPlayerBuzzed(party, quiz);
  return { store, party, quiz, packs };
}

const pauseOpts: HoldOptions = {
  questions: 2,
  points: 10,
  pauseSec: 5,
  buzzerSec: 0,
  ready: true,
  maxTeams: null,
  teamId: null,
  winnerMode: "question",
  players: 2,
};

function launchNormalQuiz(questions: 1 | 2): {
  party: Party;
  quiz: QuizPack;
  snaps: ScreenSnaps;
} {
  const store = new PartyStore(() => {}, buzzCatalog);
  const party = store.createParty({
    maxPlayers: null,
    maxTeams: null,
    closedAfterStart: false,
    allowRename: true,
    allowTeamChange: true,
  });
  addPlayer(party, "alice", "Alice", null);
  const quiz = holdPack({ ...pauseOpts, questions, ready: false, players: 1 });
  const packs = new Map<string, QuizPack>([[quiz.basename, quiz]]);
  store.hostAppendManche(party, {
    kind: "pack_quiz",
    title: quiz.title,
    packBasename: quiz.basename,
    iframeUrl: null,
    youtubeEmbedUrl: null,
    directVideoUrl: null,
    savedRoundIndex: 0,
    savedQuestionIndex: 0,
    transitionKind: null,
    transitionDurationMs: null,
  });
  store.adminSetNextQuestionCountdownSec(party, 0);
  store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", false, packs);
  return { party, quiz, snaps: snapsOf(party, packs) };
}

function cueAdvanceButton(root: ParentNode): HTMLButtonElement | null {
  return (
    [...root.querySelectorAll<HTMLButtonElement>(".bz-manche-moment button")].find((button) =>
      (button.textContent ?? "").includes("Question suivante"),
    ) ?? null
  );
}

function setNativeValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const tracker = (input as HTMLInputElement & { _valueTracker?: { setValue: (next: string) => void } })
    ._valueTracker;
  tracker?.setValue("");
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function snapsOf(party: Party, packs: Map<string, QuizPack>): ScreenSnaps {
  return {
    player: partySnapshotWithGame(party, packs, "player"),
    host: partySnapshotWithGame(party, packs, "host"),
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const recordedPosts: Array<{ url: string; body: string }> = [];

function installMissingPartyFetch(): void {
  vi.stubGlobal(
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      let body: unknown = {};
      if (url.includes("/api/parties/") && (init?.method === undefined || init.method === "GET")) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "NOT_FOUND", message: "NOT_FOUND" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/me/time-sync")) body = { clientTimestamp: 0, serverTimestamp: Date.now() };
      else if (url.includes("/api/sounds")) body = { defaultBuzzerKey: "good1", sounds: [] };
      else if (url.includes("/api/packs")) body = { packs: [] };
      else if (url.includes("/api/avatars")) body = { avatars: [] };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  );
}

function installFetch(snaps: ScreenSnaps): void {
  vi.stubGlobal(
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (init?.method === "POST") {
        recordedPosts.push({ url, body: typeof init.body === "string" ? init.body : "" });
      }
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      let body: unknown = {};
      if (url.includes("/me/time-sync")) {
        body = { clientTimestamp: 0, serverTimestamp: Date.now() };
      } else if (url.includes("/api/sounds")) {
        body = { defaultBuzzerKey: "good1", sounds: [] };
      } else if (url.includes("/api/packs")) {
        body = { packs: [] };
      } else if (url.includes("/api/avatars")) {
        body = { avatars: [] };
      } else if (url.includes("/api/parties/")) {
        body = auth.toLowerCase().startsWith("bearer ") ? snaps.host : snaps.player;
      }
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  );
}

function rememberPlayer(partyId: string, playerId = "alice"): void {
  const body = btoa(JSON.stringify({ sub: playerId }));
  sessionStorage.setItem(`partygames:playerJwt:${partyId}`, `e.${body}.s`);
}

function rememberHost(partyId: string): void {
  localStorage.setItem(`partygames:hostToken:${partyId}`, "host-token");
}

function beginClock(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
}

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function settle(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function screenReady(container: HTMLElement, route: string): boolean {
  const text = container.textContent ?? "";
  if (text.includes("Partie indisponible") || text.includes("Partie introuvable")) return false;
  if (route.includes("/broadcast")) {
    return container.querySelector(".bz-bc-prompt, .bz-bc-end, .bz-point-modal, .bz-winner-screen, .bz-podium") !== null;
  }
  if (route.includes("/admin")) return container.querySelector(".bz-board, .bz-projected-card") !== null;
  return container.querySelector(".bz-buzz-btn, .bz-buzz-closed, .bz-board, .bz-winner-screen, .bz-podium") !== null;
}

async function show(
  route: string,
  snaps: ScreenSnaps,
  playerId = "alice",
  options?: { seedHostToken?: boolean; allowUnavailable?: boolean; partyMissing?: boolean },
): Promise<HTMLElement> {
  if (options?.partyMissing === true) installMissingPartyFetch();
  else installFetch(snaps);
  if (route.includes("/play")) rememberPlayer(snaps.player.id, playerId);
  if (route.includes("/admin") && options?.seedHostToken !== false) rememberHost(snaps.host.id);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container, {
    onUncaughtError: (error: unknown) => {
      renderErrors.push(error);
    },
  });
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 8; i += 1) {
    await flush();
    if (options?.allowUnavailable === true) {
      const text = container.textContent ?? "";
      if (
        text.includes("Partie introuvable") ||
        text.includes("Jeton animateur absent") ||
        text.includes("Partie indisponible")
      ) {
        return container;
      }
    }
    if (screenReady(container, route)) {
      if (renderErrors.length > 0) throw renderErrors[0];
      return container;
    }
  }
  throw new Error(`screen did not leave loading on ${route}: ${(container.textContent ?? "").slice(0, 240)}`);
}

async function textsOf(snaps: ScreenSnaps): Promise<Record<"player" | "broadcast" | "host", string>> {
  const id = snaps.player.id;
  const routes = {
    player: `/party/${id}/play`,
    broadcast: `/party/${id}/broadcast`,
    host: `/party/${id}/admin`,
  } as const;
  const out = { player: "", broadcast: "", host: "" };
  for (const key of ["player", "broadcast", "host"] as const) {
    const container = await show(routes[key], snaps);
    out[key] = container.textContent ?? "";
  }
  return out;
}

function leakedNext(raw: string): string[] {
  return [NEXT_PROMPT, NEXT_A, NEXT_B].filter((token) => raw.includes(token));
}

function pauseScene(): { party: Party; quiz: QuizPack; snaps: ScreenSnaps } {
  const { party, quiz, packs } = answeredParty(pauseOpts);
  return { party, quiz, snaps: snapsOf(party, packs) };
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  renderErrors.length = 0;
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  socketBox.sockets.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("question holdback payloads", () => {
  it("starts the between-question pause after every connected player has answered", () => {
    const { party } = answeredParty(pauseOpts);
    expect(party.nextQuestionCountdownStartedAt).not.toBeNull();
    expect(party.pointAward).not.toBeNull();
    expect(party.pointAward?.points).toBe(10);
    expect(party.appliedNextQuestionCountdownSec).toBe(5);
    expect(party.readyPhaseStartedAt).toBeNull();
    expect(party.buzzWindowOpen).toBe(false);
  });

  it("opens « Prêt ? » only after that pause when the ready check is on", () => {
    const { store, party, quiz } = answeredParty(pauseOpts);
    const startedAt = party.nextQuestionCountdownStartedAt ?? 0;
    expect(store.maybeFinishNextQuestionCountdown(party, quiz, startedAt + 4_999)).toBe(false);
    expect(store.maybeFinishNextQuestionCountdown(party, quiz, startedAt + 5_000)).toBe(true);
    expect(party.readyPhaseStartedAt).not.toBeNull();
    expect(party.nextQuestionCountdownStartedAt).toBeNull();
    expect(party.countdownStartedAt).toBeNull();
    expect(party.buzzWindowOpen).toBe(false);
  });

  it("keeps the question just played, and omits the next one, in both snapshots during the pause", () => {
    const { snaps } = pauseScene();
    for (const snap of [snaps.player, snaps.host]) {
      const raw = JSON.stringify(snap);
      expect(raw).toContain(PREV_PROMPT);
      expect(raw).toContain(PREV_A);
      expect(raw).toContain(PREV_B);
      expect(leakedNext(raw)).toEqual([]);
    }
  });

  it("omits the next question from both snapshots during « Prêt ? »", () => {
    const { store, party, quiz, packs } = answeredParty(pauseOpts);
    const startedAt = party.nextQuestionCountdownStartedAt ?? 0;
    store.maybeFinishNextQuestionCountdown(party, quiz, startedAt + 5_000);
    const snaps = snapsOf(party, packs);
    for (const snap of [snaps.player, snaps.host]) {
      expect(leakedNext(JSON.stringify(snap))).toEqual([]);
    }
  });

  it("remplace la question par une phrase humoristique pendant « Prêt ? »", async () => {
    beginClock();
    const { store, party, quiz, packs } = answeredParty(pauseOpts);
    const startedAt = party.nextQuestionCountdownStartedAt ?? 0;
    store.maybeFinishNextQuestionCountdown(party, quiz, startedAt + 5_000);
    const tagline = party.readyPhaseTagline ?? "";
    expect(READY_PHASE_TAGLINES).toContain(tagline);
    const snaps = snapsOf(party, packs);
    for (const snap of [snaps.player, snaps.host]) {
      expect(snap.gameBoard?.kind).toBe("ready_hold");
      expect(JSON.stringify(snap)).toContain(tagline);
      expect(leakedNext(JSON.stringify(snap))).toEqual([]);
      for (const token of [PREV_PROMPT, PREV_A, PREV_B]) {
        expect(JSON.stringify(snap)).not.toContain(token);
      }
    }
    const texts = await textsOf(snaps);
    for (const text of Object.values(texts)) {
      expect(text).toContain(tagline);
      for (const token of QUESTION_TOKENS) expect(text).not.toContain(token);
    }
  });

  it("cache la question suivante pendant le décompte du buzzer et l'affiche à l'ouverture", async () => {
    beginClock();
    const { store, party, quiz, packs } = answeredParty({ ...pauseOpts, buzzerSec: 5 }, true);
    store.playerSetReady(party, "alice", true);
    store.playerSetReady(party, "bob", true);
    const firstCountdown = party.countdownStartedAt ?? 0;
    expect(firstCountdown).not.toBe(0);
    vi.setSystemTime(firstCountdown + 5_000);
    expect(store.maybeOpenBuzzAfterCountdown(party)).toBe(true);
    store.adminSetBuzzGraceWindow(party, 0);
    const choice = { choicesLen: 2, choiceIndex: 0 };
    store.buzz(party, "alice", Date.now(), choice);
    store.buzz(party, "bob", Date.now(), choice);
    store.maybeFinalizeBuzzDecision(party);
    store.maybeAutoResolveQuizWhenEveryPlayerBuzzed(party, quiz);
    const pauseStarted = party.nextQuestionCountdownStartedAt ?? 0;
    expect(store.maybeFinishNextQuestionCountdown(party, quiz, pauseStarted + 5_000)).toBe(true);
    store.playerSetReady(party, "alice", true);
    store.playerSetReady(party, "bob", true);
    expect(party.countdownStartedAt).not.toBeNull();
    expect(party.buzzWindowOpen).toBe(false);
    expect(party.appliedCountdownDurationSec).toBe(5);

    const during = snapsOf(party, packs);
    for (const snap of [during.player, during.host]) {
      const raw = JSON.stringify(snap);
      expect(raw).toContain(PREV_PROMPT);
      expect(raw).toContain(PREV_A);
      expect(raw).toContain(PREV_B);
      expect(leakedNext(raw)).toEqual([]);
    }
    const duringTexts = await textsOf(during);
    for (const name of ["player", "broadcast"] as const) {
      expect(duringTexts[name]).toContain(PREV_PROMPT);
      expect(duringTexts[name]).toContain(PREV_A);
      expect(duringTexts[name]).toContain(PREV_B);
      expect(leakedNext(duringTexts[name])).toEqual([]);
    }

    const countdownStarted = party.countdownStartedAt ?? 0;
    expect(store.maybeOpenBuzzAfterCountdown(party)).toBe(false);
    vi.setSystemTime(countdownStarted + 5_000);
    expect(store.maybeOpenBuzzAfterCountdown(party)).toBe(true);
    expect(party.buzzWindowOpen).toBe(true);

    const opened = snapsOf(party, packs);
    for (const snap of [opened.player, opened.host]) {
      const raw = JSON.stringify(snap);
      expect(raw).toContain(NEXT_PROMPT);
      expect(raw).toContain(NEXT_A);
      expect(raw).toContain(NEXT_B);
      expect(raw).not.toContain(PREV_PROMPT);
    }
    const openedTexts = await textsOf(opened);
    for (const name of ["player", "broadcast"] as const) {
      expect(openedTexts[name]).toContain(NEXT_PROMPT);
      expect(openedTexts[name]).toContain(NEXT_A);
      expect(openedTexts[name]).toContain(NEXT_B);
      expect(openedTexts[name]).not.toContain(PREV_PROMPT);
    }
  });
});

describe("question holdback screens", () => {
  it("renders player, broadcast and host during the pause without an empty root", async () => {
    beginClock();
    const { snaps } = pauseScene();
    const texts = await textsOf(snaps);
    for (const text of Object.values(texts)) {
      expect(text.trim().length).toBeGreaterThan(0);
    }
    expect(document.querySelector(".bz-broadcast, .bz-app")).not.toBeNull();
  });

  it("shows the question just played, not the next one, on player, broadcast and host during the pause", async () => {
    beginClock();
    const texts = await textsOf(pauseScene().snaps);
    const bad: string[] = [];
    for (const [name, text] of Object.entries(texts)) {
      if (!text.includes(PREV_PROMPT) || !text.includes(PREV_A) || !text.includes(PREV_B)) bad.push(`${name}:missing-previous`);
      for (const token of leakedNext(text)) bad.push(`${name}:${token}`);
    }
    expect(bad).toEqual([]);
  });

  it("shows neither question text nor any answer on player, broadcast or host during « Prêt ? »", async () => {
    beginClock();
    const { store, party, quiz, packs } = answeredParty(pauseOpts);
    const startedAt = party.nextQuestionCountdownStartedAt ?? 0;
    store.maybeFinishNextQuestionCountdown(party, quiz, startedAt + 5_000);
    const texts = await textsOf(snapsOf(party, packs));
    const shown: string[] = [];
    for (const [name, text] of Object.entries(texts)) {
      for (const token of QUESTION_TOKENS) {
        if (text.includes(token)) shown.push(`${name}:${token}`);
      }
    }
    expect(shown).toEqual([]);
  });

  it("keeps the locked pause banner when the host sets the next pause to 0 mid-countdown", async () => {
    beginClock();
    const { store, party, packs } = answeredParty(pauseOpts);
    store.adminSetNextQuestionCountdownSec(party, 0);
    expect(party.nextQuestionCountdownSec).toBe(0);
    expect(party.appliedNextQuestionCountdownSec).toBe(5);
    const container = await show(`/party/${party.id}/broadcast`, snapsOf(party, packs));
    expect(container.textContent).toContain("Prochaine question dans :");
    expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
    expect(container.querySelector(".bz-broadcast")).not.toBeNull();
  });
});

describe("broadcast sequence after every answer", () => {
  it("closes the point modal at 3 s of a 5 s pause and leaves the banner, with no winner overlay", async () => {
    beginClock();
    const { party, packs } = answeredParty(pauseOpts);
    const container = await show(`/party/${party.id}/broadcast`, snapsOf(party, packs));
    expect(container.querySelector(".bz-point-modal")).not.toBeNull();
    expect(container.textContent).toContain("Point pour");
    expect(container.textContent).toContain("+ 10 points");
    expect(container.textContent).toContain("Prochaine question dans :");
    await settle(2_999);
    expect(container.querySelector(".bz-point-modal")).not.toBeNull();
    await settle(1);
    expect(container.querySelector(".bz-point-modal")).toBeNull();
    expect(container.querySelector(".bz-winner-screen")).toBeNull();
    expect(container.textContent).toContain("Prochaine question dans :");
    expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("shows the point on a disc in the buzzer slot, then hides it after 3 s", async () => {
    beginClock();
    const { party, packs } = answeredParty(pauseOpts);
    const container = await show(`/party/${party.id}/play`, snapsOf(party, packs));
    expect(container.querySelector(".bz-point-modal, .bz-winner-screen")).toBeNull();
    const disc = container.querySelector(".bz-buzz-award");
    expect(disc).not.toBeNull();
    expect(disc?.textContent).toContain("Vous !");
    expect(disc?.textContent).toContain("+ 10 points");
    expect(disc?.textContent).toContain("Prochaine question dans :");
    expect(container.textContent).toContain(PREV_PROMPT);
    await settle(2_999);
    expect(container.querySelector(".bz-buzz-award")).not.toBeNull();
    await settle(1);
    expect(container.querySelector(".bz-buzz-award")).toBeNull();
    expect(container.querySelector(".bz-point-modal, .bz-winner-screen")).toBeNull();
    expect(container.textContent).toContain(PREV_PROMPT);
  });

  it("keeps the scorer's name on every screen except the scorer's own phone", async () => {
    beginClock();
    const { party, packs } = answeredParty(pauseOpts);
    const snaps = snapsOf(party, packs);
    const winner = await show(`/party/${party.id}/play`, snaps, "alice");
    const winnerDisc = winner.querySelector(".bz-buzz-award");
    expect(winnerDisc?.textContent).toContain("Vous !");
    expect(winnerDisc?.textContent).not.toContain("Alice");

    const other = await show(`/party/${party.id}/play`, snaps, "bob");
    const otherDisc = other.querySelector(".bz-buzz-award");
    expect(otherDisc?.textContent).toContain("Alice");
    expect(otherDisc?.textContent).not.toContain("Vous !");

    const broadcast = await show(`/party/${party.id}/broadcast`, snaps);
    expect(broadcast.textContent).toContain("Alice");
    expect(broadcast.textContent).toContain("Point pour");
    expect(broadcast.textContent).not.toContain("Vous !");
  });

  it("keeps the point award out of the host preview during the pause", async () => {
    beginClock();
    const { party, packs } = answeredParty(pauseOpts);
    const container = await show(`/party/${party.id}/admin`, snapsOf(party, packs));
    expect(container.querySelector(".bz-bc-preview-frame")).not.toBeNull();
    expect(container.querySelector(".bz-point-modal, .bz-buzz-award")).toBeNull();
    expect(container.textContent).not.toContain("Vous !");
    expect(container.textContent).not.toContain("+ 10 points");
  });

  it("un clic du joueur ferme le disque de points avant la fin du décompte", async () => {
    beginClock();
    const { party, packs } = answeredParty(pauseOpts);
    const container = await show(`/party/${party.id}/play`, snapsOf(party, packs));
    const disc = container.querySelector<HTMLButtonElement>(".bz-buzz-award");
    expect(disc).not.toBeNull();
    expect(disc?.disabled).toBe(false);
    expect(disc?.textContent).toContain("Prochaine question dans :");
    await act(async () => {
      disc?.click();
    });
    expect(container.querySelector(".bz-buzz-award")).toBeNull();
    expect(container.querySelector(".bz-winner-screen")).toBeNull();
    expect(container.textContent).toContain(PREV_PROMPT);
  });

  it("closes the point modal when the pause itself is only 2 s", async () => {
    beginClock();
    const { party, packs } = answeredParty({ ...pauseOpts, pauseSec: 2 });
    const container = await show(`/party/${party.id}/broadcast`, snapsOf(party, packs));
    expect(container.querySelector(".bz-point-modal")).not.toBeNull();
    await settle(1_999);
    expect(container.querySelector(".bz-point-modal")).not.toBeNull();
    await settle(1);
    expect(container.querySelector(".bz-point-modal")).toBeNull();
    expect(container.querySelector(".bz-winner-screen")).toBeNull();
    expect(container.textContent).toContain("Prochaine question dans :");
  });

  it("shows no point modal and no winner overlay when the pause is 0", async () => {
    beginClock();
    const { party, packs } = answeredParty({ ...pauseOpts, pauseSec: 0 });
    expect(party.nextQuestionCountdownStartedAt).toBeNull();
    expect(party.pointAward).toBeNull();
    expect(party.readyPhaseStartedAt).not.toBeNull();
    const container = await show(`/party/${party.id}/broadcast`, snapsOf(party, packs));
    expect(container.querySelector(".bz-point-modal")).toBeNull();
    expect(container.querySelector(".bz-winner-screen")).toBeNull();
    expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("uses « + 1 point » when a single point was scored", async () => {
    beginClock();
    const { party, packs } = answeredParty({ ...pauseOpts, points: 1, players: 1 });
    expect(party.pointAward?.points).toBe(1);
    expect(party.pointAward?.teamName).toBeNull();
    const container = await show(`/party/${party.id}/broadcast`, snapsOf(party, packs));
    expect(container.querySelector(".bz-point-pill")?.textContent).toBe("+ 1 point");
  });

  it("uses the team pill when the point goes to a team", async () => {
    beginClock();
    const { party, packs } = answeredParty({
      ...pauseOpts,
      players: 1,
      maxTeams: 2,
      teamId: 1,
    });
    expect(party.pointAward?.teamName).toBe("1");
    const container = await show(`/party/${party.id}/broadcast`, snapsOf(party, packs));
    expect(container.querySelector(".bz-point-pill")?.textContent).toBe("+ 10 points pour l'équipe 1");
  });
});

describe("end screens stay readable", () => {
  it("shows the team podium when the party state is ended, with no full-screen overlay", async () => {
    beginClock();
    const store = new PartyStore(() => {}, buzzCatalog);
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: 2,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    addPlayer(party, "alice", "Alice", 1);
    addPlayer(party, "bob", "Bob", 2);
    party.state = "ended";
    party.hasStartedRound = true;
    const snaps = snapsOf(party, new Map());
    const container = await show(`/party/${party.id}/broadcast`, snaps);
    expect(container.textContent).toContain("Bravo.");
    expect(container.textContent).toContain("Équipe 1");
    expect(container.textContent).toContain("Équipe 2");
    expect(container.querySelector(".bz-winner-screen, .bz-point-modal")).toBeNull();
    expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("leaves the last question on screen in question mode, without a winner overlay", async () => {
    beginClock();
    const { party, packs } = answeredParty({
      ...pauseOpts,
      questions: 1,
      ready: false,
      players: 1,
      winnerMode: "question",
    });
    expect(party.winnerDisplay).toBeNull();
    expect(party.mancheResultOpen).toBe(true);
    expect(party.nextQuestionCountdownStartedAt).toBeNull();
    expect(party.state).toBe("round_active");
    const container = await show(`/party/${party.id}/broadcast`, snapsOf(party, packs));
    expect(container.querySelector(".bz-podium")).not.toBeNull();
    expect(container.textContent).toContain("Fin de la manche");
    expect(container.textContent).not.toContain(PREV_PROMPT);
    expect(container.querySelector(".bz-winner-screen, .bz-point-modal")).toBeNull();
    expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("does not leave the round-end winner overlay open on the broadcast or the player", async () => {
    beginClock();
    const { party, packs } = answeredParty({
      ...pauseOpts,
      questions: 1,
      ready: false,
      players: 1,
      winnerMode: "round",
    });
    expect(party.winnerDisplay).not.toBeNull();
    expect(party.mancheResultOpen).toBe(true);
    expect(party.nextQuestionCountdownStartedAt).toBeNull();
    expect(party.state).toBe("round_active");
    const snaps = snapsOf(party, packs);
    const broadcast = await show(`/party/${party.id}/broadcast`, snaps);
    await settle(5_000);
    expect(broadcast.querySelector(".bz-podium")).not.toBeNull();
    expect(broadcast.querySelector(".bz-winner-screen")).toBeNull();
    const player = await show(`/party/${party.id}/play`, snaps);
    await settle(5_000);
    expect(player.querySelector(".bz-podium")).not.toBeNull();
    expect(player.querySelector(".bz-winner-screen")).toBeNull();
  });

  it("keeps the winner overlay out of the host preview", async () => {
    beginClock();
    const { party, packs } = answeredParty({
      ...pauseOpts,
      questions: 1,
      ready: false,
      players: 1,
      winnerMode: "round",
    });
    expect(party.winnerDisplay).not.toBeNull();
    const container = await show(`/party/${party.id}/admin`, snapsOf(party, packs));
    expect(container.querySelector(".bz-winner-screen")).toBeNull();
    expect(container.querySelector(".bz-podium")).toBeNull();
    expect(container.querySelector(".bz-bc-preview-frame")).not.toBeNull();
    expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
  });
});

describe("player buzzer control", () => {
  function armedParty(): Party {
    const store = new PartyStore(() => {}, buzzCatalog);
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    addPlayer(party, "alice", "Alice", null);
    addPlayer(party, "bob", "Bob", null);
    addPlayer(party, "chloe", "Chloe", null);
    party.state = "round_active";
    party.hasStartedRound = true;
    return party;
  }

  it("shows an enabled Buzz button once the server has opened the window", async () => {
    beginClock();
    const party = armedParty();
    party.buzzWindowOpen = true;
    party.buzzWindowOpenedAt = Date.now();
    const snaps = snapsOf(party, new Map());
    const container = await show(`/party/${party.id}/play`, snaps);
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Buzz"]');
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    expect(container.querySelector('[aria-label="Compte à rebours avant le buzzer"]')).toBeNull();
  });

  it("arms the buzz button once the countdown has reached 0, even if the open flag is still false", async () => {
    beginClock();
    const party = armedParty();
    party.buzzWindowOpen = false;
    party.appliedCountdownDurationSec = 5;
    party.countdownDurationSec = 5;
    party.countdownStartedAt = Date.now() - 5_000;
    const container = await show(`/party/${party.id}/play`, snapsOf(party, new Map()));
    expect(container.querySelector('[aria-label="Compte à rebours avant le buzzer"]')).toBeNull();
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Buzz"]');
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
  });

  it("shows « Buzz envoyé » once the player is in buzzOrder", async () => {
    beginClock();
    const party = armedParty();
    party.buzzWindowOpen = true;
    party.buzzWindowOpenedAt = Date.now();
    party.buzzOrder = ["alice"];
    const container = await show(`/party/${party.id}/play`, snapsOf(party, new Map()));
    expect(container.textContent).toContain("Buzz envoyé");
  });

  it("shows « Buzz envoyé » as soon as the server has parked the buzz, before buzzOrder is filled", async () => {
    beginClock();
    const store = new PartyStore(() => {}, buzzCatalog);
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    addPlayer(party, "alice", "Alice", null);
    addPlayer(party, "bob", "Bob", null);
    addPlayer(party, "chloe", "Chloe", null);
    party.state = "round_active";
    party.hasStartedRound = true;
    party.buzzWindowOpen = true;
    party.buzzWindowOpenedAt = Date.now();
    store.buzz(party, "alice", Date.now());
    store.maybeFinalizeBuzzDecision(party);
    expect(party.buzzOrder).toEqual([]);
    expect(party.pendingBuzzQueue.map((row) => row.playerId)).toEqual(["alice"]);
    const container = await show(`/party/${party.id}/play`, snapsOf(party, new Map()));
    expect(container.textContent).toContain("Buzz envoyé");
  });
});

describe("ready marks and the host return tab", () => {
  function readyScene(markAlice: boolean): { party: Party; snaps: ScreenSnaps } {
    const { store, party, quiz, packs } = answeredParty(pauseOpts);
    const startedAt = party.nextQuestionCountdownStartedAt ?? 0;
    store.maybeFinishNextQuestionCountdown(party, quiz, startedAt + 5_000);
    if (markAlice) store.playerSetReady(party, "alice", true);
    return { party, snaps: snapsOf(party, packs) };
  }

  it("shows an orange Prêt ? button, then a green Prêt ! button for that player", async () => {
    beginClock();
    const waiting = readyScene(false);
    const before = await show(`/party/${waiting.party.id}/play`, waiting.snaps);
    const orange = before.querySelector<HTMLButtonElement>("button.bz-buzz-ready");
    expect(orange?.textContent?.trim()).toBe("Prêt ?");
    expect(orange?.classList.contains("is-ready")).toBe(false);
    expect(orange?.getAttribute("aria-pressed")).toBe("false");

    const ready = readyScene(true);
    const after = await show(`/party/${ready.party.id}/play`, ready.snaps);
    const green = after.querySelector<HTMLButtonElement>("button.bz-buzz-ready");
    expect(green?.textContent?.trim()).toBe("Prêt !");
    expect(green?.classList.contains("is-ready")).toBe(true);
    expect(green?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a waiting hourglass or a ready check on the broadcast and the host, only while the mode is on", async () => {
    beginClock();
    const { party, snaps } = readyScene(true);
    const broadcast = await show(`/party/${party.id}/broadcast`, snaps);
    expect(broadcast.querySelectorAll('.bz-ready-mark.is-ready[aria-label="Prêt"]').length).toBe(1);
    expect(broadcast.querySelectorAll('.bz-ready-mark.is-waiting[aria-label="Pas encore prêt"]').length).toBe(1);

    const host = await show(`/party/${party.id}/admin`, snaps);
    const hostReady = host.querySelectorAll('.bz-ready-mark.is-ready[aria-label="Prêt"]');
    const hostWaiting = host.querySelectorAll('.bz-ready-mark.is-waiting[aria-label="Pas encore prêt"]');
    expect(hostReady.length).toBeGreaterThan(0);
    expect(hostWaiting.length).toBe(hostReady.length);

    const off = answeredParty({ ...pauseOpts, ready: false });
    const plain = await show(`/party/${off.party.id}/broadcast`, snapsOf(off.party, off.packs));
    expect(plain.querySelector(".bz-ready-mark")).toBeNull();
  });

  it("shows the same ready checks and hourglasses on the phone during « Prêt ? »", async () => {
    beginClock();
    const { party, snaps } = readyScene(true);
    const phone = await show(`/party/${party.id}/play`, snaps);
    const roster = phone.querySelector(".bz-ready-hold .bz-ready-roster");
    expect(roster).not.toBeNull();
    expect(roster?.textContent).toContain("Alice");
    expect(roster?.textContent).toContain("Bob");
    expect(roster?.querySelectorAll('.bz-ready-mark.is-ready[aria-label="Prêt"]').length).toBe(1);
    expect(roster?.querySelectorAll('.bz-ready-mark.is-waiting[aria-label="Pas encore prêt"]').length).toBe(1);
    expect(phone.querySelector(".bz-buzz-slot .bz-buzz-ready")).not.toBeNull();
    expect(phone.querySelector(".bz-buzz-slot .bz-ready-mark")).toBeNull();

    const off = answeredParty({ ...pauseOpts, ready: false });
    const plain = await show(`/party/${off.party.id}/play`, snapsOf(off.party, off.packs));
    expect(plain.querySelector(".bz-ready-mark")).toBeNull();
  });

  it("places the ready instruction above the ready count, in orange and in green", async () => {
    beginClock();
    const sheet = readFileSync("client/src/styles/buzzy.css", "utf8");
    const captionRule = sheet.slice(
      sheet.indexOf(".bz-buzz-slot .bz-ready-stack .bz-buzz-caption {"),
      sheet.indexOf(".bz-buzz-slot .bz-ready-stack .bz-buzz-caption {") + 220,
    );
    const countRule = sheet.slice(
      sheet.indexOf(".bz-buzz-slot .bz-ready-stack .bz-ready-count {"),
      sheet.indexOf(".bz-buzz-slot .bz-ready-stack .bz-ready-count {") + 180,
    );
    expect(captionRule).toContain("bottom: calc(4px + 1.25em + 4px)");
    expect(countRule).toContain("bottom: 4px");
    expect(captionRule).toContain("overflow: hidden");
    expect(countRule).toContain("overflow: hidden");
    expect(sheet).not.toMatch(/\.bz-ready-stack[\s\S]{0,400}overflow:\s*(auto|scroll)/);

    const style = document.createElement("style");
    style.textContent = sheet;
    document.head.appendChild(style);

    const waiting = readyScene(false);
    const orange = await show(`/party/${waiting.party.id}/play`, waiting.snaps);
    const orangeCaption = orange.querySelector(".bz-buzz-slot .bz-ready-stack .bz-buzz-caption");
    const orangeCount = orange.querySelector(".bz-buzz-slot .bz-ready-stack .bz-ready-count");
    expect(orangeCaption?.textContent).toContain("Touchez quand vous êtes prêt");
    expect(orangeCount).not.toBeNull();
    expect(orange.querySelector(".bz-ready-hold .bz-ready-roster")).not.toBeNull();
    expect(getComputedStyle(orangeCaption as Element).bottom).not.toBe(getComputedStyle(orangeCount as Element).bottom);
    expect(getComputedStyle(orange.querySelector(".bz-buzz-slot") as Element).overflow).toBe("hidden");

    const ready = readyScene(true);
    const green = await show(`/party/${ready.party.id}/play`, ready.snaps);
    expect(green.querySelector(".bz-buzz-slot .bz-ready-stack .bz-buzz-caption")?.textContent).toContain(
      "Touchez à nouveau pour annuler",
    );
    expect(green.querySelector(".bz-buzz-slot .bz-ready-stack .bz-ready-count")).not.toBeNull();
    const greenCaption = green.querySelector(".bz-buzz-slot .bz-ready-stack .bz-buzz-caption");
    const greenCount = green.querySelector(".bz-buzz-slot .bz-ready-stack .bz-ready-count");
    expect(getComputedStyle(greenCaption as Element).bottom).not.toBe(getComputedStyle(greenCount as Element).bottom);
  });

  it("keeps four buttons on the host bar and parks the other controls under the scenario", async () => {
    beginClock();
    const { party, snaps } = readyScene(true);
    localStorage.removeItem(`partygames:hostPartySettings:${party.id}`);
    const host = await show(`/party/${party.id}/admin`, snaps);
    const bar = host.querySelector(".bz-host-controls");
    const labels = [...(bar?.querySelectorAll("button") ?? [])].map((button) => button.textContent?.trim());
    expect(labels).toEqual(["▶ Lancer la manche", "🔔 Ouvrir buzzer", "⏸ Pause", "🏆 Afficher gagnant"]);
    expect(bar?.textContent).not.toContain("Fermer");
    expect(bar?.textContent).not.toContain("Lancer la question");
    expect(bar?.textContent).not.toContain("Ouverture auto");

    const pack = host.querySelector(".bz-host-pack");
    const settings = host.querySelector(".bz-party-settings");
    expect(pack).not.toBeNull();
    expect(settings).not.toBeNull();
    expect(
      pack !== null &&
        settings !== null &&
        (pack.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ).toBe(true);
    expect(
      settings !== null &&
        bar !== null &&
        (settings.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ).toBe(true);
    expect(settings?.textContent).toContain("Prêt ? activé · buzzer 0 s · suivante 5 s");
    expect(settings?.querySelector(".bz-party-settings-body")).toBeNull();

    const toggle = settings?.querySelector<HTMLButtonElement>(".bz-party-settings-toggle");
    await act(async () => {
      toggle?.click();
    });
    const body = host.querySelector(".bz-party-settings-body");
    const headings = [...(body?.querySelectorAll("h3") ?? [])].map((node) => node.textContent?.trim());
    expect(headings).toEqual(["Buzzer", "Comptes à rebours", "Sons et affichage"]);
    expect(body?.textContent).toContain("Ouverture auto après « suivant »");
    expect(body?.textContent).toContain("QCM : passer seul quand tous ont buzzé");
    expect(body?.textContent).toContain("Fenêtre d'attente buzz");
    expect(body?.textContent).toContain("Avant la question suivante");
    expect(body?.textContent).toContain("Mode « Prêt ? »");
    expect(body?.textContent).toContain("Délai maximum « Prêt ? »");
    expect(body?.textContent).toContain("Avant le buzzer");
    expect(body?.textContent).toContain("Sons bon / mauvais");
    expect(body?.textContent).toContain("Joueurs + animation");
    expect(body?.textContent).toContain("Écran de gagnant");
    expect(body?.textContent).toContain("Fin de question");
    expect(body?.textContent).toContain("Blind test");

    const moment = host.querySelector(".bz-manche-row--playing .bz-manche-moment");
    expect(moment?.textContent).toContain("Fermer & purger");
    expect(moment?.textContent).toContain("Lancer la question");
    expect(moment?.textContent).toContain("Question suivante");
    expect(host.querySelector(".bz-host-controls .bz-manche-moment")).toBeNull();
  });

  it("opens the host board in a new tab without putting the token in the url", async () => {
    beginClock();
    const { party, packs } = answeredParty(pauseOpts);
    const token = "secret-host-token";
    localStorage.setItem(`partygames:hostToken:${party.id.toLowerCase()}`, token);
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    const container = await show(`/party/${party.id}/broadcast`, snapsOf(party, packs));
    const link = container.querySelector<HTMLButtonElement>(".bz-bc-exit");
    expect(link?.textContent).toContain("retour tableau");
    await act(async () => {
      link?.click();
    });
    expect(opened).toHaveBeenCalledTimes(1);
    const [url, target, features] = opened.mock.calls[0] ?? [];
    expect(String(url)).toContain(`/party/${party.id.toLowerCase()}/admin`);
    expect(String(url).includes(token)).toBe(false);
    expect(String(url).includes("token=")).toBe(false);
    expect(target).toBe("_blank");
    expect(features).toBe("noopener,noreferrer");
    opened.mockRestore();
  });
});

describe("normal launch", () => {
  it("garde la question suivante masquée tant que le buzzer reste fermé", () => {
    // * First-cue visibility while the buzzer is closed is an open CA-60 choice.
    //   Flip it only in uncertainCa60FirstQuestion.test.tsx.
    const store = new PartyStore(() => {}, buzzCatalog);
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    const quiz = holdPack({ ...pauseOpts, questions: 2, ready: false });
    const packs = new Map<string, QuizPack>([[quiz.basename, quiz]]);
    store.hostAppendManche(party, {
      kind: "pack_quiz",
      title: "Culture Générale - QCM",
      packBasename: quiz.basename,
      iframeUrl: null,
      youtubeEmbedUrl: null,
      directVideoUrl: null,
      savedRoundIndex: 0,
      savedQuestionIndex: 0,
      transitionKind: null,
      transitionDurationMs: null,
    });
    store.adminSetNextQuestionCountdownSec(party, 0);
    store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", false, packs);

    expect(party.loadedPackId).toBe(quiz.id);
    expect(party.buzzWindowOpen).toBe(false);
    expect(party.autoOpenBuzzOnCueAdvance).toBe(false);
    const snaps = snapsOf(party, packs);
    for (const snap of [snaps.player, snaps.host]) {
      expect(snap.state).toBe("round_active");
      expect(leakedNext(JSON.stringify(snap))).toEqual([]);
    }

    store.adminAdvanceCue(party, quiz);
    const after = snapsOf(party, packs);
    for (const snap of [after.player, after.host]) {
      const raw = JSON.stringify(snap);
      expect(raw).toContain(PREV_PROMPT);
      expect(leakedNext(raw)).toEqual([]);
      expect(snap.buzzWindowOpen).toBe(false);
    }
  });

  it("keeps four answers and their outline inside a 390 px phone", async () => {
    beginClock();
    const sheet = readFileSync("client/src/styles/buzzy.css", "utf8");
    expect(sheet).toMatch(/\.bz-app \.bz-qna-answers \{[^}]*padding:\s*3px/);
    expect(sheet).toMatch(/\.bz-app \.bz-qna-answers > li \{[^}]*margin:\s*0/);
    expect(sheet).toContain("outline-offset: 0");
    const frame = phoneQuizAnswerFrame(390, 844);
    expect(frame.outlineInside).toBe(true);
    expect(frame.fourthAnswerInside).toBe(true);
    expect(frame.textWidthPx).toBeGreaterThan(0);

    const store = new PartyStore(() => {}, buzzCatalog);
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    addPlayer(party, "alice", "Alice", null);
    const quiz: QuizPack = {
      id: "pack-four",
      basename: "pack-four",
      title: "Pack",
      rounds: [
        {
          title: "Manche",
          questions: [
            {
              prompt: "Laquelle ?",
              choices: ["Alpha", "Bravo", "Charlie", "Delta"],
              correctIndex: 3,
              points: 1,
            },
          ],
        },
      ],
    };
    const packs = new Map<string, QuizPack>([[quiz.basename, quiz]]);
    store.hostAppendManche(party, {
      kind: "pack_quiz",
      title: quiz.title,
      packBasename: quiz.basename,
      iframeUrl: null,
      youtubeEmbedUrl: null,
      directVideoUrl: null,
      savedRoundIndex: 0,
      savedQuestionIndex: 0,
      transitionKind: null,
      transitionDurationMs: null,
    });
    store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", false, packs);
    const style = document.createElement("style");
    style.textContent = sheet;
    document.head.appendChild(style);
    const phone = await show(`/party/${party.id}/play`, snapsOf(party, packs));
    const answers = phone.querySelector(".bz-qna-answers");
    const rows = [...(answers?.children ?? [])].filter((node) => node.tagName === "LI");
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Alpha"),
      expect.stringContaining("Bravo"),
      expect.stringContaining("Charlie"),
      expect.stringContaining("Delta"),
    ]);
    expect(getComputedStyle(answers as Element).paddingTop).toBe("3px");
    expect(getComputedStyle(answers as Element).paddingRight).toBe("3px");
    expect(getComputedStyle(rows[3] as Element).marginBottom).toBe("0px");
    const play = phone.querySelector(".bz-play-screen") as HTMLElement;
    play.style.width = "390px";
    play.style.height = "844px";
    expect(play.scrollWidth).toBeLessThanOrEqual(390);
  });

  it("gives the ready block the same box as the question and the answers", async () => {
    beginClock();
    const sheet = readFileSync("client/src/styles/buzzy.css", "utf8");
    expect(sheet).toMatch(/\.bz-app \.bz-play-rest > \.bz-qna \{[^}]*margin:\s*0/);
    const style = document.createElement("style");
    style.textContent = sheet;
    document.head.appendChild(style);
    const { store, party, quiz, packs } = answeredParty(pauseOpts);
    const startedAt = party.nextQuestionCountdownStartedAt ?? 0;
    store.maybeFinishNextQuestionCountdown(party, quiz, startedAt + 5_000);
    const phone = await show(`/party/${party.id}/play`, snapsOf(party, packs));
    const ready = phone.querySelector(".bz-play-rest > .bz-qna");
    expect(ready?.classList.contains("bz-ready-hold")).toBe(true);
    const margin = getComputedStyle(ready as Element);
    expect(margin.marginTop).toBe("0px");
    expect(margin.marginBottom).toBe("0px");
  });

  it("staggers the phone podium with the same rank heights as the broadcast", () => {
    const sheet = readFileSync("client/src/styles/buzzy.css", "utf8");
    expect(sheet).toMatch(/\.bz-podium-steps \{[^}]*align-items:\s*flex-end/);
    expect(sheet).toContain("min-height: 46%");
    expect(sheet).toContain("min-height: 34%");
    expect(sheet).toContain("min-height: 26%");
    expect(sheet).not.toMatch(/\.bz-podium--phone \.bz-podium-steps \{[^}]*align-items:\s*stretch/);
    expect(sheet).not.toMatch(/\.bz-podium--phone \.bz-podium-step \{[^}]*min-height:\s*0/);
  });

  it("disables Question suivante on the last question and leaves it active before that", async () => {
    beginClock();
    const last = launchNormalQuiz(1);
    expect(last.snaps.host.gameBoard).toMatchObject({
      kind: "quiz",
      questionIndexInRound: 0,
      questionCount: 1,
    });
    const host = await show(`/party/${last.party.id}/admin`, last.snaps);
    const button = cueAdvanceButton(host);
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
    expect(host.textContent).toContain("Dernière question — ce bouton est inactif");
    const posts: string[] = [];
    vi.stubGlobal(
      "fetch",
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (init?.method === "POST") posts.push(requestUrl(input));
        return Promise.resolve(
          new Response(JSON.stringify(last.snaps.host), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    );
    await act(async () => {
      button?.click();
    });
    await flush();
    expect(posts.some((url) => url.includes("/host/cue/next"))).toBe(false);
    expect(last.party.mancheResultOpen).not.toBe(true);

    const earlier = launchNormalQuiz(2);
    expect(earlier.snaps.host.gameBoard).toMatchObject({
      kind: "quiz",
      questionIndexInRound: 0,
      questionCount: 2,
    });
    const open = await show(`/party/${earlier.party.id}/admin`, earlier.snaps);
    const next = cueAdvanceButton(open);
    expect(next?.disabled).toBe(false);
    expect(open.textContent).not.toContain("Dernière question — ce bouton est inactif");
  });

  it("keeps a typed settings number while a snapshot still says 20", async () => {
    beginClock();
    const { party, packs } = answeredParty({ ...pauseOpts, pauseSec: 20 });
    const snaps = snapsOf(party, packs);
    expect(snaps.host.nextQuestionCountdownSec).toBe(20);
    localStorage.removeItem(`partygames:hostPartySettings:${party.id}`);
    const host = await show(`/party/${party.id}/admin`, snaps);
    const toggle = host.querySelector<HTMLButtonElement>(".bz-party-settings-toggle");
    await act(async () => {
      toggle?.click();
    });
    const next = host.querySelector<HTMLInputElement>(`#bz-next-${party.id}`);
    const ready = host.querySelector<HTMLInputElement>(`#bz-ready-max-${party.id}`);
    expect(next?.value).toBe("20");
    expect(ready?.value).toBe("15");
    const posts: Array<{ url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        if (init?.method === "POST") posts.push({ url, body: typeof init.body === "string" ? init.body : "" });
        // * A stale snapshot still says 20. It must not replace the digits being typed.
        return Promise.resolve(
          new Response(JSON.stringify(snaps.host), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    );
    await act(async () => {
      next?.focus();
      if (next) setNativeValue(next, "3");
    });
    await flush();
    expect(next?.value).toBe("3");
    await act(async () => {
      if (next) setNativeValue(next, "30");
    });
    await flush();
    expect(next?.value).toBe("30");
    expect(posts.some((post) => post.url.includes("/host/next-question-countdown"))).toBe(false);
    await act(async () => {
      next?.blur();
    });
    await flush();
    await act(async () => {
      ready?.focus();
      if (ready) setNativeValue(ready, "30");
    });
    await flush();
    expect(ready?.value).toBe("30");
    await act(async () => {
      ready?.blur();
    });
    await flush();
    const countdown = posts.find((post) => post.url.includes("/host/next-question-countdown"));
    const readyPost = posts.find((post) => post.url.includes("/host/ready-timeout"));
    expect(countdown?.body).toContain('"seconds":30');
    expect(readyPost?.body).toContain('"seconds":30');
    expect(next?.value).toBe("30");
    expect(ready?.value).toBe("30");
  });

  it("keeps 30 after Enter until the server snapshot confirms it", async () => {
    beginClock();
    const { party, packs } = answeredParty({ ...pauseOpts, pauseSec: 12 });
    const snaps = snapsOf(party, packs);
    expect(snaps.host.nextQuestionCountdownSec).toBe(12);
    localStorage.removeItem(`partygames:hostPartySettings:${party.id}`);
    const host = await show(`/party/${party.id}/admin`, snaps);
    const toggle = host.querySelector<HTMLButtonElement>(".bz-party-settings-toggle");
    await act(async () => {
      toggle?.click();
    });
    const next = host.querySelector<HTMLInputElement>(`#bz-next-${party.id}`);
    expect(next?.value).toBe("12");
    let releasePost: (response: Response) => void = () => undefined;
    const pendingPost = new Promise<Response>((resolve) => {
      releasePost = resolve;
    });
    vi.stubGlobal(
      "fetch",
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        if (init?.method === "POST" && url.includes("/host/next-question-countdown")) return pendingPost;
        return Promise.resolve(
          new Response(JSON.stringify(snaps.host), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    );
    await act(async () => {
      next?.focus();
      if (next) setNativeValue(next, "30");
    });
    await flush();
    expect(next?.value).toBe("30");
    await act(async () => {
      next?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    expect(next?.value).toBe("30");
    const stale = { ...snaps.host, nextQuestionCountdownSec: 12 };
    await act(async () => {
      releasePost(
        new Response(JSON.stringify(stale), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    await flush();
    expect(next?.value).toBe("30");
    const confirmed = { ...snaps.host, nextQuestionCountdownSec: 30 };
    await act(async () => {
      emitSocket("party:patch", confirmed);
    });
    await flush();
    expect(next?.value).toBe("30");
    const later = { ...snaps.host, nextQuestionCountdownSec: 8 };
    await act(async () => {
      emitSocket("party:patch", later);
    });
    await flush();
    expect(next?.value).toBe("8");
  });

  it("keeps Afficher gagnant enabled in Fin de manche until the podium is open", async () => {
    beginClock();
    const playing = launchNormalQuiz(2);
    playing.snaps.host.winnerScreenMode = "round";
    playing.snaps.host.winnerDisplay = {
      playerId: "alice",
      playerName: "Alice",
      avatarKey: "a.png",
      score: 4,
    };
    const host = await show(`/party/${playing.party.id}/admin`, playing.snaps);
    const button = [...host.querySelectorAll<HTMLButtonElement>(".bz-host-controls button")].find((item) =>
      (item.textContent ?? "").includes("Afficher gagnant"),
    );
    expect(button?.disabled).toBe(false);

    playing.snaps.host.manchePodium = {
      title: "Fin de la manche 1",
      subtitle: "2 questions",
      kind: "players",
      participantCount: 1,
      steps: [],
      ranked: [],
    };
    const duringPodium = await show(`/party/${playing.party.id}/admin`, playing.snaps);
    const blocked = [...duringPodium.querySelectorAll<HTMLButtonElement>(".bz-host-controls button")].find((item) =>
      (item.textContent ?? "").includes("Afficher gagnant"),
    );
    expect(blocked?.disabled).toBe(true);
  });

  it("stores the host token and drops the hash, then reloads from localStorage", async () => {
    beginClock();
    const playing = launchNormalQuiz(2);
    const id = playing.party.id.toLowerCase();
    localStorage.removeItem(`partygames:hostToken:${id}`);
    window.location.hash = "#token=secret-host-token";
    const first = await show(`/party/${id}/admin`, playing.snaps, "alice", { seedHostToken: false });
    expect(first.textContent).not.toContain("Jeton animateur absent");
    expect(window.location.hash).not.toContain("token=");
    expect(localStorage.getItem(`partygames:hostToken:${id}`)).toBe("secret-host-token");

    window.location.hash = "";
    const second = await show(`/party/${id}/admin`, playing.snaps, "alice", { seedHostToken: false });
    expect(second.textContent).not.toContain("Jeton animateur absent");
    expect(window.location.hash).not.toContain("token=");
  });

  it("keeps the stored host token when the party GET is 404", async () => {
    beginClock();
    const playing = launchNormalQuiz(2);
    const id = playing.party.id.toLowerCase();
    localStorage.setItem(`partygames:hostToken:${id}`, "secret-host-token");
    window.location.hash = "";
    const host = await show(`/party/${id}/admin`, playing.snaps, "alice", {
      seedHostToken: false,
      partyMissing: true,
      allowUnavailable: true,
    });
    expect(host.textContent).toContain("Partie introuvable");
    expect(host.textContent).not.toContain("Jeton animateur absent");
    expect(localStorage.getItem(`partygames:hostToken:${id}`)).toBe("secret-host-token");
  });

  it("shows a French sentence when Question suivante returns 404", async () => {
    beginClock();
    const playing = launchNormalQuiz(2);
    const host = await show(`/party/${playing.party.id}/admin`, playing.snaps);
    vi.stubGlobal(
      "fetch",
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        if (init?.method === "POST" && url.includes("/host/cue/next")) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "NOT_FOUND", message: "NOT_FOUND" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        if (init?.method === "POST" && url.includes("/host/dismiss-winner")) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "NOT_FOUND", message: "NOT_FOUND" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(playing.snaps.host), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    );
    const button = cueAdvanceButton(host);
    await act(async () => {
      button?.click();
    });
    await flush();
    expect(host.textContent).toContain("Partie introuvable. Cette partie n'est plus sur le serveur.");
    expect(host.textContent).not.toContain("404:NOT_FOUND");
  });

  it("jumps when the admin url asks for question 70", async () => {
    beginClock();
    recordedPosts.length = 0;
    const playing = launchNormalQuiz(2);
    const host = await show(`/party/${playing.party.id}/admin?question=70`, playing.snaps);
    expect(host.querySelector(".bz-host-controls")?.textContent).not.toContain("question 70");
    expect(
      recordedPosts.some((post) => post.url.includes("/host/jump-question") && post.body.includes('"question":70')),
    ).toBe(true);
  });

  it("moves the broadcast countdown when the tab becomes visible, without waiting on the tutorial", async () => {
    beginClock();
    const playing = launchNormalQuiz(2);
    const startedAt = Date.now();
    playing.snaps.player.countdownStartedAt = startedAt;
    playing.snaps.player.appliedCountdownDurationSec = 5;
    playing.snaps.player.buzzWindowOpen = false;
    playing.snaps.player.state = "round_active";
    const broadcast = await show(`/party/${playing.party.id}/broadcast`, playing.snaps);
    expect(broadcast.querySelector(".bz-countdown-digit")?.textContent).toBe("5");
    vi.setSystemTime(startedAt + 3_000);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(broadcast.querySelector(".bz-countdown-digit")?.textContent).toBe("2");
  });

  it("labels pause as a freeze and keeps the question on the host", async () => {
    beginClock();
    const playing = launchNormalQuiz(2);
    const prompt =
      playing.snaps.host.gameBoard?.kind === "quiz" ? playing.snaps.host.gameBoard.prompt : "";
    playing.snaps.host.liveRoundPausedAt = Date.now();
    const host = await show(`/party/${playing.party.id}/admin`, playing.snaps);
    const bar = host.querySelector(".bz-host-controls");
    expect(bar?.textContent).toContain("▶ Reprendre");
    expect(bar?.textContent).not.toContain("Pause (lobby)");
    expect(host.textContent).toContain("Pause");
    expect(host.textContent).toContain(prompt);
    expect(host.textContent).not.toContain("En attente des joueurs");
  });

  it("opens the launch choice and posts normal mode", async () => {
    beginClock();
    const playing = launchNormalQuiz(2);
    recordedPosts.length = 0;
    const host = await show(`/party/${playing.party.id}/admin`, playing.snaps);
    const launch = [...host.querySelectorAll<HTMLButtonElement>(".bz-host-controls button")].find((item) =>
      (item.textContent ?? "").includes("Lancer la manche"),
    );
    await act(async () => {
      launch?.click();
    });
    await flush();
    const overlay = document.querySelector(".bz-launch-overlay");
    expect(overlay).not.toBeNull();
    // * Foreground placement and the dark scrim are the uncertain chrome test.
    expect(document.getElementById("launch-dialog-title")?.textContent).toBe("Comment lancer la manche ?");
    expect(overlay?.textContent).toContain("Mode normal");
    expect(overlay?.textContent).toContain("Mode autonome");
    const dialog = overlay?.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(dialog === document.activeElement || dialog?.contains(document.activeElement)).toBe(true);
    const normal = [...(overlay?.querySelectorAll("button") ?? [])].find((button) =>
      (button.textContent ?? "").includes("Mode normal"),
    );
    await act(async () => {
      normal?.click();
    });
    await flush();
    expect(
      recordedPosts.some((post) => post.url.includes("/host/manche/launch") && post.body.includes('"mode":"normal"')),
    ).toBe(true);
    expect(document.querySelector(".bz-launch-overlay")).toBeNull();
  });

  it("closes the broadcast tutorial from Compris, Escape, the cross, or the backdrop, once per party", async () => {
    beginClock();
    const playing = launchNormalQuiz(2);
    const id = playing.party.id.toLowerCase();
    const storageKey = `partygames:broadcastTutorialClosed:${id}`;
    localStorage.removeItem(storageKey);
    const broadcast = await show(`/party/${id}/broadcast`, playing.snaps);
    const tutorials = {
      tutorials: {
        quiz: {
          gameKind: "quiz",
          title: "Quiz QCM",
          slides: [
            { title: "Bienvenue au Quiz !", description: "Répondez.", icon: "📝" },
            { title: "Comment jouer ?", description: "Buzz.", icon: "🎯" },
          ],
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      (input: RequestInfo | URL): Promise<Response> => {
        const url = requestUrl(input);
        const body = url.includes("/api/tutorials")
          ? tutorials
          : url.includes("/api/parties/")
            ? playing.snaps.player
            : {};
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    );
    async function openTutorial(): Promise<void> {
      await act(async () => {
        emitSocket("party:tutorial", { gameKind: "quiz", canSkip: true });
      });
      await flush();
    }
    await openTutorial();
    expect(broadcast.textContent).toContain("Bienvenue au Quiz !");
    const close = broadcast.querySelector<HTMLButtonElement>(".bz-tutorial-close");
    expect(close?.textContent).toBe("×");
    // * 44 px is a Playwright measurement, not an inline-style stand-in.
    const compris = [...broadcast.querySelectorAll("button")].find((button) => button.textContent === "Compris");
    expect(compris).toBeDefined();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();
    expect(broadcast.textContent).not.toContain("Bienvenue au Quiz !");
    expect(localStorage.getItem(storageKey)).toBe("1");
    await openTutorial();
    expect(broadcast.textContent).not.toContain("Bienvenue au Quiz !");

    localStorage.removeItem(storageKey);
    await openTutorial();
    expect(broadcast.textContent).toContain("Bienvenue au Quiz !");
    const backdrop = broadcast.querySelector(".bz-tutorial-backdrop");
    await act(async () => {
      backdrop?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await flush();
    expect(broadcast.textContent).not.toContain("Bienvenue au Quiz !");
    expect(localStorage.getItem(storageKey)).toBe("1");

    localStorage.removeItem(storageKey);
    await openTutorial();
    const done = [...broadcast.querySelectorAll("button")].find((button) => button.textContent === "Compris");
    await act(async () => {
      done?.click();
    });
    await flush();
    expect(broadcast.textContent).not.toContain("Bienvenue au Quiz !");
    expect(localStorage.getItem(storageKey)).toBe("1");
  });
});
