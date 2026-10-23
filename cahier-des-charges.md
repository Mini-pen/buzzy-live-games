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
- Le bouton buzz est grisé si la fenêtre est fermée ou si le joueur a déjà buzzé. Il reste affiché (CA-57). Sa disparition après un buzz n'est pas le comportement attendu.
- Sur QCM, le joueur voit ses choix (A, B, C, D…) et sélectionne avant de buzzer.

**Cas limites :**

- Si un joueur tente de modifier son pseudo alors que `allowRename === false`, l'API renvoie `FORBIDDEN`.
- Si un joueur tente de changer d'équipe alors que `allowTeamChange === false`, idem.
- En cas de déconnexion socket, la reconnexion doit ré-envoyer le même `playerToken` dans `handshake.auth.bearer` pour rejoindre la room `party:{id}:player`.

---

### 2.5 Interface animateur

**Comportement :**

- Route `/party/:partyId/admin` : authentification via `Authorization: Bearer {adminToken}` (récupéré depuis le fragment `#token=` au montage, puis rangé dans le localStorage). Résolu par Minipen le 21/10/2026 : l'ancienne mention « stocké en sessionStorage » est remplacée. Une entrée par partie. L'entrée est effacée à la fin de la partie. L'écran de diffusion relit cette entrée pour « Retour tableau » et ne l'affiche pas (CA-48). Cette règle décidée est conservée. Ancien état jusqu'au 23/10 : écart code/CDC du commit `f81d3ec`, non tranché. Le jeton animateur reste dans l'adresse (`#token=…`) pour survivre au rechargement. À décider (Minipen) : le code garde-t-il aussi le jeton en localStorage, et le jeton visible dans l'adresse est-il acceptable ? Fin de l'ancien état. La question « jeton visible dans l'adresse en plus du localStorage » est close. Constat de FB Coding Agent le 23/10/2026, correction à dater, demandée par FB Chef De Projet. Depuis `ce0c447` (23/10/2026), le jeton animateur n'apparaît plus dans l'adresse. Il est gardé dans le stockage local. Le `#token=` est retiré de l'adresse dès qu'il est lu. Un 404 garde le jeton. Un jeton refusé par le serveur est effacé. Recettes 5 et 6 du 23/10/2026, build `index-CTBZohM2.js` : OK. La marque À décider (Minipen) reste dans l'ancien état. Elle ne rouvre pas cette question.
- Actions disponibles :
  - Ouvrir/fermer fenêtre buzzer (`POST /api/parties/:partyId/host/buzz-window`).
  - Démarrer une manche (`POST /api/parties/:partyId/host/manche/play` avec `mancheId`), ce qui passe `state` en `round_active` et charge le pack quiz associé.
  - Avancer à la question suivante (`POST /api/parties/:partyId/host/cue/next`), qui incrémente `currentQuestionIndex` ou passe au round suivant si fin de round.
  - Mettre en pause / retour lobby (`POST /api/parties/:partyId/host/round/pause`), qui passe `state` en `lobby` et ferme la fenêtre buzzer. Cette phrase est conservée. Choix incertain (Coding Agent, 21-22/10/2026), à confirmer par Minipen, codé dans `f81d3ec` : la pause gèle l'écran et les décomptes au lieu de revenir au salon d'attente. Ce choix ne remplace pas la phrase ci-dessus. Correctif de FB Coding Agent, commit `bd450b60` (23/10/2026), `webserver/src/domain/store.ts`, pour le test instable `buzzRegistrationRace.test.ts`. Cause dans le code : `scheduleGraceFinalize` armait un seul `setTimeout`, qui pouvait sonner environ 1 ms avant la fin réelle de la fenêtre de grâce, laissant le buzz dans la file jusqu'au tick de 500 ms. Le minuteur se réarme désormais sur le délai restant. Il est annulé si la file, la durée de grâce ou la pause changent. Effet de bord noté par l'auteur du code. À décider (Minipen), demande de FB Chef De Projet, commits `bd450b60` et `b09e6346` : un buzz en attente pendant une pause reprend le délai restant au lieu de se clore pendant le gel. `bd450b60` est le correctif. `b09e6346` (23/10/2026) pose le commentaire INCERTAIN de FB Coding Agent dans `webserver/src/domain/store.ts`, `adminToggleLivePause`, juste avant `scheduleGraceFinalize(party)`, sans changement de comportement ni de test. Cet effet se rattache à l'écart déjà noté (le CDC dit retour au lobby, le code fige la manche). Il ne le tranche pas. La phrase « retour lobby » et le choix incertain du gel restent.
  - Attribuer des points manuellement (`PATCH /api/parties/:partyId/host/players/:playerId/score` avec `delta`).
  - Valider un buzz (`POST /api/parties/:partyId/host/buzz-resolve` avec `playerId` et `verdict: "good"|"bad"`), ce qui ajoute ou retire des points selon le `verdict` et retire le joueur de `buzzOrder`.
  - Gérer le script de manches : ajouter (`POST /api/parties/:partyId/host/manche/add`), supprimer, réordonner, choisir le pack quiz ou vidéo YouTube ou vidéo directe.
  - Configurer les sons de buzzer (palettes good/bad, flags `playPlayerBuzzTone`, `echoPlayerBuzzOnHost`).
  - Activer/désactiver `autoOpenBuzzOnCueAdvance` (réouverture auto du buzzer sur question suivante) et `autoAdvanceQuizWhenAllBuzzed` (QCM : dès que tous ont buzzé, scoring auto + question suivante).
  - Relire un média (`POST /api/parties/:partyId/host/cue/replay`) qui incrémente `videoReplaySerial` pour forcer un rechargement côté clients.
  - Contrôle audio joueur (`POST /api/parties/:partyId/host/player-audio-control`) pour activer/désactiver `allowPlayerAudioControl` (lecture audio locale sur blind test).

**Barre du bas :**

Décidé par Minipen le 21/10/2026, mot pour mot : « le bloc qui est accroché en bas de l'écran contient trop de choses. il faut juste garder les boutons "lancer la manche" "ouvrir buzzer" "pause" "afficher gagnant", tout le reste doit migrer dans un bloc repliable, "paramètres de la partie", sous le bloc des questions ». La barre fixée en bas de l'écran ne garde que quatre boutons : « Lancer la manche », « Ouvrir buzzer », « Pause » et « Afficher gagnant ». Tout le reste va dans un bloc repliable « Paramètres de la partie », placé sous le bloc des questions.

Le CDC ne nommait pas cette barre. Il plaçait les réglages dans l'interface animateur. Ces phrases sont conservées. Elles déménagent dans le bloc. Ce que le CDC y met aujourd'hui : les deux décomptes, `countdownDurationSec` et `nextQuestionCountdownSec`, « les deux se règlent dans l'interface animateur » (§4.5, CA-49). Le champ « Durée du compte à rebours » des critères de ce §4.5. Le mode « Prêt ? », dont le réglage dans l'interface animateur est encore un choix incertain (§4.5). Le délai automatique de 15 s, « se règle dans l'interface animateur », et « L'interface animateur affiche ce délai » (§4.5). Les toggles `autoOpenBuzzOnCueAdvance` et `autoAdvanceQuizWhenAllBuzzed`, « dans les réglages » (critère de cette section). La durée de la fenêtre d'attente, réglée dans l'admin (§4.8, CA-11). La configuration des sons de buzzer. Le contrôle audio joueur, pour le blind test. L'action « Ouvrir/fermer fenêtre buzzer » est conservée : seul « Ouvrir buzzer » reste dans la barre. Fermer la fenêtre fait partie de « tout le reste » et va dans le bloc. Cette phrase sur la fermeture est conservée. Le choix incertain de Design UI plus bas la place sous la question en cours, sous le nom « Fermer & purger ». « Pause » reste le bouton de « Mettre en pause / retour lobby ». « Afficher gagnant » est le bouton gardé pour le visuel de victoire du §4.5. Le bouton « Suivant » de ce visuel n'est pas un des quatre. Cette phrase est conservée. Le même choix de Design UI le place sous la question en cours, après le gagnant.

Maquette de Design UI `animateur_parametres_v1.png` (1600×1080). Hors dépôt, ordinateur partagé, pas dans le dépôt. Elle n'est pas validée par Minipen. Elle montre la barre fixe avec les quatre boutons, chacun avec son icône. Elle montre le bloc « Paramètres de la partie » sous le scénario, à l'endroit décidé sous le bloc des questions, en trois groupes. Buzzer : ouverture auto, passage auto en QCM, fenêtre d'attente. Comptes à rebours : question suivante, mode « Prêt ? » et son délai, buzzer. Sons et affichage : sons, écran de gagnant, blind test. Le bouton « Afficher gagnant » reste dans la barre. La maquette place aussi « écran de gagnant » dans le troisième groupe.

Choix incertains (Specs Writer, 21/10/2026), à confirmer par Minipen. Le bloc est replié par défaut. Son état, replié ou ouvert, est gardé pendant la partie. Cette phrase sur l'état est conservée. Proposition de Design UI : replié, le bloc garde une ligne de résumé, par exemple « Prêt ? activé · buzzer 5 s · suivante 5 s ». Proposition de Design UI : le bloc garde son état, replié ou déplié, d'une visite à l'autre. Cette proposition remplace le choix « gardé pendant la partie ». Les deux variantes restent à trancher par Minipen : pendant la partie seulement, ou d'une visite à l'autre. Les boutons désactivés gardent leur place, pour que la barre ne bouge pas.

Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : le lancement manuel en mode « Prêt ? » reste dans les paramètres, et non dans la barre. C'est une action en direct : ce choix le signale, il ne le tranche pas. Cette phrase est conservée et remplacée. Choix incertain (Design UI, 21/10/2026), question posée à Minipen : les boutons qui ne servent qu'à certains moments vont sous la question en cours, pas dans la barre. Ce sont « Fermer & purger », le lancement de la question pendant « Prêt ? », « Suivant » après le gagnant, « Extrait suivant » et « Rejouer l'extrait ». Ce choix remplace le placement du lancement manuel dans les paramètres. Le CDC nomme déjà « Avancer à la question suivante » et « Relire un média ». Design UI place « Extrait suivant » et « Rejouer l'extrait » sous la question en cours. Le rapprochement de ces noms avec ces deux actions n'est pas tranché.

Cas limites : un paramètre modifié en pleine manche. Le CDC dit déjà, en choix incertain, qu'un changement des décomptes ou du mode « Prêt ? » s'applique à partir de la question suivante (§4.5). Ce point ne le retranche pas. Un petit écran : les quatre boutons doivent tenir sur une ligne. La maquette est en 1600×1080. Elle ne montre pas ce cas.

Choix incertains (Coding Agent, 21/10/2026), à confirmer par Minipen, codés dans `6023afd`. À la dernière question, « Question suivante → » est désactivé, avec une indication qui renvoie vers « Afficher gagnant », au lieu de déclencher le gagnant. Ce choix ne répond pas à l'À décider du CA-73 sur la fin de manche. Un réglage numérique n'est envoyé au serveur qu'en sortant du champ ou avec Entrée, pas à chaque frappe. Choix incertains (Coding Agent, 21-22/10/2026), à confirmer par Minipen, codés dans `f81d3ec`. « Afficher gagnant » ouvre le podium de manche. Ce choix ne répond pas à l'À décider du CA-73. En recette, on saute à une question avec `?question=N` dans l'adresse, sans bouton. Une partie qui n'est plus sur le serveur affiche « Partie introuvable. Cette partie n'est plus sur le serveur. » La phrase du §2.9, « Partie introuvable. », est conservée.

Choix incertain (Coding Agent, 22/10/2026), À décider Minipen. Relevé par FB Specs Writer le 23/10/2026, CA-75. Quand le serveur répond 404 à la page animateur (partie effacée par inactivité ou redémarrage), le code des commits `80e28d3` et `860abf5`, puis `ce0c447`, affiche le titre « Partie introuvable », le corps « Cette partie n'existe plus côté serveur (inactivité ou redémarrage). Le lien « Reprendre » sur l'accueil ne peut pas restaurer une partie effacée. » et le bouton « Retour à l'accueil ». Les deux phrases du paragraphe précédent, et celle du §2.9, sont conservées. Ce libellé ne les remplace pas.

**Acteurs :**

- Animateur (host) : authentifié par `adminToken`.

**Règles métier :**

- Toutes les routes `/host/*` vérifient le Bearer via `verifyAdminToken` (timing-safe égalité) ; sinon `UNAUTHORIZED`.
- Le passage en `round_active` marque `hasStartedRound = true` de façon irréversible ; si `closedAfterStart`, plus de join possible.
- L'ordre de `buzzOrder` reflète l'ordre d'arrivée des buzzs ; l'animateur peut résoudre chaque buzz dans l'ordre ou en désordre.
- Sur un quiz QCM avec `autoAdvanceQuizWhenAllBuzzed`, dès que tous les joueurs connectés ont buzzé, le serveur calcule pour chaque joueur si son `choiceIndex` correspond au `correctChoiceIndex` du pack, attribue les points (positif si bon, négatif si mauvais selon les valeurs du pack), et avance automatiquement à la question suivante. Résolu par Minipen le 21/10/2026 : cette avance attend aussi la fin du décompte entre les questions (`nextQuestionCountdownSec`, CA-49), y compris en mode autonome. 0 = pas de décompte, l'avance part après le scoring. Une fois la question affichée, le mode optionnel « Prêt ? » (§4.5), s'il est actif, s'intercale avant le décompte du buzzer. Il ne retarde pas cette avance jusqu'à la question.
- Les manches (`mancheScript`) sont ordonnées par l'animateur. Seule la manche dont `id === activeMancheId` est active. L'animateur peut ajouter des manches de type `pack_quiz` (référence un fichier JSON scanné sous `games/`), `youtube` (URL vidéo YouTube convertie en embed `youtube-nocookie.com`), ou `direct_video` (URL vidéo auto-hébergée sous `/games/` après validation path-traversal).

**Critères d'acceptation :**

- L'interface admin affiche le gameBoard enrichi (incluant `correctChoiceIndex` sur quiz, `revealTitle`/`revealArtist` sur blind test).
- L'animateur voit la file d'attente buzzer (`buzzOrder`) avec les pseudos et, sur QCM, la lettre et le label de la réponse choisie, ainsi qu'un indicateur ✓/✗.
- Les boutons « Bon » / « Mauvais » ou « +X points » / « -Y points » appliquent les deltas définis par le pack ou saisis manuellement.
- L'animateur peut naviguer dans le script de manches : ajouter, supprimer, réordonner (monter/descendre), jouer une manche.
- Le snapshot host contient `autoOpenBuzzOnCueAdvance` et `autoAdvanceQuizWhenAllBuzzed` pour afficher les toggles dans les réglages. Ces réglages sont dans le bloc « Paramètres de la partie », sous le bloc des questions (même section, barre du bas).

75. **CA-75 — Écran « Partie introuvable » et jeton, page animateur**

   **Règle :** Choix incertain (Coding Agent, 22/10/2026), À décider Minipen. Relevé par FB Specs Writer le 23/10/2026. Quand le serveur répond 404 à la page animateur, partie effacée par inactivité ou redémarrage, le code des commits `80e28d3` et `860abf5`, puis `ce0c447`, affiche le titre « Partie introuvable », le corps « Cette partie n'existe plus côté serveur (inactivité ou redémarrage). Le lien « Reprendre » sur l'accueil ne peut pas restaurer une partie effacée. » et le bouton « Retour à l'accueil ». Les phrases déjà écrites ici et au §2.9 sont conservées : « Partie introuvable. » et « Partie introuvable. Cette partie n'est plus sur le serveur. » Ce libellé ne les remplace pas.

   **Critère :** Sur `/party/:partyId/admin`, une réponse 404 au chargement montre ce titre, ce corps et ce bouton. Le libellé reste À décider Minipen.

   **Cas limites :** Recette 6 du 23/10/2026, build `index-CTBZohM2.js` (`ce0c447`). Ce qui est fixé et testé : le 404 garde le jeton animateur dans le stockage local. Un jeton refusé par le serveur est effacé. Le `#token` est retiré de l'adresse dès qu'il est lu. Sans jeton enregistré pour cette partie, la page affiche « Jeton animateur absent ou lien incomplet. Rouvrir le lien après création. » Le jeton absent passe avant « Partie introuvable ». Ancien état jusqu'au 23/10 : À décider (Minipen) du §2.5 et du CA-48, jeton encore dans `#token=`. Fin de l'ancien état. La question « jeton visible dans l'adresse en plus du localStorage » est close (§2.5, CA-48). Ces faits testés en sont l'état. Le CA-48 vise l'écran de diffusion : l'erreur « Jeton animateur absent ou lien incomplet » n'y est pas le comportement attendu. La page animateur sans jeton est une autre surface. Ce rapprochement n'est pas tranché.

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
- Pas de contrôles de jeu : interface en lecture seule pour le déroulement, synchronisée via Socket.IO. Résolu par Minipen le 21/10/2026 : l'ancienne formule « pas de contrôles animateur » est remplacée pour un seul lien. « Retour tableau » ouvre la page animateur dans un nouvel onglet (CA-48). L'écran de diffusion n'affiche jamais le jeton animateur, ni dans l'URL ni dans la page.
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

- Si la partie n'existe pas, message « Partie introuvable. » Cette phrase est conservée. Choix incertain (Coding Agent, 21-22/10/2026), à confirmer par Minipen, codé dans `f81d3ec` : une partie qui n'est plus sur le serveur affiche « Partie introuvable. Cette partie n'est plus sur le serveur. » Ce choix ne remplace pas la phrase ci-dessus.
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
- Le mode automatique respecte les durées configurées (ex. 30 secondes par question, 5 minutes par manche). Résolu par Minipen le 21/10/2026 : il respecte aussi le décompte entre les questions (`nextQuestionCountdownSec`, CA-49). 0 = pas de décompte. Le mode « Prêt ? », s'il est actif, vient après l'affichage de la question (§4.5) et ne retarde pas cet enchaînement.
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
- **Visuel de victoire :** Lorsque le temps imparti pour une question ou une manche se termine, un écran de victoire affiche le nom du gagnant (joueur ou équipe avec le meilleur score) sur le grand écran spectateur et dans l'interface joueur. Résolu par Minipen le 21/10/2026 pour la modale de point entre les questions : cette formulation est remplacée par la maquette, « Point pour <nom> », « +1 point », « Touchez pour fermer » (CA-46, CA-47). Décidé par Minipen le 21/10/2026 : le « +1 point » de cette phrase est à son tour remplacé par « + N points » pour un joueur, et par « + N points pour l'équipe <nom> » pour une équipe. « Point pour <nom> » et « Touchez pour fermer » restent. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : au singulier, le libellé est « + 1 point » ; le titre « Point pour <nom> » et l'avatar du joueur restent au-dessus. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : l'ancienne formulation et le CA-20 restent valables pour l'écran de fin de partie.
- **Compte à rebours avant question :** Un compte à rebours configurable (3 à 10 secondes) démarre avant chaque question, uniquement lorsque tous les participants ont marqué « Prêt ». Le buzzer reste fermé pendant le compte à rebours et s'ouvre automatiquement à la fin. Résolu par Minipen le 21/10/2026 : cette règle est remplacée. Le décompte d'ouverture du buzzer est `countdownDurationSec`. Il démarre après l'affichage de la question. Côté joueur, il s'affiche dans le bouton buzzer. Il est optionnel et se règle dans l'interface animateur. 0 = pas de décompte. Le défaut déjà écrit plus bas dans ce paragraphe est 5 secondes : il est conservé. Le minimum passe de 3 à 0. Ce n'est pas le décompte entre les questions (`nextQuestionCountdownSec`, CA-49). Si le mode « Prêt ? » est inactif, ce départ après l'affichage de la question reste. S'il est actif, le décompte du buzzer ne démarre qu'à la fin de l'attente « Prêt ? ». Décidé (Minipen, 21/10/2026, réponse transmise par Coding Agent) : la nouvelle question s'affiche seulement quand le buzzer s'ouvre, pas au début de ce décompte (CA-60). Pendant le décompte, la question qui vient d'être jouée reste affichée. Minipen a répondu en privé, à 22h52 heure de Paris : « la nouvelle question s'affiche seulement quand le buzzer s'ouvre ». La phrase « Il démarre après l'affichage de la question » n'est pas réécrite.

**Acteurs :**

- Animateur : configure la durée du compte à rebours et active/désactive les alertes. Il règle aussi le délai qui passe outre « Prêt ? » (15 secondes par défaut) et peut lancer manuellement la question quand ce mode est actif.
- Joueurs : marquent « Prêt », voient le compte à rebours, et peuvent buzzer une fois celui-ci terminé. Le « Prêt » ne déclenche plus le décompte. Le joueur voit ce décompte dans le bouton buzzer, et ne buzze qu'à 0, ou tout de suite si le réglage vaut 0. La phrase « Le « Prêt » ne déclenche plus le décompte » vaut quand le mode « Prêt ? » est inactif. S'il est actif, le passage de tous les joueurs au vert déclenche le décompte du buzzer. Ce n'est pas le seul départ : le délai automatique de 15 secondes et le lancement manuel de l'animateur le déclenchent aussi.

**Règles métier :**

- Le compte à rebours est affiché en grand sur le grand écran et dans l'interface joueur. Résolu par Minipen le 21/10/2026 : côté joueur, cet affichage en grand est remplacé par l'affichage dans le bouton buzzer. Proposition de Design UI, référence `buzzer_decompte_joueur_v1.png` (hors dépôt, `/workspace/ui/buzzy/`) : pendant le décompte, le buzzer est gris et inactif, le chiffre est au centre, un anneau jaune se vide. À 0, il passe au rouge « BUZZ ! » et devient actif. Si le réglage vaut 0, il est actif tout de suite. Le buzzer garde sa forme actuelle : seuls le chiffre et l'anneau s'ajoutent. Cette v1 n'est plus valable : `buzzer_decompte_joueur_v2.png` la remplace (CA-58).
- Le buzzer est fermé (`buzzWindowOpen = false`) pendant le compte à rebours ; il s'ouvre automatiquement à 0. Cette fermeture reste vraie. Un appui pendant le décompte est refusé.
- Le bouton « Prêt » est affiché dans l'interface joueur en début de question ; le compte à rebours démarre lorsque tous les joueurs connectés ont cliqué « Prêt ». La note « le départ au « Prêt » est remplacé par le départ après l'affichage de la question. Le maintien du bouton « Prêt » et de son timeout n'est pas dit » est remplacée. Résolu par Minipen le 21/10/2026 : « Prêt ? » est un autre mode, optionnel. S'il est inactif, le décompte d'ouverture du buzzer (`countdownDurationSec`) suit directement l'affichage de la question. S'il est actif, il est intercalé entre le décompte entre les questions (« question suivante », `nextQuestionCountdownSec`) et le décompte du buzzer. Il s'affiche sur le bouton buzzer. Chaque joueur clique sur « Prêt ? » en orange, qui devient « Prêt ! » en vert. Un nouveau clic repasse en orange. Une fois que tous les joueurs sont en vert, cela déclenche le décompte du buzzer.
- Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : le mode se règle dans l'interface animateur, comme les deux décomptes. Un changement en cours de partie s'applique à partir de la question suivante. « Tous les joueurs » désigne les joueurs connectés. La phrase déjà écrite s'applique : « Si un joueur se déconnecte pendant le compte à rebours, il n'est pas compté dans le « tous prêts ». » Un joueur déconnecté ne bloque donc pas. Si `countdownDurationSec` vaut 0, le buzzer s'ouvre dès que tout le monde est prêt. La diffusion affiche combien sont prêts, par exemple « 3/5 prêts ». Ce compteur de diffusion ne se confond pas avec le compteur joueur de la maquette.
- Si un joueur ne marque pas « Prêt » après un timeout (ex. 30 secondes), le compte à rebours démarre quand même (majorité ou timeout). La note « Cette phrase ne démarre plus `countdownDurationSec` » est remplacée. Quand le mode « Prêt ? » est actif, « le compte à rebours » de cette phrase est le décompte du buzzer. Le choix incertain « le délai de 30 s reste écrit tel quel, sans le fondre avec le cas limite de 30 secondes » est remplacé. Décidé par Minipen le 21/10/2026, mot pour mot : « on conserve le délai auto qui bypass le 'pret' (15 sec par défaut, paramétrable). » Le délai automatique qui passe outre « Prêt ? » vaut 15 secondes par défaut et se règle dans l'interface animateur. Même si tout le monde n'est pas prêt, il déclenche le décompte du buzzer. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : le réglage va de 5 à 60 secondes, et 0 veut dire « pas de délai automatique » (on attend tous les joueurs ou l'animateur), comme pour les deux décomptes.
- Le visuel de victoire affiche le pseudo du gagnant, son avatar, et son score final (ou celui de l'équipe). Pour la modale de point, ces éléments sont remplacés par « Point pour <nom> », « +1 point » et « Touchez pour fermer ». Décidé par Minipen le 21/10/2026 : « +1 point » est remplacé par « + N points » pour un joueur, et par « + N points pour l'équipe <nom> » pour une équipe.
- Proposition de Design UI, référence `buzzer_pret_joueur_v1.png` (hors dépôt, `/workspace/ui/buzzy/`). La maquette montre trois états : « Prêt ? » orange avec texte foncé (contraste 6,1:1), « Prêt ! » vert avec texte blanc (contraste 5,4:1), puis le décompte dans le bouton. Les mots, l'orange, le vert, le basculement à chaque clic et la place sur le bouton buzzer sont décidés. Les contrastes sont une proposition. Un compteur « 3 / 5 joueurs prêts » s'affiche sous le bouton côté joueur : Proposition de Design UI, à confirmer par Minipen. Il reste une proposition, en plus de la coche et du sablier de la liste des joueurs. Correction d'accord, commit `601fa63`, pas un choix à confirmer. « 1 / 2 joueurs prêts ». Cette citation est conservée et alignée sur le singulier : « 1 / 2 joueur prêt ». Le singulier reste pour 1, « 1 joueur ». Commit `a4571828` (FB Coding Agent, 23/10/2026) : le compteur joueur affiche « 1 / 3 joueur prêt » et « 0 / 3 joueurs prêts » (0 au pluriel, comme l'admin). L'admin et la diffusion affichent « 1/3 prêt » et « 2/3 prêts ». Choix incertain (FB Specs Writer, 23/10/2026), À décider Minipen : le singulier doit valoir partout (admin, diffusion, écran joueur). CA-76. Cette v1 n'est plus valable : `buzzer_pret_joueur_v2.png` et `buzzer_etats_joueur_v3.png` la remplacent (CA-58).
- Décidé par Minipen le 21/10/2026 pour une arrivée en cours de route. Mot pour mot : « Si un joueur rejoins en cours de décompte, il est en orange, et il faut l'attendre. Si il rejoint pendant une question, il est considéré comme pret et peux déjà répondre à la question. » Lecture retenue, mode « Prêt ? » actif : s'il rejoint pendant le décompte entre les questions ou pendant l'attente « Prêt ? », il arrive en orange et on l'attend. S'il rejoint pendant une question, il est considéré comme prêt et peut répondre tout de suite. Ces règles remplacent le choix incertain (Coding Agent et Specs Writer, 21/10/2026) selon lequel un joueur qui rejoint pendant l'attente compte parmi les joueurs connectés et doit lui aussi passer au vert.
- Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : pendant le décompte du buzzer, la question est déjà affichée, donc un joueur qui rejoint compte comme prêt.
- À décider par Minipen : un bouton qui permet à l'animateur de forcer le départ. Il n'est pas prévu pour l'instant. Cette note est remplacée. Décidé par Minipen le 21/10/2026 : même si tout le monde n'est pas prêt, l'animateur peut lancer manuellement la question. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : « lancer manuellement la question » veut dire que l'animateur démarre le décompte du buzzer, ou ouvre directement le buzzer si ce décompte vaut 0.
- Décidé par Minipen le 21/10/2026 : la liste des joueurs, sur tous les écrans (animateur, joueur et diffusion), montre qui est prêt. Une coche verte est devant le nom de chaque joueur prêt. Un petit sablier orange est devant le nom de chaque joueur qui ne l'est pas. Ces deux icônes ne s'affichent que si le mode « Prêt ? » est actif. Mot pour mot : « met une coche verte pour les prets, et un petit sablier orange pour les 'pas prets' ». La proposition d'un emplacement vide, de la largeur de la coche, devant un joueur pas encore prêt, est remplacée par ce sablier. Proposition de Design UI, à confirmer par Minipen : le vert est `#1E7A3C` et l'orange est `#F07800`, les mêmes que le bouton « Prêt ! » et « Prêt ? ». Les deux icônes ont la même taille, égale à la hauteur du texte du nom, pour que les noms restent alignés.
- `countdownDurationSec` (défaut 5, minimum 0) est le décompte d'ouverture du buzzer, après l'affichage de la question. Si le mode « Prêt ? » est actif, ce départ attend la fin de l'attente « Prêt ? ». L'ancienne borne « 3 à 10 secondes » et l'ancien départ « après Prêt » sont remplacés. La pause avant la question suivante est un autre réglage, `nextQuestionCountdownSec` (défaut 5 secondes, 0 = pas de décompte). Elle ne réutilise pas `countdownDurationSec`. Les deux se règlent dans l'interface animateur.
- L'écran plein cadre de cette section (score ou rang selon CA-20, bouton « Suivant ») n'est plus la modale de point. Pendant la pause entre deux questions, le téléphone et le grand écran montrent la modale de la maquette, puis le bandeau du CA-49. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : le CA-20 et le bouton « Suivant » restent valables pour l'écran de fin de partie. Choix incertain du même jour : sur l'écran de diffusion, le décompte du buzzer reste affiché comme aujourd'hui, en grands chiffres, en plus de son affichage dans le bouton joueur. Un changement de l'un ou l'autre réglage en cours de partie s'applique à partir de la question suivante. Le maximum reste 10 s pour le buzzer et 30 s pour l'entre-questions.

**Critères d'acceptation :**

- Les sons bon/mauvais sont joués automatiquement à la validation de buzz (si pas déjà le cas).
- Le visuel de victoire s'affiche sur `/party/:partyId/broadcast` et dans l'interface joueur à la fin d'une manche ou d'une question (selon configuration).
- Un champ « Durée du compte à rebours » est configurable dans les réglages animateur. L'ancienne borne « 3 à 10 secondes » est remplacée : minimum 0, défaut 5. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : le maximum du buzzer reste 10 secondes.
- Le bouton « Prêt » apparaît dans l'interface joueur avant chaque question. Il ne déclenche plus le décompte d'ouverture du buzzer. Cette phrase vaut si le mode « Prêt ? » est inactif. S'il est actif, le bouton affiche « Prêt ? » en orange, passe à « Prêt ! » en vert au clic, et repasse en orange au clic suivant. Le décompte du buzzer démarre quand tous les joueurs connectés sont au vert. Décidé par Minipen le 21/10/2026 : il démarre aussi à la fin du délai automatique (15 secondes par défaut), et quand l'animateur lance manuellement la question.
- Le compte à rebours s'affiche en grand (chiffres animés) et le buzzer s'ouvre à la fin. Côté joueur, les grands chiffres sont remplacés par `buzzer_decompte_joueur_v1.png` : buzzer gris et inactif, chiffre au centre, anneau jaune qui se vide, puis rouge « BUZZ ! » actif à 0. Réglage à 0 : buzzer actif tout de suite, sans décompte. Mode « Prêt ? » actif : ce décompte dans le bouton ne commence qu'une fois tout le monde au vert. Cette restriction est complétée par le délai de 15 secondes et par le lancement manuel. La maquette `buzzer_pret_joueur_v1.png` précède cet état. Ces deux v1 ne sont plus valables : voir `buzzer_decompte_joueur_v2.png`, `buzzer_pret_joueur_v2.png` et `buzzer_etats_joueur_v3.png` (CA-58).
- Mode « Prêt ? » actif : un joueur qui rejoint pendant le décompte entre les questions, ou pendant l'attente « Prêt ? », est orange. Le décompte du buzzer ne démarre pas tant qu'il n'est pas passé au vert, sauf à l'échéance du délai automatique ou au lancement manuel. Un joueur qui rejoint pendant une question est prêt et peut répondre tout de suite.
- Mode « Prêt ? » actif, délai au défaut : si au moins un joueur connecté n'est pas prêt, le décompte du buzzer démarre 15 secondes après le début de l'attente. Si tous passent au vert avant ces 15 secondes, le décompte démarre à ce moment-là, sans attendre la fin du délai. L'interface animateur affiche ce délai. Sans changement de réglage, la valeur est 15 secondes.
- Mode « Prêt ? » actif : un lancement manuel par l'animateur, alors qu'un joueur n'est pas prêt, démarre la suite sans attendre ce joueur ni la fin des 15 secondes.
- Mode « Prêt ? » actif : la page animateur, la page joueur et la diffusion affichent une coche verte devant chaque nom prêt et un petit sablier orange devant chaque nom pas prêt. Mode inactif : ni coche ni sablier sur ces trois listes. Un clic qui repasse un joueur en orange remplace sa coche par le sablier, sur les trois écrans. Cette règle décidée reste : les trois écrans les montrent. Écart code/CDC relevé par Test Writer (commit `3a710c6`) : pendant « Prêt ? », le téléphone n'affiche pas la liste avec les coches et les sabliers.

76. **CA-76 — Accord de « joueurs prêts »**

   **Règle :** L'admin et la diffusion affichent « 1/3 prêt » et « 2/3 prêts ». L'accord y est géré. Côté joueur, « 1 / 3 joueurs prêts » suivait le total, pas le nombre de prêts. Commit `a4571828` (FB Coding Agent, 23/10/2026), sur main : le compteur joueur affiche « 1 / 3 joueur prêt » et « 0 / 3 joueurs prêts ». 0 reste au pluriel, comme l'admin. Le code marque encore INCERTAIN le format du compteur (« 3/5 prêts », « 3 / 5 joueurs prêts »). L'accord lui-même n'y porte plus cette marque. Cette phrase vaut pour `a4571828`. Elle est conservée. Commit `2b83f02` (23/10/2026), sur main, ajoute un commentaire `INCERTAIN` sur l'accord singulier dans `readyStatusLabel`, sans changement de comportement ni de test. Choix incertain (FB Specs Writer, 23/10/2026), À décider Minipen : le singulier doit valoir partout (admin, diffusion, écran joueur). L'accord singulier reste À décider (Minipen). L'exemple du §4.5, « 1 / 2 joueurs prêts » (commit `601fa63`), est conservé et aligné sur « 1 / 2 joueur prêt ». La marque « pas un choix à confirmer » de cette correction est conservée. Elle ne tranche pas cet À décider.

   **Critère :** Le commit `a4571828` donne, côté joueur, « 1 / 3 joueur prêt » et « 0 / 3 joueurs prêts ». L'admin et la diffusion donnent « 1/3 prêt » et « 2/3 prêts ». Que le singulier vaille sur les trois écrans reste À décider Minipen.

   **Cas limites :** Un seul joueur, déjà prêt : « 1 / 1 joueur prêt ». Zéro prêt : pluriel, « 0 / 3 joueurs prêts », y compris si le total vaut 1 (« 0 / 1 joueurs prêts »). Le compteur « 3 / 5 joueurs prêts » reste la proposition de Design UI de ce §4.5. Ce CA ne la retire pas. La phrase « Le singulier reste pour 1, « 1 joueur » » est conservée. L'exemple aligné « 1 / 2 joueur prêt » accorde sur le nombre de prêts (1), pas sur le total (2). Cette lecture n'est pas tranchée contre l'ancienne phrase. Recette 7 du 23/10/2026, build `index-C5erKbXt.js` (`a4571828`), partie VKN66G : le singulier est validé côté joueur (« 0 / 3 joueurs prêts », « 1 / 3 joueur prêt », « 2 / 3 joueurs prêts ») et côté admin et diffusion (« 0/3 prêts », « 1/3 prêt », « 2/3 prêts »). Cet OK ne retire pas l'À décider Minipen.

77. **CA-77 — Fin de « Prêt ? » à 3/3**

   **Règle :** Choix incertain (FB Specs Writer, 23/10/2026), À décider Minipen. Observé en recette 6 du 23/10/2026, partie GGTNLF. Quand tous les joueurs sont prêts, la phase « Prêt ? » se termine tout de suite et la question démarre. Aucun « 3/3 » n'est visible. Le CDC ne l'écrivait pas. Les phrases « tous au vert, le décompte du buzzer démarre » sont conservées. Ce constat ne les remplace pas. À décider Minipen : garder tel quel, ou afficher « 3/3 » un court instant.

   **Critère :** À 3 prêts sur 3, la phase se termine sans laisser « 3/3 » à l'écran, selon l'observation. L'autre option, un court affichage de « 3/3 », n'est pas tranchée.

   **Cas limites :** Moins de 3 joueurs, par exemple 2/2 : le CDC ne dit pas si le même saut s'applique. Non tranché. Le délai de 15 secondes et le lancement manuel restent les autres départs déjà écrits. Recette 7 du 23/10/2026, build `index-C5erKbXt.js` (`a4571828`), partie VKN66G : à 3/3, aucune valeur lisible, la question démarre aussitôt. Même constat que la partie GGTNLF. L'À décider Minipen est conservé.

**Cas limites :**

- Si aucun joueur ne marque « Prêt », le compte à rebours démarre après un timeout (30 secondes par défaut). La note « Ce cas ne s'applique plus à `countdownDurationSec` » est remplacée. Le « 30 secondes par défaut » de ce cas est remplacé par le délai décidé de 15 secondes. Mode « Prêt ? » actif, réglage par défaut : si aucun joueur n'est prêt, le décompte du buzzer démarre au bout de 15 secondes.
- Si un joueur se déconnecte pendant le compte à rebours, il n'est pas compté dans le « tous prêts ». Remplacé pour le décompte du buzzer : une reconnexion pendant le décompte reprend à l'heure du serveur. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : pour l'attente « Prêt ? », cette phrase reste, et un joueur déconnecté ne bloque pas.
- Le visuel de victoire peut être skipé manuellement par l'animateur (bouton « Suivant »). Pour la modale de point, ce skip est remplacé par le CA-50 (clic, ou fin à min(3 s, décompte entre les questions)). Le bouton « Suivant » pour l'écran de fin de partie reste un choix incertain.
- Réglage du buzzer à 0 : pas de décompte, bouton actif dès l'affichage de la question. Cette phrase vaut si le mode « Prêt ? » est inactif. S'il est actif, l'ouverture immédiate dès que tout le monde est prêt reste le choix incertain écrit plus haut.
- Appui sur le buzzer pendant son décompte : buzz refusé, comme lorsque le buzzer est fermé.
- Un joueur repasse en orange juste avant le dernier clic vert : tout le monde n'est pas vert, le départ « tous verts » ne se fait pas. Le délai automatique part quand même à son échéance.
- Un seul joueur connecté, mode « Prêt ? » actif : son passage au vert déclenche le décompte du buzzer. S'il ne clique pas, le délai de 15 secondes le déclenche au défaut. L'animateur peut aussi lancer manuellement.
- Arrivée pendant le décompte entre les questions ou pendant l'attente « Prêt ? », mode actif : orange, on l'attend. Sa ligne montre le sablier. Le délai automatique et le lancement manuel ne l'attendent pas au-delà de leur propre règle.
- Arrivée pendant une question : le joueur est considéré comme prêt et peut répondre tout de suite. Sa ligne montre la coche.
- Arrivée pendant le décompte du buzzer : choix incertain, le joueur compte comme prêt. Cette phrase est conservée. Écart code/CDC relevé par Test Writer (commit `3a710c6`), `store.ts:411` : un joueur qui arrive pendant le décompte du buzzer est déjà compté prêt. Le CDC dit qu'un joueur qui rejoint pendant le décompte entre les questions ou pendant l'attente « Prêt ? » est orange, et qu'il est prêt seulement s'il rejoint pendant une question. Le cas du décompte du buzzer est donc ambigu. À décider par Minipen.
- Le dernier joueur passe au vert avant 15 secondes : un seul départ, celui du « tous verts ». La fin du délai ne provoque pas un second départ.
- L'animateur lance manuellement pendant l'attente : la suite part tout de suite. Le temps restant du délai ne la retarde pas.
- Mode inactif : la liste des joueurs n'a ni coche ni sablier, et le délai de 15 secondes ne court pas.
- Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : délai réglé à 0, pas de contournement automatique. On attend tous les joueurs ou le lancement manuel. Les bornes 5 à 60 secondes restent ce choix incertain. Le sens exact du lancement manuel (décompte du buzzer, ou buzzer ouvert tout de suite si ce décompte vaut 0) aussi.
- Proposition de Design UI : les deux icônes mesurent la hauteur du nom. Un joueur pas prêt n'a pas d'emplacement vide à la place du sablier.
- Quand tous les joueurs sont prêts, la phase « Prêt ? » se termine tout de suite. Aucun « 3/3 » n'est visible. Observé en recette 6 du 23/10/2026, partie GGTNLF, et en recette 7, partie VKN66G, build `index-C5erKbXt.js` (`a4571828`) : à 3/3, aucune valeur lisible, la question démarre aussitôt. Choix incertain (FB Specs Writer, 23/10/2026), À décider Minipen : garder tel quel, ou afficher « 3/3 » un court instant. CA-77. Les phrases déjà écrites sur le départ « tous au vert » sont conservées.

**Statut :** Livré et testé — compte à rebours grand écran, écran du gagnant automatique, sons du verdict et réglage de durée (PR 18 et 19) ; suite Vitest rejouée sur main à `06e2689` : 288/288 tests verts. Correctifs livrés : `f0d817c` (« Prêt ? » sur le téléphone) et `b3efbf4` (le décompte ne dépasse plus la durée réglée).

---

### 4.6 Configuration de l'affichage projeté depuis une fenêtre miniature

**Statut :** Livré et testé (logique serveur / helpers) — PR 27 (`bcd142c`), 341/341 Vitest verts (`broadcastDisplay.test.ts` et suite). CA UI restants hors Vitest pour l'instant (miniature admin, bloc téléphone joueur, localStorage). La sous-section « Recette Minipen du 21/10/2026 » (CA-39 à CA-51) a son propre statut, « En cours de correction ». Elle ne modifie pas le statut des CA-1 à CA-38. La sous-section « Recette Minipen du 21/10/2026, 2e passage » (CA-52 à CA-74) a le même statut. La sous-section « Recettes 5, 6 et 7 du 23/10/2026 » constate des OK. Elle ne modifie pas ce statut. Les CA-75 à CA-77 sont au §2.5 et au §4.5.

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
  - L'écran du gagnant §4.5 suit la surface : grand écran selon A (score ou rang), téléphone selon B (score si On, ligne de score absente si Off). Résolu par Minipen le 21/10/2026 : la modale de point ne suit plus cette surface. Elle suit la maquette (CA-46). Le score ou le rang de cette phrase reste un choix incertain pour l'écran de fin de partie.
- **Vue équipe / individuelle :**
  - Pendant une manche active, `mancheScript[i].broadcastViewMode !== null` l'emporte ; sinon `broadcastViewModeGlobal`.
  - Si `maxTeams === null`, le bouton « Vue par équipe » n'est pas proposé et la vue individuelle est forcée.
  - **Rendu actuel du grand écran (défaut à reproduire quand les scores sont On et la vue est équipe) :** le footer de `Broadcast` affiche les scores d'équipe (`teamScores`) quand `teamEntries.length > 0`. Le lobby affiche le nombre de joueurs, pas la liste. En `between_rounds` ou `ended`, seuls les totaux d'équipe sont affichés. La vue individuelle n'existe pas encore dans le code.
  - **Vue individuelle (à implémenter) :** liste de tous les joueurs, score décroissant, pseudo, avatar, et score numérique si A est On, rang seul si A est Off.
  - **Joueur sans équipe (décision Minipen, point fermé) :** en vue équipe, les joueurs `teamId === null` ne sont pas dans `teamScores`. Ils apparaissent dans une section titrée **Sans équipe** (pseudo, et score ou rang selon A). La section est absente s'il n'y a aucun joueur sans équipe.
  - **Équipes activées en cours de partie (décision Minipen, point fermé) :** pas de bascule automatique de `broadcastViewModeGlobal`. Aujourd'hui `maxTeams` est fixé à la création (pas de PATCH, §2.1) : cette règle s'applique au moment où une partie passe de `maxTeams === null` à des équipes activées, sans inventer ici l'API qui ferait ce passage. L'admin affiche un toast `Passer en vue par équipe ?` avec `Oui` et `Plus tard`. `Oui` met `broadcastViewModeGlobal` à `"team"` sans écraser un `broadcastViewMode` de manche. `Plus tard` ferme le toast sans changer la vue. Le toast n'est pas montré si la vue globale est déjà `"team"`, ni sur le grand écran, ni sur les téléphones. Un seul toast par passage « équipes activées ».
- **Miniature et panneau (Design UI) :**
  - Carte « Aperçu diffusion » en haut de la colonne de droite, au-dessus de la file de buzz, des scores et du chat. Le lien « Ouvrir la diffusion » reste dans le hero. 16:9, largeur de la colonne. Chaque bloc de cette colonne se replie. La miniature omet la modale de point et l'écran §4.5, pour qu'ils ne couvrent pas la page animateur.
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

5. **CA-5 :** `broadcastShowScores === false` et classement affiché : le grand écran montre des rangs seuls (1er, 2ème, 3ème…) dans le footer, l'écran du gagnant §4.5 et le classement final. Aucun score numérique sur ces surfaces. Résolu par Minipen le 21/10/2026 : pour la modale de point, ce rang est remplacé par les libellés du CA-46. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : l'écran de fin de partie garde ce rang.
6. **CA-6 :** `broadcastShowScores === true` : ces mêmes surfaces montrent les scores numériques. Pour la modale de point, le score numérique est remplacé par « +1 point » (CA-46). Décidé par Minipen le 21/10/2026 : ce « +1 point » est à son tour remplacé par « + N points » pour un joueur, et par « + N points pour l'équipe <nom> » pour une équipe (§4.5). Le score de l'écran de fin de partie reste le choix incertain du CA-20.
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
19. **CA-19 :** `playerShowScores === false` : pas de bloc, pas de score dans la bande d'identité, pas de score sur l'écran du gagnant du téléphone, pas de rang affiché à la place. Un `Masquer` local préalable ne réaffiche rien tant que B reste Off. La modale de point n'affiche déjà pas ce score : elle affiche « +1 point » (CA-46). Décidé par Minipen le 21/10/2026 : ce « +1 point » est remplacé par « + N points », ou « + N points pour l'équipe <nom> » (§4.5). L'absence de score sur l'écran de fin de partie reste couverte par ce CA si le choix incertain du CA-20 confirme cet écran.
20. **CA-20 :** Écran du gagnant §4.5 : le grand écran suit A (score si On, rang si Off) ; le téléphone suit B (score si On, pas de ligne de score si Off). Changer A pendant que l'écran du gagnant est ouvert met à jour le grand écran sans le fermer. Changer B met à jour le téléphone sans le fermer. Résolu par Minipen le 21/10/2026 : pour la modale de point entre les questions, ce critère est remplacé par « Point pour <nom> », « +1 point », « Touchez pour fermer » (CA-46, CA-47). Décidé par Minipen le 21/10/2026 : « +1 point » est remplacé par « + N points » pour un joueur, et par « + N points pour l'équipe <nom> » pour une équipe. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : ce CA-20, score ou rang, et le bouton « Suivant » du §4.5, restent valables pour l'écran de fin de partie.

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

30. **CA-30 :** Ancienne règle, remplacée (Résolu par Minipen le 21/10/2026) : la carte « Aperçu diffusion » était sous le hero et avant le plateau, en 16:9, largeur 320 à 640 px, redimensionnable par le coin, et l'aside ne changeait pas. L'emplacement est remplacé par le CA-40 (tête de la colonne de droite, au-dessus du chat). La phrase « l'aside ne change pas » est remplacée par le CA-41 (blocs de la colonne de droite pliables). Le lien « Ouvrir la diffusion » reste dans le hero. La carte reste 16:9, à la largeur de la colonne.
31. **CA-31 :** Miniature muette (buzz, verdict, compte à rebours, lecteur audio) avec un pictogramme « son coupé ». Admin et vrai grand écran ouverts sur le même poste : chaque son ne part qu'une fois.
32. **CA-32 :** La miniature est alimentée par le snapshot admin déjà reçu. Elle n'ouvre pas de socket `broadcast`. Ouvrir l'admin ne crée pas de client dans la room `broadcast` (le serveur ne compte pas ces clients : `webserver/src/index.ts` émet vers la room sans en exposer l'effectif).
33. **CA-33 :** La miniature est en lecture seule et montre le même rendu que `/party/:partyId/broadcast` (classement, scores A, highlight, vue), sauf la modale de point et l'écran §4.5, absents de la miniature pour ne pas couvrir la page animateur. Résolu par Minipen le 21/10/2026 : cet écart est confirmé. L'aperçu de diffusion sur la page animateur n'affiche pas la modale du gagnant. Explication de Coding Agent : la fenêtre du gagnant affichée dans la miniature débordait et noircissait toute la page animateur. Elle a donc été retirée de la miniature, mais elle reste sur la vraie diffusion.
34. **CA-34 :** Le panneau collé sous la miniature contient, dans cet ordre : `Afficher le classement`, `Scores sur le grand écran`, `Scores côté joueurs`, `Vue individuelle` / `Vue par équipe`, `Mettre en avant le gagnant du buzz`. Il n'y a plus de case « Masquer les scores numériques ». Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : ce panneau suit l'aperçu dans la colonne de droite et reste collé dessous.

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

Aucun sur les CA-1 à CA-38. Les points rouverts par la recette du 21/10/2026 sont dans la sous-section suivante. Ils ne sont pas tranchés ici.

#### Recette Minipen du 21/10/2026

**Statut :** En cours de correction. Livrés dans `6023afd` : la réponse D et le contour jaune visibles à 390×844, la même hauteur (398 px) pour le bloc « Prêt ? » et la zone des réponses, et le podium en escalier sur le téléphone. La recette de Testeur reste en cours.

**Périmètre :** retours de la recette de l'affichage projeté faite par Minipen le 21/10/2026. Les CA-39 à CA-51 s'ajoutent aux CA-1 à CA-38. Ils ne les retirent pas. Un écart avec une règle déjà écrite du CDC est noté en fin de sous-section et laissé à Minipen.

**Références Design UI (hors dépôt) :** maquettes sur l'ordinateur partagé de l'équipe, dossier `/workspace/ui/buzzy/` (non versionné) :

- `modale_lancement_v1.png` — modale « Choisir le mode de lancement ». Décidé par Minipen, relayé par Design UI (CA-42).
- `gagnant_joueur_v1.png` — avatar, anneau et libellés de point, page joueur (Proposition de Design UI).
- `gagnant_joueur_v2.png` — décompte dans la modale joueur. Remplace la v1 pour ce décompte (CA-46).
- `gagnant_diffusion_v1.png` — format 16:9 et avatar, écran de diffusion (Proposition de Design UI).
- `gagnant_diffusion_v2.png` — décompte dans la modale diffusion. Remplace la v1 pour ce décompte (CA-47).
- `decompte_question_joueur_v2.png` — bandeau après fermeture, page joueur. Remplace `decompte_question_joueur_v1.png` (CA-49).
- `decompte_question_diffusion_v2.png` — bandeau après fermeture, écran de diffusion (CA-49).
- sources HTML et `banner.css` — même dossier, hors dépôt, avec ces maquettes v2.
- `buzzer_decompte_joueur_v1.png` — décompte d'ouverture du buzzer dans le bouton joueur (§4.5). Proposition de Design UI. Cette v1 n'est plus valable : `buzzer_decompte_joueur_v2.png` la remplace (2e passage, CA-58).
- `buzzer_pret_joueur_v1.png` — trois états du bouton, mode « Prêt ? » (§4.5). Proposition de Design UI pour les contrastes et le compteur sous le bouton. Les mots, l'orange, le vert et le basculement sont décidés. Cette v1 n'est plus valable : `buzzer_pret_joueur_v2.png` et `buzzer_etats_joueur_v3.png` la remplacent (CA-58).

Les mesures encore marquées **Proposition de Design UI** ne sont pas des décisions. Le CA-42 est décidé. Une phrase marquée « Décidé par Minipen » est une décision de recette. Une phrase marquée « choix incertain » ou « À décider par Minipen » attend une confirmation.

##### Page animateur

39. **CA-39 — Bloc d'infos de partie**

   **Règle :** Le bloc d'infos de partie est réduit. Le code partie a la taille d'un titre de section, avec un bouton copier. Précision de Design UI. Aucune des quatre maquettes ne couvre ce bloc.

   **Critère :** Sur `/party/:partyId/admin`, le code partie est rendu à la taille d'un titre de section du même écran, et un bouton copier est visible à côté. Activer le bouton place ce code dans le presse-papiers.

   **Cas limites :** le bouton copie le code de partie affiché. Il ne copie pas le jeton animateur (§2.1 : le code join ne porte pas le token admin). Si le navigateur refuse le presse-papiers, le comportement de repli n'est pas décrit par la recette.

40. **CA-40 — Aperçu diffusion**

   **Règle :** Le bloc « Aperçu diffusion » est en tête de la colonne de droite, au-dessus du chat.

   **Critère :** Sur la page animateur, le premier bloc de la colonne de droite est « Aperçu diffusion ». Le bloc de chat vient ensuite, plus bas dans cette colonne.

   **Cas limites :** chat vide, ou chat désactivé en `round_active` (§2.7) : l'aperçu reste le premier bloc, au-dessus de la zone de chat. Bloc d'aperçu plié (CA-41) : son en-tête reste le premier de la colonne. L'ancien emplacement sous le hero (CA-30) est remplacé. Le panneau « Affichage projeté » qui suivrait l'aperçu reste le choix incertain du CA-34.

41. **CA-41 — Blocs pliables**

   **Règle :** Décidé par Minipen le 21/10/2026 : chaque bloc de la colonne de droite se plie et se déplie par un en-tête cliquable avec une flèche. Cela remplace « l'aside ne change pas » (CA-30). Son état est mémorisé. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : mémorisation en localStorage, par navigateur.

   **Critère :** Chaque bloc de la colonne de droite expose un en-tête cliquable et une flèche. Un clic plie le corps du bloc. Un second clic le déplie. Recharger la page dans le même navigateur retrouve, pour chaque bloc, l'état plié ou déplié laissé au dernier clic. Un autre navigateur garde son propre état.

   **Cas limites :** tous les blocs pliés : les en-têtes restent visibles et chacun se redéplie par son en-tête. L'état avant le premier clic n'est pas décrit. localStorage indisponible : non décrit. La table de scores du téléphone (CA-14) repart repliée à chaque chargement de `/party/:partyId/play` : c'est un autre bloc, sur une autre page. La phrase « l'aside ne change pas » du CA-30 est remplacée par ce critère (Résolu par Minipen le 21/10/2026). Le lieu de mémorisation reste un choix incertain.

42. **CA-42 — Modale de lancement**

   **Règle :** La modale « Choisir le mode de lancement » est lisible. Deux cartes cliquables, titre en gras et description dans la carte, 12 px d'écart entre les cartes. Aucun texte ne déborde, même si la description passe sur deux lignes. Décidé par Minipen, relayé par Design UI, référence `modale_lancement_v1.png` : cartes en pleine largeur, hauteur automatique, texte noir sur jaune `#FFCA28` (contraste 11,4:1), texte blanc sur vert `#1E7A3C` (contraste 5,4:1), anneau blanc au survol et au focus. La hauteur minimale de 72 px indiquée à la recette est retirée au profit de cette hauteur automatique.

   **Critère :** Au lancement d'une manche, la modale « Choisir le mode de lancement » montre deux cartes cliquables, une par mode du §4.4 (normal, autonome). Chaque carte contient son titre en gras et sa description. Les cartes occupent toute la largeur utile de la modale. Leur hauteur suit le texte. L'écart vertical entre les deux cartes est de 12 px. Une description sur deux lignes reste à l'intérieur de sa carte. La carte jaune a le fond `#FFCA28` et un texte noir, au contraste 11,4:1. La carte verte a le fond `#1E7A3C` et un texte blanc, au contraste 5,4:1. Le survol et le focus clavier dessinent un anneau blanc sur la carte. Couleurs, contrastes, anneau, largeur et hauteur automatique sont décidés (Décidé par Minipen, relayé par Design UI).

   **Cas limites :** description sur deux lignes, zoom de page, et fenêtre étroite : le texte reste dans la carte, la hauteur augmente, la largeur reste celle de la modale. Focus clavier visible par l'anneau blanc, y compris sans survol souris. Les deux destinations restent les modes du §4.4.

43. **CA-43 — Pas de modale gagnant côté animateur**

   **Règle :** La modale qui annonce le gagnant du point n'existe plus côté animateur. La liste des scores suffit.

   **Critère :** Après l'annonce d'un gagnant de point, `/party/:partyId/admin` n'ouvre aucune modale de gagnant. La liste des scores de l'animateur reste affichée et montre le score mis à jour. La page joueur et l'écran de diffusion gardent leur modale (CA-46, CA-47).

   **Cas limites :** plusieurs points d'affilée : aucune modale ne s'empile sur la page animateur. La liste des scores reste le seul rappel du point côté animateur. Le bouton « Suivant » ne ferme plus une modale absente de cette page. Son maintien sur l'écran de fin de partie est le choix incertain du CA-20.

44. **CA-44 — Question suivante sans rafraîchir**

   **Règle :** Après « tout le monde a répondu » et la fin du décompte, chaque page affiche la question suivante sans rafraîchissement. Le défaut vu en recette (les trois pages deviennent noires, il faut rafraîchir) est à corriger.

   **Critère :** Quand tous ont répondu et que le décompte du CA-49 arrive à zéro, la page animateur, la page joueur et l'écran de diffusion affichent la question suivante. Aucun rechargement manuel n'est nécessaire. Aucune des trois pages ne reste noire.

   **Cas limites :** une seule des trois pages est ouverte : elle affiche quand même la question suivante. Dernière question de la manche (pas de question suivante) : la recette ne décrit pas l'écran de remplacement. Cette phrase est conservée et remplacée pour le téléphone et la diffusion : ils affichent l'écran de résultat à podium (CA-73). La page animateur n'est pas dans cette décision. Une page qui se reconnecte pendant l'intervalle noir : non décrit.

##### Page joueur

45. **CA-45 — Surbrillance QCM au relâchement**

   **Règle :** Une réponse de QCM est en surbrillance dès que le clic est relâché, sans attendre que le pointeur quitte le bouton.

   **Critère :** Sur `/party/:partyId/play`, un appui sur un choix QCM suivi d'un relâchement alors que le pointeur est encore sur ce choix allume la surbrillance à l'instant du relâchement.

   **Cas limites :** tactile : le doigt relevé sur le choix allume la surbrillance au relâchement, sans exiger que le doigt sorte du bouton. Clic relâché hors du bouton : pas de sélection, pas de surbrillance gardée pour ce geste.

46. **CA-46 — Modale du gagnant, page joueur**

   **Règle :** Un clic sur la modale du gagnant la ferme côté joueur. Sans clic, elle se ferme selon le CA-50. Décidé par Minipen le 21/10/2026 : les libellés de la maquette sont « Point pour <nom> », « +1 point » et « Touchez pour fermer ». Ils remplacent le pseudo, l'avatar-score et le score final du §4.5 pour cette modale de point. Décidé par Minipen le 21/10/2026 : « +1 point » est remplacé par « + N points » pour un joueur, et par « + N points pour l'équipe <nom> » pour une équipe. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : au singulier, « + 1 point » ; le titre « Point pour <nom> » et l'avatar restent au-dessus. Proposition de Design UI pour les mesures, référence `gagnant_joueur_v1.png` : avatar rond de 120 px, anneau doré de 4 px avec une lueur. Dans cette modale, le texte est « Prochaine question dans : », sans le nombre de secondes. Le cercle du décompte est juste à droite de ce texte. Le nombre de secondes est porté par le cercle. Référence visuelle de ce décompte : `gagnant_joueur_v2.png` (remplace la v1 pour le décompte). Les mesures de cette maquette v2 sont une Proposition de Design UI. Si le décompte entre les questions vaut 0, cette modale ne s'affiche pas. Choix incertain (Coding Agent, 21/10/2026), à confirmer par Minipen (CA-59) : cette modale joueur est remplacée si confirmé par un bloc rond au-dessus du buzzer. Le texte de ce CA est conservé.

   **Critère :** Quand le décompte entre les questions est supérieur à 0, la modale joueur montre « Point pour » suivi du nom, « + N points » (ou « + N points pour l'équipe <nom> ») et « Touchez pour fermer ». L'ancien critère « +1 point » est remplacé par ces deux libellés. L'avatar rond mesure 120 px, avec un anneau doré de 4 px et une lueur (`gagnant_joueur_v1.png`). Le décompte dans la modale suit `gagnant_joueur_v2.png` : « Prochaine question dans : », sans nombre de secondes dans la phrase, cercle juste à droite. Un clic ferme la modale immédiatement. Sans clic, elle se ferme au bout de min(3 s, décompte entre les questions) (CA-50). Les tailles et l'anneau restent une Proposition de Design UI. « Point pour <nom> » et « Touchez pour fermer » sont décidés. « +1 point » est remplacé par « + N points » ou « + N points pour l'équipe <nom> ». Le texte sans les secondes et la place du cercle sont décidés.

   **Cas limites :** un clic pendant le décompte ferme la modale et laisse le bandeau continuer s'il reste du temps (CA-49, CA-50). Joueur sans image : CA-51. Un delta autre que +1, et une équipe gagnante, n'ont pas d'autre libellé dans la maquette décidée. Cette phrase est remplacée par « + N points » et « + N points pour l'équipe <nom> ». L'écran de fin de partie reste le choix incertain du CA-20.

##### Écran de diffusion

47. **CA-47 — Modale du gagnant, diffusion**

   **Règle :** La fermeture fixe à 3 s est remplacée. Décidé par Minipen le 21/10/2026 pour les libellés, alignés sur la maquette : « Point pour <nom> », « +1 point », « Touchez pour fermer ». « +1 point » est remplacé par « + N points » pour un joueur, et par « + N points pour l'équipe <nom> » pour une équipe (§4.5, CA-46). Proposition de Design UI, référence `gagnant_diffusion_v1.png` : même modale que la page joueur, en 16:9, avatar rond de 220 px. Le décompte dans la modale est « Prochaine question dans : », sans les secondes, cercle juste à droite (`gagnant_diffusion_v2.png`, qui remplace la v1 pour le décompte). Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : même règle de fermeture que le joueur (CA-50), soit min(3 s, décompte entre les questions), et pas de modale si ce décompte vaut 0.

   **Critère :** Sur `/party/:partyId/broadcast`, la modale reprend les libellés décidés, dont « + N points » ou « + N points pour l'équipe <nom> » à la place de « +1 point », au format 16:9, avec un avatar rond de 220 px (`gagnant_diffusion_v1.png`). Le décompte suit `gagnant_diffusion_v2.png`. La fermeture à min(3 s, décompte entre les questions), et l'absence de modale quand ce décompte vaut 0, sont le choix incertain ci-dessus. Le format et la taille d'avatar sont une Proposition de Design UI. Après fermeture, le bandeau de décompte est aussi sur cet écran (CA-49, `decompte_question_diffusion_v2.png`) lorsque le CA-50 le prévoit.

   **Cas limites :** deux écrans de diffusion ouverts se ferment au même instant (horloge serveur, CA-49). Joueur sans image : CA-51. Le clic qui ferme la modale est spécifié pour la page joueur (CA-46). Décompte de 1 ou 2 s : la modale se ferme à la fin du décompte et le bandeau ne s'affiche pas. Décompte de 3 s ou plus : le bandeau affiche le temps restant. Ces deux cas suivent le choix incertain de fermeture. Décompte à 0 : pas de modale, selon le même choix incertain.

48. **CA-48 — Lien « Retour tableau »**

   **Règle :** Décidé par Minipen le 21/10/2026. Le lien « Retour tableau » ouvre la page animateur dans un nouvel onglet. Le jeton animateur est rangé dans le localStorage, une entrée par partie, effacée à la fin de la partie (§2.5). Le lien ouvre cette page avec ce jeton. Règle de sécurité : l'écran de diffusion n'affiche jamais le jeton, ni dans l'URL ni dans la page. S'il n'y a pas d'entrée, le lien est masqué. L'erreur « Jeton animateur absent ou lien incomplet » n'est pas le comportement attendu. La mention « choix incertain » est retirée.

   **Critère :** Si le localStorage de ce navigateur a une entrée pour cette partie, « Retour tableau » est visible sur l'écran de diffusion. L'activer ouvre `/party/:partyId/admin` dans un nouvel onglet avec le jeton de cette entrée, et cet onglet affiche la page animateur. L'URL de la diffusion et la page de diffusion n'affichent pas le jeton. Sans entrée pour cette partie, le lien n'est pas rendu. L'écran ne s'arrête pas sur « Jeton animateur absent ou lien incomplet ».

   **Cas limites :** partie terminée : l'entrée de cette partie est effacée, le lien est masqué. Diffusion ouverte dans un autre navigateur ou sur une autre machine : pas d'entrée, le lien est masqué. Plusieurs parties dans le même navigateur : chaque partie a sa propre entrée. Le jeton n'apparaît ni dans le chemin, ni dans la query, ni dans le fragment, ni dans un attribut du lien. Le sessionStorage du §2.5 est remplacé par le localStorage. Le lien est l'exception décidée au §2.9. Cette règle décidée est conservée. Ancien état jusqu'au 23/10 : écart code/CDC du commit `f81d3ec`, non tranché. Sur la page animateur, le jeton reste dans l'adresse (`#token=…`) pour survivre au rechargement. À décider (Minipen) : le code garde-t-il aussi le jeton en localStorage, et le jeton visible dans l'adresse est-il acceptable ? Fin de l'ancien état. La question « jeton visible dans l'adresse en plus du localStorage » est close. Constat de FB Coding Agent le 23/10/2026, correction à dater, demandée par FB Chef De Projet. Depuis `ce0c447` (23/10/2026), le jeton animateur n'apparaît plus dans l'adresse. Il est gardé dans le stockage local. Le `#token=` est retiré de l'adresse dès qu'il est lu. Un 404 garde le jeton. Un jeton refusé par le serveur est effacé. Recettes 5 et 6 du 23/10/2026 : OK. La règle citée est celle du §2.5. La marque À décider (Minipen) reste dans l'ancien état. Elle ne rouvre pas cette question. L'erreur « Jeton animateur absent ou lien incomplet » sur la diffusion, plus haut dans ce CA, reste le point non tranché.

##### Décompte (trois pages)

49. **CA-49 — Décompte avant la question suivante**

   **Règle :** Après « tout le monde a répondu », un décompte précède la question suivante. Décidé par Minipen le 21/10/2026 : c'est un autre décompte que `countdownDurationSec` (§4.5). Champ séparé `nextQuestionCountdownSec`, 5 s par défaut, optionnel, réglable dans l'interface animateur. 0 = pas de décompte. Il s'applique aussi en mode autonome (§2.5, §4.3, CA-15 du §4.8). La mention « réglage à la création, 3 à 30 s » est remplacée par cette règle. Il est piloté par l'horloge du serveur et synchronisé sur les trois pages (animateur, joueur, diffusion). Il démarre quand la modale du gagnant s'ouvre et s'affiche déjà dans cette modale. Décidé par Minipen, relayé par Design UI : dans la modale, le texte est « Prochaine question dans : », sans le nombre de secondes, et le cercle du décompte est juste à droite du texte. Le nombre de secondes est porté par le cercle. Références visuelles : `gagnant_joueur_v2.png` et `gagnant_diffusion_v2.png`. Elles remplacent les v1 pour ce décompte. Une fois la modale fermée, le décompte continue en haut du bloc question, sur la page joueur et sur l'écran de diffusion. Décidé par Minipen : le message est bien plus visible, en haut du bloc question. Proposition de Design UI pour les valeurs, références `decompte_question_joueur_v2.png`, `decompte_question_diffusion_v2.png`, sources HTML et `banner.css` (dossier `/workspace/ui/buzzy/`, hors dépôt) : un bandeau pleine largeur, fond jaune `#FFCA28`, texte `#1a1a1a` en gras (18 px sur le téléphone, 28 px sur la diffusion), cercle à droite (chiffre de 24 px sur le téléphone, 36 px sur la diffusion), barre de progression de 5 px sur le téléphone et de 8 px sur la diffusion. L'énoncé et les réponses restent visibles sous le bandeau. Ces v2 remplacent `decompte_question_joueur_v1.png`. La fermeture de la modale suit le CA-50 : min(3 s, ce décompte), et pas de modale si le décompte vaut 0. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : le maximum de ce décompte reste 30 s. Un changement en cours de partie s'applique à partir de la question suivante.

   **Critère :** Quand tous ont répondu, les trois pages suivent le même décompte, calé sur l'horloge du serveur. Sans changement de réglage, la durée est 5 s. À l'ouverture de la modale, la page joueur (`gagnant_joueur_v2.png`) et la diffusion (`gagnant_diffusion_v2.png`) montrent le texte « Prochaine question dans : », sans nombre de secondes dans la phrase, et le cercle juste à droite. Après la fermeture, le même texte est en haut du bloc question sur ces deux pages, jusqu'à la question suivante (CA-44). Le bandeau est pleine largeur. Le fond est `#FFCA28`. Le texte est `#1a1a1a`, en gras, 18 px sur le téléphone et 28 px sur la diffusion. Le cercle est à droite, avec un chiffre de 24 px sur le téléphone et de 36 px sur la diffusion. La barre de progression mesure 5 px sur le téléphone et 8 px sur la diffusion. L'énoncé et les réponses restent visibles sous le bandeau. Deux clients dont l'horloge locale diffère affichent la même seconde restante dans le cercle. La visibilité en haut du bloc question, joueur et diffusion, est décidée. Couleurs, graisse, tailles et barre sont une Proposition de Design UI.

   **Cas limites :** la page animateur n'a pas la modale (CA-43) : le décompte y est synchronisé, et la recette ne décrit pas de bandeau sur cette page. Dernière question de la manche : non décrit. Réglage à 0 : pas de décompte, pas de modale de victoire (CA-50), pas de bandeau, la question suivante s'affiche après la décision. Décompte de 1 ou 2 s : la modale se ferme à la fin du décompte et le bandeau ne s'affiche pas. Décompte de 3 s ou plus : le bandeau affiche le temps restant. Reconnexion pendant le décompte : reprise à l'heure du serveur. Énoncé long ou réponses sur plusieurs lignes : le bandeau reste en haut, l'énoncé et les réponses restent lisibles en dessous. Le décompte du buzzer (§4.5) et l'avance automatique (§2.5, CA-15 du §4.8) sont alignés, plus en écart. Mode « Prêt ? » actif : un joueur qui rejoint pendant ce décompte entre les questions arrive en orange, et on l'attend (§4.5).

50. **CA-50 — Fermeture de la modale de victoire**

   **Règle :** Résolu par Minipen le 21/10/2026. L'alternative « 4 s ou 3 s », le provisoire « le code garde 4 s » et la question « délais fixes ou liés au décompte » sont remplacés. Côté joueur, la modale de victoire se ferme au bout de min(3 s, décompte entre les questions), ou plus tôt au clic. Si le décompte entre les questions vaut 0, la modale de victoire ne s'affiche pas. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : même règle sur la diffusion (CA-47). Choix incertain (Coding Agent, 21/10/2026), à confirmer par Minipen (CA-59) : cette fermeture min(3 s, décompte) est remplacée si confirmé par le bloc rond joueur. Le texte de ce CA est conservé.

   **Critère :** Sur la page joueur, avec un décompte entre les questions de D secondes, D > 0, la modale disparaît au bout de la plus petite des deux valeurs 3 et D, sauf si un clic la ferme avant. Avec D = 0, la modale n'apparaît pas. La diffusion reprend cette formule seulement au titre du choix incertain du CA-47.

   **Cas limites :** décompte de 1 ou 2 s : la modale se ferme à la fin du décompte et le bandeau ne s'affiche pas. Décompte de 3 s ou plus : le bandeau affiche le temps restant. Clic avant la fin : la modale se ferme et le bandeau prend le relais s'il reste du temps.

##### Cadre du gagnant

51. **CA-51 — Cadre rond**

   **Règle :** Un cadre rond partout, page joueur et écran de diffusion. Anneau de 4 px aux couleurs du joueur, doré par défaut, avec une légère lueur. Proposition de Design UI : `gagnant_joueur_v1.png` montre l'avatar rond de 120 px et l'anneau doré de 4 px avec lueur (le doré de la maquette est le défaut) ; `gagnant_diffusion_v1.png` montre l'avatar rond de 220 px.

   **Critère :** Sur les deux pages, le cadre du gagnant est rond et l'anneau mesure 4 px. L'anneau prend la couleur du joueur. Sans couleur de joueur, il est doré. Une lueur légère accompagne l'anneau. La taille d'avatar de la proposition est 120 px côté joueur et 220 px côté diffusion.

   **Cas limites :** joueur sans image : le cadre reste rond, avec le même anneau de 4 px. Le dessin qui remplace l'image absente n'est pas décrit par la recette. Les deux pages partagent l'anneau ; la taille de l'avatar diffère (CA-46, CA-47).

**Écarts du 21/10/2026 :**

1. **Emplacement de l'aperçu.** Résolu par Minipen le 21/10/2026. Le CA-30 est réécrit : « Aperçu diffusion » passe en tête de la colonne de droite, au-dessus du chat (CA-40). L'ancien emplacement sous le hero est remplacé, pas supprimé. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : le panneau « Affichage projeté » du CA-34 suit l'aperçu et reste collé dessous.
2. **Aside.** Résolu par Minipen le 21/10/2026. Les blocs de la colonne de droite sont pliables (CA-41). La règle « l'aside ne change pas » du CA-30 est remplacée. Le lieu de mémorisation (localStorage par navigateur) reste le choix incertain du CA-41.
3. **Compte à rebours.** Résolu par Minipen le 21/10/2026. Ce sont deux décomptes. L'entre-questions est le CA-49, `nextQuestionCountdownSec`, défaut 5 s, jamais `countdownDurationSec`. L'ouverture du buzzer est le §4.5, `countdownDurationSec`, après l'affichage de la question, dans le bouton buzzer côté joueur. Les deux sont optionnels (0 = pas de décompte) et se règlent dans l'interface animateur. Le défaut du buzzer déjà écrit dans le §4.5 est 5 secondes : il est conservé. Le minimum du buzzer passe à 0. L'ancienne règle « avant la question, au Prêt, 3 à 10 s, grands chiffres » est réécrite dans le §4.5, pas supprimée. La mention « réglage à la création, 3 à 30 s » est remplacée. Choix incertains (Specs Writer, 21/10/2026), à confirmer par Minipen : maximum 10 s pour le buzzer et 30 s pour l'entre-questions ; un changement en cours de partie s'applique à partir de la question suivante ; sur la diffusion, le décompte du buzzer reste affiché comme aujourd'hui, en plus du bouton. Maquette du bouton : `buzzer_decompte_joueur_v1.png`, Proposition de Design UI. Le mode optionnel « Prêt ? », résolu plus bas, s'intercale avant ce décompte quand il est actif.
4. **Avance automatique.** Résolu par Minipen le 21/10/2026. Le décompte entre les questions s'applique aussi en mode autonome (§2.5, §4.3, CA-15 du §4.8). 0 = pas d'attente supplémentaire. Le mode « Prêt ? », s'il est actif, vient après l'affichage de la question et ne retarde pas cette avance.
5. **Jeton et « Retour tableau ».** Résolu par Minipen le 21/10/2026. Le jeton animateur est dans le localStorage, une entrée par partie, effacée à la fin de la partie (§2.5, CA-48). La mention « choix incertain » est retirée du CA-48. L'ancienne mention sessionStorage du §2.5 est remplacée. Le §2.9 admet le lien « Retour tableau » sans afficher le jeton sur l'écran public. Cette résolution est conservée. Ancien état jusqu'au 23/10 : écart `f81d3ec`, À décider (Minipen), écrit au §2.5 et au CA-48 : le jeton reste dans l'adresse de la page animateur. Les deux questions, localStorage en plus et jeton visible dans l'adresse, ne sont pas tranchées. Fin de l'ancien état. La question « jeton visible dans l'adresse en plus du localStorage » est close au §2.5 et au CA-48. Constat de FB Coding Agent le 23/10/2026, correction à dater, demandée par FB Chef De Projet.
6. **Contenu de l'écran du gagnant.** Résolu par Minipen le 21/10/2026. La modale de point s'aligne sur la maquette : « Point pour <nom> », « +1 point », « Touchez pour fermer » (CA-46, CA-47). Le CA-20 et le §4.5 sont réécrits pour dire ce remplacement. Décidé par Minipen le 21/10/2026 : « +1 point » est remplacé par « + N points » pour un joueur, et par « + N points pour l'équipe <nom> » pour une équipe. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : au singulier, « + 1 point » ; le titre « Point pour <nom> » et l'avatar restent au-dessus. Le CA-20 (score ou rang, bouton « Suivant ») reste valable pour l'écran de fin de partie, toujours à confirmer.
7. **Fermeture de la modale joueur.** Résolu par Minipen le 21/10/2026 (CA-50). Fermeture à min(3 s, décompte entre les questions), ou plus tôt au clic. Décompte à 0 : pas de modale. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : même règle sur la diffusion (CA-47).

**Nouveaux écarts :** le titre « non tranchés » est remplacé. Les trois notes ci-dessous sont résolues par Minipen le 21/10/2026. Leur texte d'origine est conservé.

- Le bouton « Prêt » et son timeout de 30 s restent écrits au §4.5. Minipen a remplacé le départ du décompte buzzer (après l'affichage de la question, dans le bouton). Il ne dit pas si le bouton « Prêt » reste affiché, ni à quoi il sert encore. Résolu par Minipen le 21/10/2026 : cette note est remplacée. « Prêt ? » est un mode optionnel (§4.5). S'il est actif, il s'intercale entre le décompte entre les questions et le décompte du buzzer, sur le bouton. « Prêt ? » orange devient « Prêt ! » vert au clic, et un nouveau clic repasse en orange. Tous au vert : le décompte du buzzer démarre. S'il est inactif, le décompte du buzzer suit l'affichage de la question. Décidé le même jour pour une arrivée : pendant le décompte entre les questions ou pendant l'attente « Prêt ? », le joueur arrive en orange et on l'attend. Pendant une question, il est considéré comme prêt et peut répondre tout de suite. Ces deux règles remplacent le choix incertain (Coding Agent et Specs Writer, 21/10/2026) sur le joueur qui rejoint pendant l'attente. Le choix incertain sur le délai de 30 s est remplacé. Décidé par Minipen le 21/10/2026 : le délai automatique qui passe outre « Prêt ? » est conservé, 15 secondes par défaut, réglable dans l'interface animateur. L'« À décider » sur le forçage est remplacé : l'animateur peut lancer manuellement la question même si tout le monde n'est pas prêt. La liste des joueurs, sur tous les écrans, montre une coche verte devant chaque prêt et un petit sablier orange devant chaque pas prêt, seulement si le mode est actif. La proposition d'un emplacement vide est remplacée par ce sablier. Choix incertains (Specs Writer, 21/10/2026) : bornes 5 à 60 secondes, et 0 = pas de délai automatique ; le lancement manuel démarre le décompte du buzzer, ou ouvre le buzzer si ce décompte vaut 0. Proposition de Design UI : vert `#1E7A3C`, orange `#F07800`, icônes de la hauteur du nom. Le compteur « 3 / 5 joueurs prêts » reste une proposition, en plus de ces icônes.
- La maquette décidée dit « +1 point » et « Point pour <nom> ». Un delta autre que +1, et une équipe gagnante, n'ont pas de libellé distinct. Résolu par Minipen le 21/10/2026 : « +1 point » est remplacé par « + N points » pour un joueur, et par « + N points pour l'équipe <nom> » pour une équipe. Le singulier « + 1 point », et le maintien du titre et de l'avatar au-dessus, restent un choix incertain (Specs Writer, 21/10/2026).
- Le CA-33 retire la modale de point et l'écran §4.5 de la miniature. Cette phrase vient de la mise à jour de code du 21/10/2026. Minipen ne l'a pas confirmée. Résolu par Minipen le 21/10/2026 : le CA-33 est confirmé. L'aperçu de diffusion sur la page animateur n'affiche pas la modale du gagnant. Explication de Coding Agent : la fenêtre du gagnant affichée dans la miniature débordait et noircissait toute la page animateur. Elle a donc été retirée de la miniature, mais elle reste sur la vraie diffusion.

**Points ouverts de la recette :**

- CA-34 : le panneau « Affichage projeté » suit l'aperçu et reste collé dessous.
- CA-41 : lieu de mémorisation de l'état plié (localStorage par navigateur).
- §4.5 et CA-49 : maximum 10 s pour le buzzer, 30 s pour l'entre-questions ; changement en cours de partie à partir de la question suivante ; décompte du buzzer encore affiché en grand sur la diffusion, en plus du bouton.
- CA-20 : score ou rang, et bouton « Suivant », pour l'écran de fin de partie.
- CA-47 : même fermeture que le CA-50 sur la diffusion.
- Mode « Prêt ? » : réglage du mode dans l'interface animateur, comme les deux décomptes, et application d'un changement à partir de la question suivante. « Tous les joueurs » = joueurs connectés. Décompte du buzzer à 0 : ouverture dès que tout le monde est prêt. Compteur de diffusion, par exemple « 3/5 prêts ». Arrivée pendant le décompte du buzzer : le joueur compte comme prêt, parce que la question est déjà affichée. Cette phrase est conservée. Écart code/CDC relevé par Test Writer (commit `3a710c6`), `store.ts:411` : ce cas est À décider par Minipen (§4.5, CA-74). Pendant « Prêt ? », le téléphone n'affiche pas la liste avec les coches et les sabliers. La règle décidée, sur les trois écrans, reste. Délai automatique : bornes 5 à 60 secondes, et 0 = pas de contournement (on attend tous les joueurs ou l'animateur). Lancement manuel : il démarre le décompte du buzzer, ou ouvre le buzzer si ce décompte vaut 0. Tous ces points sont des choix incertains (Specs Writer, 21/10/2026), à confirmer par Minipen. Le lieu de ce lancement manuel sur l'écran animateur est repris par le CA-74.
- Compteur joueur « 3 / 5 joueurs prêts » sous le bouton (`buzzer_pret_joueur_v1.png`) : Proposition de Design UI, à confirmer par Minipen. Il s'ajoute à la coche et au sablier. Il ne se confond pas avec le compteur de diffusion. Correction d'accord, commit `601fa63`, pas un choix à confirmer : « 1 / 2 joueurs prêts ». Cette citation est conservée et alignée sur le singulier : « 1 / 2 joueur prêt ». Le singulier reste pour 1, « 1 joueur ». Commit `a4571828` : « 1 / 3 joueur prêt » et « 0 / 3 joueurs prêts ». Choix incertain (FB Specs Writer, 23/10/2026), À décider Minipen : le singulier partout (CA-76). La proposition du compteur reste ouverte.
- Coche et sablier : les couleurs `#1E7A3C` et `#F07800`, et la taille égale à la hauteur du nom, restent une Proposition de Design UI. La coche verte, le sablier orange et leur présence sur les trois écrans sont décidés.
- La 2e recette (CA-52 à CA-74) a ses propres questions ouvertes. Elle ne referme pas les points de cette liste.

---

#### Recette Minipen du 21/10/2026, 2e passage

**Statut :** En cours de correction. Correctifs livrés : `f0d817c` (« Prêt ? » sur le téléphone) et `b3efbf4` (le décompte ne dépasse plus la durée réglée). Livrés dans `6023afd` : la réponse D et le contour jaune visibles à 390×844, la même hauteur (398 px) pour le bloc « Prêt ? » et la zone des réponses, et le podium en escalier sur le téléphone. La recette de Testeur reste en cours.

**Périmètre :** retours de Minipen du 21/10/2026, vers 16 h. Les CA-52 à CA-74 s'ajoutent aux CA-1 à CA-51. Ils ne les retirent pas. Un bug est une régression : la règle déjà écrite reste, et le CA demande qu'elle tienne à nouveau. Les maquettes sont hors dépôt, dossier `/workspace/ui/buzzy/`.

**Références :**

- `buzzer_etats_joueur_v3.png` — bouton rond en relief dans tous les états. Décidé par Minipen le 21/10/2026 (« très bien »). `buzzer_etats_joueur_v2.png` n'est plus valable. La v3 reste décidée pour les états autres que le 4e écran.
- `buzzer_etats_joueur_v4.png` — remplace la v3 pour le 4e écran (résultat joueur). Bonne réponse sur fond vert avec une coche, réponse du joueur avec un contour jaune, votes à droite avec le pourcentage arrondi, par exemple « 11 (61%) », comme sur la diffusion. La coche est une Proposition de Design UI (CA-62, CA-63).
- `buzzer_bonne_reponse_choisie_v1.png` — le joueur a choisi la bonne réponse. Proposition de Design UI et de Testeur, à confirmer par Minipen (CA-62).
- `buzzer_etats_joueur_v5.png` — pendant « Prêt ? » et « Prêt ! », phrase humoristique. Proposition de Design UI (CA-64). Minipen l'a validée (« très bien ») pour les réponses cachées (CA-65). Elle n'est plus la maquette à citer pour la taille du bloc : `buzzer_etats_joueur_v6.png` la remplace.
- `buzzer_etats_joueur_v6.png` — bloc d'attente sur un téléphone de 390×844, 386 px, phrase centrée et plus grosse (CA-66). Cette mesure illustre cet écran. La phrase « la hauteur décidée n'est pas une valeur fixe » est remplacée : pour un écran donné, la zone a une taille fixe (CA-66).
- `buzzer_pret_joueur_v2.png` et `buzzer_decompte_joueur_v2.png` — maquettes valables pour « Prêt ? » et le décompte du buzzer. Elles montrent la question qui vient d'être jouée. Les v1 citées plus haut ne sont plus valables. Pour « Prêt ? », cette question affichée est remplacée par le texte humoristique (CA-64). La phrase sur la question jouée est conservée.
- `phrases_pret.txt` — 18 phrases préparées par Design UI, hors dépôt, même dossier. Cette liste est celle intégrée au code (CA-64). Son chemin dans le dépôt n'est pas encore sur main : aucun chemin n'est cité.
- `editeur_limites_v1.png` — compteur de l'éditeur, validé par Minipen (« c'est parfait », CA-69). Hors dépôt, même dossier. Les détails de gris, de 85 % et de contour rouge sont des Propositions de Design UI. Il n'y a pas de maquette pour la répartition de hauteur du CA-66.
- `podium_diffusion_v1.png` et `podium_joueur_v1.png` — écran de fin de manche (CA-73). Hors dépôt, ordinateur partagé, pas dans le dépôt. La diffusion est en 1600×900, ordre 2-1-3. Le téléphone est en 390×844, sans défilement. Ces dessins sont des choix incertains de Design UI, à confirmer par Minipen.
- `animateur_parametres_v1.png` — barre du bas et bloc « Paramètres de la partie » (CA-74). 1600×1080. Hors dépôt, ordinateur partagé, pas dans le dépôt. Les quatre boutons ont chacun une icône. Le bloc est sous le scénario, en trois groupes. La ligne de résumé et la mémoire d'une visite à l'autre sont des Propositions de Design UI. Le placement des boutons occasionnels sous la question en cours est un choix incertain de Design UI.

##### Bugs

52. **CA-52 — Un seul buzz enregistre le joueur**

   **Règle :** Régression. La règle déjà écrite reste : un joueur ne buzze qu'une fois par fenêtre, et ce buzz l'ajoute à `buzzOrder` (§2, §4.8). Minipen, mot pour mot : « les joueurs doivent buzzer 2 fois pour être enregistrés (mais pas toujours, j'ai du mal à reproduire le bug) ». Un seul buzz doit toujours suffire.

   **Critère :** Sur `/party/:partyId/play`, un seul buzz accepté pendant une fenêtre ouverte enregistre le joueur. La file de l'animateur le montre sans second appui. Un second appui ne crée pas une seconde entrée.

   **Cas limites :** deux clics rapides : seul le premier enregistre le joueur. Buzz pile au changement d'état du buzzer (ouverture, ou passage à l'état « déjà buzzé ») : s'il part pendant que la fenêtre est ouverte, il enregistre le joueur ; s'il part après la fermeture, il est refusé comme un buzz fenêtre fermée. Premier toucher sur écran tactile : ce premier contact suffit, sans second toucher. Question ouverte pour Minipen, Testeur attend la réponse : le bug vu l'a-t-il été au téléphone ou à la souris ? Ce CA ne choisit pas l'appareil.

53. **CA-53 — Surbrillance QCM à nouveau au relâchement**

   **Règle :** Régression du CA-45. Minipen : la mise en avant de la réponse sélectionnée ne fonctionnait pas bien, elle ne fonctionne plus du tout. Le CA-45 reste la règle : la surbrillance s'allume dès le relâchement, tant que le pointeur est encore sur le choix. Ce CA ne réécrit pas le CA-45.

   **Critère :** Le critère du CA-45 tient à nouveau sur `/party/:partyId/play`. Un relâchement sur le choix allume la surbrillance à cet instant. Décidé avec `buzzer_etats_joueur_v3.png` : la réponse choisie garde la même taille de texte, avec un contour et une lettre jaunes.

   **Cas limites :** ceux du CA-45 (tactile, relâchement hors du bouton). Après validation, la taille du texte ne change pas (CA-54).

54. **CA-54 — Taille du texte des réponses stable**

   **Règle :** Régression. Minipen : la taille des textes des réponses change une fois la réponse validée. Elle ne doit pas changer.

   **Critère :** Sur la page joueur, chaque réponse a la même taille de texte avant la validation et après. La validation peut ajouter le contour jaune (CA-53, maquette v3). Elle ne change pas la taille.

   **Cas limites :** énoncé long, réponse sur deux lignes : la taille reste celle d'avant la validation. Quatre réponses ou plus : aucune ne change de taille au moment de la validation.

55. **CA-55 — Pas d'écran noir côté diffusion**

   **Règle :** Régression. Minipen : « j'ai de nouveau des écrans noirs coté diffusion. » Le CA-44 reste la règle : aucune des trois pages ne reste noire, et la question suivante s'affiche sans rafraîchissement. Le noircissement de la page animateur par la fenêtre du gagnant dans la miniature est l'autre cas déjà écrit (CA-33) : la miniature n'a pas cette fenêtre, la vraie diffusion l'a. Ce CA ne réécrit ni le CA-44 ni le CA-33. Écart code/CDC relevé par Test Writer (commit `5fd119a`), non tranché. Le serveur ne passe jamais `state` à "ended". L'écran noir vient de `WinnerScreen` en plein écran en fin de manche. Le CA-55 et le CA-44 restent : aucune des trois pages ne reste noire. L'écran de remplacement en fin de manche reste non décrit (CA-44). Le correctif n'est pas choisi. Cette phrase sur l'écran non décrit est conservée et remplacée : l'écran attendu est le podium du CA-73, à la place de `WinnerScreen`. Le passage de `state` à "ended" n'est pas choisi.

   **Critère :** Sur `/party/:partyId/broadcast`, après un buzz, après une validation, et au passage à la question suivante, l'écran ne devient pas noir. Aucun rechargement n'est nécessaire pour revoir la diffusion.

   **Cas limites :** ceux du CA-44. Deux diffusions ouvertes : aucune des deux ne reste noire. La miniature animateur suit le CA-33.

##### Décisions

56. **CA-56 — Texte « Réponse enregistrée » retiré**

   **Règle :** Décidé par Minipen le 21/10/2026. Le texte « Réponse enregistrée — l'animateur doit valider dans la file de buzz avant l'indication bon / mauvais à l'écran. » est inutile sous les réponses lorsque la réponse est validée. Il est supprimé à cet endroit.

   **Critère :** Une fois la réponse validée, cette phrase n'apparaît pas sous les réponses, sur la page joueur. L'indication bon ou mauvais, quand l'animateur valide, n'est pas retirée par ce CA.

   **Cas limites :** avant la validation, la recette ne dit pas si une autre phrase s'affiche. QCM et question libre : la phrase citée est absente sous les réponses dès que la réponse du joueur est enregistrée.

57. **CA-57 — Le buzzer reste après le buzz**

   **Règle :** Décidé par Minipen le 21/10/2026. Le buzzer ne disparaît plus après un buzz. Il reste visible et change d'état. La phrase du §2 « Le bouton buzz est grisé si la fenêtre est fermée ou si le joueur a déjà buzzé » est conservée. Minipen avait mis un point d'interrogation (« passage au gris ? »). Ce point est remplacé par la validation de `buzzer_etats_joueur_v3.png` : l'état après buzz est le bouton gris « Buzz envoyé ».

   **Critère :** Après un buzz enregistré, le bouton buzzer est encore dans la page joueur. Il n'est pas retiré du flux. Il est gris et porte « Buzz envoyé », comme la maquette décidée. Un second buzz sur cet état ne réenregistre pas le joueur (CA-52).

   **Cas limites :** fenêtre qui se ferme sans que ce joueur ait buzzé : le bouton reste visible. Reconnexion après le buzz : le bouton revient déjà gris « Buzz envoyé », pas absent.

58. **CA-58 — Maquette des états du buzzer**

   **Règle :** Décidé par Minipen le 21/10/2026 : `buzzer_etats_joueur_v3.png` (« très bien »). Elle reprend le bouton rond en relief dans tous les états. « Prêt ? » est orange, avec une vague qui tourne. « Prêt ! » est vert, avec des rayons qui pulsent. Après un buzz, le bouton est gris « Buzz envoyé » (CA-57). Pour le gagnant, un disque remplace le buzzer, avec le nom, le gain et le décompte (CA-59). La réponse choisie garde la même taille de texte, avec un contour et une lettre jaunes (CA-53, CA-54). L'écart « +1 point » est résolu : la maquette affiche « + 1 point ». La proposition de Minipen (garder la forme du buzzer rouge, vague autour de l'orange, rayons autour du vert) est confirmée par cette validation. `buzzer_pret_joueur_v1.png`, `buzzer_decompte_joueur_v1.png` et `buzzer_etats_joueur_v2.png` ne sont plus valables. `buzzer_pret_joueur_v2.png` et `buzzer_decompte_joueur_v2.png` sont les maquettes valables de ces deux moments : elles montrent la question qui vient d'être jouée (CA-60). Les vitesses d'animation restent à confirmer par Minipen. Proposition de Design UI pour une équipe : « + N points pour l'équipe … » sur la même ligne que le gain, le nom de l'équipe passant sur deux lignes s'il est long. `buzzer_etats_joueur_v4.png` remplace la v3 pour le seul 4e écran : bonne réponse sur fond vert avec une coche, réponse du joueur avec un contour jaune, votes à droite, par exemple « 11 (61%) », comme sur la diffusion. La coche est une Proposition de Design UI. La v3 reste décidée pour les autres états. L'écart « Vous ! » est résolu. Proposition de Design UI et de Testeur, à confirmer par Minipen, référence `buzzer_bonne_reponse_choisie_v1.png` : « Vous ! » remplace seulement le nom, et uniquement sur le téléphone du joueur gagnant. « + N points » reste en dessous. Les autres joueurs voient le nom du gagnant. Sur cette maquette, la bonne réponse choisie garde le fond vert, avec un contour jaune de 3 px et une lettre jaune.

   **Critère :** La page joueur reprend ces états, dans la forme ronde en relief de la maquette décidée (v3, et v4 pour le 4e écran). Le disque du gagnant affiche « + 1 point » quand le gain est de 1. Un gain autre que 1 reste « + N points » (§4.5). Le singulier « + 1 point » de ce disque est celui de la maquette validée. « Vous ! », s'il est confirmé, ne remplace que le nom sur le téléphone du gagnant.

   **Cas limites :** équipe gagnante : la ligne proposée par Design UI n'est pas encore décidée. Animation : les vitesses ne sont pas fixées. Compteur « 3 / 5 joueurs prêts » : il reste la proposition déjà écrite, en plus de ces états.

59. **CA-59 — Bloc rond joueur, notification sur la diffusion**

   **Règle :** Choix incertain (Coding Agent, 21/10/2026), à confirmer par Minipen. Ce n'est plus un « À décider » sans lecture. Coding Agent le code déjà. Côté joueur, un bloc rond au-dessus du buzzer remplace la fenêtre. La notification ne reste que sur la diffusion. La maquette décidée montre ce bloc comme un disque à la place du buzzer, avec le nom, le gain et le décompte (CA-58). S'il est confirmé, il remplacerait la modale joueur du CA-46 et la fermeture min(3 s, décompte) du CA-50. Ces deux CA portent la mention « remplacé si confirmé ». Leur texte est conservé. La notification de diffusion reste le CA-47 : ce choix ne le retire pas. CA concernés, non réécrits : CA-43, CA-46, CA-47, CA-49, CA-50, CA-51, et les phrases de modale du §4.5.

   **Critère :** Tant que Minipen n'a pas confirmé, le CA-46 et le CA-50 restent la règle écrite. Le disque de la maquette v3 est le dessin de ce bloc. La diffusion garde une notification de gagnant (CA-47). La page joueur n'aurait plus de fenêtre modale si le choix est confirmé.

   **Cas limites :** décompte entre les questions à 0 : le CA-50 dit qu'il n'y a pas de modale. Le bloc rond, s'il est confirmé, n'a pas encore de règle de durée propre. Animateur : le CA-43 (pas de modale sur cette page) n'est pas modifié par ce choix.

##### Question affichée pendant les décomptes

60. **CA-60 — La question qui vient d'être jouée reste pendant les trois décomptes**

   **Règle :** Minipen, relayé par Chef De Projet le 21/10/2026 : pendant les trois décomptes (entre les questions, attente « Prêt ? », ouverture du buzzer), c'est la question actuelle qui reste affichée. Aucun écran (animateur, joueur, diffusion) ne montre la question suivante avant la fin de ces décomptes. C'est un bug actuel : on lit déjà la question suivante pendant le décompte. Choix incertain (Coding Agent, 21/10/2026), à confirmer par Minipen, à la place de la lecture précédente. Lecture retenue : la question qui vient d'être jouée reste affichée pendant les trois décomptes. La nouvelle n'apparaît qu'à l'ouverture du buzzer. La lecture précédente (question suivante déjà affichée pendant « Prêt ? » et le décompte du buzzer, envoyée dès la fin du décompte entre les questions) est remplacée par celle-ci. Décidé (Minipen, 21/10/2026, réponse transmise par Coding Agent) : la nouvelle question s'affiche seulement quand le buzzer s'ouvre, pas au début du décompte. Minipen a répondu en privé, à 22h52 heure de Paris : « la nouvelle question s'affiche seulement quand le buzzer s'ouvre ». L'écart relevé par Testeur (les joueurs n'ont plus le décompte pour lire la nouvelle question) est connu et ne change pas cette décision. La phrase du §4.5 « le décompte du buzzer démarre après l'affichage de la question » est conservée, pas réécrite. L'ambiguïté est celle-ci : la lecture de Coding Agent place « Prêt ? » et le décompte du buzzer avant l'affichage de la nouvelle question. L'autre lecture afficherait la nouvelle question au début du décompte du buzzer, buzzer encore fermé, après « Prêt ? » si ce mode est actif. `buzzer_pret_joueur_v2.png`, `buzzer_decompte_joueur_v2.png` et `buzzer_etats_joueur_v3.png` montrent la question précédente pendant « Prêt ? » et le décompte du buzzer. Les maquettes plus anciennes, qui montraient la question suivante, ne sont plus valables. Design UI les a corrigées dans ces fichiers. Décidé par Minipen le 21/10/2026 : pendant l'attente « Prêt ? », cette règle ne tient plus. La question n'est pas affichée. Le bloc, de taille identique, montre un texte humoristique tiré au hasard (CA-64). L'ancien texte de ce CA, qui laissait la question jouée pendant « Prêt ? », est conservé et remplacé pour cette phase seulement. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : pendant les deux autres décomptes, la règle précédente s'applique toujours. Cette phrase est conservée et rejoint la décision ci-dessus. Écart code/CDC relevé par Test Writer (commit `5fd119a`), non tranché. `commitCueAdvance` avance `currentQuestionIndex` avant la pause. La question suivante est donc visible trop tôt sur l'animateur, le joueur et la diffusion. La règle décidée de ce CA reste. Le correctif dans le code n'est pas choisi. Écart code/CDC du commit `d5556f2`, non tranché. En mode normal (§4.4), la première question s'affiche buzzer fermé. Le CA-60, décidé, dit qu'une nouvelle question n'apparaît qu'à l'ouverture du buzzer. Les questions suivantes restent masquées jusqu'à l'ouverture. À décider (Minipen) : soit la première question fait exception, soit le mode normal doit attendre l'ouverture. La règle décidée de ce CA est conservée.

   **Critère :** Décidé (Minipen, 21/10/2026) : pendant le décompte entre les questions et pendant le décompte du buzzer, l'animateur, le joueur et la diffusion affichent la question qui vient d'être jouée, pas la suivante. La suivante apparaît seulement quand le buzzer s'ouvre, pas au début du décompte du buzzer. Pendant « Prêt ? », le CA-64 s'applique : le bloc porte le texte humoristique, pas la question.

   **Cas limites :** les trois durées à 0, et « Prêt ? » inactif : il n'y a pas de décompte. La nouvelle question apparaît à l'ouverture du buzzer, tout de suite. « Prêt ? » inactif, avec un décompte entre les questions ou un décompte du buzzer : la question jouée reste pendant les décomptes qui existent. Joueur qui rejoint pendant un de ces décomptes : il voit la question jouée, pas la suivante. Pendant « Prêt ? », il voit le texte humoristique du CA-64, le même que les autres. Lancement manuel : le sens déjà incertain reste (décompte du buzzer, ou ouverture directe si ce décompte vaut 0). Décidé (Minipen, 21/10/2026) : la nouvelle question attend l'ouverture. Si le geste ne fait que démarrer le décompte du buzzer, la question jouée reste pendant ce décompte. Si le décompte vaut 0 et que le geste ouvre le buzzer, la nouvelle question apparaît alors. Première question en mode normal (`d5556f2`) : elle s'affiche buzzer fermé. Les questions suivantes restent masquées jusqu'à l'ouverture. À décider (Minipen) : exception pour la première question, ou attente de l'ouverture en mode normal. La règle décidée est conservée.

61. **CA-61 — La question suivante n'est pas envoyée avant l'ouverture**

   **Règle :** Décidé (Minipen, 21/10/2026), avec le CA-60. Le choix incertain de Coding Agent est confirmé. Le serveur n'envoie pas la question suivante avant l'ouverture du buzzer. Elle n'est pas dans ce que reçoivent les pages, pour qu'on ne puisse pas la lire en avance, même dans le code de la page. La formulation plus étroite « pas avant la fin du décompte entre les questions », qui l'aurait laissée présente pendant « Prêt ? » et le décompte du buzzer, est remplacée par celle-ci.

   **Critère :** Avant l'ouverture du buzzer, le snapshot et les messages reçus par l'animateur, le joueur et la diffusion ne contiennent ni l'énoncé ni les réponses de la question suivante. À l'ouverture, ils les contiennent.

   **Cas limites :** reconnexion pendant un des trois décomptes : la question suivante est toujours absente. Décompte du buzzer à 0 : elle arrive au moment de l'ouverture, pas avant. Décidé (Minipen, 21/10/2026), avec le CA-60 : la question suivante est envoyée seulement à l'ouverture du buzzer, pas au début du décompte.

##### Résultat côté joueur

62. **CA-62 — Bonne réponse en vert, choix du joueur en jaune**

   **Règle :** Décidé par Minipen le 21/10/2026, en plus de `buzzer_etats_joueur_v3.png`, pour le 4e écran (résultat côté joueur). La bonne réponse s'affiche sur fond vert. La réponse du joueur garde son surlignage jaune. `buzzer_etats_joueur_v4.png` remplace la v3 pour cet écran et applique ces ajouts : fond vert avec une coche, contour jaune sur la réponse du joueur. La coche est une Proposition de Design UI. La phrase « les retouches restent à faire » est remplacée par cette v4 pour ces ajouts. Choix incertain (Specs Writer et Coding Agent, 21/10/2026), à confirmer par Minipen : si le joueur a choisi la bonne réponse, celle-ci a le fond vert et le contour jaune. Proposition de Design UI et de Testeur, référence `buzzer_bonne_reponse_choisie_v1.png` : le fond vert reste, le contour jaune mesure 3 px, la lettre est jaune. Le disque affiche « Vous ! » selon le CA-58 : seulement à la place du nom, seulement sur le téléphone du gagnant.

   **Critère :** Sur la page joueur, à l'écran de résultat, la bonne réponse a un fond vert. La réponse choisie par ce joueur garde le contour jaune, y compris si ce n'est pas la bonne. La taille du texte reste celle d'avant (CA-54). La coche sur le fond vert est la proposition de `buzzer_etats_joueur_v4.png`.

   **Cas limites :** le joueur n'a pas répondu : aucune réponse n'a de surlignage jaune. La bonne réponse a quand même le fond vert. Le cumul fond vert et contour jaune, quand le joueur a la bonne réponse, reste le choix incertain ci-dessus.

63. **CA-63 — Nombre de répondants et pourcentage**

   **Règle :** Décidé par Minipen le 21/10/2026, sur le même 4e écran. Chaque réponse affiche le nombre de répondants et le pourcentage. `buzzer_etats_joueur_v4.png` les place à droite, avec le pourcentage arrondi, par exemple « 11 (61%) », comme sur la diffusion. Choix incertains (Specs Writer et Coding Agent, 21/10/2026), à confirmer par Minipen : le format est « 2 (11%) », de la même forme que l'exemple « 11 (61%) » de la v4. Le pourcentage est calculé sur les joueurs qui ont répondu, pas sur tous les connectés. Avec 0 répondant, toutes les réponses affichent « 0 (0%) ». Le choix incertain de Coding Agent et de Test Writer, « chacun est arrondi séparément et le total peut ne pas faire 100 % », passe à Décidé. Minipen, mot pour mot : « pas grave pour les pourcentages si ça ne fait pas 100 % ». Chaque pourcentage est arrondi séparément. Un total différent de 100 % est accepté.

   **Critère :** Chaque réponse du résultat joueur montre un effectif et un pourcentage arrondi à part. Un total autre que 100 % reste affiché tel quel. L'écriture « 2 (11%) », et l'exemple v4 « 11 (61%) », restent le choix incertain de format. Le calcul sur les répondants, et « 0 (0%) », aussi.

   **Cas limites :** la somme des pourcentages arrondis peut ne pas faire 100 %. Cette constatation est décidée : elle est acceptée. Un joueur qui n'a pas répondu n'a pas de surlignage jaune (CA-62). Sous le choix incertain, il ne compte pas dans le total des répondants. Zéro répondant : « 0 (0%) » sur chaque réponse, sous le même choix incertain. Le format « 2 (11%) » est l'exemple cité pour l'écriture, pas un calcul supplémentaire.

64. **CA-64 — Texte humoristique pendant « Prêt ? »**

   **Règle :** Décidé par Minipen le 21/10/2026. Mot pour mot : « sur le 'pret ?' / 'pret !' la question ne doit pas être affichée ! elle est remplacée par un bloc de taille identique avec un texte aléatoire humoristique ». Pendant l'attente « Prêt ? », le bloc de la question est remplacé par un bloc de la même taille, qui affiche un texte humoristique tiré au hasard. Décidé par Minipen le 21/10/2026, mot pour mot : « il faut que le bloc d'attente prenne la même taille que les questions ET les réponses, pour éviter un trou entre le bloc et le buzzer ». La phrase « bloc de la même taille » est conservée et remplacée : le bloc d'attente occupe la hauteur de la question et des réponses réunies, et non une valeur fixe (CA-66). La précision « et non une valeur fixe » est à son tour remplacée : cette zone a une taille fixe pour un écran donné, et le bloc d'attente la remplit exactement. Exemples de Minipen : « Chauffe Marcel ! », « Une question bien cuite pour la table 4 s'il vous plait ! », « Attachez vos ceintures, la prochaine question arrive ! », « Décollage imminent de la prochaine question ! », « Branchez bien vos neurones ! ». Cette décision remplace, pour cette phase seulement, la partie « Prêt ? » du CA-60. L'ancien texte du CA-60 est conservé. Proposition de Design UI, référence `buzzer_etats_joueur_v5.png` : la phrase est en jaune italique, sur fond violet foncé, sous la mention « Question 4 / 10 · en préparation ». Le bloc garde la taille du bloc question. Minipen a validé cette v5 (« très bien ») pour le fond et pour les réponses cachées (CA-65). La maquette à citer pour le bloc est maintenant `buzzer_etats_joueur_v6.png`, qui remplace la v5 : sur un téléphone de 390×844, le bloc mesure 386 px, la phrase est centrée et plus grosse. Ces 386 px illustrent cet écran. Ils ne sont pas la hauteur fixe de la règle. Décidé par Minipen le 21/10/2026, mot pour mot : « oui, très bien, même phrase chez tout le monde ». La phrase est la même sur tous les écrans, tirée par le serveur. Le choix incertain qui joignait cette identité au tirage « jamais deux fois de suite » est remplacé sur ce premier point. Le tirage qui ne sort jamais deux fois de suite la même phrase reste un choix incertain (Coding Agent, 21/10/2026), à confirmer par Minipen. Le fichier de départ de Coding Agent contient 15 phrases, les cinq de Minipen plus, par exemple, « On sort les cerveaux du congélateur ! » et « La question sort du four, attention ça brûle ! ». Cette fiche de 15 est remplacée : la liste intégrée au code est celle de Design UI, 18 phrases, dont celles de Minipen, préparées dans `/workspace/ui/buzzy/phrases_pret.txt` (hors dépôt). Le CDC ne fixe pas de nombre. Sur main, le chemin de ce fichier dans le dépôt n'est pas encore présent : aucun chemin de code n'est cité. Le minimum de 20 phrases, un temps envisagé, est retiré. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : pendant les deux autres décomptes, la question qui vient d'être jouée reste affichée (CA-60).

   **Critère :** Mode « Prêt ? » actif, pendant l'attente : l'animateur, le joueur et la diffusion ne montrent pas l'énoncé de la question dans le bloc. Ils montrent le même texte humoristique, tiré par le serveur. Le bloc occupe la hauteur de la question et des réponses réunies (CA-66). L'ancienne exigence « bloc de la même taille » que la question seule est remplacée. Les cinq exemples de Minipen font partie des phrases possibles. Le nombre de phrases n'est pas un critère.

   **Cas limites :** la liste ne contient qu'un texte : ce texte est affiché. La règle « jamais deux fois de suite », encore incertaine, ne peut pas s'appliquer dans ce cas. Un joueur qui rejoint pendant l'attente voit le même texte que les autres. Texte long sur téléphone : le bloc garde la hauteur question + réponses, pas une hauteur à part. « Prêt ? » inactif : ce bloc humoristique n'apparaît pas.

65. **CA-65 — Réponses cachées pendant « Prêt ? »**

   **Règle :** Choix incertain (Design UI, 21/10/2026), à confirmer par Minipen. Pendant « Prêt ? » et « Prêt ! », les réponses sont elles aussi cachées, pour ne pas trahir la question. La maquette `buzzer_etats_joueur_v5.png` montre le bloc de la phrase (CA-64). Elle ne décide pas ce point. Tant que Minipen n'a pas confirmé, ce CA n'est pas une règle. Cette réserve est remplacée. Décidé par Minipen le 21/10/2026 : il a validé la v5. Les réponses sont cachées pendant l'attente « Prêt ? ».

   **Critère :** Pendant l'attente « Prêt ? », les réponses ne sont pas visibles sur les écrans qui montrent le texte humoristique. L'ancien critère « s'il est confirmé » est remplacé par cette règle.

   **Cas limites :** « Prêt ? » inactif : les réponses de la question affichée restent visibles selon le CA-60. Joueur qui rejoint pendant l'attente : il ne voit pas les réponses. La question suivante, elle, reste soumise au CA-61.

66. **CA-66 — Pas de trou ni de saut, buzzer immobile**

   **Règle :** Décidé par Minipen le 21/10/2026. Pendant « Prêt ? », le bloc d'attente occupe la hauteur de la question et des réponses réunies, et non une valeur fixe. Il n'y a aucun trou au-dessus du buzzer, et aucun saut de mise en page quand la question s'affiche. L'ancienne taille « celle du bloc question seul » du CA-64 est conservée et remplacée par cette hauteur. `buzzer_etats_joueur_v6.png` remplace la v5 pour ce bloc : sur un téléphone de 390×844, le bloc mesure 386 px, la phrase est centrée et plus grosse. Cette mesure illustre cet écran. Le choix incertain « le bloc prend la hauteur de la question précédente et de ses réponses, un petit saut est accepté si la nouvelle diffère, et la première question a une hauteur par défaut » est remplacé. Décidé par Minipen le 21/10/2026, mot pour mot : « le bloc question doit avoir une taille FIXE ! il faut diminuer la taille de la police si nécessaire pour une longue question, pareil pour les réponses... Je ne veux aucun 'saut' dans l'interface et le buzzer doit toujours être au même endroit ! » La zone question et réponses a une taille fixe pour un écran donné, quel que soit le texte. Le bloc d'attente « Prêt ? » remplit exactement cette zone. Le texte d'une longue question, ou d'une longue réponse, réduit sa police pour tenir dans la zone. Aucun saut de mise en page à aucun moment de la partie. Le buzzer reste toujours au même endroit. Écart avec la piste de Coding Agent : une zone qui s'étire jusqu'au buzzer, avec défilement interne si le contenu déborde. La décision de Minipen réduit la police au lieu de faire défiler. Choix incertains (Specs Writer, 21/10/2026), à confirmer par Minipen : la zone est calculée à partir de la hauteur de l'écran, pas du texte. La question et chaque réponse ont une taille de police minimale. Un défilement interne n'intervient qu'en dernier recours, si la police minimale ne suffit pas, sans jamais déplacer le buzzer. Cette phrase est conservée et remplacée. Décidé par Minipen le 21/10/2026, mot pour mot : « pas de défilement interne autorisé. » Aucun défilement dans la zone question et réponses (CA-67). Le choix « coupé avec … » en cours de partie a été formulé, puis retiré avant d'être une règle. Il est remplacé par la correction à la création (CA-68) et par l'absence de coupe en jeu (CA-67). Les réponses d'une même question gardent toutes la même taille de police. Décidé par Minipen le 21/10/2026, mot pour mot : « on va couper en deux : 14 mini pour la question et 10 pour les réponses. » Les polices minimales en jeu sont 14 px pour la question et 10 px pour les réponses. La proposition de Design UI « 15 px pour la question et 12 px pour les réponses », adoptée un temps par Coding Agent, est conservée et remplacée. Les 8 px du code de Coding Agent sont conservés et remplacés. L'écart sur les 8 px est résolu. Proposition de Design UI, pour un téléphone de 390×844 : la question tient dans un bloc de 120 px, au plus 3 lignes, police de 21 px qui descend de 1 px en 1 px jusqu'à 15 px. Quatre réponses de 50 px chacune, au plus 2 lignes, police de 16 px qui descend jusqu'à 12 px. Cette proposition est conservée et remplacée. Proposition de Design UI suivante : un bloc question de 140 px et des cases de réponse de 46 px, le tout dans 386 px sur un écran de 390×844. Ce calcul part encore d'une police de 15 px, alors que les minima décidés sont 14 px et 10 px. Ces 140 px et 46 px sont conservés et remplacés comme tailles fixes. Ils servent désormais d'exemple pour le 390×844. Ils ne sont pas le résultat de la répartition ci-dessous, et ils ne sont pas la taille de tous les téléphones. Proposition de Design UI pour la répartition de la hauteur, valable sur tous les téléphones : un en-tête de 48 px ; une zone question et réponses qui occupe 50 % de la hauteur restante, dont 35 % pour la question et le reste partagé entre les quatre réponses ; un buzzer dont le diamètre fait 30 % de la hauteur restante, avec un maximum de 230 px, centré sous la zone. En 360×640, cela donne une zone d'environ 296 px, une question de 104 px, des réponses de 40 px et un buzzer d'environ 178 px. Cette répartition remplace les 140 et 46 px fixes. Écart : elle suppose quatre réponses. Le CDC (§2) ne fixe pas ce nombre. `quizChoiceIndex` va de 0 à N-1, et le joueur voit les choix « A, B, C, D… ». Avec 2 ou 6 réponses, la zone garde déjà la même hauteur et le buzzer ne bouge pas. Le partage de cette zone quand N n'est pas 4 n'est pas décidé. Cette phrase est conservée et remplacée par une Proposition de Design UI, toujours à confirmer par Minipen. La zone des réponses garde toujours la même hauteur, et ce sont les cases qui s'adaptent. De 2 à 4 réponses : une seule colonne, hauteur partagée à parts égales. Avec 2 réponses, la police peut monter jusqu'à 16 px. 5 ou 6 réponses : deux colonnes de 3 lignes, avec une largeur divisée par deux. L'aperçu de l'éditeur mesure aussi ce cas. Le bloc question et le buzzer ne bougent pas, quel que soit N : ce point est déjà décidé. La disposition des cases est la proposition. Au-delà de 6 réponses, rien n'est défini. C'est À décider par Minipen. Choix incertain (Coding Agent, 21/10/2026), à confirmer par Minipen : la hauteur de la zone ne change pas pendant toute la partie. Elle est calculée d'après l'écran du téléphone, pour que tout tienne sans défilement, y compris en 360×640. La taille fixe pour un écran donné, et le recalcul seulement à la rotation, sont déjà décidés.

   **Critère :** On mesure la position du buzzer à chaque phase : décomptes, attente « Prêt ? », question ouverte, résultat. Elle ne change pas. Testeur la mesure sur trois écrans : 360×640, 390×844, et une tablette. Ce CA est vérifié par un test navigateur (Playwright, selon Test Writer), et non par Vitest. Le §5.1.4 conserve « Aucun test Playwright n'est configuré ». Cette phrase n'est pas réécrite : elle décrit l'état du dépôt. Le critère du CA-66 reste un test navigateur, pas un test Vitest. Le bloc d'attente et la zone question et réponses occupent le même rectangle sur un écran donné. Une question longue ou une réponse longue s'affiche en police plus petite, sans descendre sous 14 px pour la question ni sous 10 px pour les réponses, et le buzzer ne descend pas. La zone ne défile pas.

   **Cas limites :** question très longue : la police diminue, le buzzer ne bouge pas. Réponses très longues : même réduction. 2 réponses ou 6 réponses : la zone garde la même hauteur, le buzzer reste à la même place. Le partage « entre les quatre réponses » de la proposition de Design UI ne s'applique pas à ces nombres, et la formule de partage n'est pas décidée. Cette phrase est conservée et remplacée. La proposition décrit 2 à 4 réponses en une colonne, et 5 ou 6 réponses en deux colonnes de 3 lignes. Elle reste à confirmer. Au-delà de 6 réponses : rien n'est défini, À décider. Rotation du téléphone : la zone se recalcule pour le nouvel écran, et c'est le seul changement admis. L'apparition ou la disparition de la barre d'adresse ne compte pas comme un changement (CA-71). Les 386 px de la v6 restent la mesure de l'exemple 390×844, pas la taille de tous les écrans. Les 140 px et 46 px restent l'exemple de l'ancienne proposition sur ce même écran. « Prêt ? » inactif : pas de bloc d'attente, et le buzzer de la question ouverte est déjà à cette place fixe.

67. **CA-67 — Pas de défilement, et rien n'est coupé en jeu**

   **Règle :** Décidé par Minipen le 21/10/2026, mot pour mot : « pas de défilement interne autorisé. » La zone question et réponses ne défile pas. Décidé par Minipen le 21/10/2026, mot pour mot : « oui, il faut corriger les questions trop longue à la création du QCM, pas lors de son exécution ! » En jeu, aucun texte n'est coupé et aucun texte ne défile. Le choix « coupé avec … » en cours de partie est retiré. Il n'est pas une règle. Le filet « les « … » en jeu ne servent que pour d'anciens packs » est un choix incertain (Coding Agent, 21/10/2026), à confirmer par Minipen. Il ne remplace pas l'absence de coupe en jeu.

   **Critère :** Pendant une partie, la zone question et réponses ne montre pas de défilement. Un texte accepté à la création s'affiche en entier. Le buzzer ne se déplace pas pour laisser place à un défilement.

   **Cas limites :** question ou réponse qui tient à la police minimale : elle s'affiche en entier, sans « … » et sans défilement. Ancien pack encore trop long : le filet « … » reste le choix incertain ci-dessus, pas la règle. Rotation : la zone se recalcule, sans défilement (CA-66).

68. **CA-68 — Refus à la création : la mesure est la règle principale**

   **Règle :** Décidé par Minipen le 21/10/2026, mot pour mot : « oui, il faut corriger les questions trop longue à la création du QCM, pas lors de son exécution ! » Décidé par Minipen le 21/10/2026, mot pour mot : « Il doit refuser. » L'éditeur refuse d'enregistrer une question ou une réponse qui dépasse la limite. Cette phrase est conservée. L'À décider « avertir sans bloquer, ou refuser l'enregistrement » est résolu : l'éditeur refuse. La piste de Coding Agent « un avertissement qui ne bloque pas la saisie » est conservée et remplacée par ce refus. Décidé par Minipen le 21/10/2026, en réponse à la proposition de Testeur, mot pour mot : « Oui, ça me parait plus stable que de faire une moyenne et un nombre de caractère en dur. » L'éditeur refuse un texte qui ne tient pas dans l'aperçu à la police minimale (14 px pour la question, 10 px pour les réponses), même s'il reste sous la limite de caractères. Ce contrôle de mesure est la règle principale. Le nombre de caractères en dur n'est pas cette règle. Il reste un garde-fou, dont la valeur n'est pas décidée. Choix incertains, à confirmer par Minipen. Coding Agent, 21/10/2026 : l'aperçu mesure le rendu sur le plus petit écran, 360×640, pour qu'un texte accepté tienne sur tous les téléphones. La mesure se fait seulement dans le navigateur. Le serveur ne vérifie que le nombre de caractères, qui sert de simple garde-fou. Design UI, 21/10/2026 : la limite est de 140 caractères pour une question et de 120 pour une réponse. L'ancienne limite d'environ 60 caractères par réponse est conservée et remplacée par ce 120. L'ancienne paire « environ 140 et environ 60 », calculée pour 15 px et 12 px, est conservée. Design UI devait la recalculer pour 14 px et 10 px. La proposition 140 et 120 est cette nouvelle valeur, et elle reste incertaine. Coding Agent, 21/10/2026 : un emoji compte pour un caractère. Un mot très long passe à la ligne au lieu de déborder. Choix incertain, 21/10/2026 : on compte des caractères et non des octets. Specs Writer, 21/10/2026 : le collage dans l'éditeur suit la règle de l'éditeur, il est refusé à l'enregistrement. Un pack déjà enregistré qui contient un texte trop long est signalé à son ouverture.

   **Critère :** Un texte qui ne tient pas dans l'aperçu à 14 px (question) ou 10 px (réponse) n'est pas enregistré, même sous la limite de caractères. Un texte qui dépasse la limite de caractères n'est pas enregistré. Un texte qui tient à la police minimale, et qui reste dans cette limite, est enregistré. La valeur de la limite reste le choix incertain ci-dessus.

   **Cas limites :** texte pile à la limite de caractères : s'il tient à la police minimale, il est accepté. S'il ne tient pas dans l'aperçu, il est refusé. Texte d'une seule unité au-dessus de la limite : l'éditeur refuse. Emojis et accents : le décompte en caractères plutôt qu'en octets, et un emoji pour un caractère, restent les choix incertains ci-dessus. Collage d'un texte long : refus à l'enregistrement, choix incertain. QCM enregistré avant la règle : signalé à l'ouverture, choix incertain.

69. **CA-69 — Compteur et aperçu téléphone**

   **Règle :** Décidé par Minipen le 21/10/2026 (« c'est parfait »). Sous chaque champ, un compteur « 128 / 140 », orange à l'approche de la limite et rouge au-delà, avec un aperçu téléphone à côté qui montre le rendu réel. La phrase « le compteur est codé par Coding Agent et reste une Proposition » est conservée et remplacée par cette validation. La maquette `editeur_limites_v1.png` (hors dépôt, `/workspace/ui/buzzy/`) met en image ce compteur. Les détails sont des Propositions de Design UI, à confirmer par Minipen. Le compteur est gris en temps normal, passe à l'orange à partir de 85 % de la limite (« 128 / 140 »), puis au rouge au-delà avec « Trop long : raccourcissez de N caractères. ». Le choix incertain de Specs Writer « le seuil orange est fixé à 90 % de la limite » est conservé et remplacé par ces 85 %. Tant qu'un champ est rouge, « Enregistrer » est grisé et une phrase indique le champ qui bloque. L'aperçu téléphone montre le rendu en direct et entoure de rouge le texte trop long. Les nombres 140 et 120 du garde-fou restent le choix incertain du CA-68. L'exemple « 128 / 140 » illustre le compteur validé. Le compteur suit le garde-fou en caractères. L'aperçu suit la mesure, qui est la règle principale (CA-68).

   **Critère :** Sous chaque champ, le compteur et l'aperçu téléphone sont visibles. Le compteur passe à l'orange à l'approche de la limite et au rouge au-delà. L'aperçu montre le rendu réel. Un texte refusé par le CA-68 n'est pas enregistré.

   **Cas limites :** sous le seuil orange : gris, selon la proposition. À partir de 85 % : orange, selon la proposition. Au-delà de la limite de caractères : rouge, selon la proposition, et l'enregistrement est refusé (CA-68). Le gris, les 85 % et la phrase « Trop long : raccourcissez de N caractères. » restent des propositions. Texte sous la limite de caractères mais qui ne tient pas dans l'aperçu : l'enregistrement est refusé (CA-68). La couleur du compteur dans ce cas n'est pas décidée. L'aperçu montre le rendu réel.

70. **CA-70 — Import ZIP : troncature et message**

   **Règle :** Décidé par Minipen le 21/10/2026, mot pour mot : « Et à l'import de zip, une question trop longue sera tronquée, et un message d'information prévient 'Attention, la question xx dépasse la taille autorisée' ». xx est le numéro de la question. Décidé par Minipen le 21/10/2026, mot pour mot : « pareil pour les réponses ». À l'import ZIP, une réponse trop longue est tronquée et signalée par un message, comme une question. Le choix incertain « les réponses trop longues à l'import sont tronquées de la même façon, avec un message du même type » est conservé et remplacé par cette décision. Choix incertains, à confirmer par Minipen. Specs Writer, 21/10/2026 : la troncature se fait à la limite de caractères et se termine par « … ». Un seul message liste toutes les questions concernées. Testeur, 21/10/2026 : à l'import ZIP, le navigateur fait la même mesure dans l'aperçu et affiche le même message « Attention, la question xx dépasse la taille autorisée ». Deux réponses longues qui ne diffèrent qu'à la fin deviennent identiques une fois tronquées. Le rapport d'import les signale à part, pour que l'animateur corrige le pack, sans bloquer l'import. À décider par Minipen : un texte importé sous la limite de caractères, mais trop large à la mesure, ne peut pas être tronqué par le compte de caractères. La règle de troncature doit dire où couper dans ce cas. Proposition laissée ouverte, non tranchée : couper au dernier mot qui tient. Cette question reçoit un choix incertain (Coding Agent, 21/10/2026, proposition de Testeur), à confirmer par Minipen. Elle n'est pas décidée. Après un import ZIP, le navigateur mesure chaque texte. Il tronque ceux qui dépassent jusqu'à ce qu'ils tiennent, puis affiche « Attention, la question N dépasse la taille autorisée ». N est le numéro de la question, le même rôle que xx dans la phrase déjà décidée. La coupe au dernier mot qui tient reste une proposition, à confirmer.

   **Critère :** Une question qui dépasse la taille autorisée est tronquée à l'import, et le message « Attention, la question xx dépasse la taille autorisée » s'affiche, avec le numéro de la question à la place de xx. Une réponse trop longue est tronquée et signalée par un message, de la même façon.

   **Cas limites :** ZIP avec plusieurs questions trop longues : chacune est tronquée. Le regroupement en un seul message reste le choix incertain. Texte pile à la limite de caractères : pas de troncature par le compte de caractères. La mesure à l'import reste le choix incertain de Testeur. Texte d'une seule unité au-dessus : troncature et message. Emojis et accents : caractères plutôt qu'octets, et un emoji pour un caractère, choix incertains du CA-68. Deux réponses qui ne diffèrent qu'après le point de coupe : elles deviennent identiques. Le rapport les signale à part sans bloquer l'import, choix incertain. Texte sous la limite de caractères mais trop large à la mesure : l'endroit de la coupe reçoit le choix incertain de Coding Agent. Le navigateur mesure, tronque jusqu'à ce que le texte tienne, puis affiche le message. La coupe au dernier mot qui tient reste une proposition. Ce point n'est pas décidé.

71. **CA-71 — Hauteur stable malgré la barre d'adresse**

   **Règle :** Décidé par Minipen le 21/10/2026, en réponse à Testeur, mot pour mot : « oui, je valide ce plan ! ». Sur téléphone, la répartition des hauteurs se calcule sur la plus petite hauteur stable de l'écran. Elle ne change pas quand la barre d'adresse du navigateur apparaît ou disparaît. Elle n'est recalculée qu'en cas de rotation. La phrase du CA-66 « la rotation est le seul changement admis » est conservée. Ce CA la précise pour la barre d'adresse.

   **Critère :** Sur un téléphone, on fait défiler la page pour faire apparaître et disparaître la barre d'adresse. La position du buzzer et la hauteur de la zone question et réponses ne changent pas. Après une rotation, la répartition est recalculée. Testeur le vérifie sur un vrai téléphone.

   **Cas limites :** barre d'adresse qui se cache au défilement : aucun déplacement du buzzer. Barre qui revient : même place. Rotation : seul recalcul admis (CA-66). Les trois écrans du CA-66 restent les mesures de position : 360×640, 390×844, et une tablette.

72. **CA-72 — Remesure de toutes les réponses**

   **Règle :** Choix incertain (Testeur, 21/10/2026), à confirmer par Minipen. Quand on ajoute ou retire une réponse, l'éditeur mesure à nouveau toutes les réponses, pas seulement le champ modifié. Exemple : en passant de 4 à 5 réponses, l'affichage passe sur deux colonnes, selon la proposition de Design UI du CA-66, donc chaque case devient deux fois plus étroite. Choix incertain (Specs Writer, 21/10/2026), à confirmer par Minipen : si des textes ne tiennent plus, l'éditeur refuse d'enregistrer et signale les réponses concernées.

   **Critère :** Après un ajout ou un retrait de réponse, chaque réponse est mesurée de nouveau dans la disposition qui correspond au nouveau nombre. Le refus d'enregistrer et le signalement restent le choix incertain de Specs Writer.

   **Cas limites :** des textes à la limite qui tiennent avec 4 réponses et ne tiennent plus après le passage à 5 réponses, parce que chaque case est deux fois plus étroite. Ce que fait alors l'éditeur, refuser l'enregistrement et signaler les réponses concernées, est le choix incertain de Specs Writer. Retrait d'une réponse, par exemple de 5 à 4 : toutes les réponses sont mesurées à nouveau, choix incertain de Testeur.

73. **CA-73 — Écran de résultat en fin de manche**

   **Règle :** Décidé par Minipen le 21/10/2026, mot pour mot : « oui, écran de résultat sur le tel et sur l'écran de diffusion, avec un podium à 3 places ». En fin de manche, le téléphone de chaque joueur et l'écran de diffusion affichent un écran de résultat avec un podium à trois places. Cet écran remplace l'écran noir `WinnerScreen`. La phrase du CA-44 « la recette ne décrit pas l'écran de remplacement » et celle du CA-55 « l'écran de remplacement en fin de manche reste non décrit » sont conservées et remplacées par cet écran, pour le téléphone et la diffusion. Écart code/CDC du CA-55, relevé par Test Writer (commit `5fd119a`) : le serveur ne passe jamais `state` à "ended", et l'écran noir vient de `WinnerScreen` en plein écran. Le CA-73 est l'écran attendu à la place de ce noir. Le passage de `state` à "ended" n'est pas choisi. Le CA-20 reste un choix incertain pour l'écran de fin de partie : score ou rang, et bouton « Suivant ». Cette décision de fin de manche ne le tranche pas. La page animateur n'est pas dans cette décision (CA-43). Choix incertains (Specs Writer, 21/10/2026), à confirmer par Minipen. Le podium suit le mode de la partie : il classe les équipes en mode équipe, et les joueurs sinon. En cas d'égalité, les ex aequo partagent la même marche du podium. S'il y a moins de trois participants, les marches vides ne sont pas affichées. Sur son téléphone, chaque joueur voit aussi sa propre place et son score, même s'il n'est pas sur le podium. L'écran reste affiché jusqu'à ce que l'animateur lance la suite. Maquettes de Design UI, hors dépôt, sur l'ordinateur partagé, pas dans le dépôt. `podium_diffusion_v1.png` (1600×900) : podium dans l'ordre 2-1-3, marches or, argent et bronze. Chaque joueur a son initiale, son nom, son équipe et ses points. Les places 4 à 8 sont à droite, avec « + N autres joueurs » en dessous. `podium_joueur_v1.png` (390×844, sans défilement) : podium compact, carte jaune « Votre place » et lignes autour du joueur, avec « Vous » en jaune. Ces dessins ne sont pas validés par Minipen. Choix incertains (Design UI, 21/10/2026), à confirmer par Minipen. Ils rejoignent ceux de Specs Writer et les cas limites de ce CA. Égalité : les ex æquo partagent la même marche, avec un badge « Ex æquo ». Les marches suivantes vont aux scores suivants, donc 1, 1, 2, 3 (classement dense). Écart possible avec un classement 1, 1, 3, à trancher par Minipen. Le choix de Specs Writer « les ex aequo partagent la même marche » est conservé. Le badge et le classement dense le précisent, sans le trancher. Moins de 3 joueurs ou équipes : seules les marches occupées sont affichées. Ce choix rejoint celui de Specs Writer sur les marches vides. Mode équipes : le podium montre les équipes avec leur nombre de joueurs. Le téléphone ajoute « Votre apport : N points » et le meilleur joueur. Ces deux ajouts sont une Proposition de Design UI. Cette phrase sur le nombre de joueurs est conservée. Choix incertain (Coding Agent, 21-22/10/2026), à confirmer par Minipen, codé dans `98e9559` : sous le nom d'une équipe, sur sa marche du podium, s'affiche « N joueurs » (« 1 joueur » au singulier), d'après la maquette de Design UI. Ce choix ne remplace pas la phrase ci-dessus. Choix incertain (Coding Agent, 21/10/2026), à confirmer par Minipen : un joueur déconnecté pendant la manche garde ses points et reste classé. Il code aussi les égalités en 1, 1, 2, 3. Le choix entre 1, 1, 2, 3 et 1, 1, 3 reste à trancher par Minipen. Ces deux points sont codés dans `8159db8`. Le passage à 1, 1, 3 se fait par une option. Précision de Design UI : avec 1, 1, 3, la 2e marche reste vide, alors qu'avec 1, 1, 2, 3, le podium est toujours plein. Proposition de Design UI (21/10/2026), à confirmer par Minipen, à côté de ce point ouvert et du choix « marches vides masquées ». Avec 1, 1, 2, 3, aucune marche n'est vide et il n'y a pas de conflit. Avec 1, 1, 3, les ex æquo vont sur la 1re marche et le joueur suivant sur la 2e marche, avec l'étiquette « 3e ». Cette proposition ne tranche pas le point ouvert. Choix incertains (Coding Agent, 21/10/2026), à confirmer par Minipen, codés dans `8159db8`. Les phrases déjà écrites sur ces points sont conservées. Les marches vides sont masquées. En mode équipes, une ligne « Votre apport » et le meilleur joueur. L'écran reste affiché jusqu'à une action de l'animateur. À décider (Minipen) : la manche se termine-t-elle toute seule après la dernière question, ou seulement avec « Afficher gagnant » ? Ce point n'est pas tranché. Choix incertain (Coding Agent, 21/10/2026), à confirmer par Minipen, codé dans `6023afd` : à la dernière question, « Question suivante → » est désactivé, avec une indication qui renvoie vers « Afficher gagnant », au lieu de déclencher le gagnant. Ce choix ne répond pas à l'À décider.

   **Critère :** À la fin de la manche, `/party/:partyId/play` et `/party/:partyId/broadcast` montrent un écran de résultat avec un podium à trois places. `WinnerScreen` en plein écran noir n'est plus cet écran.

   **Cas limites :** ex aequo : le partage de la même marche est le choix incertain de Specs Writer. Le badge « Ex æquo » et le classement dense 1, 1, 2, 3 sont le choix incertain de Design UI. L'écart avec un classement 1, 1, 3 est à trancher. Précision de Design UI : avec 1, 1, 3, la 2e marche reste vide, alors qu'avec 1, 1, 2, 3, le podium est toujours plein. Proposition de Design UI (21/10/2026), à confirmer par Minipen, à côté de ce point ouvert et du choix « marches vides masquées ». Avec 1, 1, 2, 3, aucune marche n'est vide et il n'y a pas de conflit. Avec 1, 1, 3, les ex æquo vont sur la 1re marche et le joueur suivant sur la 2e marche, avec l'étiquette « 3e ». Cette proposition ne tranche pas le point ouvert. Coding Agent code les égalités en 1, 1, 2, 3. Le choix reste à trancher par Minipen. Partie à 1 ou 2 joueurs, ou moins de 3 équipes : seules les marches occupées, choix incertain de Design UI, qui rejoint les marches vides non affichées de Specs Writer. Joueur déconnecté pendant la manche : sa place sur le podium n'est pas décidée. Cette phrase est conservée. Choix incertain (Coding Agent, 21/10/2026) : il garde ses points et reste classé. Manche où tout le monde a 0 point : l'écran de résultat s'affiche. Le classement de ces scores nuls suit le choix incertain sur les ex aequo, non tranché. Choix incertains (Coding Agent, 21/10/2026), à confirmer par Minipen, codés dans `8159db8`. Les phrases déjà écrites sur ces points sont conservées. Les marches vides sont masquées. En mode équipes, une ligne « Votre apport » et le meilleur joueur. L'écran reste affiché jusqu'à une action de l'animateur. Les égalités 1, 1, 2, 3, le passage à 1, 1, 3 par une option, et le joueur déconnecté qui garde sa place, sont déjà des choix incertains. Ils sont codés dans le même commit. À décider (Minipen) : la manche se termine-t-elle toute seule après la dernière question, ou seulement avec « Afficher gagnant » ? Ce point n'est pas tranché. Choix incertain (Coding Agent, 21/10/2026), codé dans `6023afd` : à la dernière question, « Question suivante → » est désactivé et renvoie vers « Afficher gagnant », au lieu de déclencher le gagnant. Ce choix ne répond pas à l'À décider.

74. **CA-74 — Barre du bas de l'animateur**

   **Règle :** Décidé par Minipen le 21/10/2026, mot pour mot : « le bloc qui est accroché en bas de l'écran contient trop de choses. il faut juste garder les boutons "lancer la manche" "ouvrir buzzer" "pause" "afficher gagnant", tout le reste doit migrer dans un bloc repliable, "paramètres de la partie", sous le bloc des questions ». La barre fixée en bas ne garde que « Lancer la manche », « Ouvrir buzzer », « Pause » et « Afficher gagnant ». Le détail de ce qui déménage, les phrases conservées et la maquette sont au §2.5, « Barre du bas ». Maquette `animateur_parametres_v1.png` (1600×1080), hors dépôt, ordinateur partagé. Elle montre les quatre boutons avec leur icône, et le bloc sous le scénario en trois groupes : Buzzer (ouverture auto, passage auto en QCM, fenêtre d'attente), Comptes à rebours (question suivante, mode « Prêt ? » et son délai, buzzer), Sons et affichage (sons, écran de gagnant, blind test). Choix incertains (Specs Writer, 21/10/2026), à confirmer par Minipen. Le bloc est replié par défaut. Les boutons désactivés gardent leur place, pour que la barre ne bouge pas. Son état gardé pendant la partie est conservé. Proposition de Design UI : replié, une ligne de résumé, par exemple « Prêt ? activé · buzzer 5 s · suivante 5 s ». Proposition de Design UI : l'état, replié ou déplié, est gardé d'une visite à l'autre. Cette proposition remplace « gardé pendant la partie ». Les deux variantes restent à trancher par Minipen. Choix incertain (Specs Writer, 21/10/2026) : le lancement manuel en mode « Prêt ? » reste dans les paramètres. C'est une action en direct. Cette phrase est conservée et remplacée. Choix incertain (Design UI, 21/10/2026), question posée à Minipen : les boutons qui ne servent qu'à certains moments vont sous la question en cours. Ce sont « Fermer & purger », le lancement de la question pendant « Prêt ? », « Suivant » après le gagnant, « Extrait suivant » et « Rejouer l'extrait ». Ce choix remplace le placement du lancement manuel dans les paramètres. Écarts code/CDC relevés par Test Writer (commit `3a710c6`), rappelés ici, déjà écrits au §4.5. `store.ts:411` : un joueur qui arrive pendant le décompte du buzzer est déjà compté prêt. Le CDC le dit orange pendant le décompte entre les questions ou l'attente « Prêt ? », et prêt seulement s'il rejoint pendant une question. Le cas du décompte du buzzer est ambigu. À décider par Minipen. Pendant « Prêt ? », le téléphone n'affiche pas la liste avec les coches et les sabliers. La règle décidée reste : cette liste est sur tous les écrans.

   **Critère :** Sur `/party/:partyId/admin`, la barre fixée en bas montre les quatre boutons, et eux seuls. Les décomptes, le mode « Prêt ? », son délai, les toggles, la fenêtre d'attente, les sons et le contrôle audio sont dans le bloc « Paramètres de la partie », sous le bloc des questions.

   **Cas limites :** un paramètre modifié en pleine manche. Le choix incertain du §4.5 reste : le changement des décomptes ou du mode « Prêt ? » s'applique à partir de la question suivante. Ce CA ne le retranche pas. Un petit écran : les quatre boutons tiennent sur une ligne. La maquette en 1600×1080 ne montre pas ce cas. Choix incertains (Coding Agent, 21/10/2026), à confirmer par Minipen, codés dans `6023afd`. À la dernière question, « Question suivante → » est désactivé, avec une indication qui renvoie vers « Afficher gagnant », au lieu de déclencher le gagnant. Ce choix ne répond pas à l'À décider du CA-73. Un réglage numérique n'est envoyé au serveur qu'en sortant du champ ou avec Entrée, pas à chaque frappe.

**Questions ouvertes de ce passage :**

- CA-52 : téléphone ou souris, Testeur attend Minipen.
- CA-58 : vitesses d'animation. Ligne d'équipe « + N points pour l'équipe … », Proposition de Design UI. « Vous ! » à la place du seul nom, sur le téléphone du gagnant. Coche verte du 4e écran.
- CA-59 : bloc rond à la place de la modale joueur, notification seulement sur la diffusion.
- CA-60 : décidé. Décidé (Minipen, 21/10/2026, réponse transmise par Coding Agent) : la nouvelle question s'affiche seulement quand le buzzer s'ouvre, pas au début du décompte. Pendant « Prêt ? », la question est déjà remplacée par le CA-64. Le CA-61 suit : la question suivante est envoyée seulement à l'ouverture du buzzer. L'écart de Test Writer (`5fd119a`) sur `commitCueAdvance` n'a pas de correctif choisi. Celui sur `state` "ended" et `WinnerScreen` (CA-55) a maintenant un écran attendu : le podium du CA-73. Le passage de `state` à "ended" n'est pas choisi. Écart `d5556f2`, non tranché : en mode normal, la première question s'affiche buzzer fermé. Les questions suivantes restent masquées jusqu'à l'ouverture. À décider (Minipen) : exception pour la première question, ou attente de l'ouverture.
- CA-62 et CA-63 : format « 2 (11%) » ou « 11 (61%) », cumul vert et jaune (contour de 3 px), pourcentage sur les répondants, « 0 (0%) ». L'arrondi séparé et un total autre que 100 % sont décidés.
- CA-64 : jamais deux fois de suite la même phrase. Le fichier de code des 18 phrases n'a pas encore de chemin sur main. Les deux autres décomptes gardent la question jouée. La phrase identique sur tous les écrans est décidée.
- CA-66 : zone calculée sur la hauteur de l'écran, même police pour toutes les réponses d'une question. Répartition de Design UI (en-tête 48 px, 50 % de la hauteur restante, 35 % pour la question, reste entre les réponses, buzzer 30 % plafonné à 230 px). Disposition des cases selon N : 2 à 4 en une colonne, 5 ou 6 en deux colonnes de 3 lignes, police jusqu'à 16 px avec 2 réponses. Cette proposition remplace l'écart « N ≠ 4 non décidé » et reste à confirmer. Au-delà de 6 réponses : À décider. La hauteur stable malgré la barre d'adresse est décidée (CA-71). Hauteur calculée d'après l'écran du téléphone, y compris en 360×640 (Coding Agent), reste incertaine. Les polices minimales 14 px et 10 px, l'absence de défilement, la taille fixe et le buzzer immobile sont décidés. Le défilement en dernier recours, les 15 px et 12 px, et les 8 px, sont remplacés. Les 140 px et 46 px restent un exemple pour le 390×844.
- CA-67 : filet « … » en jeu pour les anciens packs seulement. L'absence de défilement et l'absence de coupe en jeu sont décidées.
- CA-68 : écran de mesure 360×640, mesure seulement dans le navigateur, garde-fou de caractères côté serveur. Limites 140 et 120 (le 120 remplace le 60). Emoji compté pour un caractère, mot très long qui passe à la ligne. Caractères plutôt qu'octets. Collage refusé à l'enregistrement. Ancien pack signalé à l'ouverture. Le refus à la mesure, même sous la limite de caractères, est décidé. L'À décider « avertir ou bloquer » est résolu.
- CA-69 : gris, seuil 85 % (le 90 % est remplacé), phrase « Trop long : raccourcissez de N caractères. », « Enregistrer » grisé, contour rouge de l'aperçu. Couleur du compteur quand la mesure refuse un texte encore sous la limite de caractères. Le compteur et l'aperçu téléphone sont décidés. Maquette `editeur_limites_v1.png`.
- CA-70 : troncature à la limite terminée par « … », un seul message pour toutes les questions, mesure du navigateur à l'import, deux réponses identiques après troncature signalées sans bloquer l'import. L'endroit de la coupe reçoit un choix incertain (Coding Agent, proposition de Testeur) : le navigateur mesure chaque texte, tronque jusqu'à ce qu'il tienne, puis affiche « Attention, la question N dépasse la taille autorisée ». La coupe au dernier mot qui tient reste une proposition. Ce point n'est pas décidé. La troncature des questions et des réponses, et le message sur la question, sont décidés.
- CA-71 : hauteur stable malgré la barre d'adresse, décidé. Testeur le vérifie sur un vrai téléphone, en faisant défiler la page.
- CA-72 : remesure de toutes les réponses à l'ajout ou au retrait (Testeur). Refus d'enregistrer et signalement des réponses qui ne tiennent plus (Specs Writer).
- CA-73 : mode équipe ou joueurs, ex aequo sur la même marche, badge « Ex æquo », classement dense 1, 1, 2, 3. Écart possible avec 1, 1, 3, à trancher. Marches vides masquées. Place et score du joueur hors podium. Écran jusqu'au lancement de la suite. Mode équipes : nombre de joueurs. « Votre apport : N points » et le meilleur joueur sont une Proposition de Design UI. Maquettes `podium_diffusion_v1.png` et `podium_joueur_v1.png`, ordinateur partagé, hors dépôt. Le podium à trois places sur le téléphone et la diffusion est décidé. Le passage de `state` à "ended" n'est pas choisi. Le CA-20 pour l'écran de fin de partie reste ouvert. Joueur déconnecté : choix incertain de Coding Agent, il garde ses points et reste classé. Avec 1, 1, 3 la 2e marche reste vide. Avec 1, 1, 2, 3 le podium est toujours plein. Proposition de Design UI (21/10/2026), à confirmer par Minipen, à côté de « marches vides masquées » et de la 2e marche vide en 1, 1, 3. Avec 1, 1, 2, 3, aucune marche n'est vide et il n'y a pas de conflit. Avec 1, 1, 3, les ex æquo vont sur la 1re marche et le joueur suivant sur la 2e marche, avec l'étiquette « 3e ». Cette proposition ne tranche pas le point ouvert. Coding Agent code 1, 1, 2, 3. Le choix reste à trancher par Minipen. Codé dans `8159db8` : marches vides masquées, ligne « Votre apport » et meilleur joueur en mode équipes, écran jusqu'à une action de l'animateur. Ces trois points sont des choix incertains de Coding Agent, à confirmer par Minipen. Les phrases déjà écrites sont conservées. Les égalités 1, 1, 2, 3, le passage à 1, 1, 3 par une option, et le joueur déconnecté qui garde sa place, sont codés dans le même commit. À décider (Minipen) : la manche se termine-t-elle toute seule après la dernière question, ou seulement avec « Afficher gagnant » ? Choix incertain (Coding Agent, 21/10/2026), codé dans `6023afd` : à la dernière question, « Question suivante → » est désactivé et renvoie vers « Afficher gagnant », au lieu de déclencher le gagnant. Ce choix ne répond pas à l'À décider. Choix incertain (Coding Agent, 21-22/10/2026), codé dans `98e9559` : sous le nom d'équipe, sur sa marche, « N joueurs », « 1 joueur » au singulier, d'après la maquette de Design UI. La phrase sur le nombre de joueurs est conservée. Choix incertain codé dans `f81d3ec` : « Afficher gagnant » ouvre le podium de manche. Il ne répond pas à l'À décider.
- §2.5 : choix incertains (Coding Agent, 21-22/10/2026), codés dans `f81d3ec`, à confirmer par Minipen. La pause gèle l'écran et les décomptes. La phrase « retour lobby » est conservée. À décider (Minipen), demande de FB Chef De Projet, commits `bd450b60` et `b09e6346` : un buzz en attente pendant la pause reprend le délai de grâce restant au lieu de se clore pendant le gel. `b09e6346` (23/10/2026) pose le commentaire INCERTAIN de FB Coding Agent dans `adminToggleLivePause`, juste avant `scheduleGraceFinalize(party)`, sans changement de comportement ni de test. Il se rattache à cet écart. Il ne le tranche pas. En recette, saut par `?question=N`, sans bouton. « Partie introuvable. Cette partie n'est plus sur le serveur. » La phrase du §2.9 est conservée. Ancien état jusqu'au 23/10 : écart du même commit, À décider (Minipen), §2.5 et CA-48 : le jeton reste dans l'adresse (`#token=…`). Le code garde-t-il aussi le jeton en localStorage, et le jeton visible dans l'adresse est-il acceptable ? Fin de l'ancien état. Cette question est close au §2.5 et au CA-48. La pause et « Partie introuvable » de cette puce restent à confirmer.
- CA-74 : barre réduite aux quatre boutons, décidé. Bloc replié par défaut, et boutons désactivés qui gardent leur place (Specs Writer). État gardé pendant la partie, ou d'une visite à l'autre : les deux variantes sont à trancher. Ligne de résumé, Proposition de Design UI. Boutons occasionnels sous la question en cours, choix incertain de Design UI. Il remplace le lancement manuel laissé dans les paramètres. Maquette `animateur_parametres_v1.png`, ordinateur partagé, hors dépôt. Écart `3a710c6` : arrivée pendant le décompte du buzzer, À décider par Minipen (`store.ts:411`). Pendant « Prêt ? », le téléphone n'affiche pas les coches et les sabliers. La règle sur les trois écrans reste. Choix incertains (Coding Agent, 21/10/2026), codés dans `6023afd`, à confirmer par Minipen. À la dernière question, « Question suivante → » est désactivé et renvoie vers « Afficher gagnant », au lieu de déclencher le gagnant. Un réglage numérique part au serveur en sortant du champ ou avec Entrée, pas à chaque frappe.
- Recettes 5, 6 et 7 du 23/10/2026, CA-75 à CA-77. Écran « Partie introuvable », accord « joueur prêt » (`a4571828`), fin de « Prêt ? » à 3/3. À décider Minipen. La recette 7 valide les libellés, elle ne retire pas cet À décider. Point à surveiller : « 0 / ,3 joueurs prêts », observation non reproduite. Constat de FB Coding Agent le 23/10/2026 : aucune cause dans le code actuel, rien corrigé, hypothèse d'un ancien build non vérifiée. Le point reste en observation. Commit `2b83f02` : commentaire `INCERTAIN` sur l'accord, sans changement de comportement ni de test. L'accord singulier reste À décider (Minipen). Le détail est au §2.5, au §4.5 et dans la sous-section de ces recettes. Aucune marque déjà écrite n'est retirée.

---

#### Recettes 5, 6 et 7 du 23/10/2026

**Statut :** Constat de recette. Relevé par FB Specs Writer le 23/10/2026. Ce constat ne modifie pas les CA-1 à CA-74. Il ne retire aucune marque Choix incertain ni À décider.

**Recettes 5 et 6.** Build `index-CTBZohM2.js` (`ce0c447`).

**OK constatés :**

- Tutoriel de diffusion : croix 44×44 px, « Compris », Échap, clic sur le fond, ne se rouvre pas.
- Fenêtre « Comment lancer la manche ? », 540×355 px.
- Jeton hors de l'adresse.
- Champ « Avant la question suivante » après Entrée.

Choix incertain (Design UI, 23/10/2026), À décider Minipen : ces mesures, et les choix visuels de la fenêtre et du tutoriel. Ils ne remplacent pas le CA-42. Le CA-42 reste décidé : modale « Choisir le mode de lancement », deux cartes avec description, hauteur automatique, jaune et vert. La fenêtre constatée porte un autre titre et une taille fixe. Ce choix ne le remplace pas. Ancien état jusqu'au 23/10 : le jeton reste écrit dans `#token=`. Fin de l'ancien état. La question « jeton visible dans l'adresse en plus du localStorage » est close au §2.5 et au CA-48. Le constat « jeton hors de l'adresse » des recettes 5 et 6 est OK. Le §4.4 est conservé : le tutoriel s'affiche au premier lancement d'un type de jeu, et l'animateur peut le passer. « Ne se rouvre pas » après fermeture n'y est pas écrit. Non tranché. Le champ envoyé en sortant du champ ou avec Entrée reste le choix incertain de Coding Agent, commit `6023afd` (§2.5, CA-74). L'OK « après Entrée » ne le tranche pas. Le libellé « Avant la question suivante » n'était pas nommé dans le CDC. Il reste dans ce constat.

**Recette 7.** Build `index-C5erKbXt.js` (`a4571828`), partie VKN66G.

**OK constatés :**

- Singulier validé côté joueur : « 0 / 3 joueurs prêts », « 1 / 3 joueur prêt », « 2 / 3 joueurs prêts ».
- Singulier validé côté admin et diffusion : « 0/3 prêts », « 1/3 prêt », « 2/3 prêts ».
- À 3/3, aucune valeur lisible. La question démarre aussitôt.

Cet OK rejoint le CA-76 et le CA-77. Il ne retire pas l'À décider Minipen : le singulier partout, et le choix entre garder le saut à 3/3 ou afficher « 3/3 » un court instant.

**Point à surveiller.** Observation de Testeur, 23/10/2026. Non reproduite. Pas de capture. Juste après le lancement, deux écrans joueur ont affiché brièvement « 0 / ,3 joueurs prêts » (virgule parasite). Piste laissée ouverte, non tranchée : peut-être un rendu intermédiaire du compteur. Cette piste est conservée. Constat de FB Coding Agent le 23/10/2026 : aucune cause démontrable dans le code actuel, rien n'est corrigé. Le compteur joueur est `${safeReady} / ${safeTotal} ...`, avec des entiers forcés par `Number.isFinite` et `Math.floor`, sans format localisé ni interpolation de tableau. Hypothèse la plus plausible, non vérifiée : un ancien build interpolait un tableau (`[null, 3]` donne « ,3 »), rétabli au snapshot suivant. Le build `a4571828` n'a pas ce chemin. Le point reste en observation, non reproduit. Ce n'est pas un choix, ni un À décider.

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

**Statut :** Livré et testé (logique serveur) — PR 25 (`ee13238`), 329/329 Vitest verts. Couverture store : fenêtre, plafond RTT/2+50 ms, reject-before-open, modes son, `buzz_fx` / `buzz_decision`, auto-advance. CA UI restants hors Vitest store (latence live, reconnect, affichage écart broadcast, course de boutons).

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
- **Mode automatique (§4.3) et avance automatique :** Un buzz dont l'heure estimée se situe avant la fin du minuteur de question compte, même si son paquet arrive au serveur juste après ; la fenêtre d'attente peut donc dépasser le minuteur d'au plus sa durée configurée. L'avance automatique (question suivante) sur QCM lorsque tous les joueurs ont buzzé (`autoAdvanceQuizWhenAllBuzzed`) se déclenche après la décision finale, jamais avant : la règle « tous ont buzzé = décision immédiate » reste vraie (fin de la fenêtre si tous ont buzzé), mais l'avance à la question suivante attend que cette décision soit prise et notifiée. Résolu par Minipen le 21/10/2026 : elle attend aussi la fin du décompte entre les questions (CA-49), y compris en mode autonome (§4.3). 0 = pas de décompte. Une fois la question affichée, le mode optionnel « Prêt ? » (§4.5), s'il est actif, s'intercale avant le décompte du buzzer. Il ne retarde pas cette avance jusqu'à la question.
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
15. **CA-15 :** Sur QCM avec `autoAdvanceQuizWhenAllBuzzed` activé : tous les joueurs buzzent, la décision est prise immédiatement (fin de fenêtre anticipée), puis l'avance à la question suivante se déclenche après cette décision, jamais avant. Résolu par Minipen le 21/10/2026 : cette avance attend aussi le décompte entre les questions (CA-49, `nextQuestionCountdownSec`). Si ce réglage vaut 0, il n'y a pas ce décompte et l'avance part après la décision, comme la phrase précédente le dit. Le mode optionnel « Prêt ? » (§4.5), s'il est actif, vient après l'affichage de cette question et avant le décompte du buzzer. Il ne retarde pas l'avance jusqu'à la question.

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
