import type { JSX } from "react";
import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";

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
}

function playerSessionKey(pid: string): string {
  return `partygames:playerJwt:${pid}`;
}

function adminSessionKey(pid: string): string {
  return `partygames:adminToken:${pid}`;
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
  return (
    <Shell title="PartyGames">
      <p>Quiz temps réel : lobby commun, buzzer et scores synchronisés.</p>
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
  const [partyId, setPartyId] = useState(params.get("party") ?? "");
  const [snap, setSnap] = useState<PartySnapshot | null>(null);
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState<number>(1);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCode(params.get("code") ?? "");
    setPartyId(params.get("party") ?? "");
  }, [params]);

  useEffect(() => {
    async function sync(): Promise<void> {
      if (partyId.length >= 30) {
        try {
          setSnap(await fetchJson<PartySnapshot>(`/api/parties/${partyId}`));
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
        setPartyId(m.partyId);
        setSnap(m.snapshot);
      } catch {
        setSnap(null);
      }
    }
    void sync();
  }, [code, partyId]);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!snap || partyId === "") return;
    setLoading(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { displayName: name.trim() };
      if (snap.maxTeams != null && snap.maxTeams >= 2) body.teamId = teamId;
      const res = await fetchJson<{ playerToken: string }>(
        `/api/parties/${encodeURIComponent(partyId)}/join`,
        { method: "POST", body: JSON.stringify(body) },
      );
      sessionStorage.setItem(playerSessionKey(partyId), res.playerToken);
      nav(`/party/${partyId}/play`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Erreur");
    }
    setLoading(false);
  }

  const needsTeam = snap !== null && snap.maxTeams !== null && snap.maxTeams >= 2;

  return (
    <Shell title="Rejoindre une partie">
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
          UUID (facultatif, pré-rempli par le lien d’invitation)
          <input
            style={{ width: "100%", marginTop: 4 }}
            value={partyId}
            onChange={(e) => setPartyId(e.target.value.trim())}
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
          Entrer dans le lobby
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
  const pid = partyId ?? "";
  const nav = useNavigate();
  const [jwtState, setJwtState] = useState<string | null>(null);

  useEffect(() => {
    setJwtState(sessionStorage.getItem(playerSessionKey(pid)));
  }, [pid]);

  const jwt = jwtState ?? "";
  const [snap, setSnap] = useState<PartySnapshot | null>(null);
  const [chat, setChat] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!pid || jwt === "") return undefined;

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

  async function buzz(): Promise<void> {
    if (!pid || jwt === "") return;
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
    if (!pid || jwt === "") return;
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

  if (jwt === "")
    return <Navigate to={`/join?party=${encodeURIComponent(pid)}`} replace />;

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

      <section style={{ marginTop: 14 }}>
        <h2>Manche / lobby</h2>
        <p>L’animateur diffuse les questions depuis son écran administration.</p>
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
          onClick={() =>
            nav(
              `/join?party=${encodeURIComponent(pid)}&code=${encodeURIComponent(snap.joinCode)}`,
            )
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
  const pid = partyId ?? "";
  const nav = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  const [snap, setSnap] = useState<PartySnapshot | null>(null);
  const [packsList, setPacksList] = useState<
    Array<{ basename: string; id: string; title: string; roundCount?: number }>
  >([]);
  const [basename, setBasename] = useState("example-quiz-pack");
  const [err, setErr] = useState<string | null>(null);
  const [hostChat, setHostChat] = useState("");
  const [deltaById, setDeltaById] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetchJson<{
      packs: Array<{ basename: string; id: string; title: string; roundCount: number }>;
    }>(`/api/packs`).then((r) => setPacksList(r.packs));
  }, []);

  useEffect(() => {
    const h =
      typeof window !== "undefined" && window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : "";
    const sp = new URLSearchParams(h);
    const frag = sp.get("token");
    let t = pid ? sessionStorage.getItem(adminSessionKey(pid)) : null;
    if (frag && frag.length > 0) {
      sessionStorage.setItem(adminSessionKey(pid), frag);
      t = frag;
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
    }
    setToken(t);
  }, [pid]);

  const bearer = token ?? "";

  useEffect(() => {
    if (!pid || bearer === "") return undefined;

    void fetchJson<PartySnapshot>(`/api/parties/${encodeURIComponent(pid)}`)
      .then((s2) => setSnap(s2))
      .catch(() => setSnap(null));

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
  }, [pid, bearer]);

  async function hosts(
    path: string,
    method: string,
    body?: Record<string, unknown>,
  ): Promise<PartySnapshot> {
    const rBody = body === undefined ? undefined : JSON.stringify(body);
    interface ErrBody {
      error?: string;
    }
    const res = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
      },
      body: method === "GET" ? undefined : rBody,
    });
    const text = await res.text();
    if (!res.ok)
      throw new Error(
        `${res.status}:${text ? (JSON.parse(text) as ErrBody).error ?? text : ""}`,
      );
    return JSON.parse(text) as PartySnapshot;
  }

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

  if (snap === null)
    return <Shell title="Admin">Chargement…</Shell>;

  async function runRound(mode: "start" | "pause"): Promise<void> {
    setErr(null);
    try {
      const p =
        mode === "start"
          ? await hosts(`/api/parties/${pid}/host/round/start`, "POST", {})
          : await hosts(`/api/parties/${pid}/host/round/pause`, "POST", {});
      setSnap(p);
    } catch (e5) {
      setErr(String(e5));
    }
  }

  async function setBuzz(open: boolean): Promise<void> {
    setErr(null);
    try {
      const n = await hosts(`/api/parties/${pid}/host/buzz-window`, "POST", { open });
      setSnap(n);
    } catch (e6) {
      setErr(String(e6));
    }
  }

  async function applyPack(): Promise<void> {
    setErr(null);
    try {
      const j = await fetchJson<{ snapshot: PartySnapshot }>(`/api/parties/${pid}/host/pack`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({ packBasename: basename }),
      });
      setSnap(j.snapshot);
    } catch (e7) {
      setErr(String(e7));
    }
  }

  async function hcSend(): Promise<void> {
    setErr(null);
    try {
      const h = await hosts(`/api/parties/${pid}/host/chat`, "POST", { text: hostChat });
      setHostChat("");
      setSnap(h);
    } catch (e8) {
      setErr(String(e8));
    }
  }

  async function deltaScore(playerDbId: string): Promise<void> {
    const raw = deltaById[playerDbId] ?? "1";
    const delta = Number.parseInt(raw, 10);
    if (!Number.isInteger(delta)) return;
    setErr(null);
    try {
      const u = await fetchJson<PartySnapshot>(`/api/parties/${pid}/host/players/${playerDbId}/score`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({ delta }),
      });
      setSnap(u);
    } catch (e9) {
      setErr(String(e9));
    }
  }

  return (
    <Shell title={`Animateur · ${snap.joinCode}`}>
      <p>Code joueurs : <strong>{snap.joinCode}</strong></p>
      <p>Lien rejoindre (partager) :</p>
      <code>
        {`${window.location.origin}/join?code=${encodeURIComponent(snap.joinCode)}&party=${encodeURIComponent(pid)}`}
      </code>
      <p>Lien rejoindre (QR) à générer côté client à partir du lien ci‑dessus.</p>
      {err ? <pre style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{err}</pre> : null}

      <section style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={() => void runRound("start")}>
          Lancer / suivante manche
        </button>
        <button type="button" onClick={() => void runRound("pause")}>
          Mettre en pause (lobby)
        </button>
        <button type="button" onClick={() => void setBuzz(true)}>
          Ouvrir buzzer
        </button>
        <button type="button" onClick={() => void setBuzz(false)}>
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
        <button type="button" onClick={() => void applyPack()}>
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
              <button type="button" onClick={() => void deltaScore(pl2.id)}>
                Appliquer delta
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>Messages animateur vers le chat</h2>
        <textarea
          rows={2}
          style={{ width: "100%" }}
          value={hostChat}
          onChange={(evh) => setHostChat(evh.target.value)}
        />
        <button type="button" onClick={() => void hcSend()}>
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

