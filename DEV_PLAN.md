# PartyGame (buzzy-live-games) — Plan de développement

Application web temps réel pour **quiz / soirées** : lobby, **scores**, **équipes**, **buzzer**, animateur séparé. Stack : API **Fastify**, SPA **React + Vite**, **Socket.IO**, déployable sous **Docker** derrière **Traefik**.

Pour l’historique Cursor : [`cursor_log_latest.txt`](./cursor_log_latest.txt) (session récente) et [`cursor_log_archive.txt`](./cursor_log_archive.txt) (sessions archivées).

---

## 1. Objectifs produit

| Zone | Fonctionnalité |
|------|----------------|
| Accueil | Créer une partie ou rejoindre avec **code** (+ **QR** sur l’admin). |
| Création | Plafonds **joueurs** / **équipes** ou **illimité** ; **fermée** ou **ouverte** après premier lancement ; flags **rename** / **changement d’équipe**. |
| Lobby / jeu | Liste des participants, buzzer fenêtré, chat en **lobby** et **entre manches**. |
| Joueur | Infos perso + buzz + chat ; lien pour repasser par l’écran rejoindre afin de changer pseudo/équipe. |
| Admin | Contrôle **manche**, **fenêtre buzzer**, ordre des buzzes, delta de points par joueur, choix du **pack** quiz. |

---

## 2. Architecture technique (état réel du dépôt)

### 2.1 Dossiers

```
buzzy-live-games/
├── games/                     # Packs quiz JSON (scan au démarrage)
├── webserver/
│   ├── client/               # SPA Vite + React
│   ├── src/
│   │   ├── app.ts           # Construction Fastify, CORS, JWT, routes, static prod
│   │   ├── index.ts          # Bootstrap, notifier → Socket.IO emit
│   │   ├── config.ts
│   │   ├── domain/           # PartyStore, partyLogic, types
│   │   ├── http/             # routes REST
│   │   ├── games/           # Lecture / validation packs
│   │   └── realtime/socket.ts
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
├── .env.example
├── manuel.md, TRAEFIK.md
├── README.md
├── DEV_PLAN.md
├── cursor_log_latest.txt
└── cursor_log_archive.txt
```

### 2.2 Stack

| Couche | Choix |
|--------|------|
| API | Fastify 5, Zod validation, JWT joueur `@fastify/jwt`, CORS configurable |
| Temps réel | Socket.IO : room `party:{uuid}` après auth handshake (Bearer joueur ou admin) |
| Auth | JWT joueur (`pid`, `sub` = player id) ; host = `Authorization: Bearer` + secret `adminToken` par partie |
| État partie | Mémoire process (`PartyStore`) ; pas de Redis |
| Front | react-router-dom, fetch REST, socket.io-client, `qrcode.react` pour le QR animateur |

### 2.3 États partie (`PartyState`)

`lobby` → `round_active` ou `between_rounds` selon animateur → `ended` possible côté modèle pour extensions.

Les snapshots publics incluent aussi `hasStartedRound`, `buzzOrder`, `buzzWindowOpen`, `currentRoundIndex`, `currentQuestionIndex`, équipes agrégées, file de chat récente (`chatTail`).

### 2.4 Temps réel (implémenté)

- **`party:patch`** — payload = `PartyPublicSnapshot` (JSON), émis après chaque mutation métier coté méthodes du store qui invoquent `broadcast`.

### 2.5 Sécurité (rappels)

- Le **QR et liens joueurs** contiennent `joinCode` + `partyId` ; le **secret admin** ne doit pas y figurer (JWT animateur hors QR).
- Toutes les actions sensibles vérifient côté serveur (droits joueur/host, fenêtre buzzer, phases chat).

---

## 3. Phases → statut synthétique

| # | Phase | Statut |
|---|-------|--------|
| 1 | Fondations, healthcheck | Fait (`GET /api/health`) |
| 2 | API partie + join | Fait |
| 3 | Socket + sync lobby | Fait (`party:patch`) |
| 4–5 | UI joueur + admin | Fait pour un MVP quiz (voir écarts ci-dessous) |
| 6 | Pack `games/` + loader | Fait (+ `PATCH .../host/pack`) |
| 7 | Chat restreint | Fait (lobby + `between_rounds`) |
| 8 | Docker + Traefik | Fait (`webserver/Dockerfile`, compose racine, docs) |
| 9 | Tests | Partiel : **vitest** sur règles domaine uniquement ; **pas** d’e2e Playwright encore |
| 10 | Polish UX / accessibilité | Partiel |

---

## 4. Implémentation actuelle — détail technique

### 4.1 Variables d’environnement pertinentes (`config.ts`)

| Variable | Rôle |
|----------|------|
| `PUBLIC_URL` | URL publique (schéma, sans `/` final) — liens de création côté API |
| `JWT_SECRET` | Secret JWT joueur (**obligatoire** en production) |
| `GAMES_DIR` | Répertoire des packs (`games/` par défaut en local depuis la racine du dépôt) |
| `PARTY_MAX_IDLE_MS` | Âge max sans activité avant purge d’une partie (défaut 48 h) |
| `PARTY_SWEEP_INTERVAL_MS` | Période du balayage (défaut 5 min) |
| `PORT`, `HOST`, `CORS_ORIGIN` | Bind serveur et CORS |

### 4.2 Routes HTTP notables

| Méthode | Chemin | Rôle |
|---------|--------|------|
| GET | `/api/health` | Santé |
| GET | `/api/packs` | Liste des packs indexés |
| GET | `/api/parties/meta-by-code/:joinCode` | Résolution code → `partyId` + snapshot |
| POST | `/api/parties` | Création (options) → `adminToken`, URLs |
| GET | `/api/parties/:partyId` | Snapshot public |
| POST | `/api/parties/:partyId/join` | Rejoindre → `playerToken` |
| PATCH | `/api/parties/:partyId/me` | Renommer / équipe (JWT) si autorisé |
| POST | `/api/parties/:partyId/me/chat` | Chat joueur |
| POST | `/api/parties/:partyId/me/buzz` | Buzz |
| POST | `/api/parties/:partyId/host/round/start` | Animateur : manche |
| POST | `/api/parties/:partyId/host/round/pause` | Animateur : pause / lobby |
| POST | `/api/parties/:partyId/host/buzz-window` | Ouvrir / fermer buzzer |
| PATCH | `/api/parties/:partyId/host/players/:playerId/score` | Delta points |
| PATCH | `/api/parties/:partyId/host/pack` | Charger un pack |
| POST | `/api/parties/:partyId/host/chat` | Message hôte dans le chat |

Pas de `GET /api/parties/:id/qr` : le **QR est généré côté client** (SPA admin) depuis l’URL de rejoindre.

### 4.3 Frontend (routes SPA)

`/`, `/create`, `/join`, `/party/:partyId/play`, `/party/:partyId/admin` — fichier principal `webserver/client/src/App.tsx`.

---

## 5. Checklist mise à jour (MVP livré vs restant)

### Structure et outillage

- [x] Projet dans `webserver/` (TS, vite, eslint, vitest).
- [x] Modules domain / http / realtime / games (noms différent du plan originel mais rôle équivalent).
- [x] Configuration : port, `PUBLIC_URL`, CORS, **TTL parties inactives** (`PARTY_MAX_IDLE_MS`, sweep).

### Modèle et logique

- [x] Party avec paramètres (plafonds, fermée après start, flags rename / équipe).
- [x] Code join unique + gestion collisions.
- [x] Token animateur opaque par partie.
- [x] États lobby / manche / entre manches.
- [x] Règle partie fermée + plafonds (tests unitaires présents sur partie des règles).

### API HTTP — voir §4.2

- [x] Création, snapshot, join, PATCH self (**API** ; UX inline optionnelle, voir plus bas).

### Temps réel

- [x] Room par partie + auth handshake.
- [x] Patch snapshot sur mutations.
- [x] Buzz ordre observable ; chat par phase serveur‑autorisée.
- [x] Reconnexion : client renvoie le même Bearer dans `handshake.auth`.

### Frontend — pages

- [x] Accueil / création / rejoindre (`/join?code=` suffit ; UUID en query optionnel pour anciens liens).
- [x] Redirection admin après création (fragment `#token=` + sessionStorage).
- [x] Vue joueur : buzz, chat aux phases permises.
- [x] Bouton pour repasser par `/join` afin de modifier pseudo / équipe.
- [ ] **Formulaire in-place** `PATCH .../me` dans la vue joueur (sans quitter vers `/join`) si on veut éviter une ré‑inscription.
- [ ] **Énoncé de question / réponses** provenant du pack affichés au joueur — aujourd’hui seuls indices d’indexes sont dans le snapshot ; l’animateur pilote encore surtout le matériel affiché côté salle.


### Jeux (`games/`)

- [x] Format pack + exemple `example-quiz-pack.json`.
- [x] Validation côté chargement packs.
- [x] Admin : sélection de pack (`PATCH .../host/pack`).


### Docker / docs

- [x] Dockerfile, `.dockerignore`, compose, `PUBLIC_URL` / JWT documentés dans `manuel.md` et README.

### Qualité

- [x] Tests unitaires métier (`partyLogic.test.ts`).
- [ ] Tests d’intégration socket automatisés.
- [ ] E2e (Playwright) scénario happy path.
- [x] README + manuel + Traefik.

---

## 6. Hors scope MVP (inchangé, backlog produit plus large)

- Comptes / OAuth prolongés hors session quiz.
- Plusieurs familles de mini‑jeux dans une même partie.
- Grand écran « présentateur » read‑only synchronisé.
- i18n complète ; cluster Redis pour multi‑instances.


---

## 7. Prochaines actions immédiates (priorisables par l’équipe)

1. **Contenu jeu côté joueur** — enrichir le snapshot ou un événément dédié avec le texte de la question/réponses du round courant (depuis pack chargé) et rendre ça lisible sous `/party/:id/play`.
2. **UX rename/équipe** — petite UI branchée sur `PATCH /api/parties/:id/me` lorsque les flags partie l’autorisent.
3. **E2e ou test socket minimal** pour verrouiller la régression autour join + buzz.

