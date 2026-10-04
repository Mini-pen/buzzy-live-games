import { URL } from "node:url";
import sharp, { type Sharp } from "sharp";

/** * Max image dimensions for editor-downloaded images. */
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;

/** * Max download size before decoding (10 MB). */
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

/** * Timeout for image download (10 seconds). */
const DOWNLOAD_TIMEOUT_MS = 10_000;

/**
 * Downloads an image from a URL, resizes it, compresses it, and returns the buffer.
 * Rejects private/loopback addresses and enforces size limits.
 */
export async function downloadAndCompressImage(
  imageUrl: string,
  maxOutputBytes: number,
): Promise<{ buffer: Buffer; format: "jpeg" | "webp" }> {
  // * Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    throw Object.assign(new Error("L'URL fournie n'est pas valide."), {
      code: "INVALID_URL",
    });
  }

  // * Only accept http and https
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw Object.assign(new Error("Seules les URLs http et https sont autorisées."), {
      code: "PROTOCOL_NOT_ALLOWED",
    });
  }

  // * Reject private, loopback, and link-local addresses
  const hostname = parsedUrl.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("172.16.") ||
    hostname.startsWith("172.17.") ||
    hostname.startsWith("172.18.") ||
    hostname.startsWith("172.19.") ||
    hostname.startsWith("172.2") ||
    hostname.startsWith("172.30.") ||
    hostname.startsWith("172.31.") ||
    hostname.startsWith("169.254.") ||
    hostname === "::1" ||
    hostname.startsWith("fc00:") ||
    hostname.startsWith("fd00:") ||
    hostname.startsWith("fe80:")
  ) {
    throw Object.assign(
      new Error("Les adresses privées, de loopback et link-local ne sont pas autorisées."),
      { code: "PRIVATE_ADDRESS" },
    );
  }

  // * Download the image with timeout and size limit
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(imageUrl, {
      signal: controller.signal,
      redirect: "manual",
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as Error).name === "AbortError") {
      throw Object.assign(new Error("Le téléchargement de l'image a expiré."), {
        code: "DOWNLOAD_TIMEOUT",
      });
    }
    throw Object.assign(new Error("Impossible de télécharger l'image (erreur réseau)."), {
      code: "NETWORK_ERROR",
    });
  } finally {
    clearTimeout(timeoutId);
  }

  // * Reject redirects (could redirect to private addresses)
  if (response.status >= 300 && response.status < 400) {
    throw Object.assign(
      new Error("Les redirections ne sont pas autorisées pour des raisons de sécurité."),
      { code: "REDIRECT_NOT_ALLOWED" },
    );
  }

  if (!response.ok) {
    throw Object.assign(
      new Error(
        `L'image n'est pas accessible (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}).`,
      ),
      { code: "HTTP_ERROR", status: response.status },
    );
  }

  // * Check content type
  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.startsWith("image/")) {
    throw Object.assign(new Error("L'URL ne pointe pas vers une image."), {
      code: "NOT_AN_IMAGE",
    });
  }

  // * Download with size limit
  const reader = response.body?.getReader();
  if (!reader) {
    throw Object.assign(new Error("Impossible de lire le corps de la réponse."), {
      code: "NO_BODY",
    });
  }

  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.length;
      if (totalSize > MAX_DOWNLOAD_BYTES) {
        throw Object.assign(
          new Error(
            `L'image dépasse la limite de téléchargement de ${Math.floor(MAX_DOWNLOAD_BYTES / (1024 * 1024))} Mo.`,
          ),
          { code: "DOWNLOAD_TOO_LARGE" },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const rawBuffer = Buffer.concat(chunks);

  // * Resize and compress
  let resized: Sharp;
  try {
    resized = sharp(rawBuffer).resize(MAX_WIDTH, MAX_HEIGHT, {
      fit: "inside",
      withoutEnlargement: true,
    });
  } catch {
    throw Object.assign(new Error("L'image téléchargée n'est pas valide ou est corrompue."), {
      code: "INVALID_IMAGE",
    });
  }

  // * Try WebP first (better compression)
  let compressed = await resized.webp({ quality: 80 }).toBuffer();
  let format: "jpeg" | "webp" = "webp";

  if (compressed.length > maxOutputBytes) {
    // * Try JPEG if WebP is still too large
    compressed = await resized.jpeg({ quality: 75 }).toBuffer();
    format = "jpeg";
  }

  if (compressed.length > maxOutputBytes) {
    throw Object.assign(
      new Error(
        `L'image, même après compression, dépasse la limite de ${Math.floor(maxOutputBytes / 1024)} Ko (taille actuelle : ${Math.floor(compressed.length / 1024)} Ko).`,
      ),
      { code: "IMAGE_TOO_LARGE_AFTER_COMPRESSION" },
    );
  }

  return { buffer: compressed, format };
}
