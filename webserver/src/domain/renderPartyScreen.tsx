// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

import App from "../../client/src/App";
import type { PartyPublicSnapshot } from "./types.js";

/**
 * * Renders a phone or broadcast route against one frozen snapshot.
 *   happy-dom does not measure overlap; callers leave that to Playwright.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: () => undefined,
    off: () => undefined,
    disconnect: () => undefined,
    emit: () => undefined,
  }),
}));

const roots: Root[] = [];
const renderErrors: unknown[] = [];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** * Serves the snapshot the phone and the broadcast would receive. */
export function installPartyFetch(snapshot: PartyPublicSnapshot): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL): Promise<Response> => {
    const url = requestUrl(input);
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
      body = snapshot;
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

function rememberPlayer(partyId: string, playerId: string): void {
  const body = btoa(JSON.stringify({ sub: playerId }));
  sessionStorage.setItem(`partygames:playerJwt:${partyId}`, `e.${body}.s`);
}

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function screenReady(container: HTMLElement, route: string): boolean {
  const text = container.textContent ?? "";
  if (text.includes("Partie indisponible") || text.includes("Partie introuvable")) return false;
  if (route.includes("/broadcast")) {
    return container.querySelector(".bz-broadcast") !== null && !text.includes("Connexion à la partie");
  }
  return container.querySelector(".bz-podium, .bz-buzz-btn, .bz-play-screen, .bz-board") !== null;
}

/** * Mounts App on `route`. Callers turn fake timers on first. */
export async function showPartyScreen(
  route: string,
  snapshot: PartyPublicSnapshot,
  playerId = "alice",
): Promise<HTMLElement> {
  installPartyFetch(snapshot);
  if (route.includes("/play")) rememberPlayer(snapshot.id, playerId);
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
    if (screenReady(container, route)) {
      if (renderErrors.length > 0) throw renderErrors[0];
      return container;
    }
  }
  throw new Error(`screen did not leave loading on ${route}: ${(container.textContent ?? "").slice(0, 240)}`);
}

/** * Moves the frozen clock. The podium and the countdown both read `Date.now()`. */
export async function settleScreen(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** * Drops every mounted route. Safe to call from `afterEach`. */
export async function releaseRenderedScreens(): Promise<void> {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  renderErrors.length = 0;
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
}
