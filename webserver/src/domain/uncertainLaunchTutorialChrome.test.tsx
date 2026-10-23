// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { launchedQuizParty } from "./launchedQuizParty.js";
import {
  emitAdminSocket,
  flushAdmin,
  releaseAdminScreens,
  showAdminScreen,
  type AdminRequest,
} from "./renderAdminScreen.js";

/**
 * * CHOIX INCERTAIN — Design UI, 2026-10-22, en attente de Minipen.
 *   Fenêtre de lancement : fond sombre plein écran, hors de la colonne d'aperçu
 *   (App.tsx, createPortal vers `.bz-app`, commentaire INCERTAIN au-dessus de `.bz-launch-overlay`).
 *   Tutoriel diffusion : plein écran sombre, croix et « Compris »
 *   (App.tsx, commentaire INCERTAIN au-dessus de `TutorialOverlay`).
 *
 *   Pour retirer ce choix : passer `FOREGROUND_DARK_CHROME` à `false`.
 *   Le test attendra alors le dialogue dans la colonne d'aperçu,
 *   et le tutoriel sans fond plein écran.
 *
 *   Les pixels (fond peint, croix d'au moins 44 px) restent un passage Playwright.
 */

const FOREGROUND_DARK_CHROME = true;

const SLIDE_TITLE = "Diapositive chrome incertain";

function begin(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
}

function tutorialsResponse(request: AdminRequest): Response | null {
  if (!request.url.includes("/api/tutorials")) return null;
  return new Response(
    JSON.stringify({
      tutorials: {
        quiz: {
          gameKind: "quiz",
          title: "Chrome",
          slides: [{ title: SLIDE_TITLE, description: "Texte.", icon: "🎮" }],
        },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(async () => {
  await releaseAdminScreens();
  vi.useRealTimers();
});

describe("CHOIX INCERTAIN — chrome de lancement et du tutoriel", () => {
  it("place « Comment lancer la manche ? » hors de la colonne d'aperçu", async () => {
    begin();
    const { party, host, player } = launchedQuizParty("ENONCE_CHROME_LANCEMENT");
    const page = await showAdminScreen(`/party/${party.id}/admin`, host, player, { hostToken: "host-token" });
    const launch = [...page.querySelectorAll<HTMLButtonElement>(".bz-host-controls button")].find((button) =>
      (button.textContent ?? "").includes("Lancer la manche"),
    );
    await act(async () => {
      launch?.click();
    });
    await flushAdmin();
    const overlay = document.querySelector<HTMLElement>(".bz-launch-overlay");
    expect(overlay?.textContent).toContain("Comment lancer la manche ?");
    const preview = page.querySelector(".bz-bc-preview-frame, .bz-host-aside");
    expect(preview).not.toBeNull();
    if (FOREGROUND_DARK_CHROME) {
      expect(overlay?.parentElement?.classList.contains("bz-app")).toBe(true);
      expect(overlay?.closest(".bz-host-aside, .bz-bc-preview-frame, .bz-host-layout")).toBeNull();
    } else {
      expect(overlay?.closest(".bz-host-aside, .bz-bc-preview-frame")).not.toBeNull();
    }
  });

  it("affiche le tutoriel de diffusion en plein écran avec sa croix et Compris", async () => {
    begin();
    const quiz = launchedQuizParty("ENONCE_CHROME_TUTORIEL");
    const page = await showAdminScreen(`/party/${quiz.party.id}/broadcast`, quiz.host, quiz.player, {
      hostToken: false,
      respond: tutorialsResponse,
    });
    await act(async () => {
      emitAdminSocket("party:tutorial", { gameKind: "quiz", canSkip: true });
    });
    for (let i = 0; i < 5 && !(page.textContent ?? "").includes(SLIDE_TITLE); i += 1) await flushAdmin();
    const backdrop = page.querySelector<HTMLElement>(".bz-tutorial-backdrop");
    if (FOREGROUND_DARK_CHROME) {
      expect(backdrop).not.toBeNull();
      expect(backdrop?.style.position).toBe("fixed");
      expect(backdrop?.style.top).toBe("0px");
      expect(backdrop?.style.left).toBe("0px");
      expect(backdrop?.style.right).toBe("0px");
      expect(backdrop?.style.bottom).toBe("0px");
      expect(backdrop?.style.backgroundColor.replace(/\s/g, "")).toBe("rgba(0,0,0,0.95)");
      expect(backdrop?.style.zIndex).toBe("10000");
      expect(backdrop?.closest(".bz-broadcast--preview")).toBeNull();
      expect(backdrop?.querySelector(".bz-tutorial-close")?.getAttribute("aria-label")).toBe("Fermer");
      expect(backdrop?.textContent).toContain("Compris");
    } else {
      expect(backdrop).toBeNull();
      expect(page.textContent).toContain(SLIDE_TITLE);
    }
  });

  it.todo("Playwright: « Comment lancer la manche ? » est centré sur un fond sombre qui couvre tout l'écran, au premier plan, pas dans la colonne d'aperçu");

  it.todo("Playwright: la croix du tutoriel de diffusion mesure au moins 44 px de côté");
});
