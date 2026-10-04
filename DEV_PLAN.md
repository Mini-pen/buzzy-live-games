# PartyGame (buzzy-live-games) — Plan de développement

Application web temps réel pour **quiz / soirées** : lobby, **scores**, **équipes**, **buzzer**, animateur séparé. Stack : API **Fastify**, SPA **React + Vite**, **Socket.IO**, déployable sous **Docker** derrière **Traefik**.

Pour l'historique Cursor : [`cursor_log_latest.txt`](./cursor_log_latest.txt) (session récente) et [`cursor_log_archive.txt`](./cursor_log_archive.txt) (sessions archivées).

---

## 1. Objectifs produit

| Zone | Fonctionnalité |
|------|----------------|
| Accueil | Créer une partie ou rejoindre avec **code** (+ **QR** sur l'admin). |
| Création | Plafonds **joueurs** / **équipes** ou **illimité** ; **fermée** ou **ouverte** après premier lancement ; flags **rename** / **changement d'équipe**. |
| Lobby / jeu | Liste des participants, buzzer fenêtré, chat en **lobby** et **entre manches**. |
| Joueur | Infos perso + buzz + chat ; lien pour repasser par l'écran rejoindre afin de changer pseudo/équipe. |
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
| 9 | Tests | Partiel : **vitest** sur règles domaine uniquement ; **pas** d'e2e Playwright encore |
| 10 | Polish UX / accessibilité | Partiel |

---

## 4. Implémentation actuelle — détail technique

### 4.1 Variables d'environnement pertinentes (`config.ts`)

| Variable | Rôle |
|----------|------|
| `PUBLIC_URL` | URL publique (schéma, sans `/` final) — liens de création côté API |
| `JWT_SECRET` | Secret JWT joueur (**obligatoire** en production) |
| `GAMES_DIR` | Répertoire des packs (`games/` par défaut en local depuis la racine du dépôt) |
| `PARTY_MAX_IDLE_MS` | Âge max sans activité avant purge d'une partie (défaut 48 h) |
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

Pas de `GET /api/parties/:id/qr` : le **QR est généré côté client** (SPA admin) depuis l'URL de rejoindre.

### 4.3 Frontend (routes SPA)

`/`, `/create`, `/join`, `/party/:partyId/play`, `/party/:partyId/admin`, `/party/:partyId/broadcast` — fichier principal `webserver/client/src/App.tsx`.

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
- [x] **Grand écran spectateur** (`/party/:partyId/broadcast`) : livré mais non testé.
- [ ] **Formulaire in-place** `PATCH .../me` dans la vue joueur (sans quitter vers `/join`) si on veut éviter une ré‑inscription.
- [ ] **Énoncé de question / réponses** provenant du pack affichés au joueur — aujourd'hui seuls indices d'indexes sont dans le snapshot ; l'animateur pilote encore surtout le matériel affiché côté salle.

### Jeux (`games/`)

- [x] Format pack + exemple `example-quiz-pack.json`.
- [x] Validation côté chargement packs.
- [x] Admin : sélection de pack (`PATCH .../host/pack`).

### Docker / docs

- [x] Dockerfile, `.dockerignore`, compose, `PUBLIC_URL` / JWT documentés dans `manuel.md` et README.

### Qualité

- [x] Tests unitaires métier (`partyLogic.test.ts`).
- [ ] Tests d'intégration socket automatisés.
- [ ] E2e (Playwright) scénario happy path.
- [x] README + manuel + Traefik.

---

## 6. Hors scope MVP (backlog produit)

- Comptes / OAuth prolongés hors session quiz.
- Plusieurs familles de mini‑jeux dans une même partie.
- i18n complète ; cluster Redis pour multi‑instances.

---

## 7. Évolutions demandées (section 4 du cahier des charges)

Ces fonctionnalités enrichissent l'expérience au-delà du MVP actuel. Elles sont priorisées dans l'ordre suivant :

### 7.1 Import de jeux au format ZIP

**Statut :** ✅ Fait (PR #4, merged).

**Description :** L'animateur peut importer un fichier ZIP contenant un pack de jeu (JSON + ressources médias : images, audio, vidéo). Le ZIP est décompressé et les ressources sont rendues disponibles pour la partie en cours. Les packs importés s'ajoutent dynamiquement à la liste des packs disponibles.

**Règles :**
- Le ZIP doit contenir au minimum un fichier JSON de pack valide.
- Les chemins des ressources (ex. `imageUrl`, `videoUrl`) doivent pointer vers des fichiers relatifs présents dans le ZIP.
- Le pack importé est indexé sous un identifiant unique pour éviter les collisions.
- Limite de taille configurable (ex. 50 Mo).

---

### 7.2 Éditeur de jeux intégré

**Statut :** ✅ Fait (PR #6, merged).

**Description :** L'animateur peut charger un pack existant (ZIP ou JSON) dans un éditeur intégré. L'éditeur permet d'inspecter, ajouter, modifier, supprimer des rounds et questions, et d'uploader des images depuis des URLs avec redimensionnement automatique. À la fin, l'animateur peut exporter le pack sous forme de ZIP.

**Règles :**
- L'éditeur valide en temps réel la structure (schéma Zod).
- Upload d'images depuis URL : téléchargement, redimensionnement (max 1920×1080), compression.
- Limite de poids par image : configurable (ex. 500 Ko).
- Les modifications sont en mémoire ; l'export ZIP fige l'état édité.

---

### 7.3 Programmation d'une soirée complète (mode automatique)

**Statut :** ✅ Fait (PR #9, merged dans commit 09822bf).

**Description :** L'animateur peut planifier une séquence complète d'activités (manches, vidéos, pauses). Un mode « Lecture automatique » (Play mode) exécute la soirée de bout en bout avec transitions animées entre activités. L'animateur conserve le contrôle : pause, accélération, saut, retour.

**Règles :**
- La séquence est définie dans le `mancheScript` étendu avec transitions (pause, fade, countdown).
- Le mode respecte les durées configurées via les variables d'environnement :
  - `AUTO_PLAY_QUESTION_DURATION_MS` (défaut: 30s)
  - `AUTO_PLAY_ROUND_DURATION_MS` (défaut: 5min)
  - `AUTO_PLAY_TRANSITION_DURATION_MS` (défaut: 3s)
- L'animateur peut interrompre à tout moment (pause/reprendre, avancer, reculer).
- Les transitions sont affichées sur le grand écran et dans l'interface joueur avec animations visuelles.
- Le bouton « Mode lecture automatique » apparaît dans l'admin si le script contient au moins une manche.
- L'état du mode (actif, en pause, progression) est synchronisé en temps réel via Socket.IO.

**Note :** L'avancement automatique basé sur les durées configurées nécessiterait un timer côté serveur (non implémenté dans cette version). L'animateur contrôle manuellement l'avancement avec les boutons.

---

### 7.4 Introductions animées et tutoriels automatiques

**Statut :** ✅ Fait (commit 0392f22, merged dans main).

**Description :** Avant chaque type de jeu (quiz, blind test, révélation progressive, etc.), une courte introduction animée explique la mécanique. Le tutoriel est affiché sur le grand écran et dans l'interface joueur. Chaque jeu peut être lancé en mode « Normal » (avec tutoriel) ou « Autonome » (sans tutoriel, enchaînement automatique).

**Règles :**
- Les tutoriels sont pré-conçus (slides avec icônes et texte, stockés côté serveur).
- Le tutoriel est affiché uniquement au premier lancement d'un type de jeu dans une partie.
- Les jeux automatiques (ex. QCM avec auto-avance) enchaînent sans attendre l'animateur.
- Les jeux manuels attendent la validation après chaque buzz.
- Badges « Auto » et « Manuel » affichés dans le script des manches.
- Interface en français avec boutons « Lancer en mode normal » et « Lancer en mode autonome ».

---

### 7.5 Alertes sonores/visuelles, compte à rebours configurable

**Statut :** ✅ Fait (PR #15, merged).

**Description :**
- **Alertes sonores :** Sons de validation bon/mauvais joués automatiquement après jugement de buzz (toggle hôte).
- **Visuel de victoire :** Écran de victoire affichant le gagnant (joueur ou équipe) sur le grand écran et dans l'interface joueur.
- **Compte à rebours avant question :** Compte à rebours configurable (3 à 10 secondes) avant chaque question, démarrant lorsque tous les participants ont marqué « Prêt ». Le buzzer reste fermé pendant le compte à rebours et s'ouvre automatiquement à la fin.

**Important :** Le compte à rebours de 3-10 secondes s'applique uniquement avant chaque question (démarre une fois tous prêts, buzzer ouvre après la fin). Ce n'est pas la durée du tutoriel.

**Règles implémentées :**
- Le bouton « Prêt » apparaît dans l'interface joueur avant chaque question.
- Le compte à rebours démarre lorsque tous ont cliqué « Prêt » (ou après timeout de 30s, configurable via READY_TIMEOUT_MS).
- Le buzzer s'ouvre automatiquement à la fin du compte à rebours.
- Le visuel de victoire affiche pseudo, avatar, score final (joueur ou équipe).
- Durée du countdown : réglage hôte 3-10s (défaut 5s).
- Mode winner screen : réglage hôte question/manche (défaut question).

---

### 7.6 Configuration de l'affichage projeté depuis une fenêtre miniature

**Statut :** À implémenter.

**Description :** L'interface admin affiche une fenêtre miniature simulant l'écran projeté (`/party/:partyId/broadcast`). L'animateur peut configurer l'affichage : afficher uniquement la question/réponses, ou inclure aussi le classement en temps réel. Options de masquage des scores numériques (seul l'ordre de classement visible) et mise en évidence automatique du premier joueur ayant buzzé. Choix d'affichage des joueurs : groupés par équipe ou vue individuelle.

**Règles :**
- Les modifications s'appliquent en temps réel sur `/party/:partyId/broadcast`.
- La fenêtre miniature reflète l'affichage projeté (preview live).
- Le masquage des scores numériques n'affecte que l'affichage projeté.
- Le highlight du premier joueur buzzé est visible uniquement si le buzzer est ouvert.
- Le mode d'affichage (équipe vs individuel) peut être défini globalement ou par manche.

---

### 7.7 Bibliothèque de jeux communautaire

**Statut :** À implémenter.

**Description :** L'application héberge une bibliothèque de jeux accessible depuis l'interface admin et publique (lecture seule pour visiteurs). La bibliothèque contient une petite version intégrée de chaque type de jeu pour essai rapide. Les utilisateurs peuvent uploader des packs au format ZIP dans la bibliothèque ; ces packs sont stockés côté serveur et téléchargeables par tous. Lors de la création, l'animateur peut choisir un pack depuis la bibliothèque (téléchargement automatique et import).

**Règles :**
- Les packs uploadés sont validés (structure JSON, taille, contenus) avant publication.
- Chaque pack a une fiche : titre, description, auteur, nombre de questions/téléchargements, note moyenne.
- Les packs intégrés (essais rapides) sont marqués « Officiel ».
- Limite de taille par upload : configurable (ex. 50 Mo).
- Indexation et recherche par titre, auteur, type de jeu, tags.
- Système de signalement recommandé pour modération.

---

## 8. Complément MVP (section 5.1 du cahier des charges)

Ces éléments font partie du MVP mais nécessitent encore des compléments :

### 8.1 Affichage question/réponses côté joueur

**Statut :** Restant (partiellement implémenté).

**Description :** Le snapshot joueur devrait inclure systématiquement le `gameBoard` complet (sauf champs réservés animateur comme `correctChoiceIndex` ou `revealTitle`/`revealArtist`). Cela permettrait aux joueurs de lire la question, voir les choix QCM, et consulter les illustrations sans dépendre d'un affichage en salle.

---

### 8.2 Modification pseudo / équipe in-place (UX inline)

**Statut :** Restant (API existante, UI manquante).

**Description :** L'API `PATCH /api/parties/:partyId/me` permet déjà de modifier `displayName`, `teamId`, `avatarKey`, `buzzSoundKey` en cours de partie (si autorisé). Un formulaire inline dans `/party/:partyId/play` permettrait de modifier directement sans quitter la page.

---

### 8.3 Tests unitaires (Vitest)

**Statut :** Livré partiellement (120 tests, couverture à compléter).

**Modules couverts :** `partyLogic`, `free_buzz`, `readBearer`, `replyDomain`, sons, `loadConfig`.

**Modules non couverts (restant) :**
- `store.ts` : tests d'intégration du `PartyStore`.
- Routes HTTP : tests des endpoints REST.
- Socket.IO : tests d'intégration vérifiant l'émission de `party:patch`.

---

### 8.4 Tests end-to-end (Playwright)

**Statut :** Restant (aucun test e2e présent).

**Description :** Scénario happy path : création de partie, rejoindre avec 2 joueurs, lancer manche quiz, ouvrir buzzer, buzzer, valider réponses, vérifier scores.
