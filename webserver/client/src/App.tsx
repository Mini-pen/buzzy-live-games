import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { io, type Socket } from "socket.io-client";

/** * Payload aligned with `PartyPublicSnapshot.gameBoard` on the server. */
interface PartyGameBoardSurface {
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
  players: Array<{ id: string; displayName: string; teamId: number | null; score: number }>;
  teamScores: Record<string, number>;
  chatTail: Array<{ id: string; displayName: string; text: string; at: number }>;
  currentRoundIndex?: number | null;
  currentQuestionIndex?: number | null;
  gameBoard?: PartyGameBoardSurface | null;
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

/** * Last party id hints (tab session). Same browser session scope as a cookie for this SPA. */
const STORAGE_LAST_PLAYER_PARTY = "partygames:lastPlayerPartyId";
const STORAGE_LAST_PLAYER_CODE = "partygames:lastPlayerJoinCode";
const STORAGE_LAST_ADMIN_PARTY = "partygames:lastAdminPartyId";

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
  const last = sessionStorage.getItem(STORAGE_LAST_ADMIN_PARTY);
  if (last !== null && last !== "" && findAdminBearerForPartyRouteId(last) !== null) {
    const c = canonicalPartyIdFromRoute(last);
    return c === "" ? null : c;
  }
  const all = listPartyIdsWithStoredAdminToken();
  if (all.length === 0) return null;
  const c = canonicalPartyIdFromRoute(all[0] ?? "");
  return c === "" ? null : c;
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
    <div style={{ fontFamily: "system-ui,sans-serif", maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, letterSpacing: "0.03em", marginBottom: 8 }}>{props.title}</h1>
        <nav style={{ display: "flex", gap: 14 }}>
          <Link to="/">Accueil</Link>
          <Link to="/create">Créer</Link>
          <Link to="/join">Rejoindre</Link>
        </nav>
      </header>
      {props.children}
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
        try {
          const s = await fetchJson<PartySnapshot>(
            `/api/parties/${encodeURIComponent(pidA)}`,
          );
          aRes = { partyId: pidA, joinCode: s.joinCode };
        } catch {
          aRes = { partyId: pidA, joinCode: "" };
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
    <Shell title="PartyGames">
      <p>Quiz temps réel : lobby commun, buzzer et scores synchronisés.</p>
      {playerResume !== null ? (
        <section
          style={{
            marginBottom: 18,
            padding: 12,
            border: "1px solid #ccc",
            borderRadius: 8,
            background: "#f8f9fa",
          }}
        >
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Reprendre (joueur)</h2>
          <p style={{ marginBottom: 8 }}>
            Une session joueur est enregistrée dans cet onglet (équivalent d’un cookie de session pour
            ce site).
          </p>
          <p style={{ margin: 0 }}>
            <Link to={`/party/${encodeURIComponent(playerResume.partyId)}/play`}>
              Ouvrir le lobby / la partie
            </Link>
            {playerResume.joinCode.length >= 4 ? (
              <>
                {" "}
                · code <strong>{playerResume.joinCode}</strong>
              </>
            ) : null}
          </p>
        </section>
      ) : null}
      {adminResume !== null ? (
        <section
          style={{
            marginBottom: 18,
            padding: 12,
            border: "1px solid #ccc",
            borderRadius: 8,
            background: "#f0f7ff",
          }}
        >
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Reprendre (animateur)</h2>
          <p style={{ marginBottom: 8 }}>
            Le jeton d’animateur pour cette partie est encore présent dans la session du navigateur.
          </p>
          <p style={{ margin: 0 }}>
            <Link to={`/party/${encodeURIComponent(adminResume.partyId)}/admin`}>
              Ouvrir le tableau animateur
            </Link>
            {adminResume.joinCode.length >= 4 ? (
              <>
                {" "}
                · code joueurs <strong>{adminResume.joinCode}</strong>
              </>
            ) : null}
          </p>
        </section>
      ) : null}
      <p>
        <Link to="/create">Créer une partie</Link> ·{" "}
        <Link to="/join">Rejoindre avec un code</Link>
      </p>
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
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      const body: Record<string, unknown> = { displayName: name.trim() };
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
          UUID de la partie (facultatif, anciens liens seulement ; le code suffit)
          <input
            style={{ width: "100%", marginTop: 4 }}
            value={partyId}
            onChange={(e) =>
              setPartyId(canonicalPartyIdFromRoute(e.target.value))
            }
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
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
        <button type="submit" disabled={snap === null || loading}>
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
      <ul>
        {props.snap.players.map((p) => (
          <li key={p.id}>
            {p.displayName} · {p.score} pts · équipe{" "}
            {p.teamId === null ? "—" : p.teamId}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** * Displays the quiz prompt from `gameBoard`; host view may reveal the keyed correct choice. */
function GameBoardPanel(props: {
  board: PartyGameBoardSurface | null;
  partyState: string;
  revealCorrect: boolean;
}): JSX.Element | null {
  const { board, partyState, revealCorrect } = props;
  if (board !== null) {
    const ci = board.correctChoiceIndex;
    const correctText =
      revealCorrect &&
      typeof ci === "number" &&
      ci >= 0 &&
      ci < board.choices.length
        ? board.choices[ci]
        : null;
    return (
      <section
        style={{
          marginTop: 14,
          padding: 14,
          border: "1px solid #ccc",
          borderRadius: 8,
          background: "#fafafa",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Zone de jeu</h2>
        <p style={{ margin: "0 0 8px", fontSize: 13, opacity: 0.85 }}>
          {board.packTitle} · Manche {board.roundNumberHuman} — {board.roundTitle} · Question{" "}
          {board.questionIndexInRound + 1} · {board.points} {board.points === 1 ? "pt" : "pts"}
        </p>
        <p style={{ fontSize: 18, fontWeight: 600, margin: "12px 0" }}>{board.prompt}</p>
        <ol style={{ margin: 0, paddingLeft: 22 }}>
          {board.choices.map((c, i) => (
            <li key={`${board.roundIndex}-${board.questionIndexInRound}-${i}`} style={{ marginBottom: 6 }}>
              <strong>{String.fromCharCode(65 + i)}.</strong> {c}
              {revealCorrect && typeof ci === "number" && ci === i ? (
                <span style={{ marginLeft: 8, color: "seagreen" }}>(attendue)</span>
              ) : null}
            </li>
          ))}
        </ol>
        {correctText !== null ? (
          <p style={{ marginTop: 12, fontSize: 14 }}>
            Réponse attendue : <strong>{correctText}</strong>
          </p>
        ) : null}
      </section>
    );
  }
  if (partyState === "round_active") {
    return (
      <section style={{ marginTop: 14, padding: 12, border: "1px dashed #bbb", borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Zone de jeu</h2>
        <p style={{ margin: 0, opacity: 0.85 }}>
          Aucun énoncé disponible : chargez un pack quiz côté animateur (bouton « Charger ») avant de
          lancer la manche, ou la manche dépasse le contenu du pack.
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
  const [closedAfterStart, setClosedAfterStart] = useState(true);
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

  async function sendChat(): Promise<void> {
    if (!pid || jwt === null || jwt === "") return;
    setErr(null);
    try {
      const snapRes = await fetchJson<PartySnapshot>(`/api/parties/${pid}/me/chat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ text: chat }),
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
    <Shell title={`Lobby · ${snap.joinCode}`}>
      <p>
        Pseudo : <strong>{rowMe?.displayName ?? "—"}</strong> · Points :{" "}
        <strong>{rowMe?.score ?? 0}</strong>
        {snap.maxTeams != null && snap.maxTeams >= 2 ? (
          <>
            {" "}
            · Équipe{" "}
            <strong>{rowMe?.teamId === null ? "—" : rowMe.teamId}</strong>
          </>
        ) : null}
      </p>
      <p>État : {snap.state}</p>
      {err ? <p style={{ color: "crimson" }}>{err}</p> : null}

      <GameBoardPanel
        board={snap.gameBoard ?? null}
        partyState={snap.state}
        revealCorrect={false}
      />

      <section style={{ marginTop: 14 }}>
        <h2>Manche / lobby</h2>
        {(snap.gameBoard ?? null) === null ? (
          <p>L’animateur diffuse les questions depuis cette session.</p>
        ) : (
          <p style={{ opacity: 0.8 }}>Répondez avec le buzzer lorsque celui‑ci est ouvert.</p>
        )}
        {canBuzz ? (
          <button type="button" onClick={() => void buzz()}>
            BUZZ !
          </button>
        ) : (
          <p>Buzzer fermé pour l’instant.</p>
        )}
        {snap.buzzOrder.length > 0 ? (
          <ol>
            {snap.buzzOrder.map((idBuzz, idx) => {
              const pl = snap.players.find((x) => x.id === idBuzz);
              return (
                <li key={`${idBuzz}-${idx}`}>
                  {idx + 1}. {pl?.displayName ?? idBuzz}
                </li>
              );
            })}
          </ol>
        ) : null}
      </section>

      {canChatRoom ? (
        <section style={{ marginTop: 18 }}>
          <h2>Chat</h2>
          <textarea
            value={chat}
            rows={3}
            style={{ width: "100%" }}
            placeholder="Message…"
            onChange={(e) => setChat(e.target.value)}
          />
          <button type="button" onClick={() => void sendChat()}>
            Envoyer
          </button>
          <ul>
            {snap.chatTail.slice(-15).map((m) => (
              <li key={m.id}>
                <strong>{m.displayName}</strong> : {m.text}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p style={{ opacity: 0.7 }}>Chat disponible en lobby ou entre deux manches.</p>
      )}

      <p style={{ marginTop: 20 }}>
        <button
          type="button"
          onClick={() => nav(`/join?code=${encodeURIComponent(snap.joinCode)}`)}
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
  const [basename, setBasename] = useState("example-quiz-pack");
  const [err, setErr] = useState<string | null>(null);
  const [hostChat, setHostChat] = useState("");
  const [deltaById, setDeltaById] = useState<Record<string, string>>({});
  const [adminBootstrap, setAdminBootstrap] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );

  useEffect(() => {
    void fetchJson<{
      packs: Array<{ basename: string; id: string; title: string; roundCount: number }>;
    }>(`/api/packs`).then((r) => setPacksList(r.packs));
  }, []);

  useEffect(() => {
    setToken(peekAdminBearer(pid));
  }, [pid]);

  const bearer = token ?? "";

  useEffect(() => {
    if (!pid || bearer === "") return undefined;

    let cancelled = false;
    setAdminBootstrap("loading");
    setSnap(null);

    void fetchJson<PartySnapshot>(`/api/parties/${encodeURIComponent(pid)}`, {
      headers: { Authorization: `Bearer ${bearer}` },
    })
      .then((s2) => {
        if (!cancelled) {
          setSnap(s2);
          setAdminBootstrap("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSnap(null);
          setAdminBootstrap("unavailable");
        }
      });

    return (): void => {
      cancelled = true;
    };
  }, [pid, bearer]);

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

  const onHostRoundStart = useCallback(async (): Promise<void> => {
    setErr(null);
    try {
      const p = await callHostSnapshot(`${hostBasePath}/host/round/start`, "POST", {});
      setSnap(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [callHostSnapshot, hostBasePath]);

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

  const applyPackMutation = useCallback(async (): Promise<void> => {
    setErr(null);
    try {
      const j = await fetchJson<{ snapshot: PartySnapshot }>(
        `${hostBasePath}/host/pack`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer}`,
          },
          body: JSON.stringify({ packBasename: basename }),
        },
      );
      setSnap(j.snapshot);
    } catch (e7) {
      setErr(String(e7));
    }
  }, [hostBasePath, bearer, basename]);

  const onHostChatSend = useCallback(async (): Promise<void> => {
    setErr(null);
    try {
      const h = await callHostSnapshot(`${hostBasePath}/host/chat`, "POST", { text: hostChat });
      setHostChat("");
      setSnap(h);
    } catch (e8: unknown) {
      setErr(e8 instanceof Error ? e8.message : String(e8));
    }
  }, [callHostSnapshot, hostBasePath, hostChat]);

  const onDeltaScoreApply = useCallback(
    async (playerDbId: string): Promise<void> => {
      const raw = deltaById[playerDbId] ?? "1";
      const delta = Number.parseInt(raw, 10);
      if (!Number.isInteger(delta)) return;
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
    [hostBasePath, bearer, deltaById],
  );

  if (!pid) return <Navigate to="/create" replace />;

  if (bearer === "")
    return (
      <Shell title="Admin">
        <p>Jeton animateur absent ou lien incomplet. Rouvrir le lien après création.</p>
        <button type="button" onClick={() => nav("/create")}>
          Créer une session
        </button>
      </Shell>
    );

  if (adminBootstrap === "loading")
    return <Shell title="Admin">Chargement…</Shell>;

  if (adminBootstrap === "unavailable")
    return (
      <Shell title="Animateur">
        <p>
          Impossible de charger cette partie : elle n’existe plus sur le serveur (après une période
          d’inactivité ou un redémarrage) ou une erreur réseau s’est produite.
        </p>
        <p>
          Le lien « Reprendre » sur l’accueil ne peut pas restaurer une partie effacée ; il faut en
          créer une nouvelle.
        </p>
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem(adminSessionKey(pid));
            const last = sessionStorage.getItem(STORAGE_LAST_ADMIN_PARTY);
            if (last !== null && canonicalPartyIdFromRoute(last) === pid) {
              sessionStorage.removeItem(STORAGE_LAST_ADMIN_PARTY);
            }
            nav("/", { replace: true });
          }}
        >
          Retour à l’accueil et effacer ce jeton animateur
        </button>
      </Shell>
    );

  if (snap === null)
    return <Shell title="Admin">Synchronisation…</Shell>;

  const joinUrl = `${window.location.origin}/join?code=${encodeURIComponent(snap.joinCode)}`;

  return (
    <Shell title={`Animateur · ${snap.joinCode}`}>
      <p>
        État : <strong>{snap.state}</strong>
      </p>
      <p>Code joueurs : <strong>{snap.joinCode}</strong></p>
      <p>Lien rejoindre (partager) :</p>
      <code style={{ wordBreak: "break-all", display: "block", marginBottom: 12 }}>{joinUrl}</code>
      <figure style={{ margin: "16px 0" }}>
        <QRCodeSVG
          value={joinUrl}
          size={220}
          level="M"
          includeMargin
          aria-label="QR code rejoindre la partie"
        />
        <figcaption style={{ fontSize: 13, opacity: 0.85 }}>QR code (même URL que ci‑dessus)</figcaption>
      </figure>
      {err ? <pre style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{err}</pre> : null}

      <GameBoardPanel
        board={snap.gameBoard ?? null}
        partyState={snap.state}
        revealCorrect
      />

      <section style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={() => void onHostRoundStart()}>
          Lancer la manche suivante
        </button>
        <button type="button" onClick={() => void onHostRoundPause()}>
          Mettre en pause (lobby)
        </button>
        <button type="button" onClick={() => void onHostBuzzWindow(true)}>
          Ouvrir buzzer
        </button>
        <button type="button" onClick={() => void onHostBuzzWindow(false)}>
          Fermer buzzer &amp; purge file
        </button>
      </section>

      <section style={{ marginTop: 16 }}>
        <h2>Pack quiz</h2>
        <select value={basename} onChange={(e2) => setBasename(e2.target.value)}>
          {packsList.map((pk) => (
            <option key={pk.basename} value={pk.basename}>
              {pk.title} ({pk.roundCount ?? 0} manches)
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void applyPackMutation()}>
          Charger
        </button>
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>Buzz ordre courant</h2>
        <ol>
          {snap.buzzOrder.map((idBuzz2, ix) => {
            const pw = snap.players.find((zz) => zz.id === idBuzz2);
            return (
              <li key={`${idBuzz2}-${ix}`}>
                {pw?.displayName ?? idBuzz2}
              </li>
            );
          })}
        </ol>
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>Scores joueurs (+/− dans la case puis appliquer)</h2>
        <ul style={{ paddingLeft: 16 }}>
          {snap.players.map((pl2) => (
            <li key={pl2.id} style={{ marginBottom: 6 }}>
              {pl2.displayName} ({pl2.score}{" "}
              pts)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
              <input
                style={{ width: 60 }}
                value={deltaById[pl2.id] ?? ""}
                onChange={(ev) =>
                  setDeltaById((m) => ({ ...m, [pl2.id]: ev.target.value }))
                }
              />
              <button type="button" onClick={() => void onDeltaScoreApply(pl2.id)}>
                Appliquer delta
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>Fil de chat (joueurs + animateur)</h2>
        {snap.chatTail.length === 0 ? (
          <p style={{ margin: 0, opacity: 0.75 }}>Aucun message pour l’instant.</p>
        ) : (
          <ul
            style={{
              margin: "8px 0 0",
              paddingLeft: 18,
              maxHeight: 240,
              overflowY: "auto",
            }}
          >
            {snap.chatTail.slice(-80).map((m) => (
              <li key={m.id} style={{ marginBottom: 8 }}>
                <strong>{m.displayName}</strong> : {m.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>Messages animateur vers le chat</h2>
        <textarea
          rows={2}
          style={{ width: "100%" }}
          value={hostChat}
          onChange={(evh) => setHostChat(evh.target.value)}
        />
        <button type="button" onClick={() => void onHostChatSend()}>
          Publier
        </button>
      </section>
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

