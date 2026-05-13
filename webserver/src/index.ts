import type { Server } from "socket.io";

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PartyStore } from "./domain/store.js";
import { scanQuizPacks } from "./games/pack.js";
import { attachSocketIO } from "./realtime/socket.js";

let socketRef: Server | undefined;

const store = new PartyStore((partyId, snapshot) => {
  socketRef?.to(`party:${partyId}`).emit("party:patch", snapshot);
});

async function main(): Promise<void> {
  const config = loadConfig();
  const packs = await scanQuizPacks(config.gamesDir);
  console.info(`Indexed ${packs.size} quiz pack(s) under ${config.gamesDir}`);

  const app = await buildApp({ config, packs, store });
  await app.ready();

  socketRef = attachSocketIO(app.server, { store, config });

  const sweep = (): void => {
    const removed = store.sweep(config.partySweepMaxAgeMs);
    if (removed > 0) {
      app.log.info({ removed }, "inactive parties swept");
    }
  };
  setInterval(sweep, config.partySweepIntervalMs).unref?.();

  await app.listen({
    host: config.host,
    port: config.port,
  });

  app.log.info(`Listening on ${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
