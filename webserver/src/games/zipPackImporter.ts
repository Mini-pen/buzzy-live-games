import AdmZip from "adm-zip";
import path from "node:path";
import { z } from "zod";

import { quizPackSchema, type QuizPack } from "./pack.js";

/** * Max ZIP file size (configurable via env). */
export const DEFAULT_MAX_ZIP_BYTES = 50 * 1024 * 1024;

/**
 * Pre-process pack JSON to prefix relative media paths with "games/"
 * so they pass optionalPublicUrlSchema validation (which rejects plain relative paths).
 * This allows ZIP packs to reference media with simple paths like "images/x.png".
 */
function prefixRelativeMediaPaths(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(prefixRelativeMediaPaths);

  const record = obj as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    // * URL fields that optionalPublicUrlSchema validates
    if (
      (key === "imageUrl" || key === "videoUrl" || key === "audioUrl") &&
      typeof value === "string"
    ) {
      const trimmed = value.trim();
      // * Prefix relative paths (not starting with /, http, https, or games/)
      if (
        !trimmed.startsWith("/") &&
        !trimmed.startsWith("http://") &&
        !trimmed.startsWith("https://") &&
        !trimmed.startsWith("games/")
      ) {
        result[key] = `games/${trimmed}`;
      } else {
        result[key] = value;
      }
    } else if (typeof value === "object") {
      result[key] = prefixRelativeMediaPaths(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/** * In-memory storage for imported packs (process-scoped, not persisted). */
export class ImportedPackStore {
  private readonly packsById = new Map<string, { pack: QuizPack; zipEntries: AdmZip.IZipEntry[] }>();

  public has(id: string): boolean {
    return this.packsById.has(id);
  }

  public get(id: string): QuizPack | undefined {
    return this.packsById.get(id)?.pack;
  }

  public getAll(): Map<string, QuizPack> {
    const result = new Map<string, QuizPack>();
    for (const [id, { pack }] of this.packsById) {
      result.set(id, pack);
    }
    return result;
  }

  public getMediaEntry(packId: string, relativePath: string): Buffer | null {
    const entry = this.packsById.get(packId);
    if (!entry) return null;

    const normalized = relativePath.replace(/\\/gu, "/");
    const zipEntry = entry.zipEntries.find((e) => {
      const eName = e.entryName.replace(/\\/gu, "/");
      return eName === normalized;
    });

    if (!zipEntry || zipEntry.isDirectory) return null;
    try {
      return zipEntry.getData();
    } catch {
      return null;
    }
  }

  public add(pack: QuizPack, zipEntries: AdmZip.IZipEntry[]): void {
    this.packsById.set(pack.id, { pack, zipEntries });
  }
}

/** * Validates a ZIP file and extracts a quiz pack. */
export function importZipPack(
  buffer: Buffer,
  maxSizeBytes: number,
  existingDiskPackIds: Set<string>,
  existingImportedPackIds: Set<string>,
): { pack: QuizPack; zipEntries: AdmZip.IZipEntry[] } {
  if (buffer.length > maxSizeBytes) {
    throw Object.assign(
      new Error(`Le fichier ZIP dépasse la limite de ${Math.floor(maxSizeBytes / (1024 * 1024))} Mo.`),
      { code: "ZIP_TOO_LARGE" },
    );
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw Object.assign(
      new Error("Le fichier ZIP est corrompu ou invalide."),
      { code: "ZIP_CORRUPT" },
    );
  }

  const entries = zip.getEntries();

  // * Check for path traversal
  for (const entry of entries) {
    const normalized = path.normalize(entry.entryName);
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
      throw Object.assign(
        new Error("Le ZIP contient des chemins interdits (tentative d'échappement du répertoire)."),
        { code: "ZIP_PATH_TRAVERSAL" },
      );
    }
  }

  // * Find JSON files
  const jsonEntries = entries.filter(
    (e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".json"),
  );

  if (jsonEntries.length === 0) {
    throw Object.assign(
      new Error("Le ZIP ne contient aucun fichier JSON de pack."),
      { code: "ZIP_NO_JSON" },
    );
  }

  if (jsonEntries.length > 1) {
    throw Object.assign(
      new Error("Le ZIP contient plusieurs fichiers JSON. Un seul pack par archive est autorisé."),
      { code: "ZIP_MULTIPLE_JSON" },
    );
  }

  const jsonEntry = jsonEntries[0]!;
  let packJson: unknown;
  try {
    const raw = jsonEntry.getData().toString("utf8");
    packJson = JSON.parse(raw);
  } catch {
    throw Object.assign(
      new Error("Le fichier JSON du pack est invalide ou illisible."),
      { code: "JSON_INVALID" },
    );
  }

  // * Pre-process the JSON to prefix relative media paths with "games/"
  // * so they pass optionalPublicUrlSchema validation.
  packJson = prefixRelativeMediaPaths(packJson);

  let pack: QuizPack;
  try {
    pack = quizPackSchema.parse(packJson);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      const msg = first
        ? `Validation du pack échouée : ${first.path.join(".")} - ${first.message}`
        : "Le pack JSON ne respecte pas le format attendu.";
      throw Object.assign(new Error(msg), { code: "JSON_SCHEMA_INVALID" });
    }
    throw Object.assign(
      new Error("Le pack JSON ne respecte pas le format attendu."),
      { code: "JSON_SCHEMA_INVALID" },
    );
  }

  // * Check for id collision
  if (existingDiskPackIds.has(pack.id) || existingImportedPackIds.has(pack.id)) {
    throw Object.assign(
      new Error(`Un pack avec l'identifiant "${pack.id}" existe déjà. Renommez l'id dans le JSON.`),
      { code: "PACK_ID_COLLISION" },
    );
  }

  // * Validate that all referenced media exist in the ZIP
  const mediaUrls: string[] = [];
  for (const round of pack.rounds) {
    if ("videoUrl" in round && typeof round.videoUrl === "string") {
      mediaUrls.push(round.videoUrl);
    }
    if ("questions" in round && Array.isArray(round.questions)) {
      for (const q of round.questions) {
        if ("imageUrl" in q && typeof q.imageUrl === "string") {
          mediaUrls.push(q.imageUrl);
        }
      }
    }
    if ("slides" in round && Array.isArray(round.slides)) {
      for (const slide of round.slides) {
        if ("imageUrl" in slide && typeof slide.imageUrl === "string") {
          mediaUrls.push(slide.imageUrl);
        }
      }
    }
    if ("tracks" in round && Array.isArray(round.tracks)) {
      for (const track of round.tracks) {
        if ("audioUrl" in track && typeof track.audioUrl === "string") {
          mediaUrls.push(track.audioUrl);
        }
      }
    }
    if ("items" in round && Array.isArray(round.items)) {
      for (const item of round.items) {
        if ("clues" in item && Array.isArray(item.clues)) {
          for (const clue of item.clues) {
            if ("imageUrl" in clue && typeof clue.imageUrl === "string") {
              mediaUrls.push(clue.imageUrl);
            }
          }
        }
        if ("reveal" in item && typeof item.reveal === "object" && item.reveal !== null) {
          const reveal = item.reveal as { imageUrl?: string };
          if (typeof reveal.imageUrl === "string") {
            mediaUrls.push(reveal.imageUrl);
          }
        }
      }
    }
  }

  const missingMedia: string[] = [];
  for (const url of mediaUrls) {
    const trimmed = url.trim();
    // * Skip HTTPS and HTTP localhost
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      continue;
    }

    // * For /games/... or games/... URLs (transformed by optionalPublicUrlSchema or prefixed by us),
    // * strip the games/ prefix to match ZIP entries.
    let pathInZip = trimmed;
    if (trimmed.startsWith("/games/")) {
      pathInZip = trimmed.slice("/games/".length);
    } else if (trimmed.startsWith("games/")) {
      pathInZip = trimmed.slice("games/".length);
    } else if (trimmed.startsWith("/")) {
      // * Other absolute paths (e.g. /avatars/) are server-side, skip validation
      continue;
    }

    const normalized = pathInZip.replace(/\\/gu, "/");
    const found = entries.some((e) => {
      const eName = e.entryName.replace(/\\/gu, "/");
      return eName === normalized && !e.isDirectory;
    });

    if (!found) {
      missingMedia.push(pathInZip);
    }
  }

  if (missingMedia.length > 0) {
    const list = missingMedia.slice(0, 5).join(", ");
    const more = missingMedia.length > 5 ? ` (et ${missingMedia.length - 5} autres)` : "";
    throw Object.assign(
      new Error(`Médias manquants dans le ZIP : ${list}${more}`),
      { code: "MEDIA_MISSING" },
    );
  }

  // * Normalize media paths to use the imported-packs route
  const normalizedPack = normalizePack(pack);

  return { pack: normalizedPack, zipEntries: entries };
}

/** * Normalize media URLs in a pack to use the /imported-packs/:packId/ route. */
function normalizePack(pack: QuizPack): QuizPack {
  const normalized = structuredClone(pack);

  for (const round of normalized.rounds) {
    if ("videoUrl" in round && typeof round.videoUrl === "string") {
      round.videoUrl = normalizeMediaUrl(pack.id, round.videoUrl);
    }
    if ("questions" in round && Array.isArray(round.questions)) {
      for (const q of round.questions) {
        if ("imageUrl" in q && typeof q.imageUrl === "string") {
          q.imageUrl = normalizeMediaUrl(pack.id, q.imageUrl);
        }
      }
    }
    if ("slides" in round && Array.isArray(round.slides)) {
      for (const slide of round.slides) {
        if ("imageUrl" in slide && typeof slide.imageUrl === "string") {
          slide.imageUrl = normalizeMediaUrl(pack.id, slide.imageUrl);
        }
      }
    }
    if ("tracks" in round && Array.isArray(round.tracks)) {
      for (const track of round.tracks) {
        if ("audioUrl" in track && typeof track.audioUrl === "string") {
          track.audioUrl = normalizeMediaUrl(pack.id, track.audioUrl);
        }
      }
    }
    if ("items" in round && Array.isArray(round.items)) {
      for (const item of round.items) {
        if ("clues" in item && Array.isArray(item.clues)) {
          for (const clue of item.clues) {
            if ("imageUrl" in clue && typeof clue.imageUrl === "string") {
              clue.imageUrl = normalizeMediaUrl(pack.id, clue.imageUrl);
            }
          }
        }
        if ("reveal" in item && typeof item.reveal === "object" && item.reveal !== null) {
          const reveal = item.reveal as { imageUrl?: string };
          if (typeof reveal.imageUrl === "string") {
            reveal.imageUrl = normalizeMediaUrl(pack.id, reveal.imageUrl);
          }
        }
      }
    }
  }

  return normalized;
}

function normalizeMediaUrl(packId: string, url: string): string {
  const trimmed = url.trim();
  // * Keep HTTPS/HTTP URLs unchanged
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return url;
  }
  // * Convert /games/... or games/... (from imported ZIP) to /imported-packs/:packId/...
  if (trimmed.startsWith("/games/")) {
    const relativePath = trimmed.slice("/games/".length);
    return `/imported-packs/${encodeURIComponent(packId)}/${relativePath}`;
  }
  if (trimmed.startsWith("games/")) {
    const relativePath = trimmed.slice("games/".length);
    return `/imported-packs/${encodeURIComponent(packId)}/${relativePath}`;
  }
  // * Keep other absolute paths unchanged (e.g. /avatars/)
  if (trimmed.startsWith("/")) {
    return url;
  }
  // * Convert remaining relative paths to /imported-packs/:packId/:path
  return `/imported-packs/${encodeURIComponent(packId)}/${trimmed}`;
}

