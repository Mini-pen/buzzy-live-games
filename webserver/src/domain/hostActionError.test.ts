import { describe, expect, it } from "vitest";

import { frenchHostFailure } from "./hostActionError.js";

describe("french host errors", () => {
  it("turns a raw 404 into a French sentence", () => {
    expect(frenchHostFailure(404, JSON.stringify({ error: "NOT_FOUND", message: "NOT_FOUND" }))).toBe(
      "Partie introuvable. Cette partie n'est plus sur le serveur.",
    );
    expect(frenchHostFailure(404, "404:NOT_FOUND")).not.toContain("404:NOT_FOUND");
    expect(frenchHostFailure(401, JSON.stringify({ error: "UNAUTHORIZED", message: "UNAUTHORIZED" }))).toContain(
      "Jeton animateur refusé",
    );
  });

  it("keeps a French server sentence instead of the error code", () => {
    const message = "Fin des questions de cette manche — passez à la suivante ou mettez en pause.";
    expect(frenchHostFailure(409, JSON.stringify({ error: "ROUND_EXHAUSTED", message }))).toBe(message);
    expect(
      frenchHostFailure(400, JSON.stringify({ error: "BAD_PHASE", message: "Lancez la manche avant d'aller à cette question." })),
    ).toBe("Lancez la manche avant d'aller à cette question.");
  });
});
