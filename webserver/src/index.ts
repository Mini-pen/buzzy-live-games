import type { Server } from "socket.io";

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { partySnapshotWithGame } from "./domain/partySnapshotPresenter.js";
import { PartyStore } from "./domain/store.js";
import type { QuizPack } from "./games/pack.js";
import { scanQuizPacks } from "./games/pack.js";
import { attachSocketIO } from "./realtime/socket.js";

let socketRef: Server | undefined;
let quizPacksByRun: Map<string, QuizPack> | undefined;

const store = new PartyStore((partyId, party) => {
  if (socketRef === undefined || quizPacksByRun === undefined) return;
  const packs = quizPacksByRun;
  socketRef
    .to(`party:${partyId}:player`)
    .emit("party:patch", partySnapshotWithGame(party, packs, "player"));
  socketRef
    .to(`party:${partyId}:admin`)
    .emit("party:patch", partySnapshotWithGame(party, packs, "host"));
  socketRef
    .to(`party:${partyId}:broadcast`)
    .emit("party:patch", partySnapshotWithGame(party, packs, "player"));
});

async function main(): Promise<void> {
  const config = loadConfig();
  const packs = await scanQuizPacks(config.gamesDir);
  quizPacksByRun = packs;
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
