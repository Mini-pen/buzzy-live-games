// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { launchedQuizParty } from "./launchedQuizParty.js";
import { adminRequests, flushAdmin, releaseAdminScreens, showAdminScreen } from "./renderAdminScreen.js";

/**
 * * « Lancer la manche » opens a choice, posts the chosen mode, and closes.
 *   Where that window sits, and its dark scrim, are the uncertain chrome test.
 */

function begin(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
}

function launchButton(page: HTMLElement): HTMLButtonElement | undefined {
  return [...page.querySelectorAll<HTMLButtonElement>(".bz-host-controls button")].find((button) =>
    (button.textContent ?? "").includes("Lancer la manche"),
  );
}

function modeButton(overlay: Element, label: string): HTMLButtonElement | undefined {
  return [...overlay.querySelectorAll("button")].find((button) => (button.textContent ?? "").includes(label));
}

afterEach(async () => {
  await releaseAdminScreens();
  vi.useRealTimers();
});

describe("fenêtre Comment lancer la manche", () => {
  it("poste le mode choisi puis se ferme, et Annuler ou le fond ferment sans poster", async () => {
    begin();
    const { party, host, player } = launchedQuizParty("ENONCE_LANCEMENT");
    const mancheId = party.mancheScript[0]!.id;
    const page = await showAdminScreen(`/party/${party.id}/admin`, host, player, { hostToken: "host-token" });
    expect(page.textContent).toContain("ENONCE_LANCEMENT");
    const open = launchButton(page);
    expect(open).toBeDefined();

    await act(async () => {
      open?.click();
    });
    await flushAdmin();
    const overlay = document.querySelector(".bz-launch-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("Comment lancer la manche ?");
    expect(overlay?.textContent).toContain("Mode normal");
    expect(overlay?.textContent).toContain("Mode autonome");

    const dialog = overlay?.querySelector("[role='dialog']");
    await act(async () => {
      dialog?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await flushAdmin();
    expect(document.querySelector(".bz-launch-overlay")).not.toBeNull();
    expect(adminRequests.some((request) => request.url.includes("/host/manche/launch"))).toBe(false);

    await act(async () => {
      overlay?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await flushAdmin();
    expect(document.querySelector(".bz-launch-overlay")).toBeNull();
    expect(adminRequests.some((request) => request.url.includes("/host/manche/launch"))).toBe(false);

    await act(async () => {
      launchButton(page)?.click();
    });
    await flushAdmin();
    const again = document.querySelector(".bz-launch-overlay");
    const cancel = [...(again?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Annuler");
    await act(async () => {
      cancel?.click();
    });
    await flushAdmin();
    expect(document.querySelector(".bz-launch-overlay")).toBeNull();
    expect(adminRequests.some((request) => request.url.includes("/host/manche/launch"))).toBe(false);

    await act(async () => {
      launchButton(page)?.click();
    });
    await flushAdmin();
    const choosing = document.querySelector(".bz-launch-overlay");
    expect(choosing).not.toBeNull();
    await act(async () => {
      modeButton(choosing!, "Mode normal")?.click();
    });
    await flushAdmin();
    const normal = adminRequests.find((request) => request.url.includes("/host/manche/launch"));
    expect(normal?.body).toContain(`"id":"${mancheId}"`);
    expect(normal?.body).toContain('"mode":"normal"');
    expect(normal?.body).toContain('"skipIntro":false');
    expect(document.querySelector(".bz-launch-overlay")).toBeNull();

    await act(async () => {
      launchButton(page)?.click();
    });
    await flushAdmin();
    const autoOverlay = document.querySelector(".bz-launch-overlay");
    await act(async () => {
      modeButton(autoOverlay!, "Mode autonome")?.click();
    });
    await flushAdmin();
    const posted = adminRequests.filter((request) => request.url.includes("/host/manche/launch"));
    expect(posted).toHaveLength(2);
    expect(posted[1]?.body).toContain('"mode":"autonomous"');
    expect(document.querySelector(".bz-launch-overlay")).toBeNull();
    expect(page.querySelector(".bz-host-controls")).not.toBeNull();
  });
});
