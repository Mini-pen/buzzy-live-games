/**
 * * Reverse-proxy mount path helpers.
 *
 * `import.meta.env.BASE_URL` is Vite's `base` option (see `client/vite.config.ts`):
 * `/` when the app is served at the domain root, `/buzzy-live-games/` when it is
 * served behind that sub-path. Traefik strips the prefix before the request
 * reaches the server, so every absolute link the client builds must re-add it.
 */
const rawBase = import.meta.env.BASE_URL || "/";

/** * `""` at the domain root, otherwise `/buzzy-live-games` (no trailing slash). */
export const BASE_PATH = rawBase.replace(/\/+$/u, "");

/** * Prefix an absolute app path (`/api/…`, `/party/…`) with the mount path. */
export function withBase(pathAbs: string): string {
  if (BASE_PATH === "" || !pathAbs.startsWith("/")) return pathAbs;
  return `${BASE_PATH}${pathAbs}`;
}

/** * Socket.IO endpoint path, mount-aware (`/buzzy-live-games/socket.io`). */
export const SOCKET_PATH = `${BASE_PATH}/socket.io`;
