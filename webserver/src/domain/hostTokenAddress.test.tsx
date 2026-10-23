// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { launchedQuizParty } from "./launchedQuizParty.js";
import { adminRequests, httpError, releaseAdminScreens, showAdminScreen } from "./renderAdminScreen.js";

/**
 * * The host token is read from `#token=` once, stored, then removed from the address.
 *   A missing party (404) keeps that entry. A refused token (401/403) drops it.
 */

const TOKEN = "secret-host-token-address";

function tokenKey(partyId: string): string {
  return `partygames:hostToken:${partyId}`;
}

function begin(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
}

function partyStatus(status: number, error: string) {
  return (request: { url: string; method: string }) => {
    if (request.method === "GET" && request.url.includes("/api/parties/")) {
      return httpError(status, JSON.stringify({ error }));
    }
    return null;
  };
}

afterEach(async () => {
  await releaseAdminScreens();
  vi.useRealTimers();
});

describe("jeton animateur retiré de l'adresse", () => {
  it("retire #token dès que le même jeton est relu dans le localStorage", async () => {
    begin();
    const { party, host, player } = launchedQuizParty("ENONCE_HASH_RETIRE");
    const id = party.id.toLowerCase();
    localStorage.clear();
    window.location.hash = `#token=${TOKEN}&panneau=scores`;
    const page = await showAdminScreen(`/party/${id}/admin`, host, player, {
      hostToken: false,
      settleOnTokenWall: true,
    });
    expect(page.querySelector(".bz-host-controls")).not.toBeNull();
    expect(page.textContent).toContain("ENONCE_HASH_RETIRE");
    expect(page.textContent).not.toContain("Jeton animateur absent ou lien incomplet");
    expect(localStorage.getItem(tokenKey(id))).toBe(TOKEN);
    expect(window.location.hash.includes("token=")).toBe(false);
    expect(window.location.hash).toContain("panneau=scores");
    expect(page.innerHTML).not.toContain(TOKEN);
    expect(adminRequests.some((request) => request.url.includes(TOKEN) || request.url.includes("token="))).toBe(false);
    expect(adminRequests.some((request) => request.authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("garde le jeton sur un 404 Partie introuvable, et le rechargement n'affiche pas Jeton animateur absent", async () => {
    begin();
    const { party, host, player } = launchedQuizParty("ENONCE_APRES_404");
    const id = party.id.toLowerCase();
    localStorage.clear();
    window.location.hash = `#token=${TOKEN}`;
    const missing = await showAdminScreen(`/party/${id}/admin`, host, player, {
      hostToken: false,
      settleOnUnavailable: true,
      respond: partyStatus(404, "NOT_FOUND"),
    });
    // * The exact 404 sentence is an uncertain choice. This test only locks the CDC rule:
    //   the stored token survives, and the address no longer carries `#token`.
    expect(missing.querySelector(".bz-host-controls")).toBeNull();
    expect(missing.textContent).not.toContain("Jeton animateur absent");
    expect(localStorage.getItem(tokenKey(id))).toBe(TOKEN);
    expect(window.location.hash.includes("token=")).toBe(false);
    expect(missing.innerHTML.includes("#token=")).toBe(false);
    expect(missing.innerHTML).not.toContain(TOKEN);
    expect(adminRequests.some((request) => request.authorization === `Bearer ${TOKEN}`)).toBe(true);

    await releaseAdminScreens({ keepStorage: true });
    window.location.hash = "";
    const reloaded = await showAdminScreen(`/party/${id}/admin`, host, player, {
      hostToken: false,
      settleOnTokenWall: true,
    });
    expect(reloaded.textContent).not.toContain("Jeton animateur absent");
    expect(reloaded.querySelector(".bz-host-controls")).not.toBeNull();
    expect(reloaded.textContent).toContain("ENONCE_APRES_404");
    expect(localStorage.getItem(tokenKey(id))).toBe(TOKEN);
    expect(window.location.hash.includes("token=")).toBe(false);
  });

  it("efface le jeton quand le serveur le refuse par 401", async () => {
    begin();
    const { party, host, player } = launchedQuizParty("ENONCE_401");
    const id = party.id.toLowerCase();
    localStorage.clear();
    window.location.hash = `#token=${TOKEN}`;
    const refused = await showAdminScreen(`/party/${id}/admin`, host, player, {
      hostToken: false,
      settleOnUnavailable: true,
      respond: partyStatus(401, "UNAUTHORIZED"),
    });
    expect(refused.textContent).toContain("Jeton refusé");
    expect(refused.textContent).toContain("Jeton animateur refusé");
    expect(localStorage.getItem(tokenKey(id))).toBeNull();
    expect(window.location.hash.includes("token=")).toBe(false);

    await releaseAdminScreens({ keepStorage: true });
    window.location.hash = "";
    const reloaded = await showAdminScreen(`/party/${id}/admin`, host, player, {
      hostToken: false,
      settleOnTokenWall: true,
    });
    expect(reloaded.textContent).toContain("Jeton animateur absent ou lien incomplet");
    expect(reloaded.querySelector(".bz-host-controls")).toBeNull();
  });

  // * Cause: loadPartySnapshot only treats status 401 or error UNAUTHORIZED as a refused token
  //   (App.tsx:963). A 403 FORBIDDEN stays an http_error, and Admin erases the stored token
  //   only in the bad_token branch (App.tsx:3890-3894). The screen stays « Partie indisponible »
  //   and localStorage keeps the token.
  it.fails("efface le jeton quand le serveur le refuse par 403", async () => {
    begin();
    const { party, host, player } = launchedQuizParty("ENONCE_403");
    const id = party.id.toLowerCase();
    localStorage.clear();
    window.location.hash = `#token=${TOKEN}`;
    const refused = await showAdminScreen(`/party/${id}/admin`, host, player, {
      hostToken: false,
      settleOnUnavailable: true,
      respond: partyStatus(403, "FORBIDDEN"),
    });
    expect(refused.textContent).toContain("Jeton refusé");
    expect(localStorage.getItem(tokenKey(id))).toBeNull();

    await releaseAdminScreens({ keepStorage: true });
    window.location.hash = "";
    const reloaded = await showAdminScreen(`/party/${id}/admin`, host, player, {
      hostToken: false,
      settleOnTokenWall: true,
    });
    expect(reloaded.textContent).toContain("Jeton animateur absent ou lien incomplet");
  });
});
