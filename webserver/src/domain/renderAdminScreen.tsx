// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

import App from "../../client/src/App";
import type { PartyPublicSnapshot } from "./types.js";

/**
 * * Mounts the animateur (and, when asked, the phone or the broadcast) on a live snapshot getter.
 *   A host action can mutate the party; the next response reads the getter again.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** * Last `party:patch` listener. A test pushes a stale snapshot through it while a field is focused. */
export const socketSink: { onPatch: ((snapshot: unknown) => void) | null } = { onPatch: null };

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: (event: string, cb: (payload: unknown) => void) => {
      if (event === "party:patch") socketSink.onPatch = cb;
    },
    off: () => undefined,
    disconnect: () => undefined,
    emit: () => undefined,
  }),
}));

/** * One fetch issued by the mounted page. */
export interface AdminRequest {
  url: string;
  method: string;
  body: string;
  authorization: string;
}

/** * Requests since the last `showAdminScreen` call. */
export const adminRequests: AdminRequest[] = [];

const roots: Root[] = [];
const renderErrors: unknown[] = [];

/** * Replaces the default party JSON for one request. `null` keeps the default. */
let responder: ((request: AdminRequest) => Response | null) | null = null;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** * Installs fetch. `host` is used when the request carries a Bearer; otherwise `player`. */
export function installAdminFetch(
  host: () => PartyPublicSnapshot,
  player: () => PartyPublicSnapshot,
): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    const request: AdminRequest = {
      url,
      method,
      body: typeof init?.body === "string" ? init.body : "",
      authorization,
    };
    adminRequests.push(request);
    const overridden = responder?.(request);
    if (overridden) return Promise.resolve(overridden);
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
      body = authorization.toLowerCase().startsWith("bearer ") ? host() : player();
    }
    return Promise.resolve(json(body));
  });
}

/** * Raw or JSON error body. The page is expected to show a French sentence instead. */
export function httpError(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

function rememberPlayer(partyId: string, playerId: string): void {
  const body = btoa(JSON.stringify({ sub: playerId }));
  sessionStorage.setItem(`partygames:playerJwt:${partyId.toLowerCase()}`, `e.${body}.s`);
}

/** * Lets the mounted page settle one macrotask under fake timers. */
export async function flushAdmin(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function screenSettled(container: HTMLElement, route: string, settleOnTokenWall: boolean): boolean {
  const text = container.textContent ?? "";
  if (settleOnTokenWall && text.includes("Jeton animateur absent ou lien incomplet")) return true;
  if (text.includes("Partie indisponible") || text.includes("Partie introuvable")) return false;
  if (route.includes("/broadcast")) {
    return container.querySelector(".bz-broadcast") !== null && !text.includes("Connexion à la partie");
  }
  if (route.includes("/admin")) {
    return container.querySelector(".bz-board, .bz-host-controls, .bz-projected-card") !== null;
  }
  return container.querySelector(".bz-podium, .bz-buzz-btn, .bz-play-screen, .bz-board") !== null;
}

export interface ShowAdminOptions {
  /** * Stored before paint. `false` leaves localStorage untouched. */
  hostToken?: string | false;
  playerId?: string;
  /** * When the token wall is a result the test asserts, do not throw on it. */
  settleOnTokenWall?: boolean;
  respond?: (request: AdminRequest) => Response | null;
}

/**
 * * Mounts `App` on `route`.
 *   Callers start fake timers first. The hash is whatever `window.location.hash` already is.
 */
export async function showAdminScreen(
  route: string,
  host: () => PartyPublicSnapshot,
  player: () => PartyPublicSnapshot,
  options?: ShowAdminOptions,
): Promise<HTMLElement> {
  adminRequests.length = 0;
  socketSink.onPatch = null;
  responder = options?.respond ?? null;
  installAdminFetch(host, player);
  if (route.includes("/play")) rememberPlayer(host().id, options?.playerId ?? "alice");
  if (route.includes("/admin") && typeof options?.hostToken === "string") {
    localStorage.setItem(`partygames:hostToken:${host().id.toLowerCase()}`, options.hostToken);
  }
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
  for (let i = 0; i < 10; i += 1) {
    await flushAdmin();
    if (screenSettled(container, route, options?.settleOnTokenWall === true)) {
      if (renderErrors.length > 0) throw renderErrors[0];
      return container;
    }
  }
  throw new Error(`screen did not leave loading on ${route}: ${(container.textContent ?? "").slice(0, 280)}`);
}

/** * Drops every mounted route. Storage and the hash stay when the matching flag is set. */
export async function releaseAdminScreens(options?: { keepStorage?: boolean; keepHash?: boolean }): Promise<void> {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  renderErrors.length = 0;
  responder = null;
  socketSink.onPatch = null;
  document.body.replaceChildren();
  if (options?.keepStorage !== true) {
    localStorage.clear();
    sessionStorage.clear();
  }
  if (options?.keepHash !== true) window.location.hash = "";
  vi.unstubAllGlobals();
}
