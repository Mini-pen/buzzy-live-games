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

## 4. Évolutions demandées

Cette section regroupe les évolutions produit décidées, au-delà du MVP actuel. Ces fonctionnalités sont priorisées pour enrichir l'expérience utilisateur et faciliter la création de contenus par la communauté.

---

### 4.1 Import de jeux au format ZIP

**Comportement :**

- L'animateur peut importer un fichier ZIP contenant un pack de jeu (fichier JSON + ressources médias : images, audio, vidéo).
- Le ZIP est décompressé côté serveur ou client, et les ressources sont rendues disponibles pour la partie en cours.
- Les packs importés restent locaux à la session : pas de sauvegarde distante de l'état de la partie ni des packs importés.
- L'import ZIP complète le scan existant du répertoire `games/` : les packs JSON déjà sur disque restent chargés au démarrage ; les packs ZIP s'ajoutent dynamiquement à la liste des packs disponibles.

**Acteurs :**

- Animateur : importe un ZIP depuis l'interface admin.

**Règles métier :**

- Le ZIP doit contenir au minimum un fichier JSON de pack valide (structure `{ id, title, version, rounds }`).
- Les chemins des ressources dans le JSON (ex. `imageUrl`, `videoUrl`, `audioUrl`) doivent pointer vers des fichiers relatifs présents dans le ZIP (ex. `images/question1.jpg`).
- Les ressources manquantes ou chemins invalides entraînent une erreur de validation au moment de l'import.
- Le pack importé est indexé sous un identifiant unique (basé sur `id` + hash du contenu ou timestamp) pour éviter les collisions avec les packs sur disque.
- Limite de taille du ZIP : configurable (ex. 50 Mo par défaut) pour éviter les abus.

**Critères d'acceptation :**

- L'interface admin propose un bouton « Importer un pack (ZIP) ».
- À la sélection d'un fichier ZIP, le serveur valide la structure (JSON valide, ressources présentes).
- En cas de succès, le pack apparaît dans la liste des packs disponibles (`GET /api/packs` ou équivalent).
- L'animateur peut ajouter une manche issue du pack importé au `mancheScript`.
- Les ressources du pack (images, vidéos, audio) sont servies correctement pendant la partie.
- En cas d'erreur (JSON invalide, fichier manquant, ZIP corrompu), un message d'erreur explicite est affiché.

**Cas limites :**

- Si le ZIP contient plusieurs fichiers JSON, seul le premier valide est chargé (ou erreur si ambigu).
- Si deux packs importés ont le même `id`, le second est refusé ou suffixé automatiquement.
- Les packs importés ne persistent pas entre redémarrages serveur (sauf si sauvegardés explicitement dans `GAMES_DIR`).

---

### 4.2 Éditeur de jeux intégré

**Comportement :**

- L'animateur peut charger un pack existant (ZIP ou JSON scanné) dans un éditeur intégré à l'interface admin.
- L'éditeur permet d'inspecter la structure du pack, d'ajouter/modifier/supprimer des rounds et questions, et d'uploader des images depuis des URLs (avec redimensionnement automatique pour limiter le poids).
- À la fin de l'édition, l'animateur peut exporter le pack sous forme de ZIP (JSON + ressources médias), prêt à être réutilisé dans une autre partie ou partagé.

**Acteurs :**

- Animateur : édite et corrige un pack avant ou pendant une soirée.

**Règles métier :**

- L'éditeur valide en temps réel la structure du pack (schéma Zod).
- Upload d'images depuis URL : le serveur télécharge l'image, la redimensionne (ex. max 1920×1080, compression JPEG/WebP), et l'ajoute au pack.
- Limite de poids par image : configurable (ex. 500 Ko après compression).
- Les modifications sont appliquées en mémoire ; l'export ZIP fige l'état édité.
- Le pack édité peut être importé immédiatement dans la partie courante ou sauvegardé localement par l'animateur.

**Critères d'acceptation :**

- L'interface admin propose un bouton « Éditer ce pack » pour chaque pack listé.
- L'éditeur affiche la structure du pack : liste des rounds, questions, choix, points, ressources.
- Les champs sont éditables (texte, points, choix, URL des ressources).
- Un bouton « Ajouter une image depuis URL » déclenche le téléchargement, redimensionnement, et ajout au pack.
- Un bouton « Exporter en ZIP » génère un fichier téléchargeable contenant le JSON et les ressources.
- Les validations Zod sont affichées en temps réel (erreurs en rouge).

**Cas limites :**

- Si l'URL d'image est inaccessible (404, timeout), erreur explicite.
- Si l'image dépasse la limite de poids même après compression, erreur ou avertissement.
- Les modifications non exportées sont perdues si l'animateur quitte l'éditeur (avertissement avant fermeture).

---

### 4.3 Programmation d'une soirée complète

**Comportement :**

- L'animateur peut planifier une séquence complète d'activités (manches, vidéos, pauses) avant l'événement.
- Un mode « Lecture automatique » (Play mode) exécute la soirée de bout en bout, avec transitions animées entre activités.
- L'animateur conserve le contrôle : pause, accélération, saut d'activité, retour en arrière.
- Ce mode va au-delà de l'auto-avancement actuel (avance automatique sur QCM quand tous ont buzzé, bouton « Question suivante ») : il enchaîne automatiquement les manches, gère les pauses, et affiche des transitions visuelles.

**Acteurs :**

- Animateur : configure et lance le mode automatique.

**Règles métier :**

- La séquence est définie dans le `mancheScript` étendu : chaque item peut être une manche (pack, vidéo, iframe) ou une transition (pause, animation).
- Le mode automatique respecte les durées configurées (ex. 30 secondes par question, 5 minutes par manche).
- L'animateur peut interrompre le mode automatique à tout moment (bouton « Pause » / « Reprendre »).
- Les transitions sont des animations visuelles (ex. fondu, compteur, splash screen) affichées sur le grand écran spectateur et dans l'interface joueur.

**Critères d'acceptation :**

- L'interface admin propose un bouton « Mode lecture automatique » lorsque le `mancheScript` contient au moins une manche.
- En mode automatique, la soirée s'enchaîne : fin d'une manche → transition → manche suivante.
- Les transitions sont visibles sur `/party/:partyId/broadcast` et dans l'interface joueur.
- L'animateur voit une barre de progression et des contrôles (pause, avance rapide, retour).
- Le mode automatique peut être désactivé à tout moment sans perdre la progression.

**Cas limites :**

- Si une manche nécessite une intervention manuelle (ex. validation de buzz), le mode automatique attend l'action de l'animateur avant de continuer.
- Si l'animateur modifie le `mancheScript` pendant le mode automatique, les changements sont pris en compte après la manche en cours.

**Statut :** Livré et testé.

---

### 4.4 Introductions animées et tutoriels automatiques

**Comportement :**

- Avant chaque type de jeu (quiz, blind test, révélation progressive, etc.), une courte introduction animée explique la mécanique aux joueurs.
- Le tutoriel est affiché sur le grand écran spectateur et dans l'interface joueur.
- Chaque type de jeu est marqué dans les métadonnées comme nécessitant une validation manuelle de l'animateur (points attribués manuellement) ou entièrement automatique (scoring sans intervention).
- Chaque jeu peut être lancé en mode « Normal » (avec tutoriel et contrôle animateur) ou « Autonome » (sans tutoriel, enchaînement automatique).

**Acteurs :**

- Animateur : choisit le mode de lancement (normal ou autonome).
- Joueurs : voient le tutoriel avant le premier round d'un type de jeu.

**Règles métier :**

- Les tutoriels sont des animations pré-conçues (vidéo courte, animation SVG, ou slides) stockées côté serveur.
- Le tutoriel est affiché uniquement au premier lancement d'un type de jeu dans une partie (ou si l'animateur force l'affichage).
- Les jeux marqués « automatique » (ex. QCM avec `autoAdvanceQuizWhenAllBuzzed`) enchaînent sans attendre l'animateur.
- Les jeux marqués « manuel » (ex. questions libres) attendent la validation de l'animateur après chaque buzz.

**Critères d'acceptation :**

- Chaque type de jeu (`quiz`, `audio_blind`, `progressive_guess`, etc.) a un tutoriel associé.
- Au lancement d'une manche, si c'est la première du type dans la partie, le tutoriel s'affiche.
- L'interface admin affiche un badge « Auto » ou « Manuel » pour chaque manche du script.
- L'animateur peut choisir « Lancer en mode autonome » (skip tutoriel, enchaînement auto) ou « Lancer en mode normal ».
- En mode autonome, aucun tutoriel n'est présenté, ni sur l'écran de diffusion (broadcast) ni dans l'interface joueur.

**Cas limites :**

- Si l'animateur skip le tutoriel manuellement, il n'est pas affiché.
- Si un joueur rejoint après le tutoriel, il ne le voit pas (sauf si l'animateur relance explicitement).

**Statut :** Livré et testé — suite Vitest rejouée sur main à `c1e8408` : 288/288 tests verts (20 fichiers), dont `tutorials` et `tutorialLaunch` (mode autonome sans tutoriel ni marquage `seenGameKinds`).

---

### 4.5 Alertes sonores et visuelles de victoire/défaite, compte à rebours configurable

**Comportement :**

- **Alertes sonores :** Les sons de validation bon/mauvais (déjà en place) sont joués automatiquement à la validation d'un buzz ou à la fin d'une question en mode automatique. Si ce comportement n'est pas encore implémenté, l'ajouter : jouer le son `good` si le verdict est bon, `bad` sinon, côté animateur et/ou joueur selon la configuration.
- **Visuel de victoire :** Lorsque le temps imparti pour une question ou une manche se termine, un écran de victoire affiche le nom du gagnant (joueur ou équipe avec le meilleur score) sur le grand écran spectateur et dans l'interface joueur.
- **Compte à rebours avant question :** Un compte à rebours configurable (3 à 10 secondes) démarre avant chaque question, uniquement lorsque tous les participants ont marqué « Prêt ». Le buzzer reste fermé pendant le compte à rebours et s'ouvre automatiquement à la fin.

**Acteurs :**

- Animateur : configure la durée du compte à rebours et active/désactive les alertes.
- Joueurs : marquent « Prêt », voient le compte à rebours, et peuvent buzzer une fois celui-ci terminé.

**Règles métier :**

- Le compte à rebours est affiché en grand sur le grand écran et dans l'interface joueur.
- Le buzzer est fermé (`buzzWindowOpen = false`) pendant le compte à rebours ; il s'ouvre automatiquement à 0.
- Le bouton « Prêt » est affiché dans l'interface joueur en début de question ; le compte à rebours démarre lorsque tous les joueurs connectés ont cliqué « Prêt ».
- Si un joueur ne marque pas « Prêt » après un timeout (ex. 30 secondes), le compte à rebours démarre quand même (majorité ou timeout).
- Le visuel de victoire affiche le pseudo du gagnant, son avatar, et son score final (ou celui de l'équipe).

**Critères d'acceptation :**

- Les sons bon/mauvais sont joués automatiquement à la validation de buzz (si pas déjà le cas).
- Le visuel de victoire s'affiche sur `/party/:partyId/broadcast` et dans l'interface joueur à la fin d'une manche ou d'une question (selon configuration).
- Un champ « Durée du compte à rebours » (3 à 10 secondes) est configurable dans les réglages animateur.
- Le bouton « Prêt » apparaît dans l'interface joueur avant chaque question.
- Le compte à rebours s'affiche en grand (chiffres animés) et le buzzer s'ouvre à la fin.

**Cas limites :**

- Si aucun joueur ne marque « Prêt », le compte à rebours démarre après un timeout (30 secondes par défaut).
- Si un joueur se déconnecte pendant le compte à rebours, il n'est pas compté dans le « tous prêts ».
- Le visuel de victoire peut être skipé manuellement par l'animateur (bouton « Suivant »).

**Statut :** Livré et testé — compte à rebours grand écran, écran du gagnant automatique, sons du verdict et réglage de durée (PR 18 et 19) ; suite Vitest rejouée sur main à `06e2689` : 288/288 tests verts.

---

### 4.6 Configuration de l'affichage projeté depuis une fenêtre miniature

**Statut :** Décisions Minipen (7 oct. 2026) et complément Design UI intégrés — rien d'implémenté. Les quatre anciens points ouverts sont fermés.

**Comportement :**

- L'interface admin (`/party/:partyId/admin`) affiche une fenêtre miniature en lecture seule du vrai rendu de l'écran projeté (`/party/:partyId/broadcast`), avec la même logique de rendu que le composant React `Broadcast` (pas une maquette). Elle se construit depuis le snapshot admin déjà reçu. Elle ne rejoint pas la room Socket.IO `broadcast` et n'ouvre pas de connexion de diffusion en plus.
- La miniature est redimensionnable et muette (les sons ne doivent pas jouer deux fois sur la machine de l'animateur).
- L'animateur configure l'affichage depuis le panneau « Affichage projeté ». Cinq réglages sont enregistrés dans l'état de la partie et diffusés via `party:patch`. Les deux réglages de scores sont **indépendants** (l'ancien réglage unique « Masquer les scores numériques » est remplacé) :
  1. **Afficher le classement** (oui/non) : visibilité du footer (file de buzz et classement) sur le grand écran.
  2. **Scores sur le grand écran** (On/Off, défaut **On**) : réglage A. Off = rangs seuls (1er, 2ème, 3ème…) sur le grand écran, l'écran du gagnant automatique du §4.5 côté diffusion, et le classement final côté diffusion. On = scores numériques sur ces surfaces.
  3. **Scores côté joueurs** (On/Off, défaut **On**) : réglage B, distinct de A. Source de vérité : le champ de partie `playerShowScores`, écrit seulement par l'animateur, lu par tous les téléphones. Ce n'est pas une préférence par joueur et ce n'est pas le même booléen que A.
  4. **Mettre en avant le gagnant du buzz** (oui/non) : highlight visuel du gagnant désigné à la décision du §4.8 (jamais pendant la fenêtre d'attente, pas de gagnant provisoire). Si ce réglage est Off, l'écart de temps 1er/2e du §4.8 est masqué aussi.
  5. **Vue par équipe / Vue individuelle** : réglage global de partie, et valeur optionnelle par manche dans `mancheScript` (`broadcastViewMode` : `"team"`, `"individual"`, ou `null` pour suivre le global). La valeur de la manche l'emporte pendant cette manche. Changer le global en cours de manche n'écrase pas la valeur de la manche.

**Acteurs :**

- Animateur : configure l'affichage projeté et les scores côté joueurs depuis l'interface admin.
- Joueur : voit ou non ses scores selon le réglage B ; déplie la table, choisit le tri, et peut masquer le bloc sur son téléphone (préférence locale).

**Règles métier :**

- Les réglages de partie sont des champs nouveaux de `Party` (rien de tout cela n'existe dans le code aujourd'hui) :

  | Réglage UI | Champ | Défaut |
  |---|---|---|
  | Afficher le classement | `broadcastShowRanking` | `true` |
  | Scores sur le grand écran | `broadcastShowScores` | `true` |
  | Scores côté joueurs | `playerShowScores` | `true` |
  | Mettre en avant le gagnant du buzz | `highlightBuzzWinner` | `true` |
  | Vue globale | `broadcastViewModeGlobal` | `"team"` si `maxTeams !== null`, sinon `"individual"` |
  | Vue de manche | `MancheCatalogItem.broadcastViewMode` | `null` (suivre le global) |

- `broadcastShowScores` et `playerShowScores` sont deux booléens distincts. Changer l'un ne modifie pas l'autre. La source de vérité des scores téléphone est `playerShowScores` pour toute la partie, pas une copie du réglage grand écran.
- Chaque modification animateur déclenche un `party:patch`. Le grand écran (room `broadcast`) et les téléphones (room `player`) appliquent le champ qui les concerne en moins d'une seconde, sans recharger. L'admin relit les mêmes champs dans son snapshot.
- Au rechargement du grand écran ou à sa reconnexion, les réglages de diffusion sont réappliqués depuis le snapshot. Au rechargement de l'admin, les cases reflètent le snapshot. Au rechargement d'un téléphone, `playerShowScores` est relu depuis le snapshot ; la préférence locale Masquer/Afficher n'est pas dans ce snapshot.
- **Cohérence avec le §4.8 (décision Minipen, point fermé) :**
  - Le highlight (`highlightBuzzWinner`) ne s'affiche qu'après la décision finale du §4.8, jamais pendant la fenêtre d'attente, sans gagnant provisoire.
  - Aujourd'hui le grand écran affiche la file `buzzOrder` dès qu'un joueur buzze. Cette règle est remplacée : le surlignage n'apparaît qu'après la décision, et reste visible jusqu'à la question suivante ou la réouverture du buzzer. L'ancienne formulation « visible uniquement si le buzzer est ouvert et qu'un joueur a buzzé » contredit le §4.8 ; elle est abandonnée.
  - L'écart de temps 1er/2e du §4.8 (affiché seulement s'il est strictement inférieur à 1 s, jamais s'il n'y a qu'un buzz) **n'est affiché que si `highlightBuzzWinner` est `true`**. S'il est `false`, l'écart est masqué. Point fermé.
- **Scores sur le grand écran (`broadcastShowScores`, réglage A) :**
  - `false` : rangs seuls sur le grand écran (footer, écran du gagnant §4.5 côté diffusion, classement final `between_rounds` ou `ended`). Pas de score numérique sur ces surfaces.
  - `true` : scores numériques, comme le rendu actuel du footer (`teamScores`).
  - L'admin (`/party/:partyId/admin`) affiche toujours les scores numériques (aside, panneau Scores, file de buzz). A et B ne changent pas l'admin.
  - Si `broadcastShowRanking` est `false`, la case « Scores sur le grand écran » est grisée. Sa valeur (`broadcastShowScores`) est conservée et reprend effet quand le classement réapparaît. La case « Scores côté joueurs » n'est pas grisée : elle ne dépend pas du classement diffusé.
- **Scores côté joueurs (`playerShowScores`, réglage B) — décision Minipen + Design UI :**
  - `true` (défaut) : bas de l'écran `/party/:partyId/play`, un bloc épinglé, toujours visible tant que le joueur ne l'a pas masqué localement.
    - Ligne compacte : `Moi · {score} pts`. Si `teamId` n'est pas `null`, on ajoute `Éq. {teamId} · {teamScores[teamId]} pts`. Les équipes n'ont pas de nom dans le modèle (`Player.teamId` seulement) : le « Nom » du croquis Design UI est ce numéro. Chevron `▾` à droite.
    - Le score perso n'est pas répété dans la bande d'identité (`bz-identity-score`) : il vit dans ce bloc.
    - Clic sur la ligne compacte : la table se déplie. Reclic : elle se replie. L'état déplié/replié repart replié à chaque chargement de la page (non persisté).
    - Table dépliée, deux onglets : `Par score` (score total croissant, le plus petit en premier ; à score égal, `displayName` en locale `fr`) et `Par équipe` (équipes par `teamId` croissant, puis score croissant dans l'équipe ; les `teamId === null` sont groupés sous le titre **Sans équipe**). Onglet initial : `Par score`. Si `maxTeams === null`, l'onglet `Par équipe` n'est pas proposé.
    - Bouton `Masquer` : cache tout le bloc (ligne compacte et table). Il ne reste qu'un bouton `Afficher` en bas d'écran, sans aucun score. Préférence **locale au navigateur**, non envoyée au serveur, non partagée, non présente dans `party:patch`. Elle survit au rechargement de cette page sur ce navigateur et ne suit pas le joueur sur un autre appareil.
  - `false` : aucun bloc de scores, aucun score dans la bande d'identité, aucun score sur l'écran du gagnant du téléphone. Pas de rang de remplacement sur le téléphone (les rangs sont réservés au grand écran quand A est Off). Les autres joueurs et le grand écran ne changent pas.
  - L'écran du gagnant §4.5 suit la surface : grand écran selon A (score ou rang), téléphone selon B (score si On, ligne de score absente si Off).
- **Vue équipe / individuelle :**
  - Pendant une manche active, `mancheScript[i].broadcastViewMode !== null` l'emporte ; sinon `broadcastViewModeGlobal`.
  - Si `maxTeams === null`, le bouton « Vue par équipe » n'est pas proposé et la vue individuelle est forcée.
  - **Rendu actuel du grand écran (défaut à reproduire quand les scores sont On et la vue est équipe) :** le footer de `Broadcast` affiche les scores d'équipe (`teamScores`) quand `teamEntries.length > 0`. Le lobby affiche le nombre de joueurs, pas la liste. En `between_rounds` ou `ended`, seuls les totaux d'équipe sont affichés. La vue individuelle n'existe pas encore dans le code.
  - **Vue individuelle (à implémenter) :** liste de tous les joueurs, score décroissant, pseudo, avatar, et score numérique si A est On, rang seul si A est Off.
  - **Joueur sans équipe (décision Minipen, point fermé) :** en vue équipe, les joueurs `teamId === null` ne sont pas dans `teamScores`. Ils apparaissent dans une section titrée **Sans équipe** (pseudo, et score ou rang selon A). La section est absente s'il n'y a aucun joueur sans équipe.
  - **Équipes activées en cours de partie (décision Minipen, point fermé) :** pas de bascule automatique de `broadcastViewModeGlobal`. Aujourd'hui `maxTeams` est fixé à la création (pas de PATCH, §2.1) : cette règle s'applique au moment où une partie passe de `maxTeams === null` à des équipes activées, sans inventer ici l'API qui ferait ce passage. L'admin affiche un toast `Passer en vue par équipe ?` avec `Oui` et `Plus tard`. `Oui` met `broadcastViewModeGlobal` à `"team"` sans écraser un `broadcastViewMode` de manche. `Plus tard` ferme le toast sans changer la vue. Le toast n'est pas montré si la vue globale est déjà `"team"`, ni sur le grand écran, ni sur les téléphones. Un seul toast par passage « équipes activées ».
- **Miniature et panneau (Design UI) :**
  - Carte « Aperçu diffusion » dans la colonne principale, sous le hero (le lien « Ouvrir la diffusion » reste dans le hero), avant le plateau. 16:9, largeur 320 à 640 px, redimensionnable par le coin. L'aside (file de buzz, scores admin) ne change pas.
  - Construit depuis le snapshot/patch admin déjà reçu. Pas de socket vers la room `broadcast`. Le serveur (`webserver/src/index.ts`) ne compte ni n'affiche le nombre de clients de cette room.
  - Muette : pas de son de buzz (`party:buzz_fx`), de verdict (`party:answer_fx`, `playVerdictSounds`), de compte à rebours, ni de lecteur audio. Pictogramme « son coupé » dans un coin.
  - Lecture seule : pas de bouton « retour tableau », pas de lien cliquable.
  - Panneau « Affichage projeté » collé sous la miniature :
    - case `Afficher le classement` ;
    - case `Scores sur le grand écran` (défaut On), grisée si le classement est masqué, valeur conservée ;
    - case `Scores côté joueurs` (défaut On), jamais grisée par le classement ;
    - boutons `Vue individuelle` / `Vue par équipe` (le bouton équipe disparaît si `maxTeams === null`) ;
    - case `Mettre en avant le gagnant du buzz`.

**Critères d'acceptation :**

**Réglages et persistance :**

1. **CA-1 :** Passer `broadcastShowRanking`, `broadcastShowScores`, `highlightBuzzWinner` ou `broadcastViewModeGlobal` change le grand écran en moins d'1 s sans recharger (`party:patch`). Passer `playerShowScores` change les téléphones ouverts en moins d'1 s sans recharger, et ne change pas le grand écran.
2. **CA-2 :** Les champs du tableau ci-dessus sont persistés dans `Party`. Après redémarrage du process ils ne survivent pas (la partie reste en mémoire, comme le reste de l'état), mais ils survivent à un rechargement de page tant que la partie existe.
3. **CA-3 :** Recharger `/party/:partyId/broadcast` ou reconnecter son socket réapplique le classement, les scores diffusion, le highlight et la vue.
4. **CA-4 :** Recharger l'admin réaffiche les cases et les boutons de vue dans l'état du snapshot, y compris les deux cases de scores distinctes.

**Scores sur le grand écran (réglage A) :**

5. **CA-5 :** `broadcastShowScores === false` et classement affiché : le grand écran montre des rangs seuls (1er, 2ème, 3ème…) dans le footer, l'écran du gagnant §4.5 et le classement final. Aucun score numérique sur ces surfaces.
6. **CA-6 :** `broadcastShowScores === true` : ces mêmes surfaces montrent les scores numériques.
7. **CA-7 :** L'admin affiche toujours les scores numériques (panneau Scores, file de buzz), que A ou B soit On ou Off.
8. **CA-8 :** Couper A ne change pas `playerShowScores`. Couper B ne change pas `broadcastShowScores` ni le rendu du grand écran.
9. **CA-9 :** Classement masqué : la case `Scores sur le grand écran` est grisée et garde sa valeur. Réafficher le classement réapplique cette valeur sans que l'animateur ait à la recocher. La case `Scores côté joueurs` reste active pendant ce temps.
10. **CA-10 :** Égalité : deux joueurs ou deux équipes au même score affichent le même rang deux fois (ex. deux « 2ème ») quand A est Off.

**Scores côté joueurs (réglage B) :**

11. **CA-11 :** Défaut : les deux cases de scores sont On. Sur `/party/:partyId/play`, un bloc épinglé en bas montre `Moi · {score} pts` et un chevron `▾`. La bande d'identité ne répète pas ce score.
12. **CA-12 :** Joueur avec `teamId` non null : la ligne compacte ajoute `Éq. {teamId} · {Y} pts`, où Y est `teamScores` de cette équipe (somme des scores des joueurs de l'équipe, pas une copie du score perso).
13. **CA-13 :** Joueur avec `teamId === null` : la ligne compacte n'a pas de segment équipe.
14. **CA-14 :** Clic sur la ligne compacte déplie la table. Un second clic la replie. Recharger la page la remet repliée.
15. **CA-15 :** Onglet `Par score` : ordre de score croissant (le plus petit en premier). À score égal, `displayName` en locale `fr`.
16. **CA-16 :** Onglet `Par équipe` : groupes par `teamId` croissant, score croissant dans chaque groupe. Les joueurs `teamId === null` sont sous le titre **Sans équipe**.
17. **CA-17 :** `maxTeams === null` : l'onglet `Par équipe` n'est pas affiché. `Par score` reste disponible.
18. **CA-18 :** `Masquer` retire tout le bloc (plus aucun score visible, seul `Afficher` reste en bas). `Afficher` le rétablit. La préférence survit au rechargement sur ce navigateur, n'est pas dans le snapshot, et un autre joueur (ou le même joueur sur un autre navigateur) n'est pas affecté.
19. **CA-19 :** `playerShowScores === false` : pas de bloc, pas de score dans la bande d'identité, pas de score sur l'écran du gagnant du téléphone, pas de rang affiché à la place. Un `Masquer` local préalable ne réaffiche rien tant que B reste Off.
20. **CA-20 :** Écran du gagnant §4.5 : le grand écran suit A (score si On, rang si Off) ; le téléphone suit B (score si On, pas de ligne de score si Off). Changer A pendant que l'écran du gagnant est ouvert met à jour le grand écran sans le fermer. Changer B met à jour le téléphone sans le fermer.

**Mise en évidence du gagnant du buzz :**

21. **CA-21 :** `highlightBuzzWinner === true` : highlight visuel sur le grand écran seulement après la décision finale du §4.8.
22. **CA-22 :** Aucun surlignage provisoire pendant la fenêtre d'attente du §4.8 (aujourd'hui `buzzOrder` est affiché dès le premier buzz).
23. **CA-23 :** Le surlignage reste visible jusqu'à la question suivante ou la réouverture du buzzer, même si le buzzer est fermé entre-temps.
24. **CA-24 :** `highlightBuzzWinner === false` : aucun surlignage, et l'écart de temps 1er/2e n'est pas affiché, y compris quand cet écart est strictement inférieur à 1 s.
25. **CA-25 :** `highlightBuzzWinner === true` et écart 1er/2e strictement inférieur à 1 s : l'écart est affiché sur le grand écran. Écart ≥ 1 s, ou un seul buzz : pas d'écart (règles §4.8 inchangées).

**Vue équipe / individuelle :**

26. **CA-26 :** `maxTeams === null` : pas de bouton « Vue par équipe », vue individuelle forcée sur le grand écran.
27. **CA-27 :** Une manche dont `broadcastViewMode !== null` applique cette valeur. Changer `broadcastViewModeGlobal` pendant cette manche ne modifie pas le champ de la manche, et le grand écran reste sur la valeur de la manche jusqu'à la fin de celle-ci.
28. **CA-28 :** Vue équipe : totaux `teamScores` sans liste de joueurs par équipe. Les joueurs `teamId === null` sont listés dans une section **Sans équipe** (score si A est On, rang si A est Off). Section absente si personne n'est sans équipe.
29. **CA-29 :** Vue individuelle : tous les joueurs, score décroissant, pseudo, avatar, score si A est On, rang si A est Off.

**Miniature :**

30. **CA-30 :** La miniature est la carte « Aperçu diffusion » sous le hero et avant le plateau, 16:9, largeur 320 à 640 px, redimensionnable par le coin. Le lien « Ouvrir la diffusion » reste dans le hero. L'aside ne change pas.
31. **CA-31 :** Miniature muette (buzz, verdict, compte à rebours, lecteur audio) avec un pictogramme « son coupé ». Admin et vrai grand écran ouverts sur le même poste : chaque son ne part qu'une fois.
32. **CA-32 :** La miniature est alimentée par le snapshot admin déjà reçu. Elle n'ouvre pas de socket `broadcast`. Ouvrir l'admin ne crée pas de client dans la room `broadcast` (le serveur ne compte pas ces clients : `webserver/src/index.ts` émet vers la room sans en exposer l'effectif).
33. **CA-33 :** La miniature est en lecture seule et montre le même rendu que `/party/:partyId/broadcast` (classement, scores A, highlight, vue).
34. **CA-34 :** Le panneau collé sous la miniature contient, dans cet ordre : `Afficher le classement`, `Scores sur le grand écran`, `Scores côté joueurs`, `Vue individuelle` / `Vue par équipe`, `Mettre en avant le gagnant du buzz`. Il n'y a plus de case « Masquer les scores numériques ».

**Cas limites testables :**

35. **CA-35 :** Plusieurs grands écrans ouverts reçoivent les mêmes réglages et le même rendu.
36. **CA-36 :** Masquer puis réafficher le classement ne provoque pas de flash d'erreur. La valeur de `broadcastShowScores` réapparaît telle qu'elle était (CA-9).
37. **CA-37 :** Passage d'une partie sans équipes à une partie avec équipes, vue globale encore `"individual"` : `broadcastViewModeGlobal` ne change pas tout seul. L'admin montre le toast `Passer en vue par équipe ?`. `Plus tard` le ferme et laisse `"individual"`. `Oui` passe le global à `"team"` sans modifier le `broadcastViewMode` d'une manche en cours. Pas de second toast pour le même passage. Pas de toast si la vue globale est déjà `"team"`.
38. **CA-38 :** `playerShowScores` repasse à `true` après un Off : le bloc revient. Si ce navigateur avait `Masquer` enregistré, le bloc reste masqué (seul `Afficher` est visible) jusqu'au clic `Afficher`.

**Cas limites :**

- L'ancienne règle « highlight visible uniquement si le buzzer est ouvert et qu'un joueur a buzzé » est abandonnée (CA-21 à CA-23).
- Le classement peut être réaffiché instantanément depuis le panneau.
- `maxTeams === null` retire la vue équipe (CA-26) et l'onglet `Par équipe` (CA-17).
- La case `Scores sur le grand écran` grisée conserve sa valeur (CA-9). `Scores côté joueurs` non.
- Activer les équipes ne bascule pas la vue (CA-37). Le code actuel ne permet pas ce passage (`maxTeams` à la création seulement) : le CA s'applique quand ce passage existera.
- Un joueur sans équipe en vue équipe est sous **Sans équipe** (CA-28), y compris dans l'onglet `Par équipe` du téléphone (CA-16).

**Écarts avec le code actuel :**

- Aucun des champs du tableau n'existe. Le footer de `Broadcast` montre `teamScores` numériques, sans vue individuelle, sans section **Sans équipe**, sans highlight après décision §4.8.
- `/party/:partyId/play` montre `rowMe.score` dans `bz-identity-score` et ne montre pas `teamScores` ni de table. L'écran du gagnant téléphone affiche `winnerDisplay.score`.
- L'admin a une aside Scores avec les valeurs numériques ; elle reste la référence « scores toujours visibles côté animateur ».
- `webserver/src/index.ts` émet vers `party:{id}:broadcast` sans compter les sockets de la room.

**Points ouverts :**

Aucun.

---

### 4.7 Bibliothèque de jeux communautaire

**Comportement :**

- L'application héberge une bibliothèque de jeux accessible depuis l'interface admin et publique (lecture seule pour les visiteurs).
- La bibliothèque contient une petite version intégrée de chaque type de jeu (quiz, blind test, révélation progressive, etc.) pour un essai rapide.
- Les utilisateurs peuvent uploader des packs au format ZIP dans la bibliothèque communautaire ; ces packs sont stockés côté serveur et téléchargeables par tous.
- Lors de la création d'une partie, l'animateur peut choisir un pack depuis la bibliothèque communautaire (téléchargement automatique et import dans la partie).

**Acteurs :**

- Animateur : upload et télécharge des packs depuis la bibliothèque.
- Visiteurs : consultent la bibliothèque (lecture seule).

**Règles métier :**

- Les packs uploadés sont validés (structure JSON, taille, contenus appropriés) avant publication dans la bibliothèque.
- Chaque pack de la bibliothèque a une fiche : titre, description, auteur, nombre de questions, nombre de téléchargements, note moyenne (si système de notation implémenté).
- Les packs intégrés (essais rapides) sont marqués « Officiel » et ne peuvent être modifiés par la communauté.
- Limite de taille par upload : configurable (ex. 50 Mo).
- Les packs de la bibliothèque sont indexés et recherchables par titre, auteur, type de jeu, tags.

**Critères d'acceptation :**

- Une page « Bibliothèque de jeux » est accessible depuis l'interface admin et en navigation publique.
- Les packs intégrés (un par type de jeu) sont listés en premier, marqués « Officiel ».
- Un bouton « Uploader un pack » permet de soumettre un ZIP ; le serveur valide et publie le pack.
- Lors de la création d'une partie, l'animateur peut choisir « Charger depuis la bibliothèque » et sélectionner un pack.
- Le pack est téléchargé et importé dans la partie en un clic.
- Les packs communautaires sont listés avec titre, auteur, description, et un bouton « Télécharger ».

**Cas limites :**

- Si un pack contient du contenu inapproprié, un système de signalement permet de le retirer (modération manuelle ou automatique).
- Si le serveur de la bibliothèque est indisponible, l'animateur peut toujours importer des packs en local (section 4.1).
- Les packs uploadés sont associés à un auteur (pseudo ou compte si authentification implémentée) pour traçabilité.

**Impact sur les questions ouvertes :**

- **Question 5.4 (Validation des packs par la communauté) :** Cette évolution répond à la question. Les packs peuvent être uploadés via l'UI admin dans la bibliothèque communautaire. La validation est faite côté serveur (schéma Zod, limite de taille). Un système de modération (signalement, revue manuelle) est recommandé pour filtrer les contenus inappropriés. La question 5.4 n'est plus ouverte : l'upload communautaire est décidé et spécifié ici.

---

### 4.8 Régulation des buzz par horodatage

**Statut :** Spec validée par Minipen (6 oct. 2026) — à implémenter.

**Comportement :**

- **Objectif :** Le joueur qui a buzzé le premier gagne même si sa connexion est plus lente. Aujourd'hui, le gagnant est désigné par ordre d'arrivée au serveur : le premier playerId ajouté à `buzzOrder` l'emporte, sans compensation de latence réseau.
- **Synchronisation d'horloge (type NTP) :** Le client envoie un timestamp t0 (heure locale), le serveur répond avec son heure serveur ts, le client reçoit à t1. RTT (Round-Trip Time) = t1 − t0. Décalage d'horloge = ts − (t0 + t1)/2. Une salve de 5 pings est effectuée ; on retient l'échantillon au RTT le plus court. La synchro est faite à la connexion, à la reconnexion, au début de chaque manche, et toutes les 30 s pendant une manche active. Le serveur mémorise par joueur : décalage d'horloge, RTT minimal mesuré, date de la dernière synchro. Le client utilise une horloge monotone (`performance.now()`) pour éviter les sauts d'heure système.
- **Buzz horodaté :** Le joueur envoie l'heure client au moment du buzz (heure monotone locale). Le serveur calcule l'heure estimée = heure client + décalage, puis classe les buzz selon cette heure estimée.
- **Garde-fous :**
  - (a) Un buzz dont l'heure estimée est antérieure à l'heure d'ouverture des buzzers (heure serveur) est refusé comme hors fenêtre (traitement aligné sur les buzz trop tôt s'ils existent déjà).
  - (b) L'heure estimée ne peut jamais être postérieure à l'heure d'arrivée : si c'est le cas, on prend l'heure d'arrivée.
  - (c) La compensation (heure arrivée − heure estimée) est plafonnée à RTT minimal/2 + 50 ms de marge ; au-delà, on ramène à cette valeur plafond. **Valeur de la marge confirmée : 50 ms.**
  - (d) Un joueur sans synchro valide (aucune synchro, ou dernière synchro plus vieille que 60 s, ou RTT mesuré > 1000 ms) : pas de compensation, on utilise l'heure d'arrivée.
- **Fenêtre d'attente :** Au premier buzz reçu, le serveur attend 500 ms avant de désigner le gagnant. Il prend ensuite la plus petite heure estimée parmi tous les buzz reçus pendant la fenêtre. Réglable dans l'admin (à côté des réglages existants tels que `autoOpenBuzzOnCueAdvance` et `autoAdvanceQuizWhenAllBuzzed`), de 0 à 1000 ms par pas de 50, défaut 500 ms. Si la fenêtre est à 0, comportement actuel inchangé : premier arrivé sans compensation. Si tous les joueurs actifs ont buzzé avant la fin de la fenêtre, la décision est prise immédiatement. Un buzz reçu après la fin de la fenêtre ne peut plus gagner.
- **Sons de buzz (nouveau mode de configuration, distinct des sons de verdict) :** Un bouton unique côté animation permet de faire tourner 3 modes dans cet ordre : `Sons de buzz : joueurs` → `Sons de buzz : animation` → `Sons de buzz : joueurs + animation` → (retour au début). Le libellé du bouton affiche toujours le mode actif ; une aide sous le bouton indique « Cliquez pour changer ». Le bouton est placé juste sous la case « Jouer les sons bon/mauvais » (`playVerdictSounds`), dans le même bloc de réglages. **Remarque importante :** ce mode de son à 3 états ne concerne que les sons de buzz ; la case existante des sons de verdict (`playVerdictSounds`) reste séparée et inchangée. Le mode est enregistré pour la partie (persiste à un rechargement) et diffusé aux joueurs via `party:patch` (champ reçu par tous les publics, comme `countdownDurationSec`) : il active ou coupe leur son de buzz local. Valeur par défaut : « joueurs + animation » (comportement actuel du code : `playPlayerBuzzTone: true`, `echoPlayerBuzzOnHost: true`). **Son côté joueur :** part sur le téléphone dès l'appui, sans attendre le serveur (lecture locale immédiate si le mode l'autorise), mais seulement si l'écran du joueur montre le buzzer ouvert (voir règle ci-dessous). **Son côté animation :** part à chaque buzz reçu par le serveur (événement `buzz_fx` émis via Socket.IO à la room admin), sans attendre la fin de la fenêtre. Les noms réels dans le code : `playPlayerBuzzTone` (joueur), `echoPlayerBuzzOnHost` (animation), événement `party:buzz_fx` avec `{ playerId, url }`.
- **Son joueur avant réponse serveur :** Quand l'écran du joueur montre le buzzer fermé (buzzer pas encore ouvert, joueur déjà buzzé, ou bloqué d'après le dernier état reçu via `party:patch`), l'appui sur le bouton buzz est désactivé : ni requête HTTP ni son local. Quand l'écran montre le buzzer ouvert mais que le serveur refuse ensuite le buzz (course avec la fermeture du buzzer, buzz estimé avant l'ouverture réelle, etc.), le son local est déjà parti : c'est accepté, et le joueur voit simplement le message de refus sans que le son côté animation ne soit joué (le serveur n'a pas ajouté le joueur à `buzzOrder` donc pas d'événement `buzz_fx`).
- **Comportement pendant la fenêtre d'attente (changement par rapport à aujourd'hui) :** Le joueur qui vient de buzzer voit immédiatement « Buzz reçu », sans rang ni indication de classement. Les autres joueurs gardent leur buzzer actif jusqu'à la fin de la fenêtre (un second joueur peut buzzer pendant la fenêtre). Le son du buzz part immédiatement (côté joueur dès l'appui si l'écran montre le buzzer ouvert, côté animation dès réception par le serveur), mais seuls le surlignage du gagnant et l'avance automatique attendent la décision finale. Aucun classement provisoire n'est affiché pendant la fenêtre. Aujourd'hui, tous les retours (son, surlignage, ajout à `buzzOrder` visible) sont immédiats ; avec cette évolution, le son reste immédiat, seuls le surlignage et l'avance sont différés.
- **Égalité d'heure estimée (à la ms) :** En cas d'égalité, l'arrivée la plus tôt gagne.
- **Retours visuels :** Sur le téléphone, affichage « Buzz reçu » immédiatement après l'appui ; le résultat (gagnant/perdant) est affiché après la décision serveur. Le grand écran (`/party/:partyId/broadcast`) n'affiche le surlignage du gagnant qu'après la décision finale (pas de gagnant provisoire qui change). **Affichage de l'écart de temps entre 1er et 2e :** l'écart est affiché sur le grand écran seulement s'il est inférieur à 1 seconde ; si l'écart est ≥ 1 s ou s'il n'y a qu'un seul buzz, aucun écart n'est affiché.
- **Mode automatique (§4.3) et avance automatique :** Un buzz dont l'heure estimée se situe avant la fin du minuteur de question compte, même si son paquet arrive au serveur juste après ; la fenêtre d'attente peut donc dépasser le minuteur d'au plus sa durée configurée. L'avance automatique (question suivante) sur QCM lorsque tous les joueurs ont buzzé (`autoAdvanceQuizWhenAllBuzzed`) se déclenche après la décision finale, jamais avant : la règle « tous ont buzzé = décision immédiate » reste vraie (fin de la fenêtre si tous ont buzzé), mais l'avance à la question suivante attend que cette décision soit prise et notifiée.
- **Journal de debug :** Pour chaque décision de gagnant, le serveur journalise (logs internes, pas affichés aux joueurs) : heure client, décalage appliqué, heure estimée, heure d'arrivée, et si un plafond a été appliqué. Utile pour debug et détection de comportements anormaux.
- **Hors périmètre :** Compensation de la latence d'affichage de la question sur le téléphone ; détection de triche au-delà des plafonds (signalement automatique, ban).
- **Points ouverts (remarques techniques d'intégration) :**
  - Le système de reconnexion actuel (socket.ts, handshake JWT) ne prévoit pas de synchro temps ; à intégrer lors de `io.use()` middleware.
  - Le tick serveur pour synchro périodique (toutes les 30 s) nécessite un intervalle dans `store.ts` ou `app.ts`.
  - Le mode automatique actuel ne gère qu'un seul minuteur par manche ; l'intégration de la fenêtre d'attente peut nécessiter un timer supplémentaire.

**Acteurs :**

- Joueur : envoie un buzz horodaté (heure client), reçoit la confirmation immédiate puis le résultat après décision.
- Animateur : configure la durée de la fenêtre d'attente, consulte les logs de debug si besoin.

**Règles métier :**

- La synchro d'horloge est obligatoire pour bénéficier de la compensation ; un joueur qui refuse ou dont le client ne supporte pas la synchro voit ses buzz traités en mode « ordre d'arrivée ».
- La fenêtre d'attente ne bloque jamais plus longtemps que sa durée configurée, sauf si tous les joueurs ont buzzé plus tôt (décision immédiate).
- Un joueur ne peut buzzer qu'une fois par fenêtre (règle existante conservée : `playerId` déjà présent dans `buzzOrder` refuse le double buzz).
- Les événements Socket.IO `party:patch` notifient l'ouverture du buzzer, le premier buzz reçu (démarrage de la fenêtre), et la décision finale (gagnant désigné).
- Le mode de son des buzz (3 modes cycliques) est enregistré dans l'état de la partie et diffusé aux joueurs connectés via `party:patch`. Un joueur qui se connecte ou se reconnecte après un changement de mode reçoit le mode actuel et applique immédiatement le réglage (son local activé ou coupé). Le changement de mode en pleine fenêtre d'attente prend effet au buzz suivant (les sons déjà joués ne sont pas annulés).

**Critères d'acceptation :**

**Compensation de latence et fenêtre d'attente :**

1. **CA-1 :** Joueur A (RTT 300 ms) buzze 100 ms avant joueur B (RTT 20 ms) selon l'heure réelle ; A gagne malgré son arrivée plus tardive au serveur.
2. **CA-2 :** Joueur B (RTT 20 ms) buzze 100 ms avant joueur A (RTT élevé) ; B gagne.
3. **CA-3 :** Joueur A buzze dans la fenêtre, joueur B buzze après la fin de la fenêtre ; A gagne même si B avait une meilleure heure estimée.
4. **CA-4 :** Joueur trafique son heure client de −2 secondes (anticipe le buzz) ; la compensation est plafonnée à RTT/2 + 50 ms, l'avantage ne dépasse pas cette limite.
5. **CA-5 :** Buzz dont l'heure estimée est antérieure à l'ouverture des buzzers (avant `buzzWindowOpen = true`) ; refusé par le serveur (code erreur `BUZZ_TOO_EARLY` ou équivalent).
6. **CA-6 :** Fenêtre d'attente configurée à 0 ; comportement actuel inchangé (premier arrivé, aucune compensation), tests existants restent verts.
7. **CA-7 :** Joueur sans synchro valide (aucune synchro, ou synchro trop ancienne > 60 s, ou RTT > 1000 ms) ; son buzz est traité en mode « heure d'arrivée » sans compensation.
8. **CA-8 :** Tous les joueurs ont buzzé avant la fin de la fenêtre ; décision prise immédiatement sans attendre la fin du timer.
9. **CA-9 :** Égalité d'heure estimée (à la milliseconde) entre deux joueurs ; le joueur dont le paquet est arrivé en premier au serveur gagne.
10. **CA-10 :** Joueur se reconnecte en pleine manche active ; une nouvelle synchro est effectuée avant que ses buzz ne soient compensés.
11. **CA-11 :** Réglage de la fenêtre d'attente dans l'admin persiste et est borné entre 0 et 1000 ms (validation Zod côté serveur).
12. **CA-12 :** Un second joueur buzze pendant la fenêtre d'attente (après le premier buzz mais avant la fin de la fenêtre) ; son buzz est accepté, enregistré avec son heure estimée, et pris en compte lors de la décision finale.
13. **CA-13 :** Le classement des joueurs (ordre dans `buzzOrder`) n'est figé qu'à la décision finale : pendant la fenêtre d'attente, l'ordre provisoire peut changer si de nouveaux buzz arrivent avec des heures estimées plus tôt.

**Surlignage et avance automatique :**

14. **CA-14 :** Un événement Socket.IO explicite (ex. `buzz_decision` ou métadonnée dans `party:patch`) est émis à la décision finale, permettant aux clients de déclencher le surlignage du gagnant de manière testable.
15. **CA-15 :** Sur QCM avec `autoAdvanceQuizWhenAllBuzzed` activé : tous les joueurs buzzent, la décision est prise immédiatement (fin de fenêtre anticipée), puis l'avance à la question suivante se déclenche après cette décision, jamais avant.

**Affichage de l'écart de temps :**

16. **CA-16 :** L'écart de temps entre le 1er et le 2e joueur est affiché sur le grand écran seulement si cet écart est strictement inférieur à 1 seconde.
17. **CA-17 :** Si l'écart de temps entre le 1er et le 2e est supérieur ou égal à 1 seconde, aucun écart n'est affiché.
18. **CA-18 :** S'il n'y a qu'un seul joueur qui a buzzé (aucun 2e), aucun écart n'est affiché.

**Sons de buzz (mode à 3 états) :**

19. **CA-19 :** Le son du buzz côté joueur part immédiatement à l'appui (si le mode l'autorise), sans attendre la réponse du serveur.
20. **CA-20 :** Le son du buzz côté animation part à chaque buzz reçu par le serveur pendant la fenêtre d'attente (événement `buzz_fx`), sans attendre la décision finale.
21. **CA-21 :** Le bouton de mode de son fait le cycle des 3 modes à chaque clic : `Sons de buzz : joueurs` → `Sons de buzz : animation` → `Sons de buzz : joueurs + animation` → (retour). Le libellé du bouton affiche toujours le mode actif.
22. **CA-22 :** Chaque mode coupe bien le bon côté : mode « joueurs » coupe l'animation, mode « animation » coupe les joueurs, mode « joueurs + animation » active les deux.
23. **CA-23 :** Le mode de son persiste à un rechargement de l'interface animation et est appliqué aux joueurs connectés et aux nouveaux arrivants (reçu via `party:patch`).
24. **CA-24 :** Un changement de mode en pleine fenêtre d'attente est pris en compte au buzz suivant (les sons déjà joués ne sont pas annulés).
25. **CA-25 :** Changer le mode de son des buzz ne modifie pas la case `playVerdictSounds` (sons de verdict bon/mauvais), et vice-versa.

**Son joueur avant réponse serveur :**

26. **CA-26 :** Quand l'écran du joueur montre le buzzer fermé (pas encore ouvert, joueur déjà buzzé, ou bloqué d'après le dernier `party:patch`), l'appui sur le bouton buzz est désactivé : aucun son local ni requête HTTP envoyée.
27. **CA-27 :** Quand le buzz est refusé par le serveur après que le son local soit déjà parti (race condition avec fermeture, heure estimée avant ouverture, etc.), le joueur voit le message de refus et aucun son côté animation n'est joué (pas d'événement `buzz_fx` car le joueur n'est pas ajouté à `buzzOrder`).

**Cas limites :**

- **Horloge téléphone qui saute :** Si l'heure système du téléphone change brusquement (changement manuel, passage heure d'été/hiver), l'horloge monotone (`performance.now()`) n'est pas affectée. Seule une fermeture/réouverture de l'onglet ou un rechargement provoque une nouvelle synchro.
- **Mise en veille de l'onglet :** Si le navigateur suspend l'onglet (mobile en arrière-plan), `performance.now()` peut se décaler. À la reprise, si plus de 60 s se sont écoulés depuis la dernière synchro, le joueur est considéré sans synchro valide et traité en mode « ordre d'arrivée » jusqu'à la prochaine synchro périodique.
- **Double buzz du même joueur :** Seul le premier buzz compte (règle existante : `playerId` déjà dans `buzzOrder` refuse le second buzz). L'heure du premier buzz est celle qui est prise en compte. Double appui rapide côté client : un seul son local est joué (le client désactive le bouton après le premier appui jusqu'à réception de la réponse ou timeout).
- **Buzz refusé par le serveur alors que le son joueur est déjà parti :** Le joueur entend le son puis voit le message de refus (race condition acceptée). Le son côté animation n'est pas joué car le serveur n'ajoute pas le joueur à `buzzOrder` et n'émet pas d'événement `buzz_fx`.
- **Joueur seul :** Si un seul joueur buzze (aucun autre joueur actif), la fenêtre se termine immédiatement et il est déclaré gagnant sans attente.

---

**Comportement :**

- L'application héberge une bibliothèque de jeux accessible depuis l'interface admin et publique (lecture seule pour les visiteurs).
- La bibliothèque contient une petite version intégrée de chaque type de jeu (quiz, blind test, révélation progressive, etc.) pour un essai rapide.
- Les utilisateurs peuvent uploader des packs au format ZIP dans la bibliothèque communautaire ; ces packs sont stockés côté serveur et téléchargeables par tous.
- Lors de la création d'une partie, l'animateur peut choisir un pack depuis la bibliothèque communautaire (téléchargement automatique et import dans la partie).

**Acteurs :**

- Animateur : upload et télécharge des packs depuis la bibliothèque.
- Visiteurs : consultent la bibliothèque (lecture seule).

**Règles métier :**

- Les packs uploadés sont validés (structure JSON, taille, contenus appropriés) avant publication dans la bibliothèque.
- Chaque pack de la bibliothèque a une fiche : titre, description, auteur, nombre de questions, nombre de téléchargements, note moyenne (si système de notation implémenté).
- Les packs intégrés (essais rapides) sont marqués « Officiel » et ne peuvent être modifiés par la communauté.
- Limite de taille par upload : configurable (ex. 50 Mo).
- Les packs de la bibliothèque sont indexés et recherchables par titre, auteur, type de jeu, tags.

**Critères d'acceptation :**

- Une page « Bibliothèque de jeux » est accessible depuis l'interface admin et en navigation publique.
- Les packs intégrés (un par type de jeu) sont listés en premier, marqués « Officiel ».
- Un bouton « Uploader un pack » permet de soumettre un ZIP ; le serveur valide et publie le pack.
- Lors de la création d'une partie, l'animateur peut choisir « Charger depuis la bibliothèque » et sélectionner un pack.
- Le pack est téléchargé et importé dans la partie en un clic.
- Les packs communautaires sont listés avec titre, auteur, description, et un bouton « Télécharger ».

**Cas limites :**

- Si un pack contient du contenu inapproprié, un système de signalement permet de le retirer (modération manuelle ou automatique).
- Si le serveur de la bibliothèque est indisponible, l'animateur peut toujours importer des packs en local (section 4.1).
- Les packs uploadés sont associés à un auteur (pseudo ou compte si authentification implémentée) pour traçabilité.

**Impact sur les questions ouvertes :**

- **Question 5.4 (Validation des packs par la communauté) :** Cette évolution répond à la question. Les packs peuvent être uploadés via l'UI admin dans la bibliothèque communautaire. La validation est faite côté serveur (schéma Zod, limite de taille). Un système de modération (signalement, revue manuelle) est recommandé pour filtrer les contenus inappropriés. La question 5.4 n'est plus ouverte : l'upload communautaire est décidé et spécifié ici.

---

## 5. À venir

### 5.1 Restant pour atteindre le MVP complet

#### 5.1.1 Affichage question/réponses côté joueur

**Statut :** restant (non implémenté).

**Description :** Actuellement, le snapshot contient les indices de round/question (`currentRoundIndex`, `currentQuestionIndex`) mais le `gameBoard` (objet complet avec `prompt`, `choices`, `imageUrl`, etc.) n'est pas toujours transmis côté joueur sur tous les types de rounds. L'animateur pilote le contenu projeté en salle ; les joueurs voient principalement l'état du buzzer et les scores.

**Hypothèse :** Pour un MVP complet, le snapshot joueur devrait inclure systématiquement le `gameBoard` complet (sauf les champs réservés animateur comme `correctChoiceIndex` ou `revealTitle`/`revealArtist` sur blind test). Cela permettrait aux joueurs de lire la question, voir les choix QCM, et consulter les illustrations sans dépendre d'un affichage en salle.

**Critères d'acceptation (hypothèse) :**

- Le `gameBoard` dans le snapshot joueur contient `kind`, `prompt`, `choices` (sur quiz), `imageUrl` (sur image_buzz / progressive_guess), etc., sans exposer les réponses correctes.
- L'UI joueur affiche la question et les choix en grand avant le buzz.
- Sur blind test, l'audio est disponible si `allowPlayerAudioControl === true` ; sinon, le joueur attend l'annonce orale en salle.

---

#### 5.1.2 Modification pseudo / équipe in-place (UX inline)

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

#### 5.1.3 Tests unitaires (Vitest)

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

#### 5.1.4 Tests end-to-end (Playwright)

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

### 5.2 Hors scope MVP (backlog produit)

#### 5.2.1 Comptes utilisateurs / OAuth persistants

**Statut :** hors MVP.

**Description :** Actuellement, les joueurs et l'animateur n'ont pas de compte persistant. Chaque partie est éphémère (purge après inactivité). L'authentification se limite à un JWT temporaire (joueur) et un token opaque (admin) valables uniquement pour la durée de la partie.

**Hypothèse :** Une future extension permettrait de créer des comptes utilisateurs (OAuth Google/GitHub), d'associer un profil permanent (pseudo, avatar, historique de parties), et de sauvegarder les parties en base de données (PostgreSQL ou MongoDB) plutôt qu'en mémoire.

---

#### 5.2.2 Plusieurs familles de mini-jeux dans une même partie

**Statut :** hors MVP.

**Description :** Actuellement, une partie ne gère qu'un type de jeu à la fois (quiz). Le système de manches (`mancheScript`) permet déjà de charger plusieurs packs ou vidéos YouTube successivement, mais chaque manche est un quiz ou une vidéo.

**Hypothèse :** À l'avenir, on pourrait imaginer des mini-jeux différents (ex. dessin collaboratif, jeux de rapidité type « qui clique le plus vite », etc.) insérés comme manches dans le script. Cela nécessiterait un refactoring du `gameBoard` et de la logique métier pour supporter des types de rounds très différents.

---

#### 5.2.3 Internationalisation (i18n)

**Statut :** hors MVP.

**Description :** Tout le texte UI et les messages d'erreur sont en français. Aucun système i18n n'est en place.

**Hypothèse :** Intégrer `react-i18next` côté front et `i18next` côté back permettrait de supporter plusieurs langues (anglais, espagnol, etc.). Les packs quiz devraient également être traduits ou marqués par langue.

---

#### 5.2.4 Cluster Redis pour multi-instances

**Statut :** hors MVP.

**Description :** L'état des parties est en mémoire process (`PartyStore`). Impossible de scaler horizontalement sans perdre l'état.

**Hypothèse :** Utiliser Redis (ou Redis Cluster) comme store partagé permettrait de déployer plusieurs instances du serveur derrière un load balancer, avec persistance de l'état. Le socket.io-redis adapter devrait être intégré pour distribuer les événements `party:patch` entre instances.

---

## 6. Questions ouvertes

### 6.1 Gestion de la déconnexion joueur prolongée

**Question :** Si un joueur se déconnecte (socket fermé) mais que son JWT reste valide, doit-il rester dans la liste des joueurs ? Faut-il un timeout d'inactivité pour le retirer automatiquement ?

**Hypothèse :** Actuellement, un joueur reste dans la partie tant qu'il n'est pas kické ou que la partie n'est pas supprimée. Une future évolution pourrait marquer les joueurs déconnectés (flag `connected: boolean`) et les retirer après un délai d'inactivité (ex. 10 minutes).

---

### 6.2 Archivage et statistiques de parties

**Question :** Les parties sont purgées après 48h d'inactivité. Doit-on archiver les résultats (scores finaux, historique des buzzes) pour consultation ultérieure ?

**Hypothèse :** Pour un usage MVP, l'archivage n'est pas nécessaire. Une évolution future pourrait enregistrer un snapshot final dans une base de données (scores, classement, timestamp) accessible via un tableau de bord historique.

---

### 6.3 Modération du chat

**Question :** Le chat est libre ; pas de filtrage ou modération des messages. Doit-on intégrer un système de signalement ou de bannissement de mots ?

**Hypothèse :** Pour des usages privés (soirées entre amis), la modération n'est pas critique. Pour un déploiement public, un système de modération (mots-clés interdits, signalement, ban) devrait être envisagé.

---

### 6.4 Rejoindre une partie déjà lancée

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
