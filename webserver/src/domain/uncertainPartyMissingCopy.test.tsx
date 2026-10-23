// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { launchedQuizParty } from "./launchedQuizParty.js";
import { httpError, releaseAdminScreens, showAdminScreen } from "./renderAdminScreen.js";

/**
 * * CHOIX INCERTAIN (Test Writer, 2026-10-23) — libellé de l'écran animateur sur un 404.
 *   Ne tranche pas. Le jeton conservé et l'absence de `#token` sont dans `hostTokenAddress.test.tsx`.
 *
 *   CDC §2.9 : la phrase conservée est « Partie introuvable. ».
 *   Écart déjà noté (f81d3ec) : « Partie introuvable. Cette partie n'est plus sur le serveur. »
 *   Le code (App.tsx:4760-4778) affiche un titre sans point, le paragraphe d'inactivité,
 *   et le bouton « Retour à l'accueil ».
 *
 *   Pour revenir à la phrase courte du §2.9 : passer `LONG_MISSING_PARTY_COPY` à `false`.
 */

const LONG_MISSING_PARTY_COPY = true;

const LONG_BODY =
  "Cette partie n'existe plus côté serveur (inactivité ou redémarrage). Le lien « Reprendre » sur l'accueil ne peut pas restaurer une partie effacée.";

const TOKEN = "secret-host-token-missing-copy";

function begin(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
}

afterEach(async () => {
  await releaseAdminScreens();
  vi.useRealTimers();
});

describe("CHOIX INCERTAIN — libellé Partie introuvable", () => {
  it("affiche le texte actuel du code, ou seulement la phrase du §2.9", async () => {
    begin();
    const { party, host, player } = launchedQuizParty("ENONCE_LIBELLE_404");
    const id = party.id.toLowerCase();
    localStorage.clear();
    window.location.hash = `#token=${TOKEN}`;
    const page = await showAdminScreen(`/party/${id}/admin`, host, player, {
      hostToken: false,
      settleOnUnavailable: true,
      respond: (request) => {
        if (request.method === "GET" && request.url.includes("/api/parties/")) {
          return httpError(404, JSON.stringify({ error: "NOT_FOUND" }));
        }
        return null;
      },
    });
    const heading = page.querySelector("h2")?.textContent?.trim();
    const body = page.querySelector(".bz-card p")?.textContent?.trim();
    const button = page.querySelector(".bz-card button")?.textContent?.trim();
    if (LONG_MISSING_PARTY_COPY) {
      expect(heading).toBe("Partie introuvable");
      expect(body).toBe(LONG_BODY);
      expect(button).toBe("Retour à l'accueil");
    } else {
      expect(page.textContent).toContain("Partie introuvable.");
      expect(page.textContent).not.toContain("n'existe plus côté serveur");
      expect(page.textContent).not.toContain("Cette partie n'est plus sur le serveur");
    }
  });
});
