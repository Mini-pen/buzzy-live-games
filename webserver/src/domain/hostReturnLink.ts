/**
 * * Host return link from the public broadcast screen.
 *   The host token lives only in localStorage, one entry per party, same origin, never in a URL.
 *   The entry is cleared when the party ends.
 *   A legacy sessionStorage copy (`partygames:adminToken:`) is read once, written here, then deleted.
 */

const HOST_TOKEN_LOCAL_PREFIX = "partygames:hostToken:";

const LEGACY_HOST_TOKEN_SESSION_PREFIX = "partygames:adminToken:";

/** * Storage surface used for the host token and its one-time session migration. */
export interface HostTokenBucket {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

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

/** * Party ids that currently have a host token in `storage`. */
export function listStoredHostPartyIds(storage: HostTokenBucket): string[] {
  const ids: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key === null || !key.startsWith(HOST_TOKEN_LOCAL_PREFIX)) continue;
    const id = key.slice(HOST_TOKEN_LOCAL_PREFIX.length);
    const token = storage.getItem(key);
    if (typeof token === "string" && token.trim() !== "") ids.push(id);
  }
  ids.sort();
  return ids;
}

/**
 * * Copies every legacy sessionStorage host token into localStorage, then deletes the session copy.
 *   An existing localStorage entry wins. A second call finds nothing to move.
 */
export function migrateLegacyHostTokens(session: HostTokenBucket, local: HostTokenBucket): void {
  const keys: string[] = [];
  for (let i = 0; i < session.length; i += 1) {
    const key = session.key(i);
    if (key !== null && key.startsWith(LEGACY_HOST_TOKEN_SESSION_PREFIX)) keys.push(key);
  }
  for (const key of keys) {
    const partyId = key.slice(LEGACY_HOST_TOKEN_SESSION_PREFIX.length);
    const raw = session.getItem(key);
    if (typeof raw === "string" && raw.trim() !== "" && readHostToken(local, partyId) === null) {
      rememberHostToken(local, partyId, raw);
    }
    session.removeItem(key);
  }
}

/** * Deletes a legacy sessionStorage host token without copying it. */
export function forgetLegacyHostToken(session: HostTokenBucket, partyId: string): void {
  const needle = partyId.trim().toLowerCase();
  if (needle === "") return;
  const keys: string[] = [];
  for (let i = 0; i < session.length; i += 1) {
    const key = session.key(i);
    if (key === null || !key.startsWith(LEGACY_HOST_TOKEN_SESSION_PREFIX)) continue;
    const id = key.slice(LEGACY_HOST_TOKEN_SESSION_PREFIX.length);
    if (id.trim().toLowerCase() === needle) keys.push(key);
  }
  for (const key of keys) session.removeItem(key);
}
