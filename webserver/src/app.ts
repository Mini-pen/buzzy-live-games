import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

import type { AppConfig } from "./config.js";
import type { PartyStore } from "./domain/store.js";
import type { QuizPack } from "./games/pack.js";
import { registerPartyRoutes } from "./http/routesParty.js";

export interface BuildDeps {
  config: AppConfig;
  store: PartyStore;
  packs: Map<string, QuizPack>;
}

export async function buildApp(opts: BuildDeps): Promise<ReturnType<typeof Fastify>> {
  const isProd = process.env.NODE_ENV === "production";
  const app = Fastify({
    logger: true,
    // * Traefik terminates TLS; trust X-Forwarded-* for logs and any absolute URLs.
    trustProxy: isProd,
  });
  await app.register(cors, {
    origin: opts.config.corsOrigin,
    credentials: true,
  });
  await app.register(fastifyJwt, {
    secret: opts.config.jwtSecret,
  });

  await registerPartyRoutes(app, {
    store: opts.store,
    packs: opts.packs,
    config: opts.config,
  });

  await app.register(fastifyStatic, {
    root: opts.config.gamesDir,
    prefix: "/games/",
    decorateReply: false,
  });

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
