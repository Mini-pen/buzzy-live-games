/**
 * * Mount path when the app is served behind a reverse-proxy sub-path
 *   (e.g. `/buzzy-live-games`). Empty string means "served at the domain root".
 *
 * Set once at startup from `BASE_PATH` (see `index.ts`). URL builders read it
 * so every link they hand to the browser carries the prefix, while Traefik's
 * `StripPrefix` middleware removes it again before the request reaches Fastify.
 */
let basePath = "";

/** * Normalises a raw `BASE_PATH` value to `""` or `/segment` (no trailing slash). */
export function normaliseBasePath(raw: string | undefined | null): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/u, "");
  if (trimmed === "") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function setBasePath(raw: string | undefined | null): void {
  basePath = normaliseBasePath(raw);
}

export function getBasePath(): string {
  return basePath;
}

/** * Prefixes a root-relative app path (`/games/…`, `/avatars/…`) with the mount path. */
export function withBasePath(rootRelative: string): string {
  if (basePath === "" || !rootRelative.startsWith("/")) return rootRelative;
  return `${basePath}${rootRelative}`;
}
