import { randomUUID, timingSafeEqual } from "node:crypto";

import { nanoid } from "nanoid";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import {
  defaultBuzzSoundPolicyFromCatalog,
  isBuzzerClipForPlayerChoice,
  resolveBuzzSoundPublicUrl,
} from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import {
  isAudioBlindRound,
  isFreeBuzzRound,
  isImageBuzzRound,
  isProgressiveGuessRound,
  isQuizRound,
  isVideoRound,
  progressiveGuessDecode,
  progressiveGuessTotalFlatSteps,
} from "../games/pack.js";
import { resolveJoinAvatarKey, requireParsedAvatarKey } from "../avatars/catalog.js";
import { randomJoinCode, randomSecretHex } from "./codes.js";
import { evaluateJoin, normalizeTeamChoice, publicSnapshotForParty } from "./partyLogic.js";
import { quizPackFromLoadedId } from "./partySnapshotPresenter.js";
import type { ChatEntry, MancheCatalogItem, Party, PartyPublicSnapshot, Player } from "./types.js";

function clearBuzzQueue(party: Party): void {
  party.buzzOrder = [];
  party.buzzQuizGuess.clear();
}
export interface CreatePartyOpts {
  maxPlayers: number | null;
  maxTeams: number | null;
  closedAfterStart: boolean;
  allowRename: boolean;
  allowTeamChange: boolean;
}

/** * Optional QCM context for `buzz`; when `choicesLen >= 1`, `choiceIndex` must be in range. */
export interface QuizBuzzChoiceOpts {
  choicesLen?: number;
  choiceIndex?: number;
}

export type PartyNotifyMeta =
  | { kind: "buzz_fx"; playerId: string }
  | { kind: "answer_fx"; url: string }
  | { kind: "party_deleted" }
  | { kind: "player_kicked"; playerId: string }
  | { kind: "buzz_verdict"; playerId: string; verdict: "good" | "bad" }
  | { kind: "quiz_auto_toast"; playerId: string; correct: boolean }
  | { kind: "tutorial"; gameKind: string; canSkip: boolean };

export type PartyNotifier = (
  partyId: string,
  party: Party,
  meta?: PartyNotifyMeta | PartyNotifyMeta[],
) => void;

function inferChatAllows(party: Party): boolean {
  return party.state === "lobby" || party.state === "between_rounds";
}

export class PartyStore {
  private readonly parties = new Map<string, Party>();

  private readonly indexByJoinCode = new Map<string, string>();

  constructor(
    private readonly notify: PartyNotifier,
    private readonly buzzCatalog: LoadedBuzzSoundCatalog,
  ) {}

  sweep(maxAgeMs: number, now = Date.now()): number {
    let removed = 0;
    for (const id of [...this.parties.keys()]) {
      const p = this.parties.get(id)!;
      if (now - p.updatedAt > maxAgeMs) {
        this.erase(id);
        removed += 1;
      }
    }
    return removed;
  }

  private erase(id: string): void {
    const party = this.parties.get(id);
    if (!party) return;
    this.indexByJoinCode.delete(party.joinCode.toUpperCase());
    this.parties.delete(id);
  }

  broadcast(party: Party): void {
    this.notify(party.id, party);
  }

  /** * Validates optional buzzer catalogue key ; falls back to catalog default when absent. */
  normalizeBuzzerKey(raw: unknown): string {
    if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
      return this.buzzCatalog.defaultBuzzerKey;
    }
    const k = String(raw).trim();
    const hit = this.buzzCatalog.byKey.get(k);
    if (!hit) {
      throw Object.assign(new Error("Buzz sound inconnu."), { code: "BUZZ_SOUND_INVALID" });
    }
    if (!isBuzzerClipForPlayerChoice(hit)) {
      throw Object.assign(
        new Error("Ce clip n’est pas un son de buzzer (choisir uniquement la palette buzzers)."),
        { code: "BUZZ_SOUND_INVALID" },
      );
    }
    return k;
  }

  adminUpdateBuzzSoundPolicy(
    party: Party,
    next: {
      allowedGoodKeys: string[];
      allowedBadKeys: string[];
      playPlayerBuzzTone: boolean;
      echoPlayerBuzzOnHost: boolean;
    },
  ): void {
    if (next.allowedGoodKeys.length < 1 || next.allowedBadKeys.length < 1) {
      throw Object.assign(new Error("Choisir au moins un son bon et un son mauvais."), {
        code: "BAD_SOUND_POLICY",
      });
    }
    const g = [...new Set(next.allowedGoodKeys)];
    const b = [...new Set(next.allowedBadKeys)];
    for (const key of [...g, ...b]) {
      if (!this.buzzCatalog.byKey.has(key)) {
        throw Object.assign(new Error("Buzz sound inconnu."), { code: "BUZZ_SOUND_INVALID" });
      }
    }
    party.buzzSound = {
      allowedGoodKeys: g,
      allowedBadKeys: b,
      playPlayerBuzzTone: next.playPlayerBuzzTone,
      echoPlayerBuzzOnHost: next.echoPlayerBuzzOnHost,
      playVerdictSounds: party.buzzSound.playVerdictSounds,
    };
    this.touch(party);
    this.broadcast(party);
  }

  private touch(party: Party): void {
    party.updatedAt = Date.now();
  }

  get(partyId: string): Party | undefined {
    return this.parties.get(partyId);
  }

  getAllParties(): Party[] {
    return [...this.parties.values()];
  }

  getByJoinCode(code: string): Party | undefined {
    const normalized = code.trim().toUpperCase();
    const id = this.indexByJoinCode.get(normalized);
    if (id === undefined) return undefined;
    return this.parties.get(id);
  }

  /** * Base snapshot shape used by presenters; realtime uses `partySnapshotWithGame`. */
  snapshot(party: Party): PartyPublicSnapshot {
    return publicSnapshotForParty(party);
  }

  createParty(opts: CreatePartyOpts): Party {
    let joinCode = "";
    for (let i = 0; i < 40; i += 1) {
      joinCode = randomJoinCode().toUpperCase();
      if (!this.indexByJoinCode.has(joinCode)) break;
    }
    if (this.indexByJoinCode.has(joinCode)) {
      throw new Error("JOIN_CODE_EXHAUSTED");
    }
    const pol = defaultBuzzSoundPolicyFromCatalog(this.buzzCatalog);
    const party: Party = {
      id: randomUUID(),
      joinCode,
      adminToken: randomSecretHex(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      state: "lobby",
      hasStartedRound: false,
      maxPlayers: opts.maxPlayers,
      maxTeams: opts.maxTeams,
      closedAfterStart: opts.closedAfterStart,
      allowRename: opts.allowRename,
      allowTeamChange: opts.allowTeamChange,
      players: new Map(),
      buzzOrder: [],
      buzzQuizGuess: new Map(),
      buzzWindowOpen: false,
      autoOpenBuzzOnCueAdvance: false,
      autoAdvanceQuizWhenAllBuzzed: false,
      chat: [],
      currentRoundIndex: null,
      currentQuestionIndex: null,
      loadedPackId: null,
      videoReplaySerial: 0,
      allowPlayerAudioControl: false,
      buzzSound: {
        allowedGoodKeys: pol.allowedGoodKeys,
        allowedBadKeys: pol.allowedBadKeys,
        playPlayerBuzzTone: true,
        echoPlayerBuzzOnHost: true,
        playVerdictSounds: true,
      },
      mancheScript: [],
      activeMancheId: null,
      autoPlay: {
        enabled: false,
        paused: false,
        currentScriptIndex: 0,
        currentItemStartedAt: null,
        waitingForManualAction: false,
        scheduledAdvanceAt: null,
        pendingScriptUpdates: null,
      },
      seenGameKinds: new Set(),
      countdownDurationSec: 5,
      winnerScreenMode: "question",
      readyPlayers: new Set(),
      readyPhaseStartedAt: null,
      countdownStartedAt: null,
      winnerDisplay: null,
    };
    this.parties.set(party.id, party);
    this.indexByJoinCode.set(joinCode, party.id);
    this.broadcast(party);
    return party;
  }

  joinParty(
    joinCodeRaw: string,
    displayNameRaw: string,
    teamIdRaw: unknown,
    avatarKeyRaw?: unknown,
    buzzSoundKeyRaw?: unknown,
  ): { party: Party; player: Player } {
    const party =
      this.getByJoinCode(joinCodeRaw.trim()) ??
      null;
    if (!party) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }
    const player = this.joinPlayer(
      party,
      displayNameRaw,
      teamIdRaw,
      avatarKeyRaw,
      buzzSoundKeyRaw,
    );
    return { party, player };
  }

  /** * Adds a participant to an already-resolved party row (used by HTTP join by party id). */
  joinPlayer(
    party: Party,
    displayNameRaw: string,
    teamIdRaw: unknown,
    avatarKeyRaw: unknown | undefined,
    buzzSoundKeyRaw?: unknown | undefined,
  ): Player {
    const canonical = this.parties.get(party.id);
    if (!canonical) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }
    const displayName = displayNameRaw.trim().slice(0, 48);
    if (displayName.length < 2) {
      throw Object.assign(new Error("INVALID_NAME"), { code: "INVALID_NAME" });
    }
    const teamRes = normalizeTeamChoice(teamIdRaw, canonical.maxTeams);
    if (!teamRes.ok) {
      throw Object.assign(new Error(teamRes.code), { code: teamRes.code });
    }
    const joinRes = evaluateJoin({
      closedAfterStart: canonical.closedAfterStart,
      hasStartedRound: canonical.hasStartedRound,
      maxPlayers: canonical.maxPlayers,
      playerCount: canonical.players.size,
    });
    if (!joinRes.ok) {
      throw Object.assign(new Error(joinRes.code), { code: joinRes.code });
    }
    const avatarKeyResolved = resolveJoinAvatarKey(displayName, avatarKeyRaw);
    if (avatarKeyResolved === "") {
      throw Object.assign(new Error("AVATAR_CATALOG_EMPTY"), {
        code: "AVATAR_CATALOG_EMPTY",
      });
    }
    const buzzSoundKey = this.normalizeBuzzerKey(buzzSoundKeyRaw);
    const player: Player = {
      id: randomUUID(),
      displayName,
      avatarKey: avatarKeyResolved,
      buzzSoundKey,
      teamId: teamRes.teamId,
      score: 0,
      joinedAt: Date.now(),
    };
    canonical.players.set(player.id, player);
    this.touch(canonical);
    this.broadcast(canonical);
    return player;
  }

  verifyAdminToken(
    party: Party | undefined,
    candidate: string | null | undefined,
  ): boolean {
    if (!party || candidate === undefined || candidate === null || candidate === "") return false;
    const a = Buffer.from(candidate.trim(), "utf8");
    const b = Buffer.from(party.adminToken, "utf8");
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /** * Notifies then removes the party from memory (irreversible for connected clients). */
  adminDeleteParty(party: Party): void {
    this.notify(party.id, party, { kind: "party_deleted" });
    this.erase(party.id);
  }

  /** * Removes a connected player ; disconnect / UI rely on realtime `party:kicked`. */
  adminKickPlayer(party: Party, playerIdRaw: string): void {
    const playerId = playerIdRaw.trim();
    if (!party.players.has(playerId)) {
      throw Object.assign(new Error("Ce joueur n'est plus dans la partie."), {
        code: "PLAYER_GONE",
      });
    }
    party.players.delete(playerId);
    party.buzzOrder = party.buzzOrder.filter((id) => id !== playerId);
    party.buzzQuizGuess.delete(playerId);
    this.touch(party);
    this.notify(party.id, party, { kind: "player_kicked", playerId });
  }

  patchPlayerSelf(
    party: Party,
    playerId: string,
    body: {
      displayName?: string | undefined;
      teamId?: number | null | undefined;
      avatarKey?: string | undefined;
      buzzSoundKey?: string | undefined;
    },
  ): Player {
    const player = party.players.get(playerId);
    if (!player)
      throw Object.assign(new Error("PLAYER_GONE"), { code: "PLAYER_GONE" });

    if (typeof body.displayName === "string") {
      const nextName = body.displayName.trim().slice(0, 48);
      if (nextName.length < 2)
        throw Object.assign(new Error("INVALID_NAME"), { code: "INVALID_NAME" });
      if (nextName !== player.displayName) {
        if (!party.allowRename)
          throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
        player.displayName = nextName;
      }
    }

    if (body.teamId !== undefined) {
      if (body.teamId !== player.teamId && !party.allowTeamChange) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }
      const teamChoice = normalizeTeamChoice(body.teamId, party.maxTeams);
      if (!teamChoice.ok)
        throw Object.assign(new Error(teamChoice.code), { code: teamChoice.code });
      player.teamId = teamChoice.teamId;
    }

    if (typeof body.avatarKey === "string") {
      const nextKey = requireParsedAvatarKey(body.avatarKey);
      if (nextKey !== player.avatarKey) {
        if (!party.allowRename)
          throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
        player.avatarKey = nextKey;
      }
    }

    if (typeof body.buzzSoundKey === "string") {
      if (!inferChatAllows(party)) {
        throw Object.assign(new Error("BAD_PHASE"), { code: "BAD_PHASE" });
      }
      const nk = this.normalizeBuzzerKey(body.buzzSoundKey);
      if (nk !== player.buzzSoundKey) player.buzzSoundKey = nk;
    }

    this.touch(party);
    this.broadcast(party);
    return player;
  }

  setLoadedPack(party: Party, packId: string | null): void {
    party.loadedPackId = packId;
    this.touch(party);
    this.broadcast(party);
  }

  /** * Host-visible chat bubble (pseudo player id "__host__"); allowed in any phase. */
  appendHostChat(party: Party, textRaw: string): void {
    const text = textRaw.trim().slice(0, 480);
    if (text.length === 0) {
      throw Object.assign(new Error("BAD_MESSAGE"), { code: "BAD_MESSAGE" });
    }
    const entry: ChatEntry = {
      id: nanoid(12),
      playerId: "__host__",
      displayName: "Animateur",
      text,
      at: Date.now(),
    };
    party.chat.push(entry);
    this.touch(party);
    this.broadcast(party);
  }

  appendChat(party: Party, playerId: string, senderName: string, textRaw: string): void {
    if (!inferChatAllows(party)) {
      throw Object.assign(new Error("BAD_PHASE"), { code: "BAD_PHASE" });
    }
    const text = textRaw.trim().slice(0, 480);
    if (text.length === 0) {
      throw Object.assign(new Error("BAD_MESSAGE"), { code: "BAD_MESSAGE" });
    }
    const entry: ChatEntry = {
      id: nanoid(12),
      playerId,
      displayName: senderName.slice(0, 48),
      text,
      at: Date.now(),
    };
    party.chat.push(entry);
    this.touch(party);
    this.broadcast(party);
  }

  buzz(party: Party, playerId: string, quizChoice?: QuizBuzzChoiceOpts): void {
    if (!(party.state === "round_active" && party.buzzWindowOpen)) {
      throw Object.assign(new Error("NO_BUZZ"), { code: "NO_BUZZ" });
    }
    const player = party.players.get(playerId);
    if (!player)
      throw Object.assign(new Error("PLAYER_GONE"), { code: "PLAYER_GONE" });
    const alreadyBuzzedFirst = party.buzzOrder.some((pid) => pid === playerId);
    if (!alreadyBuzzedFirst) {
      const len = quizChoice?.choicesLen;
      if (typeof len === "number" && len >= 1) {
        const ix = quizChoice?.choiceIndex;
        if (
          typeof ix !== "number" ||
          !Number.isInteger(ix) ||
          ix < 0 ||
          ix >= len
        ) {
          throw Object.assign(
            new Error("Choix de réponse requis pour buzzer sur ce QCM."),
            { code: "QUIZ_CHOICE_REQUIRED" },
          );
        }
        party.buzzQuizGuess.set(playerId, ix);
      }
      party.buzzOrder.push(playerId);
      this.touch(party);
      this.broadcast(party);
      this.notify(party.id, party, { kind: "buzz_fx", playerId });
    }
  }

  resetBuzzBoard(party: Party): void {
    clearBuzzQueue(party);
    this.touch(party);
    this.broadcast(party);
  }

  adminSetBuzzOpen(party: Party, open: boolean): void {
    if (party.state !== "round_active") {
      throw Object.assign(new Error("BAD_PHASE"), { code: "BAD_PHASE" });
    }
    party.buzzWindowOpen = open;
    if (!open) {
      clearBuzzQueue(party);
    }
    this.touch(party);
    this.broadcast(party);
  }

  adminSetAutoOpenBuzzOnCueAdvance(party: Party, enabled: boolean): void {
    party.autoOpenBuzzOnCueAdvance = enabled;
    this.touch(party);
    this.broadcast(party);
  }

  adminSetAutoAdvanceQuizWhenAllBuzzed(party: Party, enabled: boolean): void {
    party.autoAdvanceQuizWhenAllBuzzed = enabled;
    this.touch(party);
    this.broadcast(party);
  }

  /**
   * * When `autoAdvanceQuizWhenAllBuzzed` is on and the current cue is a quiz (QCM), resolves every buzz with an
   *   automatic good/bad vs `correctIndex`, awards points, notifies verdict + toast, then advances the cue — if
   *   the manche has no next step, `adminAdvanceCue` errors are swallowed so scores still hold.
   */
  maybeAutoResolveQuizWhenEveryPlayerBuzzed(party: Party, pack: QuizPack | null): void {
    if (!party.autoAdvanceQuizWhenAllBuzzed || pack === null) return;
    if (party.state !== "round_active" || !party.buzzWindowOpen) return;
    const ri = party.currentRoundIndex;
    const qi = party.currentQuestionIndex;
    if (ri === null || qi === null || ri < 0 || qi < 0 || ri >= pack.rounds.length) return;
    const round = pack.rounds[ri];
    if (!isQuizRound(round)) return;
    const q = round.questions[qi];
    if (q === undefined) return;
    const ci = q.correctIndex;
    if (typeof ci !== "number" || ci < 0 || ci >= q.choices.length) return;
    const nPlayers = party.players.size;
    if (nPlayers === 0) return;
    if (party.buzzOrder.length !== nPlayers) return;
    const buzzed = new Set(party.buzzOrder);
    if (buzzed.size !== nPlayers) return;
    for (const id of party.players.keys()) {
      if (!buzzed.has(id)) return;
    }

    const orderSnapshot = [...party.buzzOrder];
    const extras: PartyNotifyMeta[] = [];
    for (const pid of orderSnapshot) {
      const guess = party.buzzQuizGuess.get(pid);
      const good = typeof guess === "number" && guess === ci;
      if (good) {
        const pl = party.players.get(pid);
        if (pl) pl.score = Math.max(0, pl.score + q.points);
      }
      extras.push({
        kind: "buzz_verdict",
        playerId: pid,
        verdict: good ? "good" : "bad",
      });
      extras.push({ kind: "quiz_auto_toast", playerId: pid, correct: good });
      if (party.buzzSound.playVerdictSounds) {
        const keys = good ? party.buzzSound.allowedGoodKeys : party.buzzSound.allowedBadKeys;
        if (keys.length > 0) {
          const pickKey = keys[Math.floor(Math.random() * keys.length)]!;
          const sfx = this.buzzCatalog.byKey.get(pickKey);
          if (sfx) {
            const url = resolveBuzzSoundPublicUrl(sfx).trim();
            if (url !== "") extras.push({ kind: "answer_fx", url });
          }
        }
      }
    }
    clearBuzzQueue(party);
    this.syncActiveQuizProgressIntoScriptItem(party);
    this.touch(party);
    this.notify(party.id, party, extras);
    try {
      this.adminAdvanceCue(party, pack);
    } catch {
      /* ROUND_EXHAUSTED ou fin de manche — état déjà notifié (scores + file vide). */
    }
  }

  /** * Guess whether the current cue can use the buzz queue (QCM, oral, blind, progressive clue — not vidéo seule or reveal slide). */
  private surfaceSupportsBuzz(party: Party, pack: QuizPack): boolean {
    const ri = party.currentRoundIndex;
    const qi = party.currentQuestionIndex;
    if (ri === null || qi === null || ri < 0 || qi < 0 || ri >= pack.rounds.length) return false;
    const round = pack.rounds[ri];
    if (round === undefined) return false;
    if (isVideoRound(round)) return false;
    if (
      isQuizRound(round) ||
      isFreeBuzzRound(round) ||
      isAudioBlindRound(round) ||
      isImageBuzzRound(round)
    ) {
      return true;
    }
    if (isProgressiveGuessRound(round)) {
      const decoded = progressiveGuessDecode(round, qi);
      return decoded !== null && decoded.clueIndex !== null;
    }
    return false;
  }

  /** * Clears any buzz queue then optionally starts ready phase or opens the buzzer per host « auto suivant » policy. */
  private reopenBuzzAccordingToCueAdvancePolicy(party: Party, pack: QuizPack | null): void {
    clearBuzzQueue(party);
    const shouldOpen = pack !== null && party.autoOpenBuzzOnCueAdvance && this.surfaceSupportsBuzz(party, pack);
    if (shouldOpen) {
      this.clearReadyPhase(party);
      party.readyPhaseStartedAt = Date.now();
      party.buzzWindowOpen = false;
    } else {
      party.buzzWindowOpen = false;
      this.clearReadyPhase(party);
    }
  }

  /** * Triggers winner screen automatically if configured for end-of-question and conditions are met. */
  private maybeAutoShowWinnerEndOfQuestion(party: Party): void {
    if (party.winnerScreenMode === "question" && party.state === "round_active") {
      this.computeAndShowWinner(party);
    }
  }

  /** * Triggers winner screen automatically if configured for end-of-round and conditions are met. */
  private maybeAutoShowWinnerEndOfRound(party: Party): void {
    if (party.winnerScreenMode === "round" && party.state === "round_active") {
      this.computeAndShowWinner(party);
    }
  }

  private syncActiveQuizProgressIntoScriptItem(party: Party): void {
    if (party.activeMancheId === null || party.state !== "round_active") return;
    const item = party.mancheScript.find((m) => m.id === party.activeMancheId);
    if (item === undefined || item.kind !== "pack_quiz") return;
    if (party.currentRoundIndex !== null) item.savedRoundIndex = party.currentRoundIndex;
    if (party.currentQuestionIndex !== null) item.savedQuestionIndex = party.currentQuestionIndex;
  }

  private hydrateRuntimeFromMancheItem(
    party: Party,
    item: MancheCatalogItem,
    packs: Map<string, QuizPack>,
  ): void {
    party.videoReplaySerial += 1;
    if (item.kind === "pack_quiz") {
      const basename = (item.packBasename ?? "").replace(/\.json$/u, "").trim();
      const pack = packs.get(basename);
      if (!pack)
        throw Object.assign(new Error("PACK_NOT_FOUND"), {
          code: "PACK_NOT_FOUND",
        });
      party.loadedPackId = pack.id;
      const ri = Math.min(
        Math.max(item.savedRoundIndex, 0),
        Math.max(pack.rounds.length - 1, 0),
      );
      party.currentRoundIndex = ri;
      const round = pack.rounds[ri];
      if (round === undefined)
        throw Object.assign(new Error("BAD_ROUND"), { code: "BAD_ROUND" });
      if (isVideoRound(round)) {
        party.currentQuestionIndex = 0;
      } else if (isFreeBuzzRound(round)) {
        party.currentQuestionIndex = Math.min(Math.max(item.savedQuestionIndex, 0), 100_000);
      } else if (isAudioBlindRound(round)) {
        party.allowPlayerAudioControl = false;
        party.currentQuestionIndex = Math.min(
          Math.max(item.savedQuestionIndex, 0),
          Math.max(round.tracks.length - 1, 0),
        );
      } else if (isImageBuzzRound(round)) {
        party.currentQuestionIndex = Math.min(
          Math.max(item.savedQuestionIndex, 0),
          Math.max(round.slides.length - 1, 0),
        );
      } else if (isProgressiveGuessRound(round)) {
        const maxFlat = progressiveGuessTotalFlatSteps(round);
        party.currentQuestionIndex = Math.min(
          Math.max(item.savedQuestionIndex, 0),
          Math.max(maxFlat - 1, 0),
        );
      } else if (isQuizRound(round)) {
        party.currentQuestionIndex = Math.min(
          Math.max(item.savedQuestionIndex, 0),
          Math.max(round.questions.length - 1, 0),
        );
      } else {
        party.currentQuestionIndex = 0;
      }
      return;
    }
    party.loadedPackId = null;
    party.currentRoundIndex = null;
    party.currentQuestionIndex = null;
  }

  hostAppendManche(party: Party, draft: Omit<MancheCatalogItem, "id" | "launchMode">): void {
    const item: MancheCatalogItem = { ...draft, id: nanoid(12), launchMode: null };
    
    if (party.autoPlay.enabled && !party.autoPlay.paused) {
      // Defer the update until after the current item
      const updatedScript = party.autoPlay.pendingScriptUpdates !== null
        ? [...party.autoPlay.pendingScriptUpdates]
        : [...party.mancheScript];
      updatedScript.push(item);
      party.autoPlay.pendingScriptUpdates = updatedScript;
    } else {
      party.mancheScript.push(item);
    }
    
    this.touch(party);
    this.broadcast(party);
  }

  hostRemoveManche(party: Party, mancheId: string): void {
    const targetScript = party.autoPlay.enabled && !party.autoPlay.paused && party.autoPlay.pendingScriptUpdates !== null
      ? party.autoPlay.pendingScriptUpdates
      : party.mancheScript;
      
    const idx = targetScript.findIndex((m) => m.id === mancheId);
    if (idx < 0)
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    
    if (party.autoPlay.enabled && !party.autoPlay.paused) {
      // Defer the update until after the current item
      const updatedScript = party.autoPlay.pendingScriptUpdates !== null
        ? [...party.autoPlay.pendingScriptUpdates]
        : [...party.mancheScript];
      updatedScript.splice(idx, 1);
      party.autoPlay.pendingScriptUpdates = updatedScript;
    } else {
      const removing = party.mancheScript[idx];
      const activePlaying =
        removing.id === party.activeMancheId && party.state === "round_active";
      if (activePlaying) this.syncActiveQuizProgressIntoScriptItem(party);
      party.mancheScript.splice(idx, 1);
      if (removing.id === party.activeMancheId) {
        party.activeMancheId = null;
        party.loadedPackId = null;
        party.currentRoundIndex = null;
        party.currentQuestionIndex = null;
        if (party.state === "round_active") party.state = "lobby";
        party.buzzWindowOpen = false;
        clearBuzzQueue(party);
      }
    }
    
    this.touch(party);
    this.broadcast(party);
  }

  hostMoveManche(party: Party, mancheId: string, delta: number): void {
    const targetScript = party.autoPlay.enabled && !party.autoPlay.paused && party.autoPlay.pendingScriptUpdates !== null
      ? party.autoPlay.pendingScriptUpdates
      : party.mancheScript;
      
    const i = targetScript.findIndex((m) => m.id === mancheId);
    if (i < 0)
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    const j = i + delta;
    if (j < 0 || j >= targetScript.length)
      throw Object.assign(new Error("BAD_MOVE"), { code: "BAD_MOVE" });
    
    if (party.autoPlay.enabled && !party.autoPlay.paused) {
      // Defer the update until after the current item
      const updatedScript = party.autoPlay.pendingScriptUpdates !== null
        ? [...party.autoPlay.pendingScriptUpdates]
        : [...party.mancheScript];
      const tmp = updatedScript[i];
      updatedScript[i] = updatedScript[j]!;
      updatedScript[j] = tmp!;
      party.autoPlay.pendingScriptUpdates = updatedScript;
    } else {
      const arr = party.mancheScript;
      const tmp = arr[i];
      arr[i] = arr[j]!;
      arr[j] = tmp!;
    }
    
    this.touch(party);
    this.broadcast(party);
  }

  /** * Helper to determine the game kind of the first round in a loaded pack. */
  private inferGameKindFromManche(
    manche: MancheCatalogItem,
    packs: Map<string, QuizPack>,
  ): string | null {
    if (manche.kind !== "pack_quiz" || manche.packBasename === null) return null;
    const pack = packs.get(manche.packBasename);
    if (!pack || pack.rounds.length === 0) return null;
    const firstRound = pack.rounds[manche.savedRoundIndex] ?? pack.rounds[0];
    if (!firstRound) return null;
    if (isQuizRound(firstRound)) return "quiz";
    if (isAudioBlindRound(firstRound)) return "audio_blind";
    if (isProgressiveGuessRound(firstRound)) return "progressive_guess";
    if (isImageBuzzRound(firstRound)) return "image_buzz";
    if (isFreeBuzzRound(firstRound)) return "free_buzz";
    if (isVideoRound(firstRound)) return "video";
    return null;
  }

  hostLaunchManche(
    party: Party,
    mancheId: string,
    mode: "normal" | "autonomous",
    skipIntro: boolean,
    packs: Map<string, QuizPack>,
  ): { shouldShowTutorial: boolean; gameKind: string | null } {
    if (party.mancheScript.length === 0)
      throw Object.assign(new Error("BAD_PHASE"), { code: "BAD_PHASE" });
    const i = party.mancheScript.findIndex((m) => m.id === mancheId);
    if (i < 0)
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    this.syncActiveQuizProgressIntoScriptItem(party);

    const before = [...party.mancheScript];
    const [picked] = party.mancheScript.splice(i, 1);
    if (picked === undefined)
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    
    picked.launchMode = mode;
    party.mancheScript.unshift(picked);
    
    try {
      party.activeMancheId = picked.id;
      this.hydrateRuntimeFromMancheItem(party, picked, packs);
    } catch (err) {
      party.mancheScript = before;
      throw err;
    }
    
    const gameKind = this.inferGameKindFromManche(picked, packs);
    const shouldShowTutorial =
      mode !== "autonomous" &&
      !skipIntro &&
      gameKind !== null &&
      !party.seenGameKinds.has(gameKind);
    
    if (shouldShowTutorial && gameKind !== null) {
      party.seenGameKinds.add(gameKind);
    }
    
    if (mode === "autonomous") {
      party.autoOpenBuzzOnCueAdvance = true;
      party.autoAdvanceQuizWhenAllBuzzed = true;
    }
    
    party.state = "round_active";
    party.hasStartedRound = true;
    const pk = quizPackFromLoadedId(packs, party.loadedPackId);
    this.reopenBuzzAccordingToCueAdvancePolicy(party, pk);
    this.touch(party);
    
    if (shouldShowTutorial && gameKind !== null) {
      this.notify(party.id, party, { kind: "tutorial", gameKind, canSkip: true });
    }
    
    this.broadcast(party);
    return { shouldShowTutorial, gameKind };
  }

  hostPlayMancheById(
    party: Party,
    mancheId: string,
    packs: Map<string, QuizPack>,
  ): void {
    this.hostLaunchManche(party, mancheId, "normal", false, packs);
  }

  adminPauseToLobby(party: Party): void {
    this.syncActiveQuizProgressIntoScriptItem(party);
    party.state = "lobby";
    party.buzzWindowOpen = false;
    clearBuzzQueue(party);
    this.touch(party);
    this.broadcast(party);
  }

  /** * Host “next cue”: next quiz / blind track / oral step; skips advancing for pure video clips (réutiliser rejouer). */
  adminAdvanceCue(party: Party, pack: QuizPack): void {
    if (party.state !== "round_active") {
      throw Object.assign(new Error("BAD_PHASE"), { code: "BAD_PHASE" });
    }
    const ri = party.currentRoundIndex;
    if (ri === null || ri < 0 || ri >= pack.rounds.length) {
      throw Object.assign(new Error("BAD_ROUND"), { code: "BAD_ROUND" });
    }
    const round = pack.rounds[ri];
    if (isVideoRound(round)) {
      party.videoReplaySerial += 1;
      this.reopenBuzzAccordingToCueAdvancePolicy(party, pack);
      this.syncActiveQuizProgressIntoScriptItem(party);
      this.touch(party);
      this.broadcast(party);
      return;
    }
    if (isFreeBuzzRound(round)) {
      const qix = party.currentQuestionIndex ?? 0;
      this.maybeAutoShowWinnerEndOfQuestion(party);
      party.currentQuestionIndex = qix + 1;
      this.reopenBuzzAccordingToCueAdvancePolicy(party, pack);
      this.syncActiveQuizProgressIntoScriptItem(party);
      this.touch(party);
      this.broadcast(party);
      return;
    }
    if (isAudioBlindRound(round)) {
      const qix = party.currentQuestionIndex ?? 0;
      const nextIx = qix + 1;
      if (nextIx < round.tracks.length) {
        this.maybeAutoShowWinnerEndOfQuestion(party);
        party.currentQuestionIndex = nextIx;
        party.videoReplaySerial += 1;
        this.reopenBuzzAccordingToCueAdvancePolicy(party, pack);
        this.syncActiveQuizProgressIntoScriptItem(party);
        this.touch(party);
        this.broadcast(party);
        return;
      }
      this.maybeAutoShowWinnerEndOfRound(party);
      throw Object.assign(
        new Error("Fin des extraits de cette manche — passez à la suivante ou mettez en pause."),
        { code: "ROUND_EXHAUSTED" },
      );
    }
    if (isImageBuzzRound(round)) {
      const qix = party.currentQuestionIndex ?? 0;
      const nextIx = qix + 1;
      if (nextIx < round.slides.length) {
        this.maybeAutoShowWinnerEndOfQuestion(party);
        party.currentQuestionIndex = nextIx;
        party.videoReplaySerial += 1;
        this.reopenBuzzAccordingToCueAdvancePolicy(party, pack);
        this.syncActiveQuizProgressIntoScriptItem(party);
        this.touch(party);
        this.broadcast(party);
        return;
      }
      this.maybeAutoShowWinnerEndOfRound(party);
      throw Object.assign(
        new Error("Fin des images de cette manche — passez à la suivante ou mettez en pause."),
        { code: "ROUND_EXHAUSTED" },
      );
    }
    if (isProgressiveGuessRound(round)) {
      const qix = party.currentQuestionIndex ?? 0;
      const nextIx = qix + 1;
      const total = progressiveGuessTotalFlatSteps(round);
      if (nextIx < total) {
        this.maybeAutoShowWinnerEndOfQuestion(party);
        party.currentQuestionIndex = nextIx;
        party.videoReplaySerial += 1;
        this.reopenBuzzAccordingToCueAdvancePolicy(party, pack);
        this.syncActiveQuizProgressIntoScriptItem(party);
        this.touch(party);
        this.broadcast(party);
        return;
      }
      this.maybeAutoShowWinnerEndOfRound(party);
      throw Object.assign(
        new Error("Fin des énigmes de cette manche — passez à la suivante ou mettez en pause."),
        { code: "ROUND_EXHAUSTED" },
      );
    }
    if (!isQuizRound(round)) {
      throw Object.assign(new Error("BAD_ROUND"), { code: "BAD_ROUND" });
    }
    const qi = party.currentQuestionIndex;
    if (qi === null || qi < 0) {
      throw Object.assign(new Error("BAD_QUESTION"), { code: "BAD_QUESTION" });
    }
    const nextQ = qi + 1;
    if (nextQ < round.questions.length) {
      this.maybeAutoShowWinnerEndOfQuestion(party);
      party.currentQuestionIndex = nextQ;
      this.reopenBuzzAccordingToCueAdvancePolicy(party, pack);
      this.syncActiveQuizProgressIntoScriptItem(party);
      this.touch(party);
      this.broadcast(party);
      return;
    }
    this.maybeAutoShowWinnerEndOfRound(party);
    throw Object.assign(
      new Error("Fin des questions de cette manche — passez à la suivante ou mettez en pause."),
      { code: "ROUND_EXHAUSTED" },
    );
  }

  /**
   * * Re-syncs playback for the **same** cue (video blind segment or blind-test track index)
   *   without advancing the question/track index (`videoReplaySerial` bump).
   */
  adminReplayMediaCue(party: Party, pack: QuizPack): void {
    if (party.state !== "round_active") {
      throw Object.assign(new Error("BAD_PHASE"), { code: "BAD_PHASE" });
    }
    const ri = party.currentRoundIndex;
    if (ri === null || ri < 0 || ri >= pack.rounds.length) {
      throw Object.assign(new Error("BAD_ROUND"), { code: "BAD_ROUND" });
    }
    const round = pack.rounds[ri];
    if (!(isVideoRound(round) || isAudioBlindRound(round))) {
      throw Object.assign(
        new Error("Relecture média disponible uniquement pour une vidéo ou un blind audio."),
        { code: "MEDIA_REPLAY_NOT_APPLICABLE" },
      );
    }
    party.videoReplaySerial += 1;
    party.buzzWindowOpen = false;
    clearBuzzQueue(party);
    this.syncActiveQuizProgressIntoScriptItem(party);
    this.touch(party);
    this.broadcast(party);
  }

  adminSetAllowPlayerAudioControl(
    party: Party,
    pack: QuizPack,
    allowed: boolean,
  ): void {
    if (party.state !== "round_active") {
      throw Object.assign(new Error("BAD_PHASE"), { code: "BAD_PHASE" });
    }
    const ri = party.currentRoundIndex;
    if (ri === null || ri < 0 || ri >= pack.rounds.length) {
      throw Object.assign(new Error("BAD_ROUND"), { code: "BAD_ROUND" });
    }
    const round = pack.rounds[ri];
    if (!isAudioBlindRound(round)) {
      throw Object.assign(
        new Error("Réglage blind audio hors manche blind test."),
        { code: "PLAYER_AUDIO_FLAG_NOT_APPLICABLE" },
      );
    }
    party.allowPlayerAudioControl = allowed;
    this.touch(party);
    this.broadcast(party);
  }

  adminAwardPoints(party: Party, playerId: string, delta: number): void {
    if (!Number.isInteger(delta))
      throw Object.assign(new Error("BAD_POINTS"), { code: "BAD_POINTS" });
    const player = party.players.get(playerId);
    if (!player)
      throw Object.assign(new Error("PLAYER_GONE"), { code: "PLAYER_GONE" });
    player.score = Math.max(0, player.score + delta);
    this.touch(party);
    this.broadcast(party);
  }

  adminSetVerdictSoundsEnabled(party: Party, enabled: boolean): void {
    party.buzzSound.playVerdictSounds = enabled;
    this.touch(party);
    this.broadcast(party);
  }

  adminSetCountdownDuration(party: Party, seconds: number): void {
    if (seconds < 3 || seconds > 10 || !Number.isInteger(seconds)) {
      throw Object.assign(new Error("Durée entre 3 et 10 secondes."), { code: "INVALID_DURATION" });
    }
    party.countdownDurationSec = seconds;
    this.touch(party);
    this.broadcast(party);
  }

  adminSetWinnerScreenMode(party: Party, mode: "question" | "round"): void {
    party.winnerScreenMode = mode;
    this.touch(party);
    this.broadcast(party);
  }

  computeAndShowWinner(party: Party): void {
    if (party.players.size === 0) {
      party.winnerDisplay = null;
      return;
    }
    
    let bestPlayer: { id: string; name: string; avatarKey: string; score: number } | null = null;
    for (const [pid, player] of party.players) {
      if (bestPlayer === null || player.score > bestPlayer.score) {
        bestPlayer = { id: pid, name: player.displayName, avatarKey: player.avatarKey, score: player.score };
      }
    }
    
    if (bestPlayer !== null) {
      party.winnerDisplay = {
        playerId: bestPlayer.id,
        playerName: bestPlayer.name,
        avatarKey: bestPlayer.avatarKey,
        score: bestPlayer.score,
      };
      this.touch(party);
      this.broadcast(party);
    }
  }

  adminDismissWinnerScreen(party: Party): void {
    party.winnerDisplay = null;
    this.touch(party);
    this.broadcast(party);
  }

  playerMarkReady(party: Party, playerId: string, readyTimeoutMs: number): void {
    if (party.state !== "round_active") {
      throw Object.assign(new Error("Pas en manche active."), { code: "BAD_PHASE" });
    }
    const player = party.players.get(playerId);
    if (!player) {
      throw Object.assign(new Error("Joueur introuvable."), { code: "PLAYER_NOT_FOUND" });
    }
    party.readyPlayers.add(playerId);
    if (party.readyPhaseStartedAt === null) {
      party.readyPhaseStartedAt = Date.now();
    }
    
    const allReady = party.readyPlayers.size >= party.players.size;
    const elapsed = Date.now() - party.readyPhaseStartedAt;
    const timeoutReached = elapsed >= readyTimeoutMs;
    
    if (allReady || timeoutReached) {
      party.countdownStartedAt = Date.now();
    }
    
    this.touch(party);
    this.broadcast(party);
  }
  
  maybeStartCountdownIfReady(party: Party, readyTimeoutMs: number): boolean {
    if (party.state !== "round_active") return false;
    if (party.readyPhaseStartedAt === null) return false;
    if (party.countdownStartedAt !== null) return false;
    if (party.buzzWindowOpen) return false;
    
    const allReady = party.readyPlayers.size >= party.players.size && party.players.size > 0;
    const elapsed = Date.now() - party.readyPhaseStartedAt;
    const timeoutReached = elapsed >= readyTimeoutMs;
    
    if (allReady || timeoutReached) {
      party.countdownStartedAt = Date.now();
      this.touch(party);
      this.broadcast(party);
      return true;
    }
    return false;
  }
  
  maybeOpenBuzzAfterCountdown(party: Party): boolean {
    if (party.countdownStartedAt === null) return false;
    if (party.buzzWindowOpen) return false;
    
    const elapsed = Date.now() - party.countdownStartedAt;
    const countdownMs = party.countdownDurationSec * 1000;
    
    if (elapsed >= countdownMs) {
      party.buzzWindowOpen = true;
      party.winnerDisplay = null;
      this.clearReadyPhase(party);
      this.touch(party);
      this.broadcast(party);
      return true;
    }
    return false;
  }

  clearReadyPhase(party: Party): void {
    party.readyPlayers.clear();
    party.readyPhaseStartedAt = null;
    party.countdownStartedAt = null;
  }

  adminStartCountdownAndOpenBuzz(party: Party): void {
    if (party.state !== "round_active") {
      throw Object.assign(new Error("Pas en manche active."), { code: "BAD_PHASE" });
    }
    this.clearReadyPhase(party);
    party.winnerDisplay = null;
    party.buzzWindowOpen = true;
    this.touch(party);
    this.broadcast(party);
  }

  /** * Picks a good/bad outcome sound, optionally awards current-cue points, removes the player from the buzz queue. */
  adminValidateBuzzAnswer(
    party: Party,
    playerId: string,
    verdict: "good" | "bad",
    pack: QuizPack,
  ): void {
    if (party.state !== "round_active") {
      throw Object.assign(new Error("Manche inactive."), { code: "BAD_PHASE" });
    }
    const ix = party.buzzOrder.indexOf(playerId);
    if (ix < 0) {
      throw Object.assign(new Error("Ce joueur n'est pas dans la file de buzz."), {
        code: "NOT_IN_BUZZ_QUEUE",
      });
    }
    const keys =
      verdict === "good" ? party.buzzSound.allowedGoodKeys : party.buzzSound.allowedBadKeys;
    if (keys.length === 0) {
      throw Object.assign(new Error("Politique de sons invalide."), {
        code: "BAD_SOUND_POLICY",
      });
    }
    const pickKey = keys[Math.floor(Math.random() * keys.length)]!;
    const sfx = this.buzzCatalog.byKey.get(pickKey);
    if (!sfx) {
      throw Object.assign(new Error("Son inconnu."), { code: "BUZZ_SOUND_INVALID" });
    }
    const url = resolveBuzzSoundPublicUrl(sfx).trim();
    if (verdict === "good") {
      const pts = this.goodPointsForCurrentCue(party, pack);
      const player = party.players.get(playerId);
      if (player) player.score = Math.max(0, player.score + pts);
    }
    party.buzzOrder.splice(ix, 1);
    party.buzzQuizGuess.delete(playerId);
    this.syncActiveQuizProgressIntoScriptItem(party);
    this.touch(party);
    const extras: PartyNotifyMeta[] = [];
    if (this.activeCueIsQuizMultipleChoice(party, pack)) {
      extras.push({ kind: "buzz_verdict", playerId, verdict });
    }
    if (party.buzzSound.playVerdictSounds && url !== "") {
      extras.push({ kind: "answer_fx", url });
    }
    this.notify(party.id, party, extras.length > 0 ? extras : undefined);
  }

  private activeCueIsQuizMultipleChoice(party: Party, pack: QuizPack): boolean {
    const ri = party.currentRoundIndex;
    const qi = party.currentQuestionIndex;
    if (ri === null || qi === null || ri < 0 || qi < 0 || ri >= pack.rounds.length) return false;
    const round = pack.rounds[ri];
    return round !== undefined && isQuizRound(round);
  }

  private goodPointsForCurrentCue(party: Party, pack: QuizPack): number {
    const ri = party.currentRoundIndex;
    const qi = party.currentQuestionIndex;
    if (ri === null || qi === null) return 1;
    const round = pack.rounds[ri];
    if (round === undefined) return 1;
    if (isQuizRound(round)) {
      const q = round.questions[qi];
      return q !== undefined ? q.points : 1;
    }
    if (isImageBuzzRound(round)) {
      const sl = round.slides[qi];
      if (sl === undefined) return 1;
      return typeof sl.points === "number" && sl.points > 0 ? sl.points : 1;
    }
    if (isProgressiveGuessRound(round)) {
      const pos = progressiveGuessDecode(round, qi);
      if (pos === null || pos.clueIndex === null) return 0;
      const clue = pos.item.clues[pos.clueIndex];
      return clue !== undefined ? clue.points : 1;
    }
    return 1;
  }

  /** * Enable or disable automatic play mode. */
  adminToggleAutoPlay(
    party: Party,
    enabled: boolean,
    config: { questionDurationMs: number; roundDurationMs: number; transitionDurationMs: number },
    packs: Map<string, QuizPack>,
  ): void {
    if (enabled && party.mancheScript.length === 0) {
      throw Object.assign(
        new Error("Impossible d'activer le mode automatique : aucune manche dans le script."),
        { code: "EMPTY_SCRIPT" },
      );
    }
    
    party.autoPlay.enabled = enabled;
    party.autoPlay.paused = false;
    party.autoPlay.currentScriptIndex = 0;
    party.autoPlay.waitingForManualAction = false;
    party.autoPlay.pendingScriptUpdates = null;
    
    if (enabled) {
      const now = Date.now();
      party.autoPlay.currentItemStartedAt = now;
      const item = party.mancheScript[0];
      if (item) {
        this.loadScriptItem(party, item, packs);
        const duration = this.calculateItemDuration(party, item, config, packs);
        party.autoPlay.scheduledAdvanceAt = duration !== null ? now + duration : null;
      } else {
        party.autoPlay.scheduledAdvanceAt = null;
      }
    } else {
      party.autoPlay.currentItemStartedAt = null;
      party.autoPlay.scheduledAdvanceAt = null;
    }
    
    this.touch(party);
    this.broadcast(party);
  }

  /** * Pause or resume automatic play mode. */
  adminAutoPlayPauseResume(party: Party, paused: boolean): void {
    if (!party.autoPlay.enabled) {
      throw Object.assign(
        new Error("Le mode automatique n'est pas activé."),
        { code: "AUTO_PLAY_NOT_ENABLED" },
      );
    }
    
    const wasPaused = party.autoPlay.paused;
    party.autoPlay.paused = paused;
    
    if (!paused && wasPaused) {
      // Resume: recalculate scheduledAdvanceAt based on remaining time
      const now = Date.now();
      if (party.autoPlay.scheduledAdvanceAt !== null && party.autoPlay.currentItemStartedAt !== null) {
        const elapsed = now - party.autoPlay.currentItemStartedAt;
        const originalDuration = party.autoPlay.scheduledAdvanceAt - party.autoPlay.currentItemStartedAt;
        const remaining = Math.max(0, originalDuration - elapsed);
        party.autoPlay.scheduledAdvanceAt = now + remaining;
        party.autoPlay.currentItemStartedAt = now;
      }
    } else if (paused) {
      // When pausing, we keep the elapsed time by not updating currentItemStartedAt
      // scheduledAdvanceAt stays the same so we can calculate remaining time on resume
    }
    
    this.touch(party);
    this.broadcast(party);
  }

  /** * Skip to next item in automatic play mode. */
  adminAutoPlaySkipForward(
    party: Party,
    config: { questionDurationMs: number; roundDurationMs: number; transitionDurationMs: number },
    packs: Map<string, QuizPack>,
  ): void {
    if (!party.autoPlay.enabled) {
      throw Object.assign(
        new Error("Le mode automatique n'est pas activé."),
        { code: "AUTO_PLAY_NOT_ENABLED" },
      );
    }
    this.autoPlayAdvanceToNextItem(party, config, packs);
  }

  /** * Go back to previous item in automatic play mode. */
  adminAutoPlaySkipBackward(
    party: Party,
    config: { questionDurationMs: number; roundDurationMs: number; transitionDurationMs: number },
    packs: Map<string, QuizPack>,
  ): void {
    if (!party.autoPlay.enabled) {
      throw Object.assign(
        new Error("Le mode automatique n'est pas activé."),
        { code: "AUTO_PLAY_NOT_ENABLED" },
      );
    }
    if (party.autoPlay.currentScriptIndex > 0) {
      party.autoPlay.currentScriptIndex -= 1;
      const item = party.mancheScript[party.autoPlay.currentScriptIndex];
      if (item) {
        const now = Date.now();
        this.loadScriptItem(party, item, packs);
        party.autoPlay.currentItemStartedAt = now;
        party.autoPlay.waitingForManualAction = false;
        const duration = this.calculateItemDuration(party, item, config, packs);
        party.autoPlay.scheduledAdvanceAt = duration !== null ? now + duration : null;
      }
    }
    this.touch(party);
    this.broadcast(party);
  }

  /** * Mark that automatic play is waiting for a manual action, and clear the timer. */
  adminAutoPlayWaitForManualAction(party: Party, waiting: boolean): void {
    party.autoPlay.waitingForManualAction = waiting;
    if (waiting) {
      party.autoPlay.scheduledAdvanceAt = null;
    }
    this.touch(party);
    this.broadcast(party);
  }

  /** * Resume automatic play after a manual action was completed. */
  adminAutoPlayResumeAfterManualAction(
    party: Party,
    config: { questionDurationMs: number; roundDurationMs: number; transitionDurationMs: number },
    packs: Map<string, QuizPack>,
  ): void {
    if (!party.autoPlay.enabled || !party.autoPlay.waitingForManualAction) {
      return;
    }
    
    party.autoPlay.waitingForManualAction = false;
    const now = Date.now();
    party.autoPlay.currentItemStartedAt = now;
    
    const item = party.mancheScript[party.autoPlay.currentScriptIndex];
    if (item) {
      const duration = this.calculateItemDuration(party, item, config, packs);
      party.autoPlay.scheduledAdvanceAt = duration !== null ? now + duration : null;
    }
    
    this.touch(party);
    this.broadcast(party);
  }

  /** * Calculate the duration for the current item (question, round, or transition). */
  private calculateItemDuration(
    party: Party,
    item: MancheCatalogItem,
    config: { questionDurationMs: number; roundDurationMs: number; transitionDurationMs: number },
    packs: Map<string, QuizPack>,
  ): number | null {
    if (item.kind === "transition") {
      return item.transitionDurationMs ?? config.transitionDurationMs;
    }
    
    if (item.kind === "pack_quiz") {
      const pack = quizPackFromLoadedId(packs, party.loadedPackId);
      if (!pack) return config.roundDurationMs;
      
      const ri = party.currentRoundIndex;
      const qi = party.currentQuestionIndex;
      
      if (ri === null || qi === null) return config.roundDurationMs;
      
      const round = pack.rounds[ri];
      if (!round) return config.roundDurationMs;
      
      // For quiz rounds with questions, use question duration
      if (isQuizRound(round) && round.questions.length > 0) {
        return config.questionDurationMs;
      }
      
      // For other round types, use round duration
      return config.roundDurationMs;
    }
    
    // For video, youtube, direct_video, use round duration
    return config.roundDurationMs;
  }

  /** * Advance to the next item in the script (internal helper for auto-play). */
  private autoPlayAdvanceToNextItem(
    party: Party,
    config: { questionDurationMs: number; roundDurationMs: number; transitionDurationMs: number },
    packs: Map<string, QuizPack>,
  ): void {
    // Apply pending script updates if any
    if (party.autoPlay.pendingScriptUpdates !== null) {
      party.mancheScript = party.autoPlay.pendingScriptUpdates;
      party.autoPlay.pendingScriptUpdates = null;
    }
    
    party.autoPlay.currentScriptIndex += 1;
    if (party.autoPlay.currentScriptIndex >= party.mancheScript.length) {
      party.autoPlay.enabled = false;
      party.autoPlay.currentScriptIndex = party.mancheScript.length - 1;
      party.autoPlay.scheduledAdvanceAt = null;
      party.state = "lobby";
      this.touch(party);
      this.broadcast(party);
      return;
    }
    
    const item = party.mancheScript[party.autoPlay.currentScriptIndex];
    if (item) {
      const now = Date.now();
      this.loadScriptItem(party, item, packs);
      party.autoPlay.currentItemStartedAt = now;
      party.autoPlay.waitingForManualAction = false;
      const duration = this.calculateItemDuration(party, item, config, packs);
      party.autoPlay.scheduledAdvanceAt = duration !== null ? now + duration : null;
    }
    this.touch(party);
    this.broadcast(party);
  }

  /** * Check if a party needs automatic advancement and advance it if the time has come. */
  tickAutoPlay(
    party: Party,
    config: { questionDurationMs: number; roundDurationMs: number; transitionDurationMs: number },
    packs: Map<string, QuizPack>,
    now: number,
  ): void {
    if (
      !party.autoPlay.enabled ||
      party.autoPlay.paused ||
      party.autoPlay.waitingForManualAction ||
      party.autoPlay.scheduledAdvanceAt === null
    ) {
      return;
    }
    
    if (now >= party.autoPlay.scheduledAdvanceAt) {
      this.autoPlayAdvanceToNextItem(party, config, packs);
    }
  }

  /** * Load a script item (manche or transition) into the party state. */
  private loadScriptItem(party: Party, item: MancheCatalogItem, packs: Map<string, QuizPack>): void {
    if (item.kind === "transition") {
      party.state = "between_rounds";
      party.activeMancheId = item.id;
      party.currentRoundIndex = null;
      party.currentQuestionIndex = null;
      party.loadedPackId = null;
      party.buzzWindowOpen = false;
      clearBuzzQueue(party);
    } else {
      party.activeMancheId = item.id;
      this.hydrateRuntimeFromMancheItem(party, item, packs);
      party.state = "round_active";
      party.hasStartedRound = true;
      const pk = quizPackFromLoadedId(packs, party.loadedPackId);
      this.reopenBuzzAccordingToCueAdvancePolicy(party, pk);
    }
  }

  /** * Tick all parties for automatic play advancement. */
  tickAllAutoPlay(
    config: { questionDurationMs: number; roundDurationMs: number; transitionDurationMs: number },
    packs: Map<string, QuizPack>,
    now: number,
  ): void {
    for (const party of this.parties.values()) {
      this.tickAutoPlay(party, config, packs, now);
    }
  }
}

