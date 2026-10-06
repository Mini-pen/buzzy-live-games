import type { Server } from "socket.io";

import { buildApp } from "./app.js";
import { setBasePath } from "./basePath.js";
import { loadConfig } from "./config.js";
import { partySnapshotWithGame } from "./domain/partySnapshotPresenter.js";
import { PartyStore, type PartyNotifyMeta } from "./domain/store.js";
import { loadBuzzSoundCatalog, resolveBuzzSoundPublicUrl } from "./games/buzzSoundCatalog.js";
import type { QuizPack } from "./games/pack.js";
import { getAvatarCatalog } from "./avatars/catalog.js";
import { scanQuizPacks } from "./games/pack.js";
import { ImportedPackStore } from "./games/zipPackImporter.js";
import { PackEditorStore } from "./games/packEditor.js";
import { attachSocketIO } from "./realtime/socket.js";

let socketRef: Server | undefined;
let quizPacksByRun: Map<string, QuizPack> | undefined;
let importedPacksRef: ImportedPackStore | undefined;

function partyNotifyExtras(meta?: PartyNotifyMeta | PartyNotifyMeta[]): PartyNotifyMeta[] {
  if (meta === undefined) return [];
  return Array.isArray(meta) ? meta : [meta];
}

async function main(): Promise<void> {
  const config = loadConfig();
  setBasePath(config.basePath);
  const packs = await scanQuizPacks(config.gamesDir);
  quizPacksByRun = packs;
  console.info(`Indexed ${packs.size} quiz pack(s) under ${config.gamesDir}`);

  const importedPacks = new ImportedPackStore();
  importedPacksRef = importedPacks;

  const packEditor = new PackEditorStore();

  const buzzCatalog = await loadBuzzSoundCatalog(config.gamesDir);
  console.info(`Buzz SFX catalogue: ${buzzCatalog.sounds.length} clip(s)`);

  const store = new PartyStore((partyId, party, meta) => {
    if (socketRef === undefined || quizPacksByRun === undefined || importedPacksRef === undefined) return;
    const packsSnap = quizPacksByRun;
    const importedSnap = importedPacksRef;
    const allPacks = new Map([...packsSnap, ...importedSnap.getAll()]);
    if (meta !== undefined && !Array.isArray(meta) && meta.kind === "party_deleted") {
      const payload = { partyId };
      socketRef.to(`party:${partyId}:player`).emit("party:terminated", payload);
      socketRef.to(`party:${partyId}:admin`).emit("party:terminated", payload);
      socketRef.to(`party:${partyId}:broadcast`).emit("party:terminated", payload);
      return;
    }
    socketRef
      .to(`party:${partyId}:player`)
      .emit("party:patch", partySnapshotWithGame(party, allPacks, "player"));
    socketRef
      .to(`party:${partyId}:admin`)
      .emit("party:patch", partySnapshotWithGame(party, allPacks, "host"));
    socketRef
      .to(`party:${partyId}:broadcast`)
      .emit("party:patch", partySnapshotWithGame(party, allPacks, "player"));
    const extras = partyNotifyExtras(meta);
    for (const m of extras) {
      if (m.kind === "buzz_fx") {
        const shouldEcho = party.buzzSound.buzzSoundMode === "animation" || party.buzzSound.buzzSoundMode === "both";
        if (!shouldEcho) continue;
        const pl = party.players.get(m.playerId);
        if (!pl) continue;
        const sfx = buzzCatalog.byKey.get(pl.buzzSoundKey);
        if (!sfx) continue;
        const url = resolveBuzzSoundPublicUrl(sfx);
        if (url === "") continue;
        socketRef
          .to(`party:${partyId}:admin`)
          .emit("party:buzz_fx", { playerId: m.playerId, url });
      }
    }
    for (const m of extras) {
      if (m.kind !== "answer_fx") continue;
      const u = typeof m.url === "string" ? m.url.trim() : "";
      if (u === "") continue;
      socketRef.to(`party:${partyId}:admin`).emit("party:answer_fx", { url: u });
      socketRef.to(`party:${partyId}:broadcast`).emit("party:answer_fx", { url: u });
    }
    for (const m of extras) {
      if (m.kind !== "buzz_verdict") continue;
      socketRef.to(`party:${partyId}:player`).emit("party:buzz_verdict", {
        playerId: m.playerId,
        verdict: m.verdict,
      });
    }
    for (const m of extras) {
      if (m.kind !== "quiz_auto_toast") continue;
      socketRef.to(`party:${partyId}:player`).emit("party:quiz_auto_toast", {
        playerId: m.playerId,
        correct: m.correct,
      });
    }
    for (const m of extras) {
      if (m.kind !== "player_kicked") continue;
      socketRef.to(`party:${partyId}:player`).emit("party:kicked", { playerId: m.playerId });
    }
    for (const m of extras) {
      if (m.kind !== "tutorial") continue;
      socketRef.to(`party:${partyId}:player`).emit("party:tutorial", {
        gameKind: m.gameKind,
        canSkip: m.canSkip,
      });
      socketRef.to(`party:${partyId}:broadcast`).emit("party:tutorial", {
        gameKind: m.gameKind,
        canSkip: m.canSkip,
      });
    }
  }, buzzCatalog);

  const avatarN = getAvatarCatalog().length;
  console.info(avatarN > 0 ? `Avatar library: ${avatarN} file(s)` : "Avatar library: empty");

  const app = await buildApp({ config, packs, importedPacks, packEditor, store, buzzCatalog });
  await app.ready();

  socketRef = attachSocketIO(app.server, { store, config });

  const sweep = (): void => {
    const removed = store.sweep(config.partySweepMaxAgeMs);
    if (removed > 0) {
      app.log.info({ removed }, "inactive parties swept");
    }
  };
  setInterval(sweep, config.partySweepIntervalMs).unref?.();

  // Auto-play ticker: check every second if parties need automatic advancement
  const autoPlayTick = (): void => {
    if (quizPacksByRun === undefined || importedPacksRef === undefined) return;
    const allPacks = new Map([...quizPacksByRun, ...importedPacksRef.getAll()]);
    const autoPlayConfig = {
      questionDurationMs: config.autoPlayQuestionDurationMs,
      roundDurationMs: config.autoPlayRoundDurationMs,
      transitionDurationMs: config.autoPlayTransitionDurationMs,
    };
    const now = Date.now();
    store.tickAllAutoPlay(autoPlayConfig, allPacks, now);
  };
  setInterval(autoPlayTick, 1000).unref?.();

  // Countdown ticker: check every 500ms if countdown should start or buzzer should open
  const countdownTick = (): void => {
    for (const party of store.getAllParties()) {
      if (party.state !== "round_active") continue;
      
      if (party.countdownStartedAt === null && party.readyPhaseStartedAt !== null) {
        store.maybeStartCountdownIfReady(party, config.readyTimeoutMs);
      }
      
      if (party.countdownStartedAt !== null && !party.buzzWindowOpen) {
        store.maybeOpenBuzzAfterCountdown(party);
      }
    }
  };
  setInterval(countdownTick, 500).unref?.();

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
