import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { io, type Socket } from "socket.io-client";

/** * Quiz surface from `PartyPublicSnapshot.gameBoard`. */
interface PartyGameBoardQuiz {
  kind: "quiz";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  questionIndexInRound: number;
  prompt: string;
  choices: string[];
  points: number;
  /** * Optional quiz illustration (HTTPS or `/…` served by backend). */
  imageUrl?: string;
  correctChoiceIndex?: number;
}

/** * Vidéo auto-hébergée ou fichier direct (`<video src>` ; préférez HTTPS ou `/games/…`). */
interface PartyGameBoardVideo {
  kind: "video";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  videoUrl: string;
  replaySerial: number;
}

/** * Questions libres : pas de choix multiples, buzz sur oral. */
interface PartyGameBoardFreeBuzz {
  kind: "free_buzz";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  questionNumberHuman: number;
  plannedQuestionCount: number | null;
  prompt: string;
}

/** * Image plein écran ; réponse orale après buzz — pas de QCM. */
interface PartyGameBoardImageBuzz {
  kind: "image_buzz";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  slideIndexHuman: number;
  slideCount: number;
  imageUrl: string;
  awardPoints: number;
  prompt?: string;
}

/** * Indices visuels successifs puis plaque réponse (même titre à deviner). */
interface PartyGameBoardProgressiveGuess {
  kind: "progressive_guess";
  phase: "clue" | "reveal";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  puzzleIndexHuman: number;
  puzzleCount: number;
  clueIndexHuman?: number;
  clueCount?: number;
  imageUrl?: string;
  awardPoints?: number;
  playerPrompt?: string;
  answer?: string;
  revealImageUrl?: string;
}

/** * Blind test audio : titre / artiste seulement côté animateur si présents dans le snapshot. */
interface PartyGameBoardAudioBlind {
  kind: "audio_blind";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  trackIndexHuman: number;
  trackCount: number;
  audioUrl: string;
  replaySerial: number;
  revealTitle?: string;
  revealArtist?: string;
}

/** * Legacy « page web » manche — never embedded client-side ; link-out only for older scénarios. */
interface PartyGameBoardIframe {
  kind: "iframe";
  title: string;
  url: string;
  replaySerial: number;
}

/** * YouTube embed manche (`embedUrl`: nocookie iframe `src`, normalised server-side). */
interface PartyGameBoardYoutube {
  kind: "youtube";
  title: string;
  embedUrl: string;
  replaySerial: number;
}

type PartyGameBoardSurface =
  | PartyGameBoardQuiz
  | PartyGameBoardVideo
  | PartyGameBoardFreeBuzz
  | PartyGameBoardImageBuzz
  | PartyGameBoardProgressiveGuess
  | PartyGameBoardAudioBlind
  | PartyGameBoardIframe
  | PartyGameBoardYoutube;

/** * Host-visible manche descriptor (mirror of `PartyPublicSnapshot.mancheScript`). */
interface MancheCatalogItemView {
  id: string;
  kind: "pack_quiz" | "iframe" | "youtube" | "direct_video";
  title: string;
  packBasename: string | null;
  iframeUrl: string | null;
  youtubeEmbedUrl: string | null;
  directVideoUrl: string | null;
  savedRoundIndex: number;
  savedQuestionIndex: number;
}

interface PartySnapshot {
  id: string;
  joinCode: string;
  state: string;
  buzzOrder: string[];
  buzzWindowOpen: boolean;
  allowRename: boolean;
  allowTeamChange: boolean;
  maxTeams: number | null;
  closedAfterStart: boolean;
  hasStartedRound: boolean;
  /** * When true during blind test, players and broadcast get local `<audio controls>`. */
  allowPlayerAudioControl?: boolean;
  players: Array<{
    id: string;
    displayName: string;
    avatarUrl: string;
    teamId: number | null;
    score: number;
    buzzSoundKey: string;
  }>;
  teamScores: Record<string, number>;
  chatTail: Array<{ id: string; displayName: string; text: string; at: number }>;
  currentRoundIndex?: number | null;
  currentQuestionIndex?: number | null;
  gameBoard?: PartyGameBoardSurface | null;
  mancheScript: MancheCatalogItemView[];
  activeMancheId: string | null;
  soundBuzzerPublic?: {
    playOnPlayerDevice: boolean;
    echoOnHostDevice: boolean;
  };
  soundBuzzerHostConfig?: {
    allowedGoodKeys: string[];
    allowedBadKeys: string[];
  };
  buzzQuizQueueDetail?: Array<{
    playerId: string;
    choiceIndex: number;
    letter: string;
    choiceLabel: string;
    correct: boolean;
  }>;
  autoOpenBuzzOnCueAdvance?: boolean;
}

/** * Catalogue GET `/api/sounds` — player buzzer picker (fichiers `buzzers/` seulement). */
interface CatalogSoundEntry {
  key: string;
  label: string;
  pool: string;
  url: string;
}

/** * Groups catalog entries for the player buzzer picker (sons sous `sounds/buzzers/` uniquement). */
function groupCatalogSoundsForJoin(
  sounds: CatalogSoundEntry[],
): { label: string; items: CatalogSoundEntry[] }[] {
  const items = [...sounds].sort((a, b) => a.label.localeCompare(b.label, "fr"));
  if (items.length === 0) return [];
  return [{ label: "Sons de buzzer", items }];
}

/** * Compact label for animateur lists. */
function mancheKindShort(kind: MancheCatalogItemView["kind"]): string {
  switch (kind) {
    case "pack_quiz":
      return "Quiz";
    case "iframe":
      return "Page";
    case "youtube":
      return "YouTube";
    case "direct_video":
      return "Vidéo";
    default:
      return kind;
  }
}

/** * Decorative round mascot image — surrounding context supplies the audible name. */
function AvatarFigure(props: { src: string; sizePx: number }): JSX.Element {
  return (
    <img
      className="bz-avatar-img"
      src={props.src}
      alt=""
      width={props.sizePx}
      height={props.sizePx}
      decoding="async"
    />
  );
}

function playerSessionKey(pid: string): string {
  return `partygames:playerJwt:${pid.trim().toLowerCase()}`;
}

function adminSessionKey(pid: string): string {
  return `partygames:adminToken:${pid.trim().toLowerCase()}`;
}

/** * Case-insensitive lookup for admin token (URL path vs legacy storage key mismatch). */
function findAdminBearerForPartyRouteId(routePartyIdRaw: string): string | null {
  if (routePartyIdRaw.trim() === "" || typeof globalThis.sessionStorage === "undefined")
    return null;
  const needle = routePartyIdRaw.trim().toLowerCase();
  const prefix = "partygames:adminToken:";
  let foundKey: string | null = null;
  let tok: string | null = null;
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k === null || !k.startsWith(prefix)) continue;
    const idPart = k.slice(prefix.length);
    if (idPart.toLowerCase() === needle) {
      const t = sessionStorage.getItem(k);
      if (typeof t === "string" && t.length > 0) {
        foundKey = k;
        tok = t;
        break;
      }
    }
  }
  if (tok !== null && foundKey !== null && foundKey !== adminSessionKey(needle)) {
    sessionStorage.setItem(adminSessionKey(needle), tok);
    sessionStorage.removeItem(foundKey);
  }
  return tok;
}

/** * Case-insensitive lookup for player JWT (same issue as admin keys). */
function findPlayerJwtForPartyRouteId(routePartyIdRaw: string): string | null {
  if (routePartyIdRaw.trim() === "" || typeof globalThis.sessionStorage === "undefined")
    return null;
  const needle = routePartyIdRaw.trim().toLowerCase();
  const prefix = "partygames:playerJwt:";
  let foundKey: string | null = null;
  let tok: string | null = null;
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k === null || !k.startsWith(prefix)) continue;
    const idPart = k.slice(prefix.length);
    if (idPart.toLowerCase() === needle) {
      const t = sessionStorage.getItem(k);
      if (typeof t === "string" && t.length > 0) {
        foundKey = k;
        tok = t;
        break;
      }
    }
  }
  if (tok !== null && foundKey !== null && foundKey !== playerSessionKey(needle)) {
    sessionStorage.setItem(playerSessionKey(needle), tok);
    sessionStorage.removeItem(foundKey);
  }
  return tok;
}

/** * Normalizes party id from the route (store + API use lowercase UUIDs). */
function canonicalPartyIdFromRoute(param: string | undefined): string {
  return (param ?? "").trim().toLowerCase();
}

/** * Browser-only: restores admin Bearer from `#token=` or sessionStorage synchronously on first paint. */
function peekAdminBearer(routePartyIdRaw: string): string | null {
  if (routePartyIdRaw.trim() === "" || typeof globalThis.window === "undefined") return null;
  const pidNorm = canonicalPartyIdFromRoute(routePartyIdRaw);
  const rawHash = window.location.hash;
  const h =
    typeof rawHash === "string" && rawHash.startsWith("#") ? rawHash.slice(1) : "";
  const frag = new URLSearchParams(h).get("token");
  let t = findAdminBearerForPartyRouteId(routePartyIdRaw);
  if (frag !== null && frag.length > 0) {
    sessionStorage.setItem(adminSessionKey(pidNorm), frag);
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
    return frag;
  }
  return typeof t === "string" && t.length > 0 ? t : null;
}

/** * Browser-only: player JWT persisted for `/party/:id/play` hydration before first React commit. */
function peekPlayerJwt(routePartyIdRaw: string): string | null {
  if (routePartyIdRaw === "" || typeof globalThis.sessionStorage === "undefined") return null;
  return findPlayerJwtForPartyRouteId(routePartyIdRaw);
}

/** * Build admin path + optional `#token=` from session (reliable resume even when storage is read after first paint). */
function adminTableResumeTo(partyIdCanon: string): string {
  const base = `/party/${encodeURIComponent(partyIdCanon)}/admin`;
  const t = findAdminBearerForPartyRouteId(partyIdCanon);
  if (t === null || t === "") return base;
  return `${base}#token=${encodeURIComponent(t)}`;
}

const STORAGE_LAST_PLAYER_PARTY = "partygames:lastPlayerPartyId";
const STORAGE_LAST_PLAYER_CODE = "partygames:lastPlayerJoinCode";
const STORAGE_LAST_ADMIN_PARTY = "partygames:lastAdminPartyId";

/** * Drops every stale admin Bearer key tied to `routePartyIdRaw` plus `lastAdminParty` hint when it matches (case-insensitive id suffix). */
function purgeAdminSessionForPartyRouteId(routePartyIdRaw: string): void {
  if (typeof globalThis.sessionStorage === "undefined") return;
  const needle = canonicalPartyIdFromRoute(routePartyIdRaw);
  if (needle === "") return;
  const prefix = "partygames:adminToken:";
  const keysToDrop: string[] = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k === null || !k.startsWith(prefix)) continue;
    const idSuffix = k.slice(prefix.length);
    if (canonicalPartyIdFromRoute(idSuffix) === needle) keysToDrop.push(k);
  }
  for (const k of keysToDrop) sessionStorage.removeItem(k);

  const last = sessionStorage.getItem(STORAGE_LAST_ADMIN_PARTY);
  if (last !== null && canonicalPartyIdFromRoute(last) === needle) {
    sessionStorage.removeItem(STORAGE_LAST_ADMIN_PARTY);
  }

  if (typeof globalThis.window === "undefined") return;
  const rawHash = window.location.hash;
  if (rawHash === "" || rawHash === "#") return;
  const frag = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  try {
    const hp = new URLSearchParams(frag);
    if (hp.has("token")) {
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
    }
  } catch {
    /* noop */
  }
}

/** * Drops player JWT keys for a party id and last-player resume hints when they match. */
function purgePlayerSessionForPartyRouteId(routePartyIdRaw: string): void {
  if (typeof globalThis.sessionStorage === "undefined") return;
  const needle = canonicalPartyIdFromRoute(routePartyIdRaw);
  if (needle === "") return;
  const prefix = "partygames:playerJwt:";
  const keysToDrop: string[] = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k === null || !k.startsWith(prefix)) continue;
    const idSuffix = k.slice(prefix.length);
    if (canonicalPartyIdFromRoute(idSuffix) === needle) keysToDrop.push(k);
  }
  for (const k of keysToDrop) sessionStorage.removeItem(k);
  const last = sessionStorage.getItem(STORAGE_LAST_PLAYER_PARTY);
  if (last !== null && canonicalPartyIdFromRoute(last) === needle) {
    sessionStorage.removeItem(STORAGE_LAST_PLAYER_PARTY);
    sessionStorage.removeItem(STORAGE_LAST_PLAYER_CODE);
  }
}

/** * Records the player party id for the home page resume link; join code is optional display cache. */
function rememberPlayerParty(partyId: string, joinCode?: string): void {
  if (typeof globalThis.sessionStorage === "undefined") return;
  const id = canonicalPartyIdFromRoute(partyId);
  if (id === "") return;
  sessionStorage.setItem(STORAGE_LAST_PLAYER_PARTY, id);
  if (joinCode !== undefined && joinCode !== "")
    sessionStorage.setItem(STORAGE_LAST_PLAYER_CODE, joinCode);
}

/** * Records the admin party id after create or when the host panel is open with a valid token. */
function rememberAdminParty(partyId: string): void {
  if (typeof globalThis.sessionStorage === "undefined") return;
  const id = canonicalPartyIdFromRoute(partyId);
  if (id === "") return;
  sessionStorage.setItem(STORAGE_LAST_ADMIN_PARTY, id);
}

function listPartyIdsWithStoredPlayerJwt(): string[] {
  if (typeof globalThis.sessionStorage === "undefined") return [];
  const prefix = "partygames:playerJwt:";
  const ids: string[] = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k === null || !k.startsWith(prefix)) continue;
    const id = k.slice(prefix.length);
    const tok = sessionStorage.getItem(k);
    if (typeof tok === "string" && tok.length > 0) ids.push(id);
  }
  ids.sort();
  return ids;
}

function listPartyIdsWithStoredAdminToken(): string[] {
  if (typeof globalThis.sessionStorage === "undefined") return [];
  const prefix = "partygames:adminToken:";
  const ids: string[] = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k === null || !k.startsWith(prefix)) continue;
    const id = k.slice(prefix.length);
    const tok = sessionStorage.getItem(k);
    if (typeof tok === "string" && tok.length > 0) ids.push(id);
  }
  ids.sort();
  return ids;
}

/** * Party id if a player JWT is still in session for this tab. */
function resolvePlayerPartyIdToResume(): string | null {
  if (typeof globalThis.sessionStorage === "undefined") return null;
  const last = sessionStorage.getItem(STORAGE_LAST_PLAYER_PARTY);
  if (last !== null && last !== "" && findPlayerJwtForPartyRouteId(last) !== null) {
    const c = canonicalPartyIdFromRoute(last);
    return c === "" ? null : c;
  }
  const all = listPartyIdsWithStoredPlayerJwt();
  if (all.length === 0) return null;
  const c = canonicalPartyIdFromRoute(all[0] ?? "");
  return c === "" ? null : c;
}

/** * Party id if an admin token is still in session for this tab. */
function resolveAdminPartyIdToResume(): string | null {
  if (typeof globalThis.sessionStorage === "undefined") return null;
  const lastStored = sessionStorage.getItem(STORAGE_LAST_ADMIN_PARTY);
  if (lastStored !== null && lastStored.trim() !== "") {
    const lastCanon = canonicalPartyIdFromRoute(lastStored);
    if (lastCanon === "") {
      sessionStorage.removeItem(STORAGE_LAST_ADMIN_PARTY);
    } else if (findAdminBearerForPartyRouteId(lastCanon) !== null) {
      return lastCanon;
    } else {
      sessionStorage.removeItem(STORAGE_LAST_ADMIN_PARTY);
    }
  }
  const all = listPartyIdsWithStoredAdminToken();
  if (all.length === 0) return null;
  const c = canonicalPartyIdFromRoute(all[0] ?? "");
  return c === "" ? null : c;
}

/** * Outcome when loading `/api/parties/:id`; drives accurate resume / error screens. */
type PartySnapLoadOutcome =
  | { kind: "ok"; snapshot: PartySnapshot }
  | { kind: "not_found" }
  | { kind: "bad_token" }
  | { kind: "aborted" }
  | { kind: "network"; message: string }
  | { kind: "http_error"; status: number; body: string };

/** * Loads a party snapshot ; optional Bearer unlocks fields reserved for authenticated host. */
async function loadPartySnapshot(
  partyId: string,
  opts?: { bearer?: string | undefined; signal?: AbortSignal | undefined },
): Promise<PartySnapLoadOutcome> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const bearer = opts?.bearer?.trim();
  if (typeof bearer === "string" && bearer !== "") headers.Authorization = `Bearer ${bearer}`;
  try {
    const res = await fetch(`/api/parties/${encodeURIComponent(partyId)}`, {
      credentials: "same-origin",
      headers,
      signal: opts?.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let errCode = "";
      try {
        const j = JSON.parse(text) as { error?: string };
        errCode = typeof j.error === "string" ? j.error : "";
      } catch {
        /* noop */
      }
      if (res.status === 401 || errCode === "UNAUTHORIZED") return { kind: "bad_token" };
      if (res.status === 404 || errCode === "NOT_FOUND") return { kind: "not_found" };
      return { kind: "http_error", status: res.status, body: text.slice(0, 320) };
    }
    try {
      const snapshot = JSON.parse(text) as PartySnapshot;
      return { kind: "ok", snapshot };
    } catch {
      return { kind: "http_error", status: res.status, body: "INVALID_JSON" };
    }
  } catch (e: unknown) {
    if (opts?.signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) {
      return { kind: "aborted" };
    }
    return { kind: "network", message: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text || `${r.status}`);
  return text === "" ? (undefined as T) : (JSON.parse(text) as T);
}

/** * Plays a short SFX URL (buzzer / animateur echo). Best-effort ; ignores autoplay blocks. */
function playSfxUrl(url: string | undefined | null): void {
  const u = typeof url === "string" ? url.trim() : "";
  if (u === "") return;
  try {
    const audioEl = new Audio(u);
    void audioEl.play().catch(() => {});
  } catch {
    /* noop */
  }
}

/** * Points attribués sur « bonne réponse » pour la vignette / question courante (affiche boutons animateur). */
function hostGoodPointsHint(board: PartyGameBoardSurface | null | undefined): number {
  if (board === null || board === undefined) return 1;
  if (board.kind === "quiz") return board.points;
  if (board.kind === "image_buzz") return board.awardPoints;
  if (board.kind === "progressive_guess" && board.phase === "clue")
    return typeof board.awardPoints === "number" ? board.awardPoints : 1;
  return 1;
}

const STORAGE_PREFERRED_BUZZ_KEY = "partygames:preferredBuzzSoundKey";

function readPreferredBuzzSoundKey(): string | null {
  if (typeof globalThis.sessionStorage === "undefined") return null;
  const v = sessionStorage.getItem(STORAGE_PREFERRED_BUZZ_KEY)?.trim();
  return v !== undefined && v !== "" ? v : null;
}

function writePreferredBuzzSoundKey(key: string): void {
  if (typeof globalThis.sessionStorage === "undefined") return;
  sessionStorage.setItem(STORAGE_PREFERRED_BUZZ_KEY, key);
}

/** * Reads JWT `sub` (player row id) for Socket.IO eviction / verdict routing. */
function parseJwtPlayerSub(tok: string): string | null {
  try {
    const [, body] = tok.split(".");
    if (body === undefined) return null;
    let b64 = body.replace(/-/gu, "+").replace(/_/gu, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const json = globalThis.atob(b64);
    interface Decoded {
      sub?: string;
    }
    const payload = JSON.parse(json) as Decoded;
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function BuzzSoundPickerBlock(props: {
  sectionId: string;
  title: string;
  lead?: string | undefined;
  soundsLib: { defaultBuzzerKey: string; sounds: CatalogSoundEntry[] } | null;
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean | undefined;
}): JSX.Element {
  const { sectionId, title, lead, soundsLib, value, onChange, disabled } = props;
  return (
    <section aria-labelledby={sectionId}>
      <h3 id={sectionId} style={{ fontSize: 16, margin: "14px 0 8px" }}>
        {title}
      </h3>
      {soundsLib === null ? (
        <p style={{ margin: 0, opacity: 0.75 }}>Chargement des sons…</p>
      ) : soundsLib.sounds.length === 0 ? (
        <p style={{ margin: 0, opacity: 0.75 }}>Aucun son disponible (défaut serveur).</p>
      ) : (
        <>
          {typeof lead === "string" && lead !== "" ? (
            <p style={{ margin: "0 0 10px", fontSize: 14, opacity: 0.85 }}>{lead}</p>
          ) : null}
          <div className="bz-join-sound-row">
            <select
              aria-labelledby={sectionId}
              className="bz-join-sound-select"
              value={value}
              disabled={disabled === true}
              onChange={(e) => onChange(e.target.value)}
            >
              {groupCatalogSoundsForJoin(soundsLib.sounds).map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              className="bz-join-sound-preview"
              disabled={disabled === true}
              onClick={() => {
                const hit = soundsLib.sounds.find((x) => x.key === value);
                playSfxUrl(hit?.url);
              }}
            >
              Écouter
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Shell(props: {
  title: string;
  children: React.ReactNode;
  /** * Wider readable column on host dashboard. */
  wide?: boolean;
}): JSX.Element {
  return (
    <div className="bz-app">
      <div
        className={`bz-shell-container${props.wide ? " bz-shell--wide" : ""}`}
      >
        <header className="bz-header">
          <Link to="/" className="bz-logo" style={{ fontSize: 24 }}>
            <span>buzzy</span>
            <span className="bz-logo-dot" />
          </Link>
          <span className="bz-page-title">{props.title}</span>
          <nav>
            <Link to="/">Accueil</Link>
            <Link to="/create">Créer</Link>
            <Link to="/join">Rejoindre</Link>
          </nav>
        </header>
        {props.children}
      </div>
    </div>
  );
}

function Home(): JSX.Element {
  const [playerResume, setPlayerResume] = useState<{
    partyId: string;
    joinCode: string;
  } | null>(null);
  const [adminResume, setAdminResume] = useState<{
    partyId: string;
    joinCode: string;
  } | null>(null);
  const [homeSoundsLib, setHomeSoundsLib] = useState<{
    defaultBuzzerKey: string;
    sounds: CatalogSoundEntry[];
  } | null>(null);
  const [homeBuzzPick, setHomeBuzzPick] = useState("");
  const [resumeAdminDeleting, setResumeAdminDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadResume(): Promise<void> {
      if (typeof globalThis.sessionStorage === "undefined") return;
      const pidP = resolvePlayerPartyIdToResume();
      const pidA = resolveAdminPartyIdToResume();
      let pRes: { partyId: string; joinCode: string } | null = null;
      let aRes: { partyId: string; joinCode: string } | null = null;
      if (pidP !== null) {
        const lastStored = sessionStorage.getItem(STORAGE_LAST_PLAYER_PARTY);
        const cachedCode =
          lastStored === pidP ? sessionStorage.getItem(STORAGE_LAST_PLAYER_CODE) ?? "" : "";
        try {
          const s = await fetchJson<PartySnapshot>(
            `/api/parties/${encodeURIComponent(pidP)}`,
          );
          pRes = { partyId: pidP, joinCode: s.joinCode };
        } catch {
          pRes = {
            partyId: pidP,
            joinCode: cachedCode.length >= 4 ? cachedCode : "",
          };
        }
      }
      if (pidA !== null) {
        const bearerA = findAdminBearerForPartyRouteId(pidA);
        if (bearerA === null || bearerA === "") {
          purgeAdminSessionForPartyRouteId(pidA);
          aRes = null;
        } else {
          const outA = await loadPartySnapshot(pidA, { bearer: bearerA });
          if (outA.kind === "ok") {
            aRes = { partyId: pidA, joinCode: outA.snapshot.joinCode };
          } else if (outA.kind === "not_found" || outA.kind === "bad_token") {
            purgeAdminSessionForPartyRouteId(pidA);
            aRes = null;
          } else {
            aRes = { partyId: pidA, joinCode: "" };
          }
        }
      }
      if (!cancelled) {
        setPlayerResume(pRes);
        setAdminResume(aRes);
      }
    }
    void loadResume();
    function onVis(): void {
      if (document.visibilityState === "visible") void loadResume();
    }
    document.addEventListener("visibilitychange", onVis);
    return (): void => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    void fetchJson<{ defaultBuzzerKey: string; sounds: CatalogSoundEntry[] }>(`/api/sounds`).then(
      setHomeSoundsLib,
    );
  }, []);

  useEffect(() => {
    if (homeSoundsLib === null || homeBuzzPick !== "") return;
    const pref = readPreferredBuzzSoundKey();
    const fromPref =
      pref !== null && homeSoundsLib.sounds.some((s) => s.key === pref) ? pref : null;
    const d = homeSoundsLib.defaultBuzzerKey.trim();
    const hasDefault = homeSoundsLib.sounds.some((s) => s.key === d);
    const fb = homeSoundsLib.sounds[0]?.key ?? "";
    setHomeBuzzPick(fromPref ?? (hasDefault ? d : fb));
  }, [homeSoundsLib, homeBuzzPick]);

  async function onDeleteAdminResumeParty(): Promise<void> {
    if (adminResume === null) return;
    if (
      typeof globalThis.window !== "undefined" &&
      !window.confirm(
        "Supprimer cette partie sur le serveur ? Les joueurs seront déconnectés.",
      )
    )
      return;
    const bearerH = findAdminBearerForPartyRouteId(adminResume.partyId);
    if (bearerH === null || bearerH === "") {
      purgeAdminSessionForPartyRouteId(adminResume.partyId);
      setAdminResume(null);
      return;
    }
    setResumeAdminDeleting(true);
    try {
      const res = await fetch(`/api/parties/${encodeURIComponent(adminResume.partyId)}/host/delete`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${bearerH}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        interface ErrBody {
          error?: string;
        }
        const text = await res.text();
        let detail = text.slice(0, 280);
        if (text !== "") {
          try {
            detail = (JSON.parse(text) as ErrBody).error ?? text;
          } catch {
            /* noop */
          }
        }
        window.alert(`Suppression impossible : ${detail}`);
        return;
      }
      purgeAdminSessionForPartyRouteId(adminResume.partyId);
      setAdminResume(null);
    } finally {
      setResumeAdminDeleting(false);
    }
  }

  return (
    <Shell title="Accueil">
      <section className="bz-hero">
        <span className="bz-eyebrow">Live quiz · soirées en temps réel</span>
        <h1 className="bz-hero-title">
          Le buzzer<br />dans la poche.
        </h1>
        <p className="bz-hero-lead">
          Un code, un QR, et tes joueurs buzzent depuis leur téléphone
          pendant que tu fais défiler les questions ou la vidéo — tout
          est synchronisé.
        </p>
        <div className="bz-cta-row">
          <Link to="/create" className="bz-cta bz-primary">
            Créer une partie
          </Link>
          <Link to="/join" className="bz-cta">
            Rejoindre avec un code
          </Link>
        </div>
      </section>

      <section className="bz-home-player-prefs" style={{ marginTop: 28 }}>
        <BuzzSoundPickerBlock
          sectionId="home-buzz-sound-heading"
          title="Ton buzzer pour la prochaine partie"
          lead="Réglage mémorisé sur cet appareil : il sera repris automatiquement sur « Rejoindre »."
          soundsLib={homeSoundsLib}
          value={homeBuzzPick}
          onChange={(k) => {
            setHomeBuzzPick(k);
            writePreferredBuzzSoundKey(k);
          }}
        />
      </section>

      {(playerResume !== null || adminResume !== null) ? (
        <section className="bz-resume-grid">
          {playerResume !== null ? (
            <Link
              to={`/party/${encodeURIComponent(playerResume.partyId)}/play`}
              className="bz-card bz-resume-card"
            >
              <span className="bz-pill bz-accent">session joueur</span>
              <h2>Reprendre le lobby</h2>
              <p>
                Une session joueur est enregistrée dans cet onglet —
                tu peux retourner directement dans la partie.
              </p>
              <span className="bz-resume-foot">
                {playerResume.joinCode.length >= 4 ? (
                  <>code <code className="bz-code">{playerResume.joinCode}</code></>
                ) : (
                  <>session active</>
                )}
                <span className="bz-arrow" aria-hidden="true">→</span>
              </span>
            </Link>
          ) : null}

          {adminResume !== null ? (
            <div className="bz-resume-slot">
              <Link to={adminTableResumeTo(adminResume.partyId)} className="bz-card bz-resume-card">
                <span className="bz-pill bz-info">jeton animateur</span>
                <h2>Reprendre le tableau</h2>
                <p>
                  Ton jeton d'animateur est encore actif sur ce navigateur —
                  tu peux rouvrir le tableau de cette partie.
                </p>
                <span className="bz-resume-foot">
                  {adminResume.joinCode.length >= 4 ? (
                    <>code joueurs <code className="bz-code">{adminResume.joinCode}</code></>
                  ) : (
                    <>jeton actif</>
                  )}
                  <span className="bz-arrow" aria-hidden="true">→</span>
                </span>
              </Link>
              <button
                type="button"
                className="bz-home-admin-delete-btn"
                disabled={resumeAdminDeleting}
                onClick={() => void onDeleteAdminResumeParty()}
              >
                {resumeAdminDeleting ? "Suppression…" : "Supprimer ce salon"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </Shell>
  );
}

function Join(): JSX.Element {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [partyId, setPartyId] = useState(() =>
    canonicalPartyIdFromRoute(params.get("party") ?? ""),
  );
  const [snap, setSnap] = useState<PartySnapshot | null>(null);
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState<number>(1);
  /** * Slug echoed to `POST /join` — initialised once `/api/avatars` loads. */
  const [avatarKeyChosen, setAvatarKeyChosen] = useState("");
  const [avatarsLib, setAvatarsLib] = useState<{
    defaultKey: string;
    avatars: Array<{ key: string; label: string; url: string }>;
  } | null>(null);
  const [soundsLib, setSoundsLib] = useState<{
    defaultBuzzerKey: string;
    sounds: CatalogSoundEntry[];
  } | null>(null);
  /** * Key sent to `POST /join` — initialised once `/api/sounds` loads. */
  const [buzzSoundKeyChosen, setBuzzSoundKeyChosen] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void fetchJson<{
      defaultKey: string;
      avatars: Array<{ key: string; label: string; url: string }>;
    }>(`/api/avatars`).then(setAvatarsLib);
  }, []);

  useEffect(() => {
    void fetchJson<{ defaultBuzzerKey: string; sounds: CatalogSoundEntry[] }>(`/api/sounds`).then(
      setSoundsLib,
    );
  }, []);

  useEffect(() => {
    const c = params.get("code") ?? "";
    const pRaw = params.get("party");
    setCode(c);
    if (params.has("party")) setPartyId(canonicalPartyIdFromRoute(pRaw ?? ""));
    else if (c.trim() === "") setPartyId("");
  }, [params]);

  useEffect(() => {
    async function sync(): Promise<void> {
      const pidNorm = canonicalPartyIdFromRoute(partyId);
      if (pidNorm.length >= 30) {
        try {
          setSnap(
            await fetchJson<PartySnapshot>(
              `/api/parties/${encodeURIComponent(pidNorm)}`,
            ),
          );
        } catch {
          setSnap(null);
        }
        return;
      }
      const c = code.trim().toUpperCase();
      if (c.length < 4) {
        setSnap(null);
        return;
      }
      try {
        const m = await fetchJson<{ snapshot: PartySnapshot; partyId: string }>(
          `/api/parties/meta-by-code/${encodeURIComponent(c)}`,
        );
        setPartyId(canonicalPartyIdFromRoute(m.partyId));
        setSnap(m.snapshot);
      } catch {
        setSnap(null);
      }
    }
    void sync();
  }, [code, partyId]);

  useEffect(() => {
    if (avatarsLib === null || avatarKeyChosen !== "") return;
    const first = avatarsLib.avatars[0]?.key ?? avatarsLib.defaultKey;
    setAvatarKeyChosen(avatarsLib.defaultKey || first);
  }, [avatarsLib, avatarKeyChosen]);

  useEffect(() => {
    if (soundsLib === null || buzzSoundKeyChosen !== "") return;
    const pref = readPreferredBuzzSoundKey();
    const fromPref =
      pref !== null && soundsLib.sounds.some((s) => s.key === pref) ? pref : null;
    const d = soundsLib.defaultBuzzerKey.trim();
    const hasDefault = soundsLib.sounds.some((s) => s.key === d);
    const fallback = soundsLib.sounds[0]?.key ?? "";
    setBuzzSoundKeyChosen(fromPref ?? (hasDefault ? d : fallback));
  }, [soundsLib, buzzSoundKeyChosen]);

  const pidNormField = canonicalPartyIdFromRoute(partyId);
  const joinPartyIdResolved: string =
    pidNormField !== "" ? pidNormField : snap !== null ? canonicalPartyIdFromRoute(snap.id) : "";

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const pidCanon = joinPartyIdResolved;
    if (!snap || pidCanon === "") {
      if (snap !== null && pidCanon === "")
        setErr(
          "Impossible de déterminer l’identifiant de la partie. Attendez le chargement ou rafraîchissez la page.",
        );
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const key =
        avatarKeyChosen !== ""
          ? avatarKeyChosen
          : avatarsLib?.defaultKey ?? avatarsLib?.avatars[0]?.key ?? "";
      const body: Record<string, unknown> = { displayName: name.trim(), avatarKey: key };
      if (snap.maxTeams != null && snap.maxTeams >= 2) body.teamId = teamId;
      if (buzzSoundKeyChosen.trim() !== "") body.buzzSoundKey = buzzSoundKeyChosen.trim();
      const res = await fetchJson<{ playerToken: string }>(
        `/api/parties/${encodeURIComponent(pidCanon)}/join`,
        { method: "POST", body: JSON.stringify(body) },
      );
      sessionStorage.setItem(playerSessionKey(pidCanon), res.playerToken);
      rememberPlayerParty(pidCanon, snap.joinCode);
      nav(`/party/${encodeURIComponent(pidCanon)}/play`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Erreur");
    }
    setLoading(false);
  }

  const needsTeam = snap !== null && snap.maxTeams !== null && snap.maxTeams >= 2;

  return (
    <Shell title="Rejoindre une partie">
      {joinPartyIdResolved !== "" && peekPlayerJwt(joinPartyIdResolved) !== null ? (
        <p style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={() =>
              nav(`/party/${encodeURIComponent(joinPartyIdResolved)}/play`)
            }
          >
            Reprendre le lobby (vous êtes déjà inscrit sur cet appareil)
          </button>
        </p>
      ) : null}
      <form onSubmit={(e) => void onSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label>
          Code
          <input
            style={{ width: "100%", marginTop: 4 }}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCDEF"
          />
        </label>
        <label>
          Pseudo (2–48 caractères)
          <input
            style={{ width: "100%", marginTop: 4 }}
            value={name}
            minLength={2}
            maxLength={48}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <section aria-labelledby="join-avatars-heading">
          <h3 id="join-avatars-heading" style={{ fontSize: 16, margin: "14px 0 8px" }}>
            Avatar
          </h3>
          {avatarsLib === null ? (
            <p style={{ margin: 0, opacity: 0.75 }}>Chargement des images…</p>
          ) : (
            <>
              <p style={{ margin: "0 0 10px", fontSize: 14, opacity: 0.85 }}>
                Choisissez une image affichée à côté de votre pseudo.
              </p>
              <div
                role="radiogroup"
                aria-label="Bibliothèque d’avatars"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
                  gap: 10,
                  maxHeight: 320,
                  overflowY: "auto",
                  padding: 4,
                }}
              >
                {avatarsLib.avatars.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    role="radio"
                    aria-checked={avatarKeyChosen === a.key}
                    aria-label={a.label}
                    className="bz-avatar-pick"
                    onClick={() => setAvatarKeyChosen(a.key)}
                  >
                    <AvatarFigure src={a.url} sizePx={56} />
                    <span>{a.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
        <BuzzSoundPickerBlock
          sectionId="join-buzz-sound-heading"
          title="Son du buzzer"
          lead="Choisissez le son joué sur votre téléphone quand vous buzz (si l’animateur l’autorise)."
          soundsLib={soundsLib}
          value={buzzSoundKeyChosen}
          disabled={loading}
          onChange={(k) => {
            setBuzzSoundKeyChosen(k);
            writePreferredBuzzSoundKey(k);
          }}
        />
        {needsTeam ? (
          <label>
            Équipe (1–{snap.maxTeams})
            <input
              type="number"
              min={1}
              max={snap.maxTeams ?? 2}
              value={teamId}
              style={{ width: "100%", marginTop: 4 }}
              onChange={(e) => setTeamId(Number.parseInt(e.target.value, 10))}
              required
            />
          </label>
        ) : null}
        {err ? <p style={{ color: "crimson" }}>{err}</p> : null}
        <button
          type="submit"
          disabled={
            snap === null ||
            loading ||
            avatarKeyChosen === "" ||
            (soundsLib !== null && soundsLib.sounds.length > 0 && buzzSoundKeyChosen === "")
          }
        >
          Rejoindre le lobby / la partie
        </button>
      </form>
      {snap === null && code.trim().length >= 4 ? <p>Code introuvable…</p> : null}
      {snap ? <PlayersPreview snap={snap} /> : null}
    </Shell>
  );
}

function PlayersPreview(props: { snap: PartySnapshot }): JSX.Element {
  return (
    <section style={{ marginTop: 20 }}>
      <h2>Déjà inscrits</h2>
      <ul style={{ paddingLeft: 0, listStyle: "none" }}>
        {props.snap.players.map((p) => (
          <li
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
              padding: "6px 0",
            }}
          >
            <AvatarFigure src={p.avatarUrl} sizePx={40} />
            <span>
              {p.displayName} · {p.score} pts · équipe {p.teamId === null ? "—" : p.teamId}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** * Quiz illustration; decorative only (meaning is conveyed by `prompt`). */
function QuizIllustration(props: { imageUrl: string; variant: "panel" | "broadcast" }): JSX.Element | null {
  const u = props.imageUrl.trim();
  if (u === "") return null;
  const wrapCls =
    props.variant === "broadcast" ? "bz-bc-quiz-img-wrap" : "bz-board-question-img-wrap";
  return (
    <div className={wrapCls}>
      <img
        className="bz-board-question-img"
        src={u}
        alt=""
        decoding="async"
        loading="lazy"
      />
    </div>
  );
}

/** * Displays quiz prompt or video from `gameBoard`; host may reveal the keyed correct choice on quiz. */
function GameBoardPanel(props: {
  board: PartyGameBoardSurface | null;
  partyState: string;
  revealCorrect: boolean;
  /** * Host prévisualisation blind : lectures locales toujours autorisées. */
  blindHostPresenter?: boolean;
  /** * Joueurs / diffusion : rejouer / play sur l’appareil seulement si l’animateur l’active. */
  allowBlindPlaybackOnClients?: boolean;
  /** * Animateur quiz : surbrillance des options choisies dans la file buzz (un « bad » domine sur une même ligne). */
  hostQuizBuzzHighlights?: Array<{ choiceIndex: number; tone: "good" | "bad" }>;
  /** * Joueur QCM : clic pour choisir avant buzz ; après buzz réponse figée jusqu'au clic animateur puis bon/mauvais visible. */
  quizPlayerPickUi?: {
    selectedIndex: number | null;
    locked?: { choiceIndex: number; verdict?: "good" | "bad" } | null;
    onPick: (choiceIndex: number) => void;
    canPick: boolean;
  };
}): JSX.Element | null {
  const {
    board,
    partyState,
    revealCorrect,
    blindHostPresenter,
    allowBlindPlaybackOnClients,
    hostQuizBuzzHighlights,
    quizPlayerPickUi,
  } = props;

  const blindClientsMayPlay =
    blindHostPresenter === true || (allowBlindPlaybackOnClients ?? false) === true;

  if (board !== null && board.kind === "video") {
    return (
      <section className="bz-board">
        <div className="bz-board-meta">
          <span className="bz-pill bz-info"><span className="bz-dot" />vidéo</span>
          <span>
            {board.packTitle} · Manche {board.roundNumberHuman} — {board.roundTitle}
          </span>
        </div>
        <video
          key={board.replaySerial}
          controls
          playsInline
          preload="metadata"
          className="bz-board-video"
          src={board.videoUrl}
        >
          Lecture vidéo non supportée par ce navigateur.
        </video>
      </section>
    );
  }

  if (board !== null && board.kind === "free_buzz") {
    const planned = board.plannedQuestionCount;
    return (
      <section className="bz-board">
        <div className="bz-board-meta">
          <span className="bz-pill bz-info">
            <span className="bz-dot" />
            questions libres
          </span>
          <span>
            {board.packTitle} · Manche {board.roundNumberHuman} — {board.roundTitle}
          </span>
        </div>
        <h2 className="bz-board-prompt">Question {board.questionNumberHuman}</h2>
        {planned !== null ? (
          <p className="bz-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
            Environ {planned} question{planned === 1 ? "" : "s"} prévue{planned === 1 ? "" : "s"} pour cette
            manche (indicatif — l&apos;animateur peut s&apos;arrêter avant ou prolonger).
          </p>
        ) : null}
        <p className="bz-free-buzz-lead">{board.prompt}</p>
      </section>
    );
  }

  if (board !== null && board.kind === "image_buzz") {
    const lead =
      typeof board.prompt === "string" && board.prompt.trim() !== ""
        ? board.prompt.trim()
        : "Buzzer puis donne ta réponse à voix haute — pas de choix à l'écran.";
    return (
      <section className="bz-board">
        <div className="bz-board-meta">
          <span className="bz-pill bz-info">
            <span className="bz-dot" />
            image · réponse orale
          </span>
          <span>
            {board.packTitle} · Manche {board.roundNumberHuman} — {board.roundTitle} — visuel{" "}
            {board.slideIndexHuman}/{board.slideCount}
          </span>
        </div>
        <QuizIllustration imageUrl={board.imageUrl} variant="panel" />
        <p className="bz-free-buzz-lead">{lead}</p>
        <p className="bz-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
          L&apos;animateur ouvre le buzzer : la file indique qui répond à l&apos;oral dans l&apos;ordre.
        </p>
      </section>
    );
  }

  if (board !== null && board.kind === "progressive_guess") {
    if (board.phase === "clue") {
      const lead =
        typeof board.playerPrompt === "string" && board.playerPrompt.trim() !== ""
          ? board.playerPrompt.trim()
          : "Un seul titre pour toute la série d’images — buzz puis réponds à voix haute.";
      return (
        <section className="bz-board">
          <div className="bz-board-meta">
            <span className="bz-pill bz-accent">
              +{board.awardPoints ?? 1} {(board.awardPoints ?? 1) === 1 ? "pt" : "pts"}
            </span>
            <span>
              {board.packTitle} · {board.roundTitle} — énigme {board.puzzleIndexHuman}/{board.puzzleCount} ·
              indice {board.clueIndexHuman}/{board.clueCount}
            </span>
          </div>
          {typeof board.imageUrl === "string" && board.imageUrl.trim() !== "" ? (
            <QuizIllustration imageUrl={board.imageUrl} variant="panel" />
          ) : null}
          <p className="bz-free-buzz-lead">{lead}</p>
          <p className="bz-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
            Indice suivant plus facile&nbsp;: le bonus «&nbsp;bonne réponse&nbsp;» peut baisser.
          </p>
        </section>
      );
    }
    const img = typeof board.revealImageUrl === "string" ? board.revealImageUrl.trim() : "";
    return (
      <section className="bz-board">
        <div className="bz-board-meta">
          <span className="bz-pill bz-good">
            <span className="bz-dot" />
            révélation
          </span>
          <span>
            {board.packTitle} · {board.roundTitle} — énigme {board.puzzleIndexHuman}/{board.puzzleCount}
          </span>
        </div>
        {img !== "" ? <QuizIllustration imageUrl={img} variant="panel" /> : null}
        <h2 className="bz-board-prompt" style={{ marginTop: 16 }}>
          {board.answer ?? "—"}
        </h2>
      </section>
    );
  }

  if (board !== null && board.kind === "audio_blind") {
    const showReveal =
      revealCorrect &&
      typeof board.revealTitle === "string" &&
      board.revealTitle.trim() !== "";
    return (
      <section className="bz-board">
        <div className="bz-board-meta">
          <span className="bz-pill bz-accent">
            <span className="bz-dot" />
            blind test
          </span>
          <span>
            {board.packTitle} · {board.roundTitle} — extrait {board.trackIndexHuman}/{board.trackCount}
          </span>
        </div>
        {blindClientsMayPlay ? (
          <audio
            key={board.replaySerial}
            controls
            className="bz-board-audio"
            preload="metadata"
            src={board.audioUrl}
          >
            Lecture audio non supportée.
          </audio>
        ) : (
          <p className="bz-blind-remote-audio-hint">
            Défaut animateur&nbsp;: pas de flux audio sur cet appareil — l&apos;extrait passe par les enceintes ou
            l&apos;écran géant. Ton animateur peut activer lecture et rejouer ici depuis son tableau si besoin (jeu
            en solo / écouteurs).
          </p>
        )}
        {showReveal ? (
          <div className="bz-audio-host-reveal">
            <p style={{ margin: "0 0 6px", fontSize: 15 }}>
              <span className="bz-pill bz-good">
                <span className="bz-dot" />
                fiche animateur
              </span>
            </p>
            <p style={{ margin: 0, fontSize: 17 }}>
              <strong>Titre</strong> : {board.revealTitle}
            </p>
            {typeof board.revealArtist === "string" && board.revealArtist.trim() !== "" ? (
              <p style={{ margin: "8px 0 0", fontSize: 16 }}>
                <strong>Artiste / détail</strong> : {board.revealArtist}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="bz-board-embed-hint bz-muted">
            {blindClientsMayPlay
              ? "Écoute l&apos;extrait. Titre et artiste ne sont pas affichés ici pour les joueurs ni en projection."
              : "Titre et artiste ne sont montrés nulle part tant que tu ne les annonces pas — la fiche réservée animateur liste la bonne réponse."}
          </p>
        )}
      </section>
    );
  }

  if (board !== null && board.kind === "quiz") {
    const ci = board.correctChoiceIndex;
    const correctText =
      revealCorrect &&
      typeof ci === "number" &&
      ci >= 0 &&
      ci < board.choices.length
        ? board.choices[ci]
        : null;

    const hostToneByIndex = new Map<number, "good" | "bad">();
    for (const h of hostQuizBuzzHighlights ?? []) {
      hostToneByIndex.set(h.choiceIndex, h.tone);
    }
    const qp = quizPlayerPickUi;

    return (
      <section className="bz-board">
        <div className="bz-board-meta">
          <span className="bz-pill bz-accent">
            +{board.points} {board.points === 1 ? "pt" : "pts"}
          </span>
          <span>
            {board.packTitle} · Manche {board.roundNumberHuman} — {board.roundTitle}
            {" · Question "}
            {board.questionIndexInRound + 1}
          </span>
        </div>
        {typeof board.imageUrl === "string" && board.imageUrl.trim() !== "" ? (
          <QuizIllustration imageUrl={board.imageUrl} variant="panel" />
        ) : null}
        <h2 className="bz-board-prompt">{board.prompt}</h2>
        <ol className={`bz-board-choices${qp !== undefined ? " bz-board-choices--pickable" : ""}`}>
          {board.choices.map((c, i) => {
            const isCorrectReveal =
              revealCorrect && typeof ci === "number" && ci === i;
            const buzzTone =
              revealCorrect === true ? hostToneByIndex.get(i) : undefined;

            let rowClass = `bz-choice ${isCorrectReveal ? "bz-choice--correct" : ""}`;
            if (revealCorrect && buzzTone === "good") rowClass += " bz-choice--host-pick-good";
            if (revealCorrect && buzzTone === "bad") rowClass += " bz-choice--host-pick-bad";

            const lockedRow = qp?.locked ?? null;
            if (qp !== undefined && lockedRow !== null && lockedRow.choiceIndex === i) {
              if (lockedRow.verdict === "good") rowClass += " bz-choice--player-pick-good";
              else if (lockedRow.verdict === "bad") rowClass += " bz-choice--player-pick-bad";
              else rowClass += " bz-choice--player-pick-locked";
            } else if (qp !== undefined && lockedRow === null && qp.canPick && qp.selectedIndex === i) {
              rowClass += " bz-choice--selected";
            }

            const key = `${board.roundIndex}-${board.questionIndexInRound}-${i}`;

            if (qp !== undefined && qp.canPick) {
              return (
                <li key={key} className="bz-choice-slot">
                  <button
                    type="button"
                    className={rowClass}
                    onClick={() => qp.onPick(i)}
                  >
                    <span className="bz-choice-letter">{String.fromCharCode(65 + i)}</span>
                    <span className="bz-choice-text">{c}</span>
                    {isCorrectReveal ? (
                      <span className="bz-pill bz-good">
                        <span className="bz-dot" />
                        bonne réponse
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            }

            return (
              <li key={key} className={rowClass}>
                <span className="bz-choice-letter">{String.fromCharCode(65 + i)}</span>
                <span className="bz-choice-text">{c}</span>
                {isCorrectReveal ? (
                  <span className="bz-pill bz-good">
                    <span className="bz-dot" />
                    bonne réponse
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        {qp !== undefined &&
        qp.locked !== undefined &&
        qp.locked !== null &&
        qp.locked.verdict === undefined ? (
          <p className="bz-board-quiz-wait-host bz-muted" style={{ marginTop: 10 }}>
            Réponse enregistrée — l&apos;animateur doit valider dans la file de buzz avant l&apos;indication bon /
            mauvais à l&apos;écran.
          </p>
        ) : null}
        {correctText !== null ? (
          <p className="bz-board-answer">
            Réponse attendue : <strong>{correctText}</strong>
          </p>
        ) : null}
      </section>
    );
  }

  if (board !== null && board.kind === "youtube") {
    return (
      <section className="bz-board">
        <div className="bz-board-meta">
          <span className="bz-pill bz-accent">
            <span className="bz-dot" />
            YouTube
          </span>
          <span>{board.title}</span>
        </div>
        <div className="bz-board-embed-wrap">
          <iframe
            key={board.replaySerial}
            title={board.title}
            src={board.embedUrl}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        <p className="bz-board-embed-hint bz-muted">
          Une vidéo peut refuser totalement la lecture dans un cadre si l&apos;auteur l&apos;a interdit («
          Autoriser l&apos;intégration »), si elle est géo-bloquée, soumise à une limite d&apos;âge, ou privée /
          liste restreinte. Dans ce cas même un lien nocookie échoue — choisis une autre vidéo ou ouvre-la sur{" "}
          <code className="bz-code">youtube.com</code> dans un onglet séparé. Si l&apos;écran semble cassé alors
          que l&apos;intégration est autorisée : désactivez le bloqueur de pub pour ce site ( lecteur +{" "}
          <code className="bz-code">googlevideo</code>/<code className="bz-code">doubleclick.net</code> ), évitez
          la navigation privée stricte, ou désactivez un anti-tracking trop agressif.
        </p>
      </section>
    );
  }

  if (board !== null && board.kind === "iframe") {
    return (
      <section className="bz-board bz-board--external-site">
        <div className="bz-board-meta">
          <span className="bz-pill bz-info">
            <span className="bz-dot" />
            page externe (hors cadre)
          </span>
          <span>{board.title}</span>
        </div>
        <p className="bz-board-external-lead">
          Ce type de page ne peut pas être affiché dans Buzzy : les sites sérieux envoient des en-têtes (
          <code className="bz-code">X-Frame-Options</code>, <code className="bz-code">Content-Security-Policy</code>
          ) qui interdisent l&apos;intégration pour des raisons de sécurité. Ouvre le lien depuis un navigateur
          pleine page (projecteur ou appareil des joueurs).
        </p>
        <div className="bz-board-external-actions">
          <a
            className="bz-primary-link"
            href={board.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ouvrir « {board.title} » dans un nouvel onglet
          </a>
        </div>
        <p className="bz-muted" style={{ fontSize: "0.92rem", marginBottom: 0 }}>
          Ancienne manche « page dans un cadre » — supprime-la du scénario si tu préfères ne plus l&apos;utiliser.
          Pour une vidéo hébergée sur YouTube, ajoute une manche « Vidéo YouTube » à la place.
        </p>
      </section>
    );
  }

  if (partyState === "round_active" && board === null) {
    return (
      <section className="bz-board bz-board--empty">
        <h2>Zone de jeu</h2>
        <p>
          Rien à afficher pour l&apos;instant : la manche n&apos;a pas encore de surface jouable (quiz à lancer depuis
          l&apos;animateur ou média en chargement / indisponible).
        </p>
      </section>
    );
  }
  return null;
}

/** * No player JWT: load public snapshot to redirect to `/join?code=` only (compact invite links / QR). */
function RedirectJoinForReauth(props: { partyId: string }): JSX.Element {
  const nav = useNavigate();
  const pidCanon = canonicalPartyIdFromRoute(props.partyId);
  useEffect(() => {
    let cancelled = false;
    void fetchJson<PartySnapshot>(`/api/parties/${encodeURIComponent(pidCanon)}`)
      .then((s) => {
        if (!cancelled)
          nav(`/join?code=${encodeURIComponent(s.joinCode)}`, { replace: true });
      })
      .catch(() => {
        if (!cancelled) nav("/join", { replace: true });
      });
    return (): void => {
      cancelled = true;
    };
  }, [pidCanon, nav]);
  return (
    <Shell title="Redirection…">
      <p>Ouverture de la page rejoindre…</p>
    </Shell>
  );
}

function Create(): JSX.Element {
  const nav = useNavigate();
  const [playersUnlimited, setPlayersUnlimited] = useState(true);
  const [teamsUnlimited, setTeamsUnlimited] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(12);
  const [maxTeams, setMaxTeams] = useState(3);
  const [closedAfterStart, setClosedAfterStart] = useState(false);
  const [allowRename, setAllowRename] = useState(true);
  const [allowTeamChange, setAllowTeamChange] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    try {
      const body = {
        playersUnlimited,
        teamsUnlimited,
        maxPlayers: playersUnlimited ? undefined : maxPlayers,
        maxTeams: teamsUnlimited ? undefined : maxTeams,
        closedAfterStart,
        allowRename,
        allowTeamChange,
      };
      const res = await fetchJson<{
        adminToken: string;
        partyId: string;
      }>(`/api/parties`, { method: "POST", body: JSON.stringify(body) });
      sessionStorage.setItem(adminSessionKey(res.partyId), res.adminToken);
      rememberAdminParty(res.partyId);
      nav(`/party/${res.partyId}/admin#token=${encodeURIComponent(res.adminToken)}`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Erreur");
    }
  }

  return (
    <Shell title="Nouvelle partie">
      <form onSubmit={(e) => void onSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label>
          <input type="checkbox" checked={playersUnlimited} onChange={(e) => setPlayersUnlimited(e.target.checked)} />{" "}
          Joueurs illimités
        </label>
        {!playersUnlimited ? (
          <label>
            Plafond joueurs
            <input
              type="number"
              min={2}
              max={500}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number.parseInt(e.target.value, 10))}
            />
          </label>
        ) : null}

        <label>
          <input type="checkbox" checked={teamsUnlimited} onChange={(e) => setTeamsUnlimited(e.target.checked)} />{" "}
          Pas d’équipes (solo)
        </label>
        {!teamsUnlimited ? (
          <label>
            Nombre d’équipes (≥2)
            <input
              type="number"
              min={2}
              max={40}
              value={maxTeams}
              onChange={(e) => setMaxTeams(Number.parseInt(e.target.value, 10))}
            />
          </label>
        ) : null}

        <label>
          <input type="checkbox" checked={closedAfterStart} onChange={(e) => setClosedAfterStart(e.target.checked)} />{" "}
          Partie fermée après le premier lancement
        </label>
        <label>
          <input type="checkbox" checked={allowRename} onChange={(e) => setAllowRename(e.target.checked)} /> Authoriser le
          changement de pseudo (lobby)
        </label>
        <label>
          <input
            type="checkbox"
            checked={allowTeamChange}
            onChange={(e) => setAllowTeamChange(e.target.checked)}
          />{" "}
          Authoriser le changement d’équipe (lobby)
        </label>
        {err ? <p style={{ color: "crimson" }}>{err}</p> : null}
        <button type="submit">Créer et ouvrir l’administration</button>
      </form>
    </Shell>
  );
}

function Play(): JSX.Element {
  const { partyId } = useParams<{ partyId: string }>();
  const pid = canonicalPartyIdFromRoute(partyId);
  const nav = useNavigate();
  const [jwt, setJwt] = useState<string | null>(() => peekPlayerJwt(pid));

  useEffect(() => {
    setJwt(peekPlayerJwt(pid));
  }, [pid]);

  const [snap, setSnap] = useState<PartySnapshot | null>(null);
  const [chat, setChat] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [quizSelected, setQuizSelected] = useState<number | null>(null);
  const [quizBuzzLocked, setQuizBuzzLocked] = useState<{
    choiceIndex: number;
    verdict?: "good" | "bad";
  } | null>(null);
  const [lobbySoundsLib, setLobbySoundsLib] = useState<{
    defaultBuzzerKey: string;
    sounds: CatalogSoundEntry[];
  } | null>(null);
  const [lobbyBuzzSaving, setLobbyBuzzSaving] = useState(false);

  useEffect(() => {
    void fetchJson<{ defaultBuzzerKey: string; sounds: CatalogSoundEntry[] }>(`/api/sounds`).then(
      setLobbySoundsLib,
    );
  }, []);

  useEffect(() => {
    if (!pid || jwt === null || jwt === "") return undefined;

    fetchJson<PartySnapshot>(`/api/parties/${encodeURIComponent(pid)}`)
      .then((s1) => setSnap(s1))
      .catch(() => setSnap(null));

    const s: Socket = io({
      transports: ["websocket", "polling"],
      auth: { partyId: pid, bearer: jwt, role: "player" },
    });

    const onSnap = (p: PartySnapshot) => setSnap(p);
    const onTerminated = (): void => {
      purgePlayerSessionForPartyRouteId(pid);
      s.disconnect();
      nav("/", { replace: true });
    };
    const onBuzzVerdict = (payload: {
      playerId?: string;
      verdict?: unknown;
    }): void => {
      const sub = parseJwtPlayerSub(jwt);
      if (
        typeof sub !== "string" ||
        typeof payload.playerId !== "string" ||
        payload.playerId !== sub
      ) {
        return;
      }
      if (payload.verdict !== "good" && payload.verdict !== "bad") return;
      setQuizBuzzLocked((prev) =>
        prev === null ? prev : { ...prev, verdict: payload.verdict as "good" | "bad" },
      );
    };
    const onKicked = (payload: { playerId?: string }): void => {
      const sub = parseJwtPlayerSub(jwt);
      if (
        typeof sub !== "string" ||
        typeof payload.playerId !== "string" ||
        payload.playerId !== sub
      ) {
        return;
      }
      purgePlayerSessionForPartyRouteId(pid);
      s.disconnect();
      nav("/", { replace: true });
    };
    s.on("party:patch", onSnap);
    s.on("party:terminated", onTerminated);
    s.on("party:buzz_verdict", onBuzzVerdict);
    s.on("party:kicked", onKicked);

    return (): void => {
      s.off("party:patch", onSnap);
      s.off("party:terminated", onTerminated);
      s.off("party:buzz_verdict", onBuzzVerdict);
      s.off("party:kicked", onKicked);
      s.disconnect();
    };
  }, [pid, jwt, nav]);

  useEffect(() => {
    if (!pid || jwt === null || jwt === "" || snap === null) return;
    rememberPlayerParty(pid, snap.joinCode);
  }, [pid, jwt, snap]);

  const quizSurfaceKey =
    snap?.gameBoard?.kind === "quiz"
      ? `${snap.gameBoard.roundIndex}-${snap.gameBoard.questionIndexInRound}`
      : "";

  useEffect(() => {
    setQuizSelected(null);
    setQuizBuzzLocked(null);
  }, [quizSurfaceKey]);

  useEffect(() => {
    if (snap?.gameBoard?.kind !== "quiz") return;
    if (snap.buzzWindowOpen !== false) return;
    setQuizSelected(null);
    setQuizBuzzLocked(null);
  }, [snap?.gameBoard?.kind, snap?.buzzWindowOpen]);

  async function buzz(): Promise<void> {
    if (!pid || jwt === null || jwt === "") return;
    if (
      snap?.gameBoard?.kind === "quiz" &&
      typeof quizSelected !== "number"
    ) {
      setErr("Choisis une réponse avant de buzzer.");
      return;
    }
    setErr(null);
    try {
      const res = await fetchJson<{
        snapshot: PartySnapshot;
        buzzToneUrl?: string;
        quizPickFeedback?: { choiceIndex: number };
      }>(`/api/parties/${pid}/me/buzz`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body:
          snap?.gameBoard?.kind === "quiz"
            ? JSON.stringify({ quizChoiceIndex: quizSelected })
            : JSON.stringify({}),
      });
      setSnap(res.snapshot);
      if (typeof res.quizPickFeedback?.choiceIndex === "number") {
        setQuizBuzzLocked({
          choiceIndex: res.quizPickFeedback.choiceIndex,
        });
      }
      if (
        typeof res.buzzToneUrl === "string" &&
        res.buzzToneUrl.length > 0 &&
        res.snapshot.soundBuzzerPublic?.playOnPlayerDevice === true
      ) {
        playSfxUrl(res.buzzToneUrl);
      }
    } catch (e3) {
      setErr(e3 instanceof Error ? e3.message : "Buzz refusé");
    }
  }

  async function sendChat(textOverride?: string): Promise<void> {
    if (!pid || jwt === null || jwt === "") return;
    const payload = (typeof textOverride === "string" ? textOverride : chat).trim();
    if (payload === "") return;
    setErr(null);
    try {
      const snapRes = await fetchJson<PartySnapshot>(`/api/parties/${pid}/me/chat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ text: payload }),
      });
      setChat("");
      setSnap(snapRes);
    } catch (e3) {
      setErr(e3 instanceof Error ? e3.message : "Chat refusé");
    }
  }

  if (!pid) return <Navigate to="/join" replace />;

  if (jwt === null || jwt === "") return <RedirectJoinForReauth partyId={pid} />;

  /** * Spinner before first REST response. */
  if (snap === null) return <Shell title="Chargement…">Connexion lobby…</Shell>;

  const myId = parseJwtPlayerSub(jwt);
  const rowMe = snap.players.find((p) => p.id === myId);
  const canChatRoom = snap.state === "lobby" || snap.state === "between_rounds";
  const canBuzz = snap.state === "round_active" && snap.buzzWindowOpen;
  const queuedBuzz = typeof myId === "string" && snap.buzzOrder.some((bid) => bid === myId);

  async function updateMyBuzzSound(next: string): Promise<void> {
    if (!pid || jwt === null || jwt === "") return;
    const me = snap.players.find((p) => p.id === myId);
    if (me === undefined || me.buzzSoundKey === next) return;
    setErr(null);
    setLobbyBuzzSaving(true);
    try {
      const s = await fetchJson<PartySnapshot>(`/api/parties/${encodeURIComponent(pid)}/me`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ buzzSoundKey: next }),
      });
      setSnap(s);
      writePreferredBuzzSoundKey(next);
    } catch (e4) {
      setErr(e4 instanceof Error ? e4.message : "Mise à jour refusée");
    }
    setLobbyBuzzSaving(false);
  }

  return (
    <Shell title={`Partie · ${snap.joinCode}`}>
      <section className="bz-identity-strip">
        {rowMe !== undefined ? (
          <span className="bz-avatar-slot" title={rowMe.avatarUrl}>
            <AvatarFigure src={rowMe.avatarUrl} sizePx={44} />
          </span>
        ) : (
          <span className="bz-avatar">?</span>
        )}
        <div className="bz-identity-info">
          <div className="bz-identity-name">{rowMe?.displayName ?? "—"}</div>
          <div className="bz-identity-meta">
            {snap.maxTeams != null && snap.maxTeams >= 2 ? (
              <span>
                Équipe&nbsp;
                <strong>
                  {rowMe?.teamId === null || rowMe?.teamId === undefined
                    ? "—"
                    : rowMe.teamId}
                </strong>
              </span>
            ) : null}
            <span
              className={`bz-pill ${
                snap.state === "round_active" ? "bz-live" : ""
              }`}
            >
              {snap.state === "round_active" ? (
                <span className="bz-dot" />
              ) : null}
              {snap.state}
            </span>
          </div>
        </div>
        <div className="bz-identity-score">
          <span className="bz-score-label">points</span>
          <span className="bz-score-value">{rowMe?.score ?? 0}</span>
        </div>
      </section>

      {err ? <p style={{ color: "crimson" }}>{err}</p> : null}

      <GameBoardPanel
        board={snap.gameBoard ?? null}
        partyState={snap.state}
        revealCorrect={false}
        allowBlindPlaybackOnClients={snap.allowPlayerAudioControl === true}
        quizPlayerPickUi={
          snap.state === "round_active" && snap.gameBoard?.kind === "quiz"
            ? {
                selectedIndex: quizSelected,
                locked: quizBuzzLocked,
                onPick: (ix) => {
                  setQuizSelected(ix);
                },
                canPick: canBuzz && !queuedBuzz,
              }
            : undefined
        }
      />

      <section className="bz-buzz-hero">
        {canBuzz ? (
          <button
            type="button"
            onClick={() => void buzz()}
            disabled={snap.gameBoard?.kind === "quiz" && quizSelected === null}
            className="bz-buzz-btn bz-buzz-armed"
            aria-label="Buzz"
          >
            BUZZ
          </button>
        ) : (
          <div className="bz-buzz-closed">
            <span className="bz-pill">buzzer fermé</span>
            <p>
              {snap.gameBoard !== null &&
              snap.gameBoard.kind === "audio_blind" &&
              snap.allowPlayerAudioControl !== true
                ? "Blind test : pas de lecteur audio sur ton téléphone tant que l’animateur diffuse en salle uniquement."
                : snap.gameBoard !== null &&
                  (snap.gameBoard.kind === "video" ||
                    snap.gameBoard.kind === "youtube" ||
                    snap.gameBoard.kind === "audio_blind")
                  ? "Regarde ou écoute — l’animateur peut enchaîner l’extrait pour tout le monde."
                : snap.gameBoard !== null &&
                  snap.gameBoard.kind === "progressive_guess" &&
                  snap.gameBoard.phase === "reveal"
                  ? "Révélation affichée : plus d’indices — le buzzer ne sert plus à marquer sur cette vignette."
                : snap.gameBoard !== null &&
                  (snap.gameBoard.kind === "free_buzz" ||
                    snap.gameBoard.kind === "image_buzz" ||
                    (snap.gameBoard.kind === "progressive_guess" &&
                      snap.gameBoard.phase === "clue"))
                  ? "Pas de choix à l'écran : réponds à voix quand l’animateur ouvre le buzzer."
                : snap.state === "lobby"
                ? "En attente du démarrage de la manche par l'animateur."
                : snap.state === "between_rounds"
                ? "Pause entre les manches. Le buzzer rouvrira à la prochaine manche."
                : snap.state === "ended"
                ? "Partie terminée. Merci d'avoir joué !"
                : "L'animateur n'a pas encore ouvert le buzzer pour cette question."}
            </p>
          </div>
        )}
      </section>

      {snap.buzzOrder.length > 0 ? (
        <section className="bz-queue">
          <h2>File de buzz</h2>
          <ol>
            {snap.buzzOrder.map((idBuzz, idx) => {
              const pl = snap.players.find((x) => x.id === idBuzz);
              const isMe = idBuzz === myId;
              return (
                <li
                  key={`${idBuzz}-${idx}`}
                  className={`bz-queue-row ${isMe ? "bz-queue-me" : ""}`}
                >
                  <span className="bz-queue-rank">{idx + 1}</span>
                  <span className="bz-queue-name">
                    {pl?.displayName ?? idBuzz}
                    {isMe ? " · toi" : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {canChatRoom ? (
        <section className="bz-chat">
          <h2>Chat</h2>
          <div className="bz-chat-input">
            <textarea
              value={chat}
              rows={2}
              placeholder="Message…"
              onChange={(e) => setChat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                e.preventDefault();
                void sendChat(e.currentTarget.value);
              }}
            />
            <button type="button" onClick={() => void sendChat()}>
              Envoyer
            </button>
          </div>
          <ul className="bz-chat-list">
            {snap.chatTail.slice(-15).map((m) => (
              <li key={m.id} className="bz-chat-row">
                <strong>{m.displayName}</strong>
                <span>{m.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="bz-muted">
          Chat disponible en lobby ou entre deux manches.
        </p>
      )}

      <p className="bz-leave">
        <button
          type="button"
          onClick={() =>
            nav(`/join?code=${encodeURIComponent(snap.joinCode)}`)
          }
        >
          Quitter pour changer pseudo / équipe
        </button>
      </p>
    </Shell>
  );
}

function Admin(): JSX.Element {
  const { partyId } = useParams<{ partyId: string }>();
  const pid = canonicalPartyIdFromRoute(partyId);
  const nav = useNavigate();
  const [token, setToken] = useState<string | null>(() => peekAdminBearer(pid));
  const [snap, setSnap] = useState<PartySnapshot | null>(null);
  const [packsList, setPacksList] = useState<
    Array<{ basename: string; id: string; title: string; roundCount?: number }>
  >([]);
  const [err, setErr] = useState<string | null>(null);
  const [hostChat, setHostChat] = useState("");
  const [adminBootstrap, setAdminBootstrap] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  /** * Why host bootstrap landed on « unavailable » (for wording + retry affordance). */
  const [adminUnavailableKind, setAdminUnavailableKind] = useState<
    "gone" | "bad_token" | "network" | "http" | null
  >(null);
  /** * Bumped to replay the bootstrap fetch without changing Bearer or party id (network flake). */
  const [adminBootstrapRetryNonce, setAdminBootstrapRetryNonce] = useState(0);

  /** * Popup: append a scripted manche (quiz, YouTube ou vidéo dans `games/video`). */
  const [addMancheOpen, setAddMancheOpen] = useState(false);
  const [addMancheFlavor, setAddMancheFlavor] = useState<"pack" | "youtube" | "local_video">(
    "pack",
  );
  const [modalPackBasename, setModalPackBasename] = useState("");
  const [modalMancheTitle, setModalMancheTitle] = useState("");
  const [modalSiteUrl, setModalSiteUrl] = useState("");
  const [modalLocalVideoPick, setModalLocalVideoPick] = useState("");
  const [hostedVideoFiles, setHostedVideoFiles] = useState<Array<{ name: string; url: string }>>(
    [],
  );
  const [hostedVideoListLoading, setHostedVideoListLoading] = useState(false);
  const [deltaById, setDeltaById] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetchJson<{
      packs: Array<{ basename: string; id: string; title: string; roundCount: number }>;
    }>(`/api/packs`).then((r) => setPacksList(r.packs));
  }, []);

  useEffect(() => {
    if (packsList.length === 0) return;
    setModalPackBasename((prev) => {
      if (prev !== "" && packsList.some((p) => p.basename === prev)) return prev;
      return packsList[0]!.basename;
    });
  }, [packsList]);

  useEffect(() => {
    if (!addMancheOpen || addMancheFlavor !== "local_video") return;
    setHostedVideoListLoading(true);
    void fetchJson<{ videos: Array<{ name: string; url: string }> }>("/api/games/video-files")
      .then((r) => setHostedVideoFiles(r.videos))
      .catch(() => setHostedVideoFiles([]))
      .finally(() => setHostedVideoListLoading(false));
  }, [addMancheFlavor, addMancheOpen]);

  useEffect(() => {
    if (!addMancheOpen || addMancheFlavor !== "local_video") return;
    setModalLocalVideoPick((prev) => {
      if (prev !== "" && hostedVideoFiles.some((v) => v.url === prev)) return prev;
      return hostedVideoFiles[0]?.url ?? "";
    });
  }, [addMancheFlavor, addMancheOpen, hostedVideoFiles]);

  useEffect(() => {
    setToken(peekAdminBearer(pid));
  }, [pid]);

  const bearer = token ?? "";

  useEffect(() => {
    if (!pid || bearer === "") return undefined;

    let cancelled = false;
    const ac = new AbortController();
    setAdminBootstrap("loading");
    setSnap(null);
    setAdminUnavailableKind(null);

    void (async () => {
      const outcome = await loadPartySnapshot(pid, { bearer, signal: ac.signal });
      if (cancelled) return;
      if (outcome.kind === "aborted") return;
      if (outcome.kind === "ok") {
        setSnap(outcome.snapshot);
        setAdminBootstrap("ready");
        return;
      }
      setSnap(null);
      if (outcome.kind === "not_found") {
        purgeAdminSessionForPartyRouteId(pid);
        setToken(null);
        setAdminUnavailableKind("gone");
      } else if (outcome.kind === "bad_token") {
        purgeAdminSessionForPartyRouteId(pid);
        setToken(null);
        setAdminUnavailableKind("bad_token");
      } else if (outcome.kind === "network") setAdminUnavailableKind("network");
      else setAdminUnavailableKind("http");
      setAdminBootstrap("unavailable");
    })();

    return (): void => {
      cancelled = true;
      ac.abort();
    };
  }, [pid, bearer, adminBootstrapRetryNonce]);

  useEffect(() => {
    if (!pid || bearer === "" || adminBootstrap !== "ready") return undefined;

    const s: Socket = io({
      transports: ["websocket", "polling"],
      auth: { partyId: pid, bearer, role: "admin" },
    });
    const onSnap = (p: PartySnapshot) => setSnap(p);
    const onBuzzFx = (payload: { url: string }) => {
      playSfxUrl(payload.url);
    };
    const onAnswerFx = (payload: { url: string }) => {
      playSfxUrl(payload.url);
    };
    const onTerminatedAdmin = (): void => {
      purgeAdminSessionForPartyRouteId(pid);
      setToken(null);
      nav("/", { replace: true });
    };
    s.on("party:patch", onSnap);
    s.on("party:buzz_fx", onBuzzFx);
    s.on("party:answer_fx", onAnswerFx);
    s.on("party:terminated", onTerminatedAdmin);
    return (): void => {
      s.off("party:patch", onSnap);
      s.off("party:buzz_fx", onBuzzFx);
      s.off("party:answer_fx", onAnswerFx);
      s.off("party:terminated", onTerminatedAdmin);
      s.disconnect();
    };
  }, [pid, bearer, adminBootstrap, nav]);

  useEffect(() => {
    if (adminBootstrap !== "ready" || !pid || bearer === "") return;
    rememberAdminParty(pid);
  }, [adminBootstrap, pid, bearer]);

  const callHostSnapshot = useCallback(
    async (
      path: string,
      method: string,
      body?: Record<string, unknown>,
    ): Promise<PartySnapshot> => {
      if (!pid || bearer === "")
        throw new Error("auth:Session animateur incomplète (recharger la page).");
      const rBody = body === undefined ? undefined : JSON.stringify(body);
      interface ErrBody {
        error?: string;
      }
      const res = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: method === "GET" ? undefined : rBody,
      });
      const text = await res.text();
      if (!res.ok) {
        let detail = text.slice(0, 200);
        if (text !== "") {
          try {
            detail = (JSON.parse(text) as ErrBody).error ?? text;
          } catch {
            /* noop */
          }
        }
        throw new Error(`${res.status}:${detail}`);
      }
      try {
        return JSON.parse(text) as PartySnapshot;
      } catch {
        throw new Error(`${res.status}:INVALID_JSON`);
      }
    },
    [pid, bearer],
  );

  const hostBasePath = `/api/parties/${encodeURIComponent(pid)}`;

  const onHostBuzzResolve = useCallback(
    async (playerId: string, verdict: "good" | "bad"): Promise<void> => {
      setErr(null);
      try {
        const p = await callHostSnapshot(`${hostBasePath}/host/buzz-resolve`, "POST", {
          playerId,
          verdict,
        });
        setSnap(p);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [callHostSnapshot, hostBasePath],
  );

  const onHostKickPlayerClick = useCallback(
    async (playerIdKick: string, displayNameKick: string): Promise<void> => {
      if (
        typeof globalThis.window !== "undefined" &&
        !window.confirm(
          `Expulser ${displayNameKick} de la partie ? Il perdra sa session sur cet appareil.`,
        )
      ) {
        return;
      }
      setErr(null);
      try {
        const p = await fetchJson<PartySnapshot>(
          `${hostBasePath}/host/players/${encodeURIComponent(playerIdKick)}/kick`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${bearer}`,
            },
            body: JSON.stringify({}),
          },
        );
        setSnap(p);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [hostBasePath, bearer],
  );

  const onHostDeleteParty = useCallback(async (): Promise<void> => {
    if (
      typeof globalThis.window !== "undefined" &&
      !window.confirm(
        "Supprimer définitivement cette partie ? Tous les joueurs seront déconnectés.",
      )
    ) {
      return;
    }
    setErr(null);
    try {
      if (!pid || bearer === "")
        throw new Error("auth:Session animateur incomplète (recharger la page).");
      const res = await fetch(`${hostBasePath}/host/delete`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const text = await res.text();
        interface ErrBody {
          error?: string;
        }
        let detail = text.slice(0, 200);
        if (text !== "") {
          try {
            detail = (JSON.parse(text) as ErrBody).error ?? text;
          } catch {
            /* noop */
          }
        }
        throw new Error(`${res.status}:${detail}`);
      }
      purgeAdminSessionForPartyRouteId(pid);
      setToken(null);
      nav("/", { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [pid, bearer, hostBasePath, nav]);

  const onHostMancheSubmitAdd = useCallback(async (): Promise<void> => {
    setErr(null);
    try {
      if (addMancheFlavor === "pack" && packsList.length === 0) {
        throw new Error("validation:Aucun pack quiz chargé sur le serveur pour l’instant.");
      }
      if (addMancheFlavor === "pack") {
        const pkMeta = packsList.find((x) => x.basename === modalPackBasename);
        const titleDraft = modalMancheTitle.trim();
        const title =
          titleDraft.length > 0
            ? titleDraft
            : (pkMeta?.title ?? "").trim().length > 0
              ? (pkMeta?.title ?? "").trim()
              : modalPackBasename;
        const p = await callHostSnapshot(`${hostBasePath}/host/manche/add`, "POST", {
          kind: "pack_quiz",
          title,
          packBasename: modalPackBasename,
        });
        setSnap(p);
      } else if (addMancheFlavor === "youtube") {
        const title = modalMancheTitle.trim();
        if (title === "") {
          throw new Error("validation:Titre obligatoire.");
        }
        const urlRaw = modalSiteUrl.trim();
        if (urlRaw === "") {
          throw new Error("validation:URL YouTube obligatoire.");
        }
        const body = { kind: "youtube" as const, title, url: urlRaw };
        const p = await callHostSnapshot(`${hostBasePath}/host/manche/add`, "POST", body);
        setSnap(p);
      } else {
        const title = modalMancheTitle.trim();
        if (title === "") {
          throw new Error("validation:Titre obligatoire.");
        }
        const urlVid = modalLocalVideoPick.trim();
        if (urlVid === "") {
          throw new Error("validation:Sélectionne un fichier vidéo dans la liste.");
        }
        const p = await callHostSnapshot(`${hostBasePath}/host/manche/add`, "POST", {
          kind: "direct_video",
          title,
          url: urlVid,
        });
        setSnap(p);
      }
      setAddMancheOpen(false);
      setModalMancheTitle("");
      setModalSiteUrl("");
      setModalLocalVideoPick("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [
    addMancheFlavor,
    callHostSnapshot,
    hostBasePath,
    modalLocalVideoPick,
    modalMancheTitle,
    modalPackBasename,
    modalSiteUrl,
    packsList,
  ]);

  const onHostManchePlay = useCallback(
    async (id: string): Promise<void> => {
      setErr(null);
      try {
        const p = await callHostSnapshot(`${hostBasePath}/host/manche/play`, "POST", { id });
        setSnap(p);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [callHostSnapshot, hostBasePath],
  );

  const onHostMancheRemove = useCallback(
    async (id: string): Promise<void> => {
      setErr(null);
      try {
        const p = await callHostSnapshot(`${hostBasePath}/host/manche/remove`, "POST", { id });
        setSnap(p);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [callHostSnapshot, hostBasePath],
  );

  const onHostMancheMove = useCallback(
    async (id: string, direction: "up" | "down"): Promise<void> => {
      setErr(null);
      try {
        const p = await callHostSnapshot(`${hostBasePath}/host/manche/move`, "POST", {
          id,
          direction,
        });
        setSnap(p);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [callHostSnapshot, hostBasePath],
  );

  const onHostRoundPause = useCallback(async (): Promise<void> => {
    setErr(null);
    try {
      const p = await callHostSnapshot(`${hostBasePath}/host/round/pause`, "POST", {});
      setSnap(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [callHostSnapshot, hostBasePath]);

  const onHostBuzzWindow = useCallback(
    async (open: boolean): Promise<void> => {
      setErr(null);
      try {
        const n = await callHostSnapshot(`${hostBasePath}/host/buzz-window`, "POST", { open });
        setSnap(n);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [callHostSnapshot, hostBasePath],
  );

  const onHostBuzzAutoCueAdvance = useCallback(
    async (enabled: boolean): Promise<void> => {
      setErr(null);
      try {
        const n = await callHostSnapshot(`${hostBasePath}/host/buzz-auto-cue-advance`, "POST", {
          enabled,
        });
        setSnap(n);
      } catch (e11) {
        setErr(e11 instanceof Error ? e11.message : String(e11));
      }
    },
    [callHostSnapshot, hostBasePath],
  );

  const onHostCueNext = useCallback(async (): Promise<void> => {
    setErr(null);
    try {
      const p = await callHostSnapshot(`${hostBasePath}/host/cue/next`, "POST", {});
      setSnap(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [callHostSnapshot, hostBasePath]);

  const onHostCueReplay = useCallback(async (): Promise<void> => {
    setErr(null);
    try {
      const p = await callHostSnapshot(`${hostBasePath}/host/cue/replay`, "POST", {});
      setSnap(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [callHostSnapshot, hostBasePath]);

  const onHostPlayerAudioAllowed = useCallback(
    async (allowed: boolean): Promise<void> => {
      setErr(null);
      try {
        const p = await callHostSnapshot(`${hostBasePath}/host/player-audio-control`, "POST", {
          allowed,
        });
        setSnap(p);
      } catch (e10) {
        setErr(e10 instanceof Error ? e10.message : String(e10));
      }
    },
    [callHostSnapshot, hostBasePath],
  );

  const onHostChatSend = useCallback(async (textOverride?: string): Promise<void> => {
    const payload = (typeof textOverride === "string" ? textOverride : hostChat).trim();
    if (payload === "") return;
    setErr(null);
    try {
      const h = await callHostSnapshot(`${hostBasePath}/host/chat`, "POST", {
        text: payload,
      });
      setHostChat("");
      setSnap(h);
    } catch (e8: unknown) {
      setErr(e8 instanceof Error ? e8.message : String(e8));
    }
  }, [callHostSnapshot, hostBasePath, hostChat]);

  const onPlayerScoreDelta = useCallback(
    async (playerDbId: string, delta: number): Promise<void> => {
      if (delta !== 1 && delta !== -1) return;
      setErr(null);
      try {
        const u = await fetchJson<PartySnapshot>(
          `${hostBasePath}/host/players/${encodeURIComponent(playerDbId)}/score`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${bearer}`,
            },
            body: JSON.stringify({ delta }),
          },
        );
        setSnap(u);
      } catch (e9) {
        setErr(String(e9));
      }
    },
    [hostBasePath, bearer],
  );

  const sortedPlayers = useMemo(() => {
    if (snap === null) return [];
    return [...snap.players].sort(
      (a, b) =>
        b.score - a.score || a.displayName.localeCompare(b.displayName, "fr", { sensitivity: "base" }),
    );
  }, [snap]);

  const hostQuizBuzzHighlights = useMemo(() => {
    if (snap === null) return [];
    const rows = snap.buzzQuizQueueDetail;
    if (!rows || rows.length === 0) return [];
    const m = new Map<number, "good" | "bad">();
    for (const row of rows) {
      if (row.choiceIndex < 0) continue;
      const t = row.correct ? ("good" as const) : ("bad" as const);
      const prev = m.get(row.choiceIndex);
      m.set(row.choiceIndex, prev === "bad" || t === "bad" ? "bad" : "good");
    }
    return [...m.entries()].map(([choiceIndex, tone]) => ({ choiceIndex, tone }));
  }, [snap]);

  const onDeltaScoreApply = useCallback(
    async (playerId: string): Promise<void> => {
      setErr(null);
      const raw = (deltaById[playerId] ?? "").trim().replace(/,/gu, "");
      if (raw === "" || raw === "±") return;
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n === 0) {
        setErr("validation:Entier non nul attendu pour les points (ex. 3 ou -2).");
        return;
      }
      const dir: 1 | -1 = n > 0 ? 1 : -1;
      const steps = Math.min(Math.abs(n), 999);
      for (let i = 0; i < steps; i += 1) {
        await onPlayerScoreDelta(playerId, dir);
      }
      setDeltaById((m) => ({ ...m, [playerId]: "" }));
    },
    [deltaById, onPlayerScoreDelta],
  );

  const onHostRoundStart = useCallback(async (): Promise<void> => {
    if (snap === null) return;
    const head = snap.mancheScript[0];
    if (head === undefined) {
      setErr("validation:Ajoutez au moins une manche avec « Ajouter (+) », puis rechargez-la en tête de liste si besoin.");
      return;
    }
    await onHostManchePlay(head.id);
  }, [snap, onHostManchePlay]);

  if (!pid) return <Navigate to="/create" replace />;

  if (bearer === "")
    return (
      <Shell title="Animateur">
        <div className="bz-card" style={{ marginTop: 24 }}>
          <p style={{ marginTop: 0 }}>
            Jeton animateur absent ou lien incomplet. Rouvrir le lien
            après création.
          </p>
          <button type="button" className="bz-primary" onClick={() => nav("/create")}>
            Créer une nouvelle partie
          </button>
        </div>
      </Shell>
    );

  if (adminBootstrap === "loading")
    return (
      <Shell title="Animateur">
        <p className="bz-muted">Chargement…</p>
      </Shell>
    );

  if (adminBootstrap === "unavailable")
    return (
      <Shell title="Animateur">
        <div className="bz-card" style={{ marginTop: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: 22 }}>Partie indisponible</h2>
          <p>
            Cette partie n'existe plus côté serveur (inactivité ou
            redémarrage). Le lien "Reprendre" sur l'accueil ne peut pas
            restaurer une partie effacée.
          </p>
          <button
            type="button"
            onClick={() => {
              purgeAdminSessionForPartyRouteId(pid);
              setToken(null);
              nav("/", { replace: true });
            }}
          >
            Retour à l'accueil
          </button>
        </div>
      </Shell>
    );

  if (snap === null)
    return (
      <Shell title="Animateur">
        <p className="bz-muted">Synchronisation…</p>
      </Shell>
    );

  const joinUrl = `${window.location.origin}/join?code=${encodeURIComponent(snap.joinCode)}`;

  const activeMancheEntry =
    snap.activeMancheId === null
      ? undefined
      : snap.mancheScript.find((m) => m.id === snap.activeMancheId);
  const hostGameBoard = snap.gameBoard ?? null;
  const showMediaReplayCue =
    snap.state === "round_active" &&
    activeMancheEntry?.kind === "pack_quiz" &&
    hostGameBoard !== null &&
    (hostGameBoard.kind === "video" || hostGameBoard.kind === "audio_blind");

  const showCueAdvanceButton =
    snap.state === "round_active" &&
    activeMancheEntry?.kind === "pack_quiz" &&
    hostGameBoard !== null &&
    hostGameBoard.kind !== "video";

  const cueAdvanceLabel =
    hostGameBoard !== null && hostGameBoard.kind === "audio_blind"
      ? "Extrait suivant →"
      : hostGameBoard !== null && hostGameBoard.kind === "image_buzz"
        ? "Image suivante →"
        : hostGameBoard !== null && hostGameBoard.kind === "progressive_guess"
          ? "Indice / révélation suivant(e) →"
          : hostGameBoard !== null && hostGameBoard.kind === "free_buzz"
            ? "Question suivante (oral) →"
            : "Question suivante →";

  const goodPts = hostGoodPointsHint(hostGameBoard);

  return (
    <Shell title={`Animateur · ${snap.joinCode}`} wide>
      <div className="bz-host-layout">
        <main className="bz-host-stage">
          {/* Hero — code, share, QR */}
          <section className="bz-host-hero">
            <div className="bz-host-hero-info">
              <span className="bz-eyebrow">code joueurs</span>
              <div className="bz-host-code">{snap.joinCode}</div>
              <div className="bz-host-join">
                {window.location.host}/join?code=<strong>{snap.joinCode}</strong>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <span
                  className={`bz-pill ${
                    snap.state === "round_active" ? "bz-live" : ""
                  }`}
                >
                  {snap.state === "round_active" ? (
                    <span className="bz-dot" />
                  ) : null}
                  {snap.state}
                </span>
                <span className="bz-pill">
                  {snap.players.length} joueur
                  {snap.players.length === 1 ? "" : "s"}
                </span>
                {snap.buzzWindowOpen ? (
                  <span className="bz-pill bz-good">
                    <span className="bz-dot" />
                    buzzer ouvert
                  </span>
                ) : null}
                <a
                  href={`/party/${encodeURIComponent(pid)}/broadcast`}
                  target="_blank"
                  rel="noreferrer"
                  className="bz-cta"
                  style={{ height: 40, alignSelf: "flex-start", fontSize: 13 }}
                >
                  📺 Ouvrir la diffusion (nouvel onglet)
                </a>
                <button
                  type="button"
                  className="bz-host-party-delete-btn"
                  onClick={() => void onHostDeleteParty()}
                >
                  Supprimer la partie
                </button>
              </div>
            </div>
            <div className="bz-host-hero-qr">
              <QRCodeSVG
                value={joinUrl}
                size={160}
                level="M"
                includeMargin
                aria-label="QR code rejoindre la partie"
              />
              <span className="bz-host-qr-cap">scanne pour rejoindre</span>
            </div>
          </section>

          {err ? <pre className="bz-err">{err}</pre> : null}

          {/* Game board — same component, with revealCorrect for host */}
          <GameBoardPanel
            board={snap.gameBoard ?? null}
            partyState={snap.state}
            revealCorrect
            blindHostPresenter={snap.gameBoard?.kind === "audio_blind"}
            hostQuizBuzzHighlights={hostQuizBuzzHighlights}
          />

          <section className="bz-host-pack">
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "10px 14px",
                alignItems: "center",
              }}
            >
              <h2 style={{ margin: 0 }}>Scénario — liste des manches</h2>
              <button
                type="button"
                title="Ajouter une manche"
                aria-label="Ajouter une manche"
                onClick={() => {
                  setErr(null);
                  setAddMancheOpen(true);
                  setModalMancheTitle("");
                  setModalSiteUrl("");
                }}
              >
                + Ajouter
              </button>
            </div>
            <p className="bz-muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
              « ▶ Lancer la manche » joue et met en <strong>tête</strong> la première ligne ; réordonnez avec les
              flèches avant de lancer. Les packs JSON (quiz à choix, questions libres orales, séries d’images
              sans QCM, blind test audio…) se chargent avec la manche ; les vidéos directes et YouTube suivent le
              scénario habituel.
            </p>
            {snap.mancheScript.length === 0 ? (
              <p style={{ margin: "14px 0 0" }} className="bz-muted">
                Aucune étape encore — utilisez « + Ajouter » pour un pack, une page (HTTPS), une vidéo YouTube ou
                une vidéo directe.
              </p>
            ) : (
              <ul className="bz-manche-list">
                {snap.mancheScript.map((mancheRow, mi) => {
                  const playing =
                    snap.activeMancheId === mancheRow.id && snap.state === "round_active";
                  return (
                    <li
                      key={mancheRow.id}
                      className={playing ? "bz-manche-row bz-manche-row--playing" : "bz-manche-row"}
                    >
                      <span className="bz-manche-row-title">
                        <strong>{mancheRow.title}</strong>
                        <span className="bz-manche-row-kind bz-muted">
                          ({mancheKindShort(mancheRow.kind)})
                        </span>
                        {playing ? <span className="bz-manche-row-live">● en cours</span> : null}
                      </span>
                      <button
                        type="button"
                        title="Jouer cette manche"
                        onClick={() => void onHostManchePlay(mancheRow.id)}
                      >
                        ▶
                      </button>
                      <button
                        type="button"
                        disabled={mi === 0}
                        title="Monter dans la liste"
                        aria-label="Monter dans la liste"
                        onClick={() => void onHostMancheMove(mancheRow.id, "up")}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={mi === snap.mancheScript.length - 1}
                        title="Descendre dans la liste"
                        aria-label="Descendre dans la liste"
                        onClick={() => void onHostMancheMove(mancheRow.id, "down")}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        title="Supprimer cette manche"
                        aria-label="Supprimer cette manche"
                        onClick={() => void onHostMancheRemove(mancheRow.id)}
                      >
                        🗑
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Sticky controls */}
          <div className="bz-host-controls">
            <button
              type="button"
              className="bz-primary"
              onClick={() => void onHostRoundStart()}
            >
              ▶ Lancer la manche
            </button>
            <button type="button" onClick={() => void onHostRoundPause()}>
              ⏸ Pause (lobby)
            </button>
            <div className="bz-host-buzz-tools">
              <div className="bz-host-buzz-buttons">
                <button
                  type="button"
                  onClick={() => void onHostBuzzWindow(true)}
                >
                  🔔 Ouvrir buzzer
                </button>
                <button
                  type="button"
                  onClick={() => void onHostBuzzWindow(false)}
                >
                  ⏹ Fermer & purger
                </button>
              </div>
              <label className="bz-host-buzz-auto">
                <input
                  type="checkbox"
                  checked={snap.autoOpenBuzzOnCueAdvance === true}
                  onChange={(e) => void onHostBuzzAutoCueAdvance(e.target.checked)}
                />
                <span>
                  Rouvrir le buzz automatiquement après chaque «&nbsp;suivant&nbsp;» (QCM, questions orales,
                  blind audio, images, indices progressifs — pas après un simple rejoué vidéo / audio).
                </span>
              </label>
            </div>
            {snap.gameBoard?.kind === "audio_blind" ? (
              <label
                className="bz-host-blind-player-audio"
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  width: "100%",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={snap.allowPlayerAudioControl === true}
                  onChange={(e) => void onHostPlayerAudioAllowed(e.target.checked)}
                />
                <span style={{ flex: "1", textAlign: "left", fontSize: 13, lineHeight: 1.35 }}>
                  Blind test&nbsp;: autoriser lecture / rejouer sur les téléphones joueurs et sur la page diffusion
                  (sinon tout le monde écoute seulement la sortie de ton poste animateur ou la sono).
                </span>
              </label>
            ) : null}
            {showMediaReplayCue ? (
              <button type="button" onClick={() => void onHostCueReplay()}>
                ↻ Rejouer l&apos;extrait (même média)
              </button>
            ) : null}
            {showCueAdvanceButton ? (
              <button type="button" onClick={() => void onHostCueNext()}>
                {cueAdvanceLabel}
              </button>
            ) : null}
          </div>
        </main>

        <aside className="bz-host-aside">
          {/* Buzz queue */}
          <section className="bz-host-section">
            <h2>
              File de buzz
              {snap.buzzOrder.length > 0 ? (
                <span className="bz-pill bz-live">
                  <span className="bz-dot" />
                  live
                </span>
              ) : null}
            </h2>
            {snap.buzzOrder.length === 0 ? (
              <p className="bz-muted" style={{ margin: 0, fontSize: 12 }}>
                Vide.
              </p>
            ) : (
              <ol className="bz-host-queue-list">
                {snap.buzzOrder.map((idBuzz2, ix) => {
                  const pw = snap.players.find((zz) => zz.id === idBuzz2);
                  const qRow = snap.buzzQuizQueueDetail?.[ix];
                  return (
                    <li key={`${idBuzz2}-${ix}`} className="bz-host-queue-item">
                      <span className="bz-rank">{ix + 1}</span>
                      <div className="bz-host-queue-main">
                        <div className="bz-host-queue-name-line">
                          <span className="bz-name">{pw?.displayName ?? idBuzz2}</span>
                          {pw?.teamId != null ? (
                            <span className="bz-host-team">éq. {pw.teamId}</span>
                          ) : null}
                        </div>
                        {qRow !== undefined && snap.gameBoard?.kind === "quiz" ? (
                          <div
                            className={`bz-host-qcm-pick ${
                              qRow.correct ? "bz-host-qcm-pick--good" : "bz-host-qcm-pick--bad"
                            }`}
                          >
                            <span className="bz-host-qcm-pick-letter">{qRow.letter}.</span>
                            <span className="bz-host-qcm-pick-text">{qRow.choiceLabel}</span>
                          </div>
                        ) : null}
                      </div>
                      <span className="bz-host-queue-actions">
                        <button
                          type="button"
                          className="bz-host-resolve-btn bz-host-resolve-btn--good"
                          title={`Bonne réponse — +${goodPts} point${goodPts === 1 ? "" : "s"}`}
                          onClick={() => void onHostBuzzResolve(idBuzz2, "good")}
                        >
                          Bon (+{goodPts})
                        </button>
                        <button
                          type="button"
                          className="bz-host-resolve-btn bz-host-resolve-btn--bad"
                          title="Mauvaise réponse — son « mauvais »"
                          onClick={() => void onHostBuzzResolve(idBuzz2, "bad")}
                        >
                          Mauvais
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* Scoreboard */}
          <section className="bz-host-section">
            <h2>Scores</h2>
            <ul className="bz-host-scores">
              {sortedPlayers.map((pl2, idx) => (
                <li key={pl2.id} className="bz-host-score-row">
                  <span className="bz-host-rank">{idx + 1}</span>
                  <span className="bz-host-name">
                    {pl2.displayName}
                    {pl2.teamId != null ? (
                      <span className="bz-host-team">éq. {pl2.teamId}</span>
                    ) : null}
                  </span>
                  <span className="bz-host-score-value">{pl2.score}</span>
                  <span className="bz-host-delta">
                    <input
                      value={deltaById[pl2.id] ?? ""}
                      placeholder="±"
                      onChange={(ev) =>
                        setDeltaById((m) => ({
                          ...m,
                          [pl2.id]: ev.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => void onDeltaScoreApply(pl2.id)}
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      className="bz-host-kick-player-btn"
                      title="Retire la session de ce joueur"
                      aria-label={`Expulser ${pl2.displayName}`}
                      onClick={() => void onHostKickPlayerClick(pl2.id, pl2.displayName)}
                    >
                      Expulser
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Chat */}
          <section className="bz-host-section bz-chat">
            <h2>Chat</h2>
            <ul className="bz-chat-list">
              {snap.chatTail.length === 0 ? (
                <li
                  className="bz-chat-row bz-muted"
                  style={{ fontSize: 12 }}
                >
                  Aucun message pour l'instant.
                </li>
              ) : (
                snap.chatTail.slice(-80).map((m) => (
                  <li key={m.id} className="bz-chat-row">
                    <strong>{m.displayName}</strong>
                    <span>{m.text}</span>
                  </li>
                ))
              )}
            </ul>
            <div className="bz-chat-input">
              <textarea
                rows={2}
                value={hostChat}
                placeholder="Message animateur…"
                onChange={(evh) => setHostChat(evh.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey) return;
                  e.preventDefault();
                  void onHostChatSend(e.currentTarget.value);
                }}
              />
              <button
                type="button"
                onClick={() => void onHostChatSend()}
              >
                Publier
              </button>
            </div>
          </section>
        </aside>

        {addMancheOpen ? (
          <div
            role="presentation"
            className="bz-modal-overlay"
            onMouseDown={(evt) => {
              if (evt.target === evt.currentTarget) setAddMancheOpen(false);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-manche-title"
              className="bz-modal-dialog"
              onMouseDown={(evt) => {
                evt.stopPropagation();
              }}
            >
              <h2 id="add-manche-title">Ajouter une manche au scénario</h2>
              <div className="bz-modal-tab-row bz-modal-tab-row--wrap">
                <button
                  type="button"
                  aria-pressed={addMancheFlavor === "pack"}
                  onClick={() => setAddMancheFlavor("pack")}
                  className="bz-modal-tab"
                >
                  Pack quiz
                </button>
                <button
                  type="button"
                  aria-pressed={addMancheFlavor === "youtube"}
                  onClick={() => setAddMancheFlavor("youtube")}
                  className="bz-modal-tab"
                >
                  Vidéo YouTube
                </button>
                <button
                  type="button"
                  aria-pressed={addMancheFlavor === "local_video"}
                  onClick={() => setAddMancheFlavor("local_video")}
                  className="bz-modal-tab"
                >
                  Vidéo locale
                </button>
              </div>

              {addMancheFlavor === "pack" ? (
                <>
                  <label style={{ display: "block", marginBottom: 10 }}>
                    Pack à ajouter
                    <select
                      style={{ display: "block", width: "100%", marginTop: 6 }}
                      value={
                        modalPackBasename !== "" &&
                        packsList.some((p2) => p2.basename === modalPackBasename)
                          ? modalPackBasename
                          : packsList[0]?.basename ?? ""
                      }
                      onChange={(ev2) => setModalPackBasename(ev2.target.value)}
                    >
                      {packsList.map((pk) => (
                        <option key={pk.basename} value={pk.basename}>
                          {pk.title} ({pk.roundCount ?? 0} segments)
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: 8 }}>
                    Titre affiché (optionnel ; par défaut le titre du JSON)
                    <input
                      type="text"
                      style={{
                        display: "block",
                        width: "100%",
                        marginTop: 6,
                        boxSizing: "border-box",
                      }}
                      placeholder="Laisser vide pour reprendre le nom du JSON"
                      value={modalMancheTitle}
                      onChange={(ev2) => setModalMancheTitle(ev2.target.value)}
                    />
                  </label>
                </>
              ) : addMancheFlavor === "youtube" ? (
                <>
                  <label style={{ display: "block", marginBottom: 12 }}>
                    Titre dans la liste
                    <input
                      type="text"
                      style={{
                        display: "block",
                        width: "100%",
                        marginTop: 6,
                        boxSizing: "border-box",
                      }}
                      placeholder="Ex. Sponsor · clip d’introduction"
                      value={modalMancheTitle}
                      onChange={(ev2) => setModalMancheTitle(ev2.target.value)}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    URL YouTube complète (coller depuis le navigateur)
                    <input
                      type="url"
                      autoComplete="url"
                      style={{
                        display: "block",
                        width: "100%",
                        marginTop: 6,
                        boxSizing: "border-box",
                      }}
                      placeholder={"https://www.youtube.com/watch?v=…"}
                      value={modalSiteUrl}
                      onChange={(ev2) => setModalSiteUrl(ev2.target.value)}
                    />
                  </label>
                  <p className="bz-modal-embed-tip">
                    Lecture dans Buzzy via{" "}
                    <code className="bz-code">youtube-nocookie.com</code>. Une vidéo peut refuser tout lecteur externe si
                    l&apos;auteur désactive l&apos;intégration ou pose des restrictions d&apos;âge / géo / liste
                    privée — ce n&apos;est pas configurable côté Buzzy. Une extension anti-pub peut aussi afficher{" "}
                    <code className="bz-code">ERR_BLOCKED_BY_CLIENT</code> alors que la lecture reste audible.
                  </p>
                </>
              ) : (
                <>
                  <label style={{ display: "block", marginBottom: 12 }}>
                    Titre dans la liste
                    <input
                      type="text"
                      style={{
                        display: "block",
                        width: "100%",
                        marginTop: 6,
                        boxSizing: "border-box",
                      }}
                      placeholder="Ex. Bande annonce événement"
                      value={modalMancheTitle}
                      onChange={(ev2) => setModalMancheTitle(ev2.target.value)}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: 12 }}>
                    Fichier dans <code className="bz-code">games/video/</code>
                    <select
                      style={{ display: "block", width: "100%", marginTop: 6 }}
                      disabled={hostedVideoListLoading || hostedVideoFiles.length === 0}
                      value={
                        modalLocalVideoPick !== "" && hostedVideoFiles.some((v) => v.url === modalLocalVideoPick)
                          ? modalLocalVideoPick
                          : hostedVideoFiles[0]?.url ?? ""
                      }
                      onChange={(ev2) => setModalLocalVideoPick(ev2.target.value)}
                    >
                      {!hostedVideoListLoading && hostedVideoFiles.length === 0 ? (
                        <option value="">— Aucun fichier —</option>
                      ) : (
                        hostedVideoFiles.map((v) => (
                          <option key={v.url} value={v.url}>
                            {v.name}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  {hostedVideoListLoading ? (
                    <p className="bz-modal-embed-tip">Chargement de la liste des vidéos…</p>
                  ) : hostedVideoFiles.length === 0 ? (
                    <p className="bz-modal-embed-tip">
                      Ajoute des fichiers <code className="bz-code">.mp4</code>, <code className="bz-code">.webm</code>,
                      etc. dans <code className="bz-code">games/video/</code>, puis recharge cette page ou rouvre cette
                      boîte.
                    </p>
                  ) : null}
                  {modalLocalVideoPick !== "" || hostedVideoFiles[0]?.url ? (
                    <div className="bz-modal-hosted-video-preview">
                      <p className="bz-modal-hosted-video-caption">Aperçu lecture locale</p>
                      <video
                        className="bz-modal-hosted-video-el"
                        controls
                        playsInline
                        preload="metadata"
                        src={(modalLocalVideoPick || hostedVideoFiles[0]?.url) ?? undefined}
                      />
                    </div>
                  ) : null}
                </>
              )}

              <div className="bz-modal-actions">
                <button
                  type="button"
                  onClick={() => {
                    setAddMancheOpen(false);
                    setModalMancheTitle("");
                    setModalSiteUrl("");
                    setModalLocalVideoPick("");
                  }}
                >
                  Annuler
                </button>
                <button type="button" className="bz-primary" onClick={() => void onHostMancheSubmitAdd()}>
                  Ajouter cette manche
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}

/** * Full-screen spectator view (same payload as joueurs socket); no JWT — party id in URL only. */
function Broadcast(): JSX.Element {
  const { partyId } = useParams<{ partyId: string }>();
  const pid = canonicalPartyIdFromRoute(partyId);
  const [snap, setSnap] = useState<PartySnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!pid) return undefined;
    let cancelled = false;

    void fetchJson<PartySnapshot>(`/api/parties/${encodeURIComponent(pid)}`)
      .then((s) => {
        if (!cancelled) {
          setSnap(s);
          setErr(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e));
      });

    const s: Socket = io({
      transports: ["websocket", "polling"],
      auth: { partyId: pid, role: "broadcast" },
    });

    const onSnap = (p: PartySnapshot): void => {
      if (!cancelled) {
        setSnap(p);
        setErr(null);
      }
    };
    const onAnswerFx = (payload: { url: string }): void => {
      playSfxUrl(payload.url);
    };
    s.on("party:patch", onSnap);
    s.on("party:answer_fx", onAnswerFx);

    return (): void => {
      cancelled = true;
      s.off("party:patch", onSnap);
      s.off("party:answer_fx", onAnswerFx);
      s.disconnect();
    };
  }, [pid]);

  if (!pid) return <Navigate to="/" replace />;

  if (snap === null) {
    return (
      <div className="bz-broadcast">
        <div className={err === null ? "bz-bc-loading" : "bz-bc-error"}>
          {err === null ? "Connexion à la partie…" : "Partie introuvable."}
        </div>
      </div>
    );
  }

  const joinUrl = `${window.location.origin}/join?code=${encodeURIComponent(snap.joinCode)}`;
  const board = snap.gameBoard;
  const quizBoard = board !== null && board.kind === "quiz" ? board : null;
  const videoBoard = board !== null && board.kind === "video" ? board : null;
  const teamEntries = Object.entries(snap.teamScores ?? {})
    .map(([id, score]) => ({ id: Number(id), score }))
    .sort((a, b) => a.id - b.id);

  return (
    <div className="bz-broadcast">
      <Link to={`/party/${encodeURIComponent(pid)}/admin`} className="bz-bc-exit">
        ← retour tableau
      </Link>

      <header className="bz-bc-header">
        <span className="bz-logo" style={{ fontSize: 36 }}>
          <span>buzzy</span>
          <span className="bz-logo-dot" />
        </span>
        <div className="bz-bc-header-right">
          <span
            className={`bz-pill ${snap.state === "round_active" ? "bz-live" : ""}`}
          >
            {snap.state === "round_active" ? <span className="bz-dot" /> : null}
            {snap.state}
          </span>
          <span className="bz-bc-code-chip">{snap.joinCode}</span>
          <div className="bz-bc-qr">
            <QRCodeSVG value={joinUrl} size={96} level="M" />
          </div>
        </div>
      </header>

      <main className="bz-bc-stage">
        {snap.state === "lobby" ? (
          <div className="bz-bc-lobby">
            <div>
              <span className="bz-eyebrow" style={{ fontSize: 18 }}>
                scanne · rejoins · joue
              </span>
              <h1 className="bz-bc-lobby-title">Buzzy.</h1>
              <p className="bz-bc-lobby-sub">
                {snap.players.length === 0
                  ? "En attente des joueurs."
                  : `${snap.players.length} joueur${snap.players.length === 1 ? "" : "s"} déjà dans le lobby.`}
              </p>
              <div className="bz-bc-lobby-code">{snap.joinCode}</div>
            </div>
            <div className="bz-bc-lobby-qr">
              <QRCodeSVG value={joinUrl} size={320} level="M" includeMargin />
            </div>
          </div>
        ) : null}

        {snap.state === "round_active" && quizBoard !== null ? (
          <>
            <div className="bz-bc-meta">
              Manche {quizBoard.roundNumberHuman} · Question{" "}
              {quizBoard.questionIndexInRound + 1} · +{quizBoard.points}{" "}
              {quizBoard.points === 1 ? "pt" : "pts"}
            </div>
            {typeof quizBoard.imageUrl === "string" && quizBoard.imageUrl.trim() !== "" ? (
              <QuizIllustration imageUrl={quizBoard.imageUrl} variant="broadcast" />
            ) : null}
            <h1 className="bz-bc-prompt">{quizBoard.prompt}</h1>
            <ol className="bz-bc-choices" data-count={quizBoard.choices.length}>
              {quizBoard.choices.map((c, i) => (
                <li
                  key={`${quizBoard.roundIndex}-${quizBoard.questionIndexInRound}-${i}`}
                  className="bz-bc-choice"
                >
                  <span className="bz-bc-choice-letter">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="bz-bc-choice-text">{c}</span>
                </li>
              ))}
            </ol>
          </>
        ) : null}

        {snap.state === "round_active" && videoBoard !== null ? (
          <>
            <div className="bz-bc-meta">
              Manche {videoBoard.roundNumberHuman} — {videoBoard.roundTitle}
            </div>
            <video
              key={videoBoard.replaySerial}
              autoPlay
              controls
              playsInline
              preload="auto"
              className="bz-bc-video"
              src={videoBoard.videoUrl}
            >
              Lecture vidéo non supportée par ce navigateur.
            </video>
          </>
        ) : null}

        {snap.state === "round_active" &&
        board !== null &&
        board.kind !== "quiz" &&
        board.kind !== "video" ? (
          <GameBoardPanel
            board={board}
            partyState={snap.state}
            revealCorrect={false}
            allowBlindPlaybackOnClients={snap.allowPlayerAudioControl === true}
          />
        ) : null}

        {snap.state === "round_active" && board === null ? (
          <div className="bz-bc-meta">
            En attente — l'animateur doit charger un pack quiz.
          </div>
        ) : null}

        {snap.state === "between_rounds" || snap.state === "ended" ? (
          <div className="bz-bc-end">
            <h1>{snap.state === "ended" ? "Bravo." : "Pause."}</h1>
            {teamEntries.length > 0 ? (
              <div style={{ display: "flex", gap: 48 }}>
                {teamEntries.map((t) => (
                  <div key={t.id} className="bz-bc-team">
                    <div className="bz-bc-team-label">Équipe {t.id}</div>
                    <div className="bz-bc-team-value">{t.score}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </main>

      {snap.state === "round_active" ? (
        <footer className="bz-bc-footer">
          <div className="bz-bc-queue">
            <h3>
              {snap.buzzOrder.length > 0
                ? "File de buzz"
                : snap.buzzWindowOpen
                  ? "Buzzer ouvert · personne n'a buzzé"
                  : "Buzzer fermé"}
            </h3>
            {snap.buzzOrder.length > 0 ? (
              <ol className="bz-bc-queue-list">
                {snap.buzzOrder.slice(0, 3).map((idBuzz, idx) => {
                  const pl = snap.players.find((p) => p.id === idBuzz);
                  return (
                    <li key={`${idBuzz}-${idx}`}>
                      <span className="bz-bc-queue-rank">{idx + 1}</span>
                      <span className="bz-bc-queue-name">
                        {pl?.displayName ?? idBuzz}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </div>

          {teamEntries.length > 0 ? (
            <div className="bz-bc-teams">
              {teamEntries.map((t) => (
                <div key={t.id} className="bz-bc-team">
                  <div className="bz-bc-team-label">Équipe {t.id}</div>
                  <div className="bz-bc-team-value">{t.score}</div>
                </div>
              ))}
            </div>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/join" element={<Join />} />
      <Route path="/create" element={<Create />} />
      <Route path="/party/:partyId/play" element={<Play />} />
      <Route path="/party/:partyId/admin" element={<Admin />} />
      <Route path="/party/:partyId/broadcast" element={<Broadcast />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

