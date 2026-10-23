// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { launchedQuizParty, type LaunchedQuiz } from "./launchedQuizParty.js";
import {
  emitAdminSocket,
  flushAdmin,
  releaseAdminScreens,
  showAdminScreen,
  type AdminRequest,
} from "./renderAdminScreen.js";

/**
 * * The broadcast tutorial closes from the cross, « Compris », Escape, or the backdrop.
 *   That close is remembered for the party: a later tutorial event stays hidden.
 *   The 44 px target is a Playwright check, not a happy-dom measurement.
 */

const SLIDE_TITLE = "Bienvenue au quiz diffusion";

const tutorials = {
  tutorials: {
    quiz: {
      gameKind: "quiz",
      title: "Quiz diffusion",
      slides: [{ title: SLIDE_TITLE, description: "Buzzez quand le buzzer s'ouvre.", icon: "📝" }],
    },
  },
};

function begin(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
}

function closedKey(partyId: string): string {
  return `partygames:broadcastTutorialClosed:${partyId}`;
}

function respondTutorials(): (request: AdminRequest) => Response | null {
  return (request: AdminRequest): Response | null => {
    if (!request.url.includes("/api/tutorials")) return null;
    return new Response(JSON.stringify(tutorials), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

async function showBroadcast(quiz: LaunchedQuiz): Promise<HTMLElement> {
  return showAdminScreen(`/party/${quiz.party.id}/broadcast`, quiz.host, quiz.player, {
    hostToken: false,
    respond: respondTutorials(),
  });
}

async function openTutorial(page: HTMLElement): Promise<void> {
  await act(async () => {
    emitAdminSocket("party:tutorial", { gameKind: "quiz", canSkip: true });
  });
  for (let i = 0; i < 5 && !(page.textContent ?? "").includes(SLIDE_TITLE); i += 1) {
    await flushAdmin();
  }
}

afterEach(async () => {
  await releaseAdminScreens();
  vi.useRealTimers();
});

describe("fermeture du tutoriel de la diffusion", () => {
  it("se ferme par la croix et ne se rouvre pas pour cette partie", async () => {
    begin();
    const quiz = launchedQuizParty("ENONCE_TUTO_CROIX");
    const id = quiz.party.id.toLowerCase();
    const page = await showBroadcast(quiz);
    await openTutorial(page);
    expect(page.textContent).toContain(SLIDE_TITLE);
    const close = page.querySelector<HTMLButtonElement>(".bz-tutorial-close");
    expect(close?.getAttribute("aria-label")).toBe("Fermer");
    await act(async () => {
      close?.click();
    });
    await flushAdmin();
    expect(page.textContent).not.toContain(SLIDE_TITLE);
    expect(localStorage.getItem(closedKey(id))).toBe("1");
    await openTutorial(page);
    expect(page.textContent).not.toContain(SLIDE_TITLE);
    expect(page.textContent).not.toContain("Chargement du tutoriel");
  });

  it("se ferme par Compris, et une autre partie montre encore le tutoriel", async () => {
    begin();
    const first = launchedQuizParty("ENONCE_TUTO_COMPRIS");
    const firstId = first.party.id.toLowerCase();
    const page = await showBroadcast(first);
    await openTutorial(page);
    expect(page.textContent).toContain(SLIDE_TITLE);
    const compris = [...page.querySelectorAll("button")].find((button) => button.textContent === "Compris");
    expect(compris).toBeDefined();
    await act(async () => {
      compris?.click();
    });
    await flushAdmin();
    expect(page.textContent).not.toContain(SLIDE_TITLE);
    expect(localStorage.getItem(closedKey(firstId))).toBe("1");
    await openTutorial(page);
    expect(page.textContent).not.toContain(SLIDE_TITLE);

    await releaseAdminScreens({ keepStorage: true });
    const second = launchedQuizParty("ENONCE_TUTO_AUTRE_PARTIE");
    const other = await showBroadcast(second);
    await openTutorial(other);
    expect(other.textContent).toContain(SLIDE_TITLE);
    expect(localStorage.getItem(closedKey(second.party.id.toLowerCase()))).toBeNull();
  });

  it("se ferme par Échap et ignore un nouvel événement", async () => {
    begin();
    const quiz = launchedQuizParty("ENONCE_TUTO_ECHAP");
    const id = quiz.party.id.toLowerCase();
    const page = await showBroadcast(quiz);
    await openTutorial(page);
    expect(page.textContent).toContain(SLIDE_TITLE);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flushAdmin();
    expect(page.textContent).not.toContain(SLIDE_TITLE);
    expect(localStorage.getItem(closedKey(id))).toBe("1");
    await openTutorial(page);
    expect(page.textContent).not.toContain(SLIDE_TITLE);
  });

  it("se ferme par un clic sur le fond, pas par un clic sur la diapositive", async () => {
    begin();
    const quiz = launchedQuizParty("ENONCE_TUTO_FOND");
    const id = quiz.party.id.toLowerCase();
    const page = await showBroadcast(quiz);
    await openTutorial(page);
    const backdrop = page.querySelector(".bz-tutorial-backdrop");
    expect(backdrop).not.toBeNull();
    const slide = [...(backdrop?.querySelectorAll("h2") ?? [])].find((node) => node.textContent === SLIDE_TITLE);
    await act(async () => {
      slide?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await flushAdmin();
    expect(page.textContent).toContain(SLIDE_TITLE);
    expect(localStorage.getItem(closedKey(id))).toBeNull();
    await act(async () => {
      backdrop?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await flushAdmin();
    expect(page.textContent).not.toContain(SLIDE_TITLE);
    expect(localStorage.getItem(closedKey(id))).toBe("1");
    await openTutorial(page);
    expect(page.textContent).not.toContain(SLIDE_TITLE);
  });
});
