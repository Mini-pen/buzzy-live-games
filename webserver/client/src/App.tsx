import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
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
  correctChoiceIndex?: number;
}

/** * Video clip surface; `replaySerial` changes restart playback on clients. */
interface PartyGameBoardVideo {
  kind: "video";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  videoUrl: string;
  replaySerial: number;
}

/** * External page shown inside an iframe manche. */
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
  players: Array<{
    id: string;
    displayName: string;
    avatarUrl: string;
    teamId: number | null;
    score: number;
  }>;
  teamScores: Record<string, number>;
  chatTail: Array<{ id: string; displayName: string; text: string; at: number }>;
  currentRoundIndex?: number | null;
  currentQuestionIndex?: number | null;
  gameBoard?: PartyGameBoardSurface | null;
  mancheScript: MancheCatalogItemView[];
  activeMancheId: string | null;
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
      src={props.src}
      alt=""
      width={props.sizePx}
      height={props.sizePx}
      decoding="async"
      style={{
        flexShrink: 0,
        objectFit: "cover",
        borderRadius: "50%",
        border: "1px solid #ccc",
      }}
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

function Shell(props: { title: string; children: React.ReactNode }): JSX.Element {
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
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void fetchJson<{
      defaultKey: string;
      avatars: Array<{ key: string; label: string; url: string }>;
    }>(`/api/avatars`).then(setAvatarsLib);
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
          : avatarsLib?.defaultKey ??
            avatarsLib?.avatars[0]?.key ??
            "fox";
      const body: Record<string, unknown> = { displayName: name.trim(), avatarKey: key };
      if (snap.maxTeams != null && snap.maxTeams >= 2) body.teamId = teamId;
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
                    onClick={() => setAvatarKeyChosen(a.key)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: 10,
                      borderRadius: 10,
                      border:
                        avatarKeyChosen === a.key ? "3px solid #2874a6" : "1px solid #ccc",
                      background: avatarKeyChosen === a.key ? "#f0f7ff" : "#fafafa",
                      cursor: "pointer",
                      fontSize: 12,
                      lineHeight: 1.25,
                      textAlign: "center",
                      boxSizing: "border-box",
                    }}
                  >
                    <AvatarFigure src={a.url} sizePx={56} />
                    <span>{a.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
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
        <button type="submit" disabled={snap === null || loading || avatarKeyChosen === ""}>
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

/** * Displays quiz prompt or video from `gameBoard`; host may reveal the keyed correct choice on quiz. */
function GameBoardPanel(props: {
  board: PartyGameBoardSurface | null;
  partyState: string;
  revealCorrect: boolean;
}): JSX.Element | null {
  const { board, partyState, revealCorrect } = props;

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

  if (board !== null && board.kind === "quiz") {
    const ci = board.correctChoiceIndex;
    const correctText =
      revealCorrect &&
      typeof ci === "number" &&
      ci >= 0 &&
      ci < board.choices.length
        ? board.choices[ci]
        : null;
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
        <h2 className="bz-board-prompt">{board.prompt}</h2>
        <ol className="bz-board-choices">
          {board.choices.map((c, i) => {
            const isCorrect =
              revealCorrect && typeof ci === "number" && ci === i;
            return (
              <li
                key={`${board.roundIndex}-${board.questionIndexInRound}-${i}`}
                className={`bz-choice ${isCorrect ? "bz-choice--correct" : ""}`}
              >
                <span className="bz-choice-letter">
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="bz-choice-text">{c}</span>
                {isCorrect ? (
                  <span className="bz-pill bz-good">
                    <span className="bz-dot" />
                    bonne réponse
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
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
          Si une vérification « anti-robot » ou un écran vide apparaît : désactivez le bloqueur de publicités
          pour cette page ( le lecteur appelle aussi des domaines comme{" "}
          <code className="bz-code">doubleclick.net</code> ), testez hors navigation privée stricte, ou ouvrez la
          vidéo dans un nouvel onglet YouTube depuis l’ordinateur animateur.
        </p>
      </section>
    );
  }

  if (board !== null && board.kind === "iframe") {
    return (
      <section className="bz-board">
        <div className="bz-board-meta">
          <span className="bz-pill bz-info">
            <span className="bz-dot" />
            page web
          </span>
          <span>{board.title}</span>
        </div>
        <div className="bz-board-embed-wrap">
          <iframe
            key={board.replaySerial}
            title={board.title}
            src={board.url}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        <p className="bz-board-embed-hint bz-muted">
          Beaucoup de sites interdisent l’affichage dans un autre domaine : si la console signale une erreur «{" "}
          <code className="bz-code">frame-ancestors</code> » ou «{" "}
          <code className="bz-code">X-Frame-Options</code>
          », le site doit être ouvert hors Buzzy — pour une vidéo YouTube officielle utilisez toujours le type «
          Vidéo YouTube », pas une URL en iframe générique.
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
          l&apos;animateur, média iframe/YouTube en chargement ou indisponible).
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
    s.on("party:patch", onSnap);

    return (): void => {
      s.off("party:patch", onSnap);
      s.disconnect();
    };
  }, [pid, jwt]);

  useEffect(() => {
    if (!pid || jwt === null || jwt === "" || snap === null) return;
    rememberPlayerParty(pid, snap.joinCode);
  }, [pid, jwt, snap]);

  async function buzz(): Promise<void> {
    if (!pid || jwt === null || jwt === "") return;
    setErr(null);
    try {
      const snapRes = await fetchJson<PartySnapshot>(`/api/parties/${pid}/me/buzz`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({}),
      });
      setSnap(snapRes);
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

  function parseSub(tok: string): string | null {
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

  const myId = parseSub(jwt);
  const rowMe = snap.players.find((p) => p.id === myId);
  const canChatRoom = snap.state === "lobby" || snap.state === "between_rounds";
  const canBuzz = snap.state === "round_active" && snap.buzzWindowOpen;

  return (
    <Shell title={`Partie · ${snap.joinCode}`}>
      <section className="bz-identity-strip">
        <span className="bz-avatar">
          {(rowMe?.displayName ?? "?").slice(0, 2).toUpperCase()}
        </span>
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
      />

      <section className="bz-buzz-hero">
        {canBuzz ? (
          <button
            type="button"
            onClick={() => void buzz()}
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
              (snap.gameBoard.kind === "video" ||
                snap.gameBoard.kind === "youtube" ||
                snap.gameBoard.kind === "iframe")
                ? "Regarde la vidéo — l'animateur peut la relancer pour tout le monde."
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

  /** * Popup: append a scripted manche (pack, iframe site, or YouTube). */
  const [addMancheOpen, setAddMancheOpen] = useState(false);
  /** * `"pack"` = quiz JSON pack ; `"site"` = iframe or pasted YouTube watch URL. */
  const [addMancheFlavor, setAddMancheFlavor] = useState<"pack" | "site">("pack");
  const [modalPackBasename, setModalPackBasename] = useState("");
  const [modalMancheTitle, setModalMancheTitle] = useState("");
  const [modalSiteKind, setModalSiteKind] = useState<"iframe" | "youtube">("iframe");
  const [modalSiteUrl, setModalSiteUrl] = useState("");

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
    s.on("party:patch", onSnap);
    return (): void => {
      s.off("party:patch", onSnap);
      s.disconnect();
    };
  }, [pid, bearer, adminBootstrap]);

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
      } else {
        const title = modalMancheTitle.trim();
        if (title === "") {
          throw new Error("validation:Titre obligatoire.");
        }
        const urlRaw = modalSiteUrl.trim();
        if (urlRaw === "") {
          throw new Error("validation:URL obligatoire.");
        }
        const body =
          modalSiteKind === "iframe"
            ? { kind: "iframe", title, url: urlRaw }
            : { kind: "youtube", title, url: urlRaw };
        const p = await callHostSnapshot(`${hostBasePath}/host/manche/add`, "POST", body);
        setSnap(p);
      }
      setAddMancheOpen(false);
      setModalMancheTitle("");
      setModalSiteUrl("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [
    addMancheFlavor,
    callHostSnapshot,
    hostBasePath,
    modalMancheTitle,
    modalPackBasename,
    modalSiteKind,
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

  const onHostCueNext = useCallback(async (): Promise<void> => {
    setErr(null);
    try {
      const p = await callHostSnapshot(`${hostBasePath}/host/cue/next`, "POST", {});
      setSnap(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [callHostSnapshot, hostBasePath]);

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
  const showQuizCueButtons =
    snap.state === "round_active" && activeMancheEntry?.kind === "pack_quiz";

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
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
          />

          {/* Pack picker */}
          <section className="bz-host-pack">
            <h2>Pack quiz</h2>
            <div className="bz-host-pack-row">
              <select
                value={basename}
                onChange={(e2) => setBasename(e2.target.value)}
              >
                {packsList.map((pk) => (
                  <option key={pk.basename} value={pk.basename}>
                    {pk.title} ({pk.roundCount ?? 0} manches)
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void applyPackMutation()}
              >
                Charger
              </button>
            </div>
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
            <button type="button" onClick={() => void onHostCueNext()}>
              Question suivante →
            </button>
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
                  return (
                    <li key={`${idBuzz2}-${ix}`}>
                      <span className="bz-rank">{ix + 1}</span>
                      <span className="bz-name">
                        {pw?.displayName ?? idBuzz2}
                      </span>
                      {pw?.teamId != null ? (
                        <span className="bz-host-team">éq. {pw.teamId}</span>
                      ) : null}
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
      </div>
    </Shell>
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

