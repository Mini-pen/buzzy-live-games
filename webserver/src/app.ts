import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import Fastify from "fastify";

import type { AppConfig } from "./config.js";
import type { PartyStore } from "./domain/store.js";
import type { LoadedBuzzSoundCatalog } from "./games/buzzSoundCatalog.js";
import type { QuizPack } from "./games/pack.js";
import type { ImportedPackStore } from "./games/zipPackImporter.js";
import { registerPartyRoutes } from "./http/routesParty.js";
import { resolveAvatarsServingRoot } from "./avatars/catalog.js";

export interface BuildDeps {
  config: AppConfig;
  store: PartyStore;
  packs: Map<string, QuizPack>;
  importedPacks: ImportedPackStore;
  buzzCatalog: LoadedBuzzSoundCatalog;
}

export async function buildApp(opts: BuildDeps): Promise<ReturnType<typeof Fastify>> {
  const isProd = process.env.NODE_ENV === "production";
  const app = Fastify({
    logger: true,
    // * Traefik terminates TLS; trust X-Forwarded-* for logs and any absolute URLs.
    trustProxy: isProd,
    bodyLimit: opts.config.maxZipPackBytes + 1024,
  });
  await app.register(cors, {
    origin: opts.config.corsOrigin,
    credentials: true,
  });
  await app.register(fastifyJwt, {
    secret: opts.config.jwtSecret,
  });
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: opts.config.maxZipPackBytes,
    },
  });

  await registerPartyRoutes(app, {
    store: opts.store,
    packs: opts.packs,
    importedPacks: opts.importedPacks,
    config: opts.config,
    buzzCatalog: opts.buzzCatalog,
  });

  const avatarsRoot = resolveAvatarsServingRoot();
  if (avatarsRoot !== null) {
    await app.register(fastifyStatic, {
      root: avatarsRoot,
      prefix: "/avatars/",
      decorateReply: false,
    });
  }

  await app.register(fastifyStatic, {
    root: opts.config.gamesDir,
    prefix: "/games/",
    decorateReply: false,
  });

  app.get<{ Params: { packId: string; "*": string } }>(
    "/imported-packs/:packId/*",
    async (req, reply) => {
      const packId = req.params.packId;
      const mediaPath = req.params["*"];
      if (!packId || !mediaPath) {
        return reply.status(404).send({ error: "NOT_FOUND" });
      }
      const buffer = opts.importedPacks.getMediaEntry(packId, mediaPath);
      if (buffer === null) {
        return reply.status(404).send({ error: "NOT_FOUND" });
      }

      // * Determine MIME type from extension
      const ext = mediaPath.toLowerCase().split(".").pop() ?? "";
      const mimeMap: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        mp4: "video/mp4",
        webm: "video/webm",
        mp3: "audio/mpeg",
        m4a: "audio/mp4",
        ogg: "audio/ogg",
        wav: "audio/wav",
        flac: "audio/flac",
      };
      const mimeType = mimeMap[ext] ?? "application/octet-stream";

      return reply.type(mimeType).send(buffer);
    },
  );

  if (isProd) {
    const clientRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "client");
    await app.register(fastifyStatic, {
      root: clientRoot,
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith("/api")) {
        return reply.status(404).send({ error: "NOT_FOUND" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
