/**
 * * Host return link from the public broadcast screen.
 *   INCERTAIN: jeton animateur partagé entre onglets via localStorage, par partie, à confirmer par Minipen.
 *   sessionStorage reste la copie de l'onglet animateur. localStorage (même origine, jamais dans une URL)
 *   permet à l'onglet diffusion d'ouvrir le tableau. L'entrée est effacée quand la partie se termine.
 */

const HOST_TOKEN_LOCAL_PREFIX = "partygames:hostToken:";

/** * localStorage key for one party's host token. The key is the party id, not the token. */
export function hostTokenLocalStorageKey(partyId: string): string {
  return `${HOST_TOKEN_LOCAL_PREFIX}${partyId.trim().toLowerCase()}`;
}

/**
 * * Admin path with no credential.
 *   The host token must never be placed in this path, a hash, or a query string.
 */
export function hostAdminPath(partyId: string): string {
  return `/party/${encodeURIComponent(partyId.trim().toLowerCase())}/admin`;
}

interface TokenWrite {
  setItem: (key: string, value: string) => void;
}

interface TokenRead {
  getItem: (key: string) => string | null;
}

interface TokenForget {
  removeItem: (key: string) => void;
}

/** * Stores the host token for `partyId`. Empty tokens are ignored. */
export function rememberHostToken(storage: TokenWrite, partyId: string, token: string): void {
  const trimmed = token.trim();
  if (trimmed === "" || partyId.trim() === "") return;
  storage.setItem(hostTokenLocalStorageKey(partyId), trimmed);
}

/** * Reads the host token for `partyId`, or `null` when missing. */
export function readHostToken(storage: TokenRead, partyId: string): string | null {
  if (partyId.trim() === "") return null;
  const value = storage.getItem(hostTokenLocalStorageKey(partyId));
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** * Drops the shared host token when the party ends. */
export function forgetHostToken(storage: TokenForget, partyId: string): void {
  if (partyId.trim() === "") return;
  storage.removeItem(hostTokenLocalStorageKey(partyId));
}

/** * The broadcast link is hidden when this browser has no host token. */
export function shouldShowHostReturnLink(token: string | null | undefined): boolean {
  return typeof token === "string" && token.trim() !== "";
}
