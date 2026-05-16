import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".ogv", ".m4v"]);

export interface HostedGameVideoEntry {
  /** * Display name (filename). */
  name: string;
  /** * Root-relative URL served by the app (`/games/video/…`). */
  url: string;
}

/** * Lists flat `GAMES_DIR/video/*` media files (non-recursive). */
export async function listHostedGameVideos(gamesDir: string): Promise<HostedGameVideoEntry[]> {
  const root = path.join(gamesDir, "video");
  let names: string[];
  try {
    names = await fsPromises.readdir(root);
  } catch (e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") return [];
    throw e;
  }
  const out: HostedGameVideoEntry[] = [];
  for (const name of names.sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }))) {
    if (name.startsWith(".")) continue;
    const ext = path.extname(name).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) continue;
    const abs = path.join(root, name);
    let st: fs.Stats;
    try {
      st = await fsPromises.stat(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    out.push({ name, url: `/games/video/${encodeURIComponent(name)}` });
  }
  return out;
}

/**
 * * Validates a `direct_video` manche URL: HTTPS stream, or a single file under `games/video/`
 *   that exists on disk.
 */
export function assertDirectVideoUrlForPartyManche(gamesDir: string, urlRaw: string): string {
  const url = urlRaw.trim();
  if (url.startsWith("https://")) {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") throw new Error("not https");
    } catch {
      throw Object.assign(new Error("URL HTTPS invalide."), { code: "BAD_VIDEO_URL" });
    }
    if (url.length > 2048) {
      throw Object.assign(new Error("URL trop longue."), { code: "BAD_VIDEO_URL" });
    }
    return url;
  }

  if (!url.startsWith("/games/video/")) {
    throw Object.assign(
      new Error("Vidéo hébergée : choisir un fichier listé ou une URL HTTPS."),
      { code: "BAD_VIDEO_URL" },
    );
  }

  const rest = url.slice("/games/video/".length);
  if (rest === "" || rest.includes("/")) {
    throw Object.assign(
      new Error("Seuls les fichiers à la racine de games/video/ sont supportés."),
      { code: "BAD_VIDEO_URL" },
    );
  }

  let fileName: string;
  try {
    fileName = decodeURIComponent(rest);
  } catch {
    throw Object.assign(new Error("Nom de fichier encodé invalide."), { code: "BAD_VIDEO_URL" });
  }

  if (
    fileName === "" ||
    fileName.includes("/") ||
    fileName.includes(path.sep) ||
    fileName.includes("..") ||
    fileName.startsWith(".")
  ) {
    throw Object.assign(new Error("Nom de fichier invalide."), { code: "BAD_VIDEO_URL" });
  }

  const ext = path.extname(fileName).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(ext)) {
    throw Object.assign(new Error("Extension vidéo non prise en charge."), { code: "BAD_VIDEO_EXT" });
  }

  const root = path.resolve(path.join(gamesDir, "video"));
  const abs = path.resolve(path.join(root, fileName));
  if (!abs.startsWith(root + path.sep)) {
    throw Object.assign(new Error("Chemin hors du dossier vidéo."), { code: "BAD_VIDEO_URL" });
  }

  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error("not file");
  } catch {
    throw Object.assign(
      new Error("Fichier vidéo introuvable sous games/video/. Recharge la liste après copie."),
      { code: "HOSTED_VIDEO_NOT_FOUND" },
    );
  }

  return `/games/video/${encodeURIComponent(fileName)}`;
}
