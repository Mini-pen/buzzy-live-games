/**
 * * French text for a failed host action.
 *   The raw status and error code stay on the wire; the animateur sees a sentence.
 */

const HOST_ERROR_FR: Record<string, string> = {
  NOT_FOUND: "Partie introuvable. Cette partie n'est plus sur le serveur.",
  PACK_NOT_FOUND: "Pack de la manche introuvable.",
  UNAUTHORIZED: "Jeton animateur refusé. Rouvrez le lien reçu à la création.",
  HOSTED_VIDEO_NOT_FOUND: "Vidéo introuvable.",
  EDITOR_SESSION_NOT_FOUND: "Session d'édition introuvable.",
};

/** * Turns an HTTP error body into one French sentence. */
export function frenchHostFailure(status: number, bodyText: string): string {
  let code = "";
  let message = "";
  const text = bodyText.trim();
  if (text !== "") {
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      if (typeof parsed.error === "string") code = parsed.error;
      if (typeof parsed.message === "string") message = parsed.message;
    } catch {
      message = text;
    }
  }
  const rawCode = message.match(/^\d{3}:([A-Z0-9_]+)$/);
  if (rawCode !== null && HOST_ERROR_FR[rawCode[1]!] !== undefined) return HOST_ERROR_FR[rawCode[1]!]!;
  if (message !== "" && message !== code) return message;
  if (code !== "" && HOST_ERROR_FR[code] !== undefined) return HOST_ERROR_FR[code]!;
  if (status === 404) return HOST_ERROR_FR.NOT_FOUND!;
  return "Action impossible. Réessayez.";
}
