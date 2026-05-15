import type { Server as HttpServer } from "node:http";

import jwt from "jsonwebtoken";
import { Server } from "socket.io";

import type { AppConfig } from "../config.js";
import type { PartyStore } from "../domain/store.js";
import type { JwtPlayerPayload } from "../domain/types.js";

export interface SocketDeps {
  store: PartyStore;
  config: AppConfig;
}

interface HandshakeAuth {
  partyId?: string;
  bearer?: string;
  role?: string;
}

/** * Delivers realtime `party:patch` to players, admins, and projector/broadcast spectators. */
export function attachSocketIO(httpServer: HttpServer, deps: SocketDeps): Server {
  const io = new Server(httpServer, {
    cors: { origin: true, methods: ["GET", "POST"] },
    transports: ["websocket", "polling"],
  });

  io.use((socket, next) => {
    try {
      const rawAuth = socket.handshake.auth as unknown;
      const raw =
        typeof rawAuth === "object" && rawAuth !== null ? (rawAuth as HandshakeAuth) : {};
      const partyIdRaw =
        typeof raw.partyId === "string" && raw.partyId.length > 0 ? raw.partyId : null;
      const bearer =
        typeof raw.bearer === "string" && raw.bearer.length > 0 ? raw.bearer : null;
      const role = typeof raw.role === "string" ? raw.role : "player";

      if (partyIdRaw === null) {
        next(new Error("auth"));
        return;
      }

      const partyIdNorm = partyIdRaw.trim().toLowerCase();
      const party = deps.store.get(partyIdNorm);
      if (!party) {
        next(new Error("auth"));
        return;
      }

      if (role === "broadcast") {
        void socket.join(`party:${party.id}:broadcast`);
        next();
        return;
      }

      if (bearer === null) {
        next(new Error("auth"));
        return;
      }

      if (role === "admin") {
        if (!deps.store.verifyAdminToken(party, bearer)) {
          next(new Error("auth"));
          return;
        }
        void socket.join(`party:${party.id}:admin`);
        next();
        return;
      }

      let payload: JwtPlayerPayload;
      try {
        payload = jwt.verify(bearer, deps.config.jwtSecret) as JwtPlayerPayload;
      } catch {
        next(new Error("auth"));
        return;
      }

      const pidClaim = typeof payload.pid === "string" ? payload.pid : null;
      const subClaim = typeof payload.sub === "string" ? payload.sub : null;

      if (pidClaim !== party.id || subClaim === null) {
        next(new Error("auth"));
        return;
      }

      void socket.join(`party:${party.id}:player`);
      next();
    } catch {
      next(new Error("auth"));
    }
  });

  io.on("connection", () => {});

  return io;
}
