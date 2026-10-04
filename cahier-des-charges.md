# Cahier des charges — buzzy-live-games

## 1. Objet du produit

Application web temps réel permettant d'animer des soirées quiz et jeux de type « buzzer » en présentiel ou hybride. L'animateur pilote la partie depuis une interface dédiée (admin) ; les participants rejoignent via un code court et jouent depuis leur navigateur mobile ou desktop. L'application gère scores individuels et par équipes, fenêtre de buzzer contrôlée, chat restreint aux phases de lobby et entre-manches, et supporte plusieurs familles de quiz (QCM, questions libres, blind test audio, révélation progressive, image buzz).

**Contexte d'usage :** soirée familiale, team-building, événement associatif avec 2 à plusieurs dizaines de participants. Chaque partie est éphémère (en mémoire serveur, purge après 48 h d'inactivité par défaut).

---

## 2. Fonctionnalités déjà en place

### 2.1 Accueil et création de partie

**Comportement :**

- Page d'accueil (`/`) : lien vers « Créer une partie » ou « Rejoindre une partie ».
- Formulaire de création : choix des plafonds joueurs/équipes (ou illimité), flag « partie fermée après premier lancement », flag « autoriser renommage » et « autoriser changement d'équipe en cours de partie ».
- À la validation, le serveur génère un code court (6 caractères alphanumériques, ex. `AB12CD`), un UUID unique pour la partie, et un token admin opaque (secret). Le code est unique et indexé pour la résolution rapide.
- L'API renvoie `partyId`, `joinCode`, `adminToken`, `joinUrl` (lien joueur public) et `adminUrl` (lien admin incluant le fragment `#token=`).

**Acteurs :**

- Hôte : personne qui crée la partie et accède à l'interface animateur.

**Règles métier :**

- Plafond joueurs : si défini, compté au moment du join. Erreur `PARTY_FULL` si atteint.
- Plafond équipes : si défini (≥ 2), chaque joueur doit indiquer un `teamId` (entier de 1 à `maxTeams`). Si équipes désactivées (`maxTeams === null`), le `teamId` doit être `null`.
- Partie fermée : si `closedAfterStart` est `true` et que `hasStartedRound` est `true`, tout nouveau join renvoie `PARTY_CLOSED`.
- Collisions de code : en cas d'épuisement (40 tentatives), le serveur renvoie `JOIN_CODE_EXHAUSTED` (cas théorique rarissime).

**Critères d'acceptation :**

- Le code join ne doit jamais contenir le token admin.
- La création échoue si `playersUnlimited === false` et `maxPlayers` absent, ou si `teamsUnlimited === false` et `maxTeams` absent ou < 2.
- Les liens joueur (`joinUrl`, `/join?code=…`) ne contiennent que le code court ; le lien admin (`adminUrl`) contient le token en fragment de hash (non transmis au serveur lors du GET).

**Cas limites :**

- Si le formulaire demande un plafond équipes sans activer les équipes, validation échoue côté front.
- Les plafonds peuvent être mis à jour uniquement en recréant une partie (pas de PATCH des paramètres de partie après création).

---

### 2.2 Rejoindre une partie

**Comportement :**

- Page `/join` : champ code join + pseudo + équipe (si équipes activées) + choix d'avatar (catalogue hébergé sous `/avatars/`) + choix de son de buzzer (catalogue `/games/sounds/`).
- L'utilisateur peut arriver avec un query param `?code=` pré-rempli (QR scan ou lien partagé).
- À la validation, `POST /api/parties/:partyId/join` retourne `playerId`, `playerToken` (JWT signé), et le snapshot initial.
- Le JWT contient `{ pid: partyId, sub: playerId }` ; validité illimitée tant que la partie existe.

**Acteurs :**

- Joueur : participant à la partie.

**Règles métier :**

- Le pseudo doit faire 2 à 48 caractères (trimé).
- Le `teamId` doit être entre 1 et `maxTeams` si équipes activées ; absent ou `null` sinon.
- Erreur `PARTY_FULL` si `maxPlayers` atteint.
- Erreur `PARTY_CLOSED` si `closedAfterStart && hasStartedRound`.
- L'avatar est choisi depuis un catalogue scanné au démarrage (dossiers sous `avatars/`). Si le catalogue est vide ou la clé invalide, erreur `AVATAR_CATALOG_EMPTY` ou `AVATAR_INVALID`.
- Le son de buzzer est choisi depuis `/games/sounds/catalog.json` (seulement ceux marqués `selectable: true` et pool `buzzer`). Défaut si absent : `defaultBuzzerKey` du catalogue.

**Critères d'acceptation :**

- Une fois rejoint, le joueur reçoit son `playerToken` et peut s'authentifier pour les actions ultérieures (chat, buzz, PATCH self).
- Le snapshot retourné contient la liste des joueurs, scores par équipe agrégés, état de partie (`lobby` au départ).
- Les joueurs connectés via Socket.IO reçoivent un événement `party:patch` dès qu'un nouveau joueur arrive.

**Cas limites :**

- Si le joueur tente de rejoindre avec un code invalide, erreur `NOT_FOUND`.
- Si le joueur revient avec le même lien après avoir été kické, son ancien JWT est invalide (le `playerId` n'existe plus) ; il devra rejoindre à nouveau.

---

### 2.3 Lobby et gestion de participants

**Comportement :**

- État initial : `state === "lobby"`, `hasStartedRound === false`.
- Le lobby affiche la liste des joueurs (pseudo, avatar, équipe, score = 0).
- L'animateur peut kické un joueur (`POST /api/parties/:partyId/host/players/:playerId/kick`), qui est retiré de `players` et de `buzzOrder`.
- L'animateur peut supprimer la partie (`POST /api/parties/:partyId/host/delete`), ce qui notifie tous les clients puis efface la partie de la mémoire.

**Acteurs :**

- Animateur : contrôle l'accès (kick), supprime la partie.
- Joueurs : voient la liste en temps réel ; peuvent chatter en lobby.

**Règles métier :**

- Chat autorisé en `lobby` et `between_rounds` uniquement (vérifié côté serveur).
- Kick : le joueur concerné reçoit un événement `party:kicked` via Socket.IO et doit afficher un message puis se déconnecter.
- Suppression : tous les clients reçoivent `party_deleted` et doivent retourner à l'accueil.

**Critères d'acceptation :**

- Le lobby affiche en temps réel l'arrivée et le départ de joueurs.
- Les scores équipes sont calculés et affichés (somme des scores de tous les joueurs d'une équipe).
- Le chat en lobby est limité à 50 messages récents (fenêtre glissante côté snapshot : `chatTail`).

**Cas limites :**

- Si un joueur tente de chatter hors lobby/entre-manches, erreur serveur (par exemple pendant `round_active`).
- Les joueurs kické ou dont la partie est supprimée doivent gérer la déconnexion proprement (pas de boucle de reconnexion).

---

### 2.4 Interface joueur

**Comportement :**

- Route `/party/:partyId/play` : affiche l'état de la partie (liste joueurs, scores, gameBoard si `state === "round_active"`).
- Actions disponibles : buzz (`POST /api/parties/:partyId/me/buzz`), chat (`POST /api/parties/:partyId/me/chat`), modifier son profil via `PATCH /api/parties/:partyId/me` (si autorisé).
- Le bouton buzz est actif si `buzzWindowOpen === true` ; un joueur ne peut buzzer qu'une fois par fenêtre (son `playerId` est ajouté à `buzzOrder`).
- Sur un quiz QCM (`kind: "quiz"`), le buzz inclut un `quizChoiceIndex` (0 à N-1) correspondant au choix sélectionné. La réponse est stockée dans `buzzQuizGuess` et peut être auto-évaluée si `autoAdvanceQuizWhenAllBuzzed` est activé.
- L'interface joue un son de buzzer local (`buzzToneUrl` retourné par l'API) si `playPlayerBuzzTone === true`.

**Acteurs :**

- Joueur : interagit avec la partie (buzz, chat, consultation du gameBoard).

**Règles métier :**

- Le buzz est refusé si `buzzWindowOpen === false` ou si le joueur a déjà buzzé (`BUZZ_WINDOW_CLOSED` ou `ALREADY_BUZZED`).
- Sur un quiz QCM, si `quizChoiceIndex` est absent ou hors limites, erreur `VALIDATION`.
- Les modifications de profil (pseudo, équipe) ne sont permises que si `allowRename` / `allowTeamChange` sont `true`. Sinon erreur `FORBIDDEN`.
- Le chat est limité à 480 caractères par message.

**Critères d'acceptation :**

- Le joueur voit le `gameBoard` (question, choix, image, vidéo) selon le type de round actif.
- Le score du joueur et de son équipe est mis à jour en temps réel.
- Le bouton buzz est grisé si la fenêtre est fermée ou si le joueur a déjà buzzé.
- Sur QCM, le joueur voit ses choix (A, B, C, D…) et sélectionne avant de buzzer.

**Cas limites :**

- Si un joueur tente de modifier son pseudo alors que `allowRename === false`, l'API renvoie `FORBIDDEN`.
- Si un joueur tente de changer d'équipe alors que `allowTeamChange === false`, idem.
- En cas de déconnexion socket, la reconnexion doit ré-envoyer le même `playerToken` dans `handshake.auth.bearer` pour rejoindre la room `party:{id}:player`.

---

### 2.5 Interface animateur

**Comportement :**

- Route `/party/:partyId/admin` : authentification via `Authorization: Bearer {adminToken}` (récupéré depuis le fragment `#token=` au montage, puis stocké en sessionStorage).
- Actions disponibles :
  - Ouvrir/fermer fenêtre buzzer (`POST /api/parties/:partyId/host/buzz-window`).
  - Démarrer une manche (`POST /api/parties/:partyId/host/manche/play` avec `mancheId`), ce qui passe `state` en `round_active` et charge le pack quiz associé.
  - Avancer à la question suivante (`POST /api/parties/:partyId/host/cue/next`), qui incrémente `currentQuestionIndex` ou passe au round suivant si fin de round.
  - Mettre en pause / retour lobby (`POST /api/parties/:partyId/host/round/pause`), qui passe `state` en `lobby` et ferme la fenêtre buzzer.
  - Attribuer des points manuellement (`PATCH /api/parties/:partyId/host/players/:playerId/score` avec `delta`).
  - Valider un buzz (`POST /api/parties/:partyId/host/buzz-resolve` avec `playerId` et `verdict: "good"|"bad"`), ce qui ajoute ou retire des points selon le `verdict` et retire le joueur de `buzzOrder`.
  - Gérer le script de manches : ajouter (`POST /api/parties/:partyId/host/manche/add`), supprimer, réordonner, choisir le pack quiz ou vidéo YouTube ou vidéo directe.
  - Configurer les sons de buzzer (palettes good/bad, flags `playPlayerBuzzTone`, `echoPlayerBuzzOnHost`).
  - Activer/désactiver `autoOpenBuzzOnCueAdvance` (réouverture auto du buzzer sur question suivante) et `autoAdvanceQuizWhenAllBuzzed` (QCM : dès que tous ont buzzé, scoring auto + question suivante).
  - Relire un média (`POST /api/parties/:partyId/host/cue/replay`) qui incrémente `videoReplaySerial` pour forcer un rechargement côté clients.
  - Contrôle audio joueur (`POST /api/parties/:partyId/host/player-audio-control`) pour activer/désactiver `allowPlayerAudioControl` (lecture audio locale sur blind test).

**Acteurs :**

- Animateur (host) : authentifié par `adminToken`.

**Règles métier :**

- Toutes les routes `/host/*` vérifient le Bearer via `verifyAdminToken` (timing-safe égalité) ; sinon `UNAUTHORIZED`.
- Le passage en `round_active` marque `hasStartedRound = true` de façon irréversible ; si `closedAfterStart`, plus de join possible.
- L'ordre de `buzzOrder` reflète l'ordre d'arrivée des buzzs ; l'animateur peut résoudre chaque buzz dans l'ordre ou en désordre.
- Sur un quiz QCM avec `autoAdvanceQuizWhenAllBuzzed`, dès que tous les joueurs connectés ont buzzé, le serveur calcule pour chaque joueur si son `choiceIndex` correspond au `correctChoiceIndex` du pack, attribue les points (positif si bon, négatif si mauvais selon les valeurs du pack), et avance automatiquement à la question suivante.
- Les manches (`mancheScript`) sont ordonnées par l'animateur. Seule la manche dont `id === activeMancheId` est active. L'animateur peut ajouter des manches de type `pack_quiz` (référence un fichier JSON scanné sous `games/`), `youtube` (URL vidéo YouTube convertie en embed `youtube-nocookie.com`), ou `direct_video` (URL vidéo auto-hébergée sous `/games/` après validation path-traversal).

**Critères d'acceptation :**

- L'interface admin affiche le gameBoard enrichi (incluant `correctChoiceIndex` sur quiz, `revealTitle`/`revealArtist` sur blind test).
- L'animateur voit la file d'attente buzzer (`buzzOrder`) avec les pseudos et, sur QCM, la lettre et le label de la réponse choisie, ainsi qu'un indicateur ✓/✗.
- Les boutons « Bon » / « Mauvais » ou « +X points » / « -Y points » appliquent les deltas définis par le pack ou saisis manuellement.
- L'animateur peut naviguer dans le script de manches : ajouter, supprimer, réordonner (monter/descendre), jouer une manche.
- Le snapshot host contient `autoOpenBuzzOnCueAdvance` et `autoAdvanceQuizWhenAllBuzzed` pour afficher les toggles dans les réglages.

**Cas limites :**

- Si l'animateur tente de démarrer une manche dont le pack n'existe plus sur disque, erreur `PACK_NOT_FOUND`.
- Si l'animateur tente de valider un buzz pour un joueur qui n'est plus dans `buzzOrder`, erreur silencieuse (le joueur a peut-être déjà été résolu).
- Les manches vidéo YouTube : l'URL fournie doit matcher un pattern `youtube.com/watch?v=` ou `youtu.be/` ; sinon `BAD_YOUTUBE_URL`.
- Les manches vidéo directes : le serveur valide que l'URL pointe sous `{GAMES_DIR}/` (pas de path traversal) ; sinon `DIRECT_VIDEO_PATH_INVALID`.

---

### 2.6 Packs de jeux

**Comportement :**

- Au démarrage, le serveur scanne le répertoire `GAMES_DIR` (par défaut `./games/` relatif à la racine) à la recherche de fichiers `*.json`.
- Chaque pack est validé selon un schéma Zod : structure `{ id, title, version, rounds }` où chaque round a un `kind` (`quiz`, `video`, `free_buzz`, `image_buzz`, `progressive_guess`, `audio_blind`).
- L'animateur charge un pack en l'ajoutant au `mancheScript` (via `POST /api/parties/:partyId/host/manche/add` avec `kind: "pack_quiz"` et `packBasename`).
- À la lecture d'une manche pack, le serveur charge le pack en mémoire (`loadedPackId`), parcourt les rounds et questions, et alimente le `gameBoard` selon le type de round.

**Acteurs :**

- Animateur : choisit et charge un pack.
- Joueurs : voient le contenu projeté (question, choix, image, vidéo, audio).

**Règles métier :**

- Les packs sont en lecture seule ; aucune modification en runtime.
- Chaque round de quiz contient une liste de questions avec `prompt`, `choices`, `correct` (index de la bonne réponse), `points` (attribués en cas de bonne réponse), éventuel `imageUrl`.
- Les rounds vidéo (`kind: "video"`) contiennent `videoUrl` (URL YouTube ou auto-hébergée).
- Les rounds libres (`kind: "free_buzz"`) contiennent une liste de prompts sans choix multiples ; l'animateur ouvre le buzzer, écoute la réponse orale, et valide.
- Les rounds image buzz (`kind: "image_buzz"`) présentent une image plein écran ; l'animateur valide la réponse orale après buzz.
- Les rounds révélation progressive (`kind: "progressive_guess"`) présentent des indices visuels successifs (phase `clue`) puis une plaque finale (phase `reveal`) avec l'image et la réponse.
- Les rounds blind test (`kind: "audio_blind"`) diffusent un fichier audio ; le titre/artiste sont masqués côté joueur mais visibles côté animateur.

**Critères d'acceptation :**

- `GET /api/packs` renvoie la liste de tous les packs chargés (basename, id, titre, version, nombre de rounds).
- Le serveur refuse de démarrer si un pack JSON est invalide (log d'erreur, pack ignoré).
- Les packs peuvent inclure des ressources statiques (images, vidéos, audio) hébergées sous `/games/` (servi par le backend en prod via `fastify-static`).

**Cas limites :**

- Si un pack est supprimé du disque pendant qu'une partie l'utilise, l'animateur peut continuer de naviguer dans le pack chargé en mémoire mais ne pourra plus le récharger après un redémarrage serveur.
- Si un `imageUrl` ou `videoUrl` du pack est cassé (404), l'affichage échoue côté client (à gérer par un fallback UI ou un placeholder).

---

### 2.7 Chat

**Comportement :**

- Le chat est visible pour tous les joueurs et l'animateur.
- Les joueurs peuvent envoyer un message via `POST /api/parties/:partyId/me/chat` (JWT requis).
- L'animateur peut envoyer un message via `POST /api/parties/:partyId/host/chat` (Bearer admin requis).
- Le chat est limité aux phases `lobby` et `between_rounds` ; toute tentative en `round_active` est refusée (`CHAT_NOT_ALLOWED`).

**Acteurs :**

- Joueurs et animateur : écrivent des messages.

**Règles métier :**

- Message limité à 480 caractères.
- Chaque message est enregistré avec `{ id, playerId, displayName, text, at }`.
- Le snapshot contient `chatTail` (50 derniers messages).
- Les messages animateur ont `playerId: "host"` et `displayName: "Animateur"` (ou valeur configurable côté UI).

**Critères d'acceptation :**

- Les messages apparaissent en temps réel dans la room Socket.IO (`party:patch`).
- Le chat est désactivé (champ grisé) pendant `round_active`.

**Cas limites :**

- Si un joueur tente de chatter pendant `round_active`, le serveur renvoie `CHAT_NOT_ALLOWED`.
- Si le chat est vide, `chatTail` est `[]`.

---

### 2.8 Temps réel (Socket.IO)

**Comportement :**

- Le serveur expose un endpoint Socket.IO sur `/socket.io`.
- L'authentification se fait via `handshake.auth` : `{ partyId, bearer, role }` où `role` peut être `"player"`, `"admin"`, ou `"broadcast"`.
- Les rôles sont séparés en rooms : `party:{id}:player`, `party:{id}:admin`, `party:{id}:broadcast`.
- Événement unique émis : `party:patch` avec payload `PartyPublicSnapshot` (ou snapshot enrichi si admin).
- Le broadcast se fait après chaque mutation métier côté `PartyStore` (appels à `this.notify(party.id, party, meta?)`).

**Acteurs :**

- Joueurs : room `player`, snapshot joueur.
- Animateur : room `admin`, snapshot admin enrichi (inclut `correctChoiceIndex`, `revealTitle`, `autoOpenBuzzOnCueAdvance`, etc.).
- Spectateurs (broadcast) : room `broadcast`, snapshot joueur (pas d'auth bearer requis, mais `partyId` validé). Voir section 2.9 pour l'UI dédiée.

**Règles métier :**

- Si le `partyId` est invalide ou absent, auth refusée (event `connect_error`).
- Si le Bearer JWT joueur est invalide ou n'appartient pas à la partie, auth refusée.
- Si le Bearer admin ne correspond pas au `adminToken` de la partie, auth refusée.
- En cas de reconnexion, le client renvoie le même Bearer dans `handshake.auth` pour rejoindre automatiquement la bonne room.

**Critères d'acceptation :**

- Chaque action (join, buzz, kick, chat, delta score, avance question) déclenche un `party:patch` vers tous les clients de la room appropriée.
- Les clients désynchronisés (ex. après un refresh navigateur) peuvent relire le snapshot via `GET /api/parties/:partyId` (avec ou sans Bearer selon le rôle) puis se reconnecter au socket.

**Cas limites :**

- Si la partie est supprimée, le serveur envoie `party_deleted` puis efface la partie ; les clients doivent traiter cet événement et déconnecter proprement.
- Si un joueur est kické, il reçoit `player_kicked` avec son `playerId` ; il doit fermer la socket et afficher un message.

---

### 2.9 Grand écran spectateur (broadcast)

**Comportement :**

- Route `/party/:partyId/broadcast` : affichage plein écran optimisé pour vidéo-projecteur ou grand écran.
- Affiche en temps réel le snapshot de la partie : `gameBoard` (questions, choix QCM, images, vidéos), liste des joueurs, scores par équipe, état de la partie (`lobby`, `round_active`).
- Pas de contrôles animateur : interface en lecture seule, synchronisée via Socket.IO.
- L'interface admin contient un lien « 📺 Ouvrir la diffusion (nouvel onglet) » pointant vers cette route.

**Acteurs :**

- Spectateurs (public, projecteur) : visualisation en lecture seule.

**Règles métier :**

- Pas d'authentification Bearer requise : seul le `partyId` dans `handshake.auth` est nécessaire.
- Le client rejoint la room Socket.IO `party:{id}:broadcast` avec le rôle `"broadcast"`.
- Le snapshot reçu est le snapshot public (sans les informations réservées à l'animateur comme `correctChoiceIndex`, `revealTitle`/`revealArtist`, flags admin).

**Critères d'acceptation :**

- La route `/party/:partyId/broadcast` affiche en grand le `gameBoard` (prompt, choix QCM, image, vidéo) selon le type de round actif.
- En lobby, affiche le QR code de rejoindre, le code join, et le nombre de joueurs présents.
- Les scores équipes sont visibles en permanence.
- La mise à jour se fait en temps réel via `party:patch`.

**Cas limites :**

- Si la partie n'existe pas, message « Partie introuvable. »
- Si la partie est supprimée pendant la diffusion, le client reçoit `party_deleted` et doit afficher un message.

**Statut :** Livré (route `/party/:partyId/broadcast`, composant `Broadcast` dans `webserver/client/src/App.tsx`, room Socket.IO `broadcast`).

---

### 2.10 Authentification et autorisations

**Comportement :**

- **Joueur :** JWT signé avec `JWT_SECRET`, payload `{ pid, sub }`, durée illimitée tant que la partie existe. Le JWT est renvoyé à chaque appel nécessitant une authentification joueur (`@fastify/jwt` + hook `gatePlayerJwt`).
- **Animateur :** Bearer opaque (64 caractères hexa), généré à la création, vérifié par `timingSafeEqual` côté serveur. Transmis en fragment de hash côté client (`#token=`), puis en header `Authorization: Bearer …` pour toutes les routes `/host/*`.
- **Spectateur (broadcast) :** pas de Bearer requis, seulement le `partyId` dans `handshake.auth` ; rejoint la room `broadcast` pour la diffusion grand écran (voir section 2.9).

**Acteurs :**

- Joueur : possède un `playerToken` (JWT).
- Animateur : possède un `adminToken` (secret opaque).
- Spectateur : pas de token, rejoint en lecture seule via la route `/party/:partyId/broadcast`.

**Règles métier :**

- Les routes joueur (`/me/*`) vérifient le JWT et extraient `pid` / `sub` du payload.
- Les routes admin (`/host/*`) vérifient le Bearer via `verifyAdminToken`.
- Les routes publiques (`GET /api/parties/:partyId`, `GET /api/packs`) ne nécessitent pas d'auth (snapshot public renvoyé).

**Critères d'acceptation :**

- Un joueur ne peut pas appeler une route admin sans le `adminToken`.
- Un animateur ne peut pas accéder aux données d'une autre partie (vérif `partyId` dans les routes).
- Le JWT doit être validé côté serveur à chaque requête (`jwtVerify`).

**Cas limites :**

- Si le JWT est forgé ou corrompu, réponse `401 UNAUTHORIZED`.
- Si l'admin token est incorrect, idem `401 UNAUTHORIZED`.
- Si la partie n'existe plus (supprimée ou purgée), `404 NOT_FOUND`.

---

## 3. API

### 3.1 Routes HTTP publiques

| Méthode | Chemin | Description | Authentification |
|---------|--------|-------------|------------------|
| `GET` | `/api/health` | Santé du serveur | Aucune |
| `GET` | `/api/packs` | Liste des packs quiz disponibles | Aucune |
| `GET` | `/api/games/video-files` | Liste des vidéos auto-hébergées sous `GAMES_DIR` | Aucune |
| `GET` | `/api/avatars` | Catalogue des avatars (clé par défaut + liste) | Aucune |
| `GET` | `/api/sounds` | Catalogue des sons de buzzer (clé par défaut + liste) | Aucune |
| `GET` | `/api/parties/meta-by-code/:joinCode` | Résolution code → `partyId` + snapshot public | Aucune |
| `GET` | `/api/parties/:partyId` | Snapshot public de la partie ; snapshot admin si Bearer admin fourni | Facultative (Bearer admin enrichit le snapshot) |
| `POST` | `/api/parties` | Création de partie | Aucune |

**Erreurs notables :**

- `GET /api/parties/meta-by-code/:joinCode` : `NOT_FOUND` si code invalide.
- `GET /api/parties/:partyId` : `NOT_FOUND` si partie inexistante ; `UNAUTHORIZED` si Bearer fourni mais invalide.

---

### 3.2 Routes joueur (JWT requis)

| Méthode | Chemin | Description | Erreurs |
|---------|--------|-------------|---------|
| `POST` | `/api/parties/:partyId/join` | Rejoindre en tant que nouveau joueur | `NOT_FOUND`, `PARTY_FULL`, `PARTY_CLOSED`, `VALIDATION`, `INVALID_NAME`, `TEAM_REQUIRED`, `TEAM_OUT_OF_RANGE`, `TEAMS_DISABLED`, `INVALID_TEAM`, `AVATAR_INVALID`, `BUZZ_SOUND_INVALID` |
| `PATCH` | `/api/parties/:partyId/me` | Modifier pseudo / équipe / avatar / son buzzer (si autorisé) | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION`, `INVALID_NAME`, `TEAM_REQUIRED`, `TEAM_OUT_OF_RANGE`, `AVATAR_INVALID`, `BUZZ_SOUND_INVALID` |
| `POST` | `/api/parties/:partyId/me/chat` | Envoyer un message au chat | `UNAUTHORIZED`, `FORBIDDEN` (si JWT invalide ou `partyId` mismatch), `VALIDATION`, `CHAT_NOT_ALLOWED` (si hors lobby/entre-manches), `PLAYER_GONE` (si joueur kické) |
| `POST` | `/api/parties/:partyId/me/buzz` | Buzzer (ajoute le joueur à `buzzOrder` ; sur QCM, enregistre `quizChoiceIndex`) | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION`, `BUZZ_WINDOW_CLOSED`, `ALREADY_BUZZED` |

**Note :** Le JWT est vérifié via le hook `gatePlayerJwt` qui appelle `req.jwtVerify()` ; en cas d'échec, `401 UNAUTHORIZED`.

---

### 3.3 Routes animateur (Bearer admin requis)

| Méthode | Chemin | Description | Erreurs |
|---------|--------|-------------|---------|
| `POST` | `/api/parties/:partyId/host/round/pause` | Retour au lobby (ferme buzzer, passe en `lobby`) | `UNAUTHORIZED` |
| `POST` | `/api/parties/:partyId/host/buzz-window` | Ouvrir/fermer fenêtre buzzer (`{ open: boolean }`) | `UNAUTHORIZED`, `VALIDATION` |
| `POST` | `/api/parties/:partyId/host/buzz-auto-cue-advance` | Activer/désactiver réouverture auto du buzzer sur question suivante | `UNAUTHORIZED`, `VALIDATION` |
| `POST` | `/api/parties/:partyId/host/quiz-auto-all-buzzed` | Activer/désactiver scoring auto QCM quand tous ont buzzé | `UNAUTHORIZED`, `VALIDATION` |
| `POST` | `/api/parties/:partyId/host/buzz-resolve` | Valider un buzz (`{ playerId, verdict: "good"|"bad" }`) | `UNAUTHORIZED`, `VALIDATION`, `PACK_NOT_FOUND` (si pack chargé absent) |
| `POST` | `/api/parties/:partyId/host/cue/next` | Avancer à la question/round suivant | `UNAUTHORIZED`, `PACK_NOT_FOUND` |
| `POST` | `/api/parties/:partyId/host/cue/replay` | Relire média (incrémente `videoReplaySerial`) | `UNAUTHORIZED`, `PACK_NOT_FOUND` |
| `POST` | `/api/parties/:partyId/host/player-audio-control` | Activer/désactiver lecture audio locale joueur (`{ allowed: boolean }`) | `UNAUTHORIZED`, `VALIDATION`, `PACK_NOT_FOUND` |
| `POST` | `/api/parties/:partyId/host/sound-policy` | Configurer palettes bon/mauvais + flags echo/play (`{ allowedGoodKeys, allowedBadKeys, playPlayerBuzzTone, echoPlayerBuzzOnHost }`) | `UNAUTHORIZED`, `VALIDATION`, `BAD_SOUND_POLICY`, `BUZZ_SOUND_INVALID` |
| `PATCH` | `/api/parties/:partyId/host/players/:playerId/score` | Attribuer delta de points (`{ delta: number }`) | `UNAUTHORIZED`, `VALIDATION` |
| `POST` | `/api/parties/:partyId/host/players/:playerId/kick` | Kické un joueur | `UNAUTHORIZED` |
| `POST` | `/api/parties/:partyId/host/delete` | Supprimer la partie (irréversible) | `UNAUTHORIZED` |
| `POST` | `/api/parties/:partyId/host/manche/add` | Ajouter une manche (`{ kind, title, packBasename|url }`) | `UNAUTHORIZED`, `VALIDATION`, `PACK_NOT_FOUND`, `BAD_YOUTUBE_URL`, `DIRECT_VIDEO_PATH_INVALID` |
| `POST` | `/api/parties/:partyId/host/manche/remove` | Supprimer une manche (`{ id }`) | `UNAUTHORIZED`, `VALIDATION` |
| `POST` | `/api/parties/:partyId/host/manche/move` | Déplacer une manche (`{ id, direction: "up"|"down" }`) | `UNAUTHORIZED`, `VALIDATION` |
| `POST` | `/api/parties/:partyId/host/manche/play` | Lancer une manche (`{ id }`) | `UNAUTHORIZED`, `VALIDATION`, `PACK_NOT_FOUND` |
| `POST` | `/api/parties/:partyId/host/chat` | Envoyer un message animateur au chat | `UNAUTHORIZED`, `VALIDATION` |

**Note :** Toutes les routes `/host/*` appellent `verifyAdminToken` qui compare le Bearer fourni avec `party.adminToken` via `timingSafeEqual`.

---

### 3.4 Socket.IO

**Événement émis par le serveur :**

- `party:patch` : payload `PartyPublicSnapshot` (enrichi si room admin). Émis après chaque mutation métier (join, buzz, kick, chat, avance question, delta score, changement de round, etc.).

**Métadonnées optionnelles :**

Le serveur peut accompagner le `party:patch` de métadonnées spécifiques (non envoyées dans le payload JSON mais traitées séparément par le notifier) :

- `{ kind: "buzz_fx", playerId }` : pour jouer un son de buzzer côté animateur si echo activé.
- `{ kind: "answer_fx", url }` : pour jouer un son bon/mauvais côté animateur.
- `{ kind: "party_deleted" }` : pour déconnecter tous les clients.
- `{ kind: "player_kicked", playerId }` : pour déconnecter le joueur concerné.
- `{ kind: "buzz_verdict", playerId, verdict }` : pour afficher un toast sur validation buzz.
- `{ kind: "quiz_auto_toast", playerId, correct }` : pour afficher un toast auto-scoring QCM.

**Authentification handshake :**

```json
{
  "partyId": "uuid",
  "bearer": "jwt-ou-admin-token",
  "role": "player|admin|broadcast"
}
```

**Erreurs :**

- Si `partyId` absent ou invalide : `connect_error` "auth".
- Si `bearer` invalide pour le rôle : `connect_error` "auth".
- Si le rôle n'est pas reconnu : `connect_error` "auth".

---

## 4. À venir

### 4.1 Restant pour atteindre le MVP complet

#### 4.1.1 Affichage question/réponses côté joueur

**Statut :** restant (non implémenté).

**Description :** Actuellement, le snapshot contient les indices de round/question (`currentRoundIndex`, `currentQuestionIndex`) mais le `gameBoard` (objet complet avec `prompt`, `choices`, `imageUrl`, etc.) n'est pas toujours transmis côté joueur sur tous les types de rounds. L'animateur pilote le contenu projeté en salle ; les joueurs voient principalement l'état du buzzer et les scores.

**Hypothèse :** Pour un MVP complet, le snapshot joueur devrait inclure systématiquement le `gameBoard` complet (sauf les champs réservés animateur comme `correctChoiceIndex` ou `revealTitle`/`revealArtist` sur blind test). Cela permettrait aux joueurs de lire la question, voir les choix QCM, et consulter les illustrations sans dépendre d'un affichage en salle.

**Critères d'acceptation (hypothèse) :**

- Le `gameBoard` dans le snapshot joueur contient `kind`, `prompt`, `choices` (sur quiz), `imageUrl` (sur image_buzz / progressive_guess), etc., sans exposer les réponses correctes.
- L'UI joueur affiche la question et les choix en grand avant le buzz.
- Sur blind test, l'audio est disponible si `allowPlayerAudioControl === true` ; sinon, le joueur attend l'annonce orale en salle.

---

#### 4.1.2 Modification pseudo / équipe in-place (UX inline)

**Statut :** restant (API existante, UI manquante).

**Description :** L'API `PATCH /api/parties/:partyId/me` permet déjà de modifier `displayName`, `teamId`, `avatarKey`, `buzzSoundKey` en cours de partie (si `allowRename` / `allowTeamChange` sont activés). Actuellement, l'UI joueur propose un bouton « Modifier profil » qui redirige vers `/join?code=…` pour re-rejoindre. Cette UX est fonctionnelle mais implique de re-saisir pseudo/équipe.

**Hypothèse :** Un formulaire inline dans la vue joueur (`/party/:partyId/play`) permettrait de modifier directement le pseudo et l'équipe sans quitter la page, en appelant `PATCH /api/parties/:partyId/me`. Les flags `allowRename` / `allowTeamChange` contrôleraient la visibilité/activation des champs.

**Critères d'acceptation (hypothèse) :**

- Si `allowRename === true`, un champ « Pseudo » éditable apparaît dans un panneau profil.
- Si `allowTeamChange === true`, un sélecteur d'équipe (1 à `maxTeams`) apparaît.
- À la validation, l'UI appelle `PATCH /api/parties/:partyId/me` avec le JWT joueur.
- En cas de succès, le snapshot mis à jour est reçu via `party:patch` et l'UI se rafraîchit.
- En cas d'erreur (`FORBIDDEN`, `VALIDATION`), un message d'erreur s'affiche.

---

#### 4.1.3 Tests unitaires (Vitest)

**Statut :** Livré partiellement (120 tests unitaires, couverture restante à compléter).

**Description :** Suite de tests unitaires Vitest couvrant la logique métier et les utilitaires. Le code de production n'a pas été modifié par l'ajout des tests.

**Modules couverts (livrés) :**

- `partyLogic` : scores équipes, snapshot public, codes équipes.
- `free_buzz` : validation des manches libres.
- `readBearer` : extraction du token Bearer depuis les headers.
- `replyDomain` : gestion des erreurs domaine.
- Catalogue de sons (`sounds`).
- `loadConfig` : chargement de la configuration.

**Modules non couverts (restant à implémenter) :**

- `store.ts` : tests d'intégration du `PartyStore` (mutations, broadcast, purge).
- Routes HTTP (`routesParty.ts`, etc.) : tests des endpoints REST.
- Socket.IO (`socket.ts`) : tests d'intégration Socket.IO vérifiant l'émission de `party:patch` après actions (join, buzz, kick, chat).

**Critères d'acceptation pour la couverture restante (hypothèse) :**

- Tests `store.ts` : vérifier les mutations (join, buzz, kick, delta score) et la synchronisation du snapshot.
- Tests routes : vérifier les validations Zod, les codes d'erreur HTTP, et les droits d'accès (JWT joueur, Bearer admin).
- Tests Socket.IO : un client de test se connecte, effectue une action via l'API HTTP, et vérifie la réception de `party:patch` avec le bon contenu.

---

#### 4.1.4 Tests end-to-end (Playwright)

**Statut :** restant (aucun test e2e présent).

**Description :** Aucun test Playwright n'est configuré. L'objectif est de couvrir un scénario happy path : création de partie, rejoindre avec 2 joueurs, lancer une manche quiz, ouvrir le buzzer, buzzer, valider la réponse, vérifier les scores.

**Hypothèse :** Installer Playwright, ajouter un fichier `e2e/happy-path.spec.ts` qui automatise les actions navigateur (formulaire création, scan QR ou saisie code, clic buzzer, validation animateur).

**Critères d'acceptation (hypothèse) :**

- Le test crée une partie via l'UI.
- Deux navigateurs clients rejoignent via le `joinCode`.
- L'animateur lance une manche quiz, ouvre le buzzer.
- Les deux joueurs buzzent (un après l'autre).
- L'animateur valide les deux réponses (une bonne, une mauvaise).
- Les scores sont vérifiés dans l'UI (un joueur a +X points, l'autre -Y ou 0).

---

### 4.2 Hors scope MVP (backlog produit)

#### 4.2.1 Comptes utilisateurs / OAuth persistants

**Statut :** hors MVP.

**Description :** Actuellement, les joueurs et l'animateur n'ont pas de compte persistant. Chaque partie est éphémère (purge après inactivité). L'authentification se limite à un JWT temporaire (joueur) et un token opaque (admin) valables uniquement pour la durée de la partie.

**Hypothèse :** Une future extension permettrait de créer des comptes utilisateurs (OAuth Google/GitHub), d'associer un profil permanent (pseudo, avatar, historique de parties), et de sauvegarder les parties en base de données (PostgreSQL ou MongoDB) plutôt qu'en mémoire.

---

#### 4.2.2 Plusieurs familles de mini-jeux dans une même partie

**Statut :** hors MVP.

**Description :** Actuellement, une partie ne gère qu'un type de jeu à la fois (quiz). Le système de manches (`mancheScript`) permet déjà de charger plusieurs packs ou vidéos YouTube successivement, mais chaque manche est un quiz ou une vidéo.

**Hypothèse :** À l'avenir, on pourrait imaginer des mini-jeux différents (ex. dessin collaboratif, jeux de rapidité type « qui clique le plus vite », etc.) insérés comme manches dans le script. Cela nécessiterait un refactoring du `gameBoard` et de la logique métier pour supporter des types de rounds très différents.

---

#### 4.2.3 Internationalisation (i18n)

**Statut :** hors MVP.

**Description :** Tout le texte UI et les messages d'erreur sont en français. Aucun système i18n n'est en place.

**Hypothèse :** Intégrer `react-i18next` côté front et `i18next` côté back permettrait de supporter plusieurs langues (anglais, espagnol, etc.). Les packs quiz devraient également être traduits ou marqués par langue.

---

#### 4.2.4 Cluster Redis pour multi-instances

**Statut :** hors MVP.

**Description :** L'état des parties est en mémoire process (`PartyStore`). Impossible de scaler horizontalement sans perdre l'état.

**Hypothèse :** Utiliser Redis (ou Redis Cluster) comme store partagé permettrait de déployer plusieurs instances du serveur derrière un load balancer, avec persistance de l'état. Le socket.io-redis adapter devrait être intégré pour distribuer les événements `party:patch` entre instances.

---

## 5. Questions ouvertes

### 5.1 Gestion de la déconnexion joueur prolongée

**Question :** Si un joueur se déconnecte (socket fermé) mais que son JWT reste valide, doit-il rester dans la liste des joueurs ? Faut-il un timeout d'inactivité pour le retirer automatiquement ?

**Hypothèse :** Actuellement, un joueur reste dans la partie tant qu'il n'est pas kické ou que la partie n'est pas supprimée. Une future évolution pourrait marquer les joueurs déconnectés (flag `connected: boolean`) et les retirer après un délai d'inactivité (ex. 10 minutes).

---

### 5.2 Archivage et statistiques de parties

**Question :** Les parties sont purgées après 48h d'inactivité. Doit-on archiver les résultats (scores finaux, historique des buzzes) pour consultation ultérieure ?

**Hypothèse :** Pour un usage MVP, l'archivage n'est pas nécessaire. Une évolution future pourrait enregistrer un snapshot final dans une base de données (scores, classement, timestamp) accessible via un tableau de bord historique.

---

### 5.3 Modération du chat

**Question :** Le chat est libre ; pas de filtrage ou modération des messages. Doit-on intégrer un système de signalement ou de bannissement de mots ?

**Hypothèse :** Pour des usages privés (soirées entre amis), la modération n'est pas critique. Pour un déploiement public, un système de modération (mots-clés interdits, signalement, ban) devrait être envisagé.

---

### 5.4 Validation des packs par la communauté

**Question :** Les packs sont hébergés localement sous `games/`. Doit-on permettre aux utilisateurs de téléverser leurs propres packs via l'UI admin ?

**Hypothèse :** Pour le MVP, les packs sont gérés manuellement par l'administrateur du serveur (ajout de fichiers JSON sur le disque, redémarrage serveur). Une évolution future pourrait intégrer un système d'upload de packs via l'UI, avec validation Zod côté serveur avant ajout au catalogue.

---

### 5.5 Rejoindre une partie déjà lancée

**Question :** Actuellement, si `closedAfterStart === true`, les joueurs ne peuvent plus rejoindre après le premier lancement. Doit-on permettre un mode « rejoin » où un joueur déconnecté peut revenir sans compter comme un nouveau join ?

**Hypothèse :** Un système de « rejoin » nécessiterait de stocker le `playerId` dans le JWT et de vérifier si ce joueur existe déjà dans la partie. Si oui, ne pas incrémenter `playerCount`. Cela éviterait de bloquer un joueur qui a simplement rafraîchi son navigateur. Non implémenté pour le MVP.

---

## Annexe : Glossaire technique

- **Party :** Unité centrale du modèle métier ; contient `id`, `joinCode`, `adminToken`, liste des joueurs, état (`lobby`, `round_active`, `between_rounds`), scores, buzzer, chat, script de manches.
- **Player :** Participant à une partie ; possède `id`, `displayName`, `teamId`, `score`, `avatarKey`, `buzzSoundKey`.
- **Snapshot :** Représentation JSON de l'état d'une partie à un instant T, transmise via `party:patch` ou en réponse HTTP. Peut être public (joueur) ou enrichi (admin).
- **GameBoard :** Objet décrivant le contenu visible (question, choix, image, vidéo, audio) pour le round actif. Type dépendant du `kind` du round (`quiz`, `video`, `free_buzz`, `image_buzz`, `progressive_guess`, `audio_blind`, `iframe`, `youtube`).
- **Pack quiz :** Fichier JSON hébergé sous `games/`, contenant `{ id, title, version, rounds }`.
- **Manche :** Item du script de l'animateur (`mancheScript`) ; peut être un pack quiz, une vidéo YouTube, une vidéo directe, ou une iframe (hors-scope MVP).
- **JWT :** JSON Web Token signé avec `JWT_SECRET`, contenant `{ pid, sub }` pour l'authentification joueur.
- **Bearer admin :** Token opaque (64 caractères hexa) généré à la création, vérifié par `timingSafeEqual`.
- **Socket.IO room :** Espace de diffusion pour `party:patch` ; trois rooms par partie : `party:{id}:player`, `party:{id}:admin`, `party:{id}:broadcast`.
