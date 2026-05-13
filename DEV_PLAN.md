# PartyGame — Plan de développement

Application web temps réel pour organiser des soirées **quiz / jeux de société** avec **scores partagés**, **lobby**, **équipes** et **buzzer**. Hébergement prévu sous **Docker** derrière **Traefik** (réseau et labels à aligner avec votre stack actuelle).

---

## 1. Objectifs produit

| Zone | Fonctionnalité |
|------|----------------|
| Accueil | Créer une partie ou rejoindre avec **code unique** (+ **QR code** pointant vers l’URL de rejoindre). |
| Création | Nombre max de **joueurs** et d’**équipes** (valeurs numériques ou **illimité**). Mode **fermée** (plus d’entrées après le lancement) ou **ouverte** (rejoindre à tout moment). Options : autoriser ou non le **changement de nom / équipe** depuis le lobby. |
| Lobby | Liste des participants, scores (selon état de la partie), **chat entre manches**, attente du lancement ou de la manche suivante. |
| Joueur | En-tête : nom, score perso, équipe, score d’équipe. Centre : contenu **question / réponses** (selon le moteur de jeu). Bas : **buzzer**. Action : retour lobby (si les règles le permettent). |
| Admin | Vue lobby, contrôle du cycle de vie : **lancer / terminer une manche**, passage lobby ↔ jeu. Pas de buzzer côté admin (sauf besoin futur « animateur »). |

---

## 2. Architecture technique (proposition)

### 2.1 Dossiers du dépôt

```
PartyGame/
├── games/           # Données et ressources des jeux (JSON, médias, packs de questions)
├── webserver/       # API, WebSocket/SSE, frontend servi ou build statique
├── DEV_PLAN.md      # Ce document
└── (à ajouter) docker-compose.yml, Dockerfile — à la racine PartyGame ou dans webserver selon convention
```

### 2.2 Stack recommandée (ajustable)

- **Backend** : Node.js (Fastify ou Express) + **Socket.IO** ou **ws** pour événements temps réel (lobby, buzzer, scores, chat).
- **Frontend** : SPA légère (React + Vite ou Vue + Vite) — pages : accueil, création, rejoindre, lobby joueur, vue jeu joueur, admin.
- **État serveur** : sessions de partie en mémoire (Redis optionnel pour multi-instances) ; persistance fichier/DB pour historique si besoin plus tard.
- **Identité joueur** : pseudo + `playerId` (UUID) stocké en **session / localStorage** ; lien à la partie via `partyId` + code court.
- **Jeux** : chargement de **packs** depuis `games/` (schéma JSON : manches, questions, bonnes réponses, points). Premier jeu : **quiz simple** ; structure extensible pour d’autres modes.

### 2.3 Modèle de données (conceptuel)

- **Party** : `id`, `joinCode`, `maxPlayers`, `maxTeams`, `teamsUnlimited`, `playersUnlimited`, `closedAfterStart`, `allowRename`, `allowTeamChange`, `state` (lobby / round_active / round_break), `adminSecret` ou **JWT animateur**.
- **Player** : `id`, `partyId`, `displayName`, `teamId` (nullable), scores individuels et contribution au score d’équipe.
- **Round** : référence manche courante, question affichée, ordre des buzzers, réponses validées par l’admin.

### 2.4 Flux temps réel (événements typiques)

- `party:updated`, `player:joined`, `player:left`, `player:renamed`, `team:changed`
- `chat:message` (lobby / entre manches selon règles)
- `round:start`, `round:end`, `question:show`, `buzz`, `buzz:order`, `score:update`
- `admin:*` réservés aux clients authentifiés comme animateur

### 2.5 Docker & Traefik

- **Image** : build multi-stage (build frontend + runtime Node pour servir fichiers statiques + API/WebSocket).
- **Ports** : un seul port HTTP interne (ex. 3000) ; Traefik route le host (ex. `partygame.example.com`).
- **Labels Traefik** : `traefik.enable=true`, router HTTPS (entrypoint `websecure`), middlewares (headers, rate limit optionnel), service sur le bon port.
- **WebSocket** : vérifier que le routeur Traefik laisse passer les upgrades (`Upgrade`, `Connection`) — en général OK avec les defaults.
- **Réseau** : attacher le conteneur au **même réseau externe** que Traefik (`traefik_public` ou équivalent chez vous).

### 2.6 Sécurité (rappels)

- Code de partie non devinable (entropie suffisante, ex. 6–8 caractères alphanumériques ou plus long si besoin).
- **Secret admin** : token fort à l’URL de création ou écran dédié ; ne jamais exposer en clair dans le QR code joueur.
- Validation serveur de toutes les actions (buzzer, scores, messages) ; pas de confiance au seul client.

---

## 3. Phases de réalisation

1. **Fondations** : monorepo ou repo `webserver`, tooling, variables d’environnement, healthcheck HTTP.
2. **API partie** : créer / rejoindre / quitter ; génération code + QR ; règles fermée / ouverte.
3. **Temps réel** : Socket (ou équivalent) + synchronisation lobby.
4. **UI joueur** : lobby, écran jeu, buzzer, contraintes rename / équipe.
5. **UI admin** : dashboard manches, lecture état buzzer, attribution points (manuel ou semi-auto selon design quiz).
6. **Contenu jeu** : format JSON dans `games/` + loader côté serveur.
7. **Chat** : salon limité au lobby / pauses ; modération basique (longueur, débit).
8. **Docker + Traefik** : `Dockerfile`, `docker-compose` snippet documenté pour copier-coller les labels dans votre compose global.
9. **Tests** : unitaires règles métier ; un test d’intégration socket minimal.
10. **Polish** : accessibilité basique, messages d’erreur, mode hors-ligne dégradé (message clair).

---

## 4. Liste de tâches (todo) — tout ce qu’il faut pour un produit fonctionnel

### Structure & outillage

- [ ] Initialiser le projet dans `webserver/` (package.json, TypeScript, linter, formatter).
- [ ] Définir la structure des modules : `api/`, `sockets/`, `domain/`, `public/` ou équivalent.
- [ ] Schéma de configuration : port, `BASE_URL` (pour QR), CORS, durée de vie des parties inactives.

### Modèle & logique métier

- [ ] Implémenter l’entité **Party** avec tous les paramètres (joueurs, équipes, illimité, fermée/ouverte, flags rename/équipe).
- [ ] Générer **code d’invitation** unique ; gérer collisions.
- [ ] Générer **token / secret administrateur** par partie ; stockage côté client admin (sessionStorage conseillé).
- [ ] Gérer les **états** : création → lobby → manche en cours → retour lobby → fin.
- [ ] Règle **partie fermée** : rejeter les `join` après `round:first_start` ou équivalent documenté.
- [ ] Règle **partie ouverte** : accepter les join selon plafonds joueurs/équipes seulement.

### API HTTP

- [ ] `POST /api/parties` — création (body : options) ; réponse : `partyId`, `joinCode`, `adminUrl` ou token.
- [ ] `GET /api/parties/:id` — métadonnées publiques (nom affiché optionnel, état lobby, nombre de joueurs).
- [ ] `POST /api/parties/:id/join` — body : pseudo, équipe optionnelle ; réponse : `playerId`, cookie ou token joueur.
- [ ] `PATCH /api/parties/:id/players/me` — renommer / changer d’équipe si autorisé.
- [ ] `GET /api/parties/:id/qr` ou génération **côté client** via `joinCode` + `BASE_URL` (réduire charge serveur).
- [ ] Route statique ou build Vite pour le **frontend**.

### Temps réel

- [ ] Canal par `partyId` ; authentifier les messages (joueur vs admin).
- [ ] Diffuser les mises à jour de **liste joueurs**, **scores**, **équipes**.
- [ ] Événements **buzzer** : premier arrivé premier servi ; file d’attente visible côté admin.
- [ ] **Chat** : broadcast filtré par phase (lobby / entre manches).
- [ ] Reconnexion : réassocier socket à `playerId` / token.

### Frontend — pages & composants

- [ ] **Page d’accueil** : boutons Créer / Rejoindre ; champ code ; scan QR (option : `GET` param `?code=`).
- [ ] **Page création** : formulaire (max joueurs, max équipes, cases illimité, fermée/ouverte, options rename/équipe).
- [ ] **Redirection** après création vers **page admin** (URL avec token).
- [ ] **Page rejoindre** : saisie pseudo, choix équipe si applicable.
- [ ] **Lobby joueur** : liste participants, scores, chat, indication d’attente.
- [ ] **Vue jeu joueur** : layout 3 zones (infos perso / contenu central / buzzer).
- [ ] Bouton **retour lobby** + respect des flags serveur.
- [ ] **Page admin** : miroir lobby, boutons lancer manche, terminer manche, affichage ordre buzzer, saisie points.
- [ ] Composant **QR Code** (librairie npm) sur accueil ou page « partage » animateur.

### Contenu jeu (`games/`)

- [ ] Définir le **format JSON** d’un pack (métadonnées, liste de manches, questions, réponses, points).
- [ ] Placer au moins **un pack exemple** jouable.
- [ ] Loader serveur : validation du schéma ; erreurs explicites si pack invalide.
- [ ] Permettre à l’admin de **sélectionner** le pack ou la manche suivante (MVP : un seul pack linéaire).

### Persistance & nettoyage

- [ ] Politique d’expiration des parties **inactives** (timer + sweep).
- [ ] (Optionnel) journal des scores exportable ou log fichier.

### Docker

- [ ] `Dockerfile` (build + prod).
- [ ] `.dockerignore`.
- [ ] `docker-compose` d’exemple pour PartyGame avec **labels Traefik** commentés ou prêts à l’emploi.
- [ ] Variable `BASE_URL` / `PUBLIC_URL` pour QR et liens absolus.

### Qualité

- [ ] Tests unitaires : règles join, fermée/ouverte, buzzer, plafonds.
- [ ] Test e2e minimal (Playwright) : créer → rejoindre → buzzer simulé (si faisable).
- [ ] Documentation README courte : lancement local, build, intégration Traefik.

---

## 5. Hors scope MVP (backlog futur)

- Comptes utilisateurs / auth OAuth.
- Plusieurs types de mini-jeux dans un même événement.
- Mode « présentateur » sur grand écran (écran géant read-only).
- Internationalisation complète.
- Hébergement multi-régions et persistance Redis cluster.

---

## 6. Prochaine action immédiate

Implémenter les **fondations** dans `webserver/` (serveur HTTP + première route `POST /api/parties`) et un **prototype Socket** qui pousse une mise à jour de lobby ; brancher ensuite le **frontend minimal** (accueil + création + join).
