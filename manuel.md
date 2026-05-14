# PartyGames — Manuel build & déploiement

Ce document décrit comment **construire**, **tester localement** et **déployer** l’application (API Node + SPA + Socket.IO), derrière **Traefik**, ainsi que comment **diagnostiquer** les problèmes de DNS et connexion habituels.

---

## 1. Prérequis

| Élément | Détail |
|--------|--------|
| **Node.js** | ≥ 20 (recommandé 22+) pour le développement local (`npm`). |
| **Docker** / **Compose** | Pour l’image de production et l’alignement avec Traefik. |
| **Traefik** | Déjà présent sur l’hôte, réseau Docker externe nommé **`traefik`**, entrées **`http`** (80) et **`https`** (443), résolveur TLS (ex. `cloudflare`) compatible avec tes certificats. |
| **DNS** | Un enregistrement **A** (et éventuellement **AAAA**) du sous-domaine vers l’IP **publique** du serveur qui écoute sur 80/443 (ou équivalent CDN non décrit ici). |

---

## 2. Arborescence utile

```
PartyGame/
├── games/                 # Packs quiz JSON (ex. example-quiz-pack.json)
├── webserver/
│   ├── client/           # Frontend Vite + React
│   ├── src/              # Backend TypeScript (Fastify, Socket.IO)
│   ├── Dockerfile        # Image de production (contexte = racine PartyGame/)
│   └── package.json
├── docker-compose.yml    # Compose (build depuis la racine PartyGame/)
├── .env.example
└── manual.md             # Ce fichier (manuel.md demandé utilisateur : lien symbolique ci-dessous optionnel)
```

> **Important :** les commandes **`docker compose build`** depuis la racine **`PartyGame/`** permettent d’embarquer le dossier **`games/`** dans l’image (copié lors du build).

---

## 3. Variables d’environnement

Créer un fichier **`.env`** à la racine de **`PartyGame/`** à partir de **`.env.example`**.

| Variable | Rôle |
|----------|------|
| **`JWT_SECRET`** | Secret pour signer les jetons joueur (**obligatoire** en prod ; doit être une chaîne longue et aléatoire). Compose refuse de démarrer si elle est vide (`:?`). |
| **`PUBLIC_URL`** | URL publique **avec schéma**, **sans slash final** (ex. `https://partygames.from-beyond.fr`). Utilisée par l’API pour les liens d’invitation. |
| **`PARTYGAMES_HOST`** | Nom d’hôte utilisé uniquement dans les **labels Traefik** (`Host(\`...\`)`). Doit être le **FQDN exact** présent dans le DNS. |
| **`GAMES_DIR`** | Déjà forcé dans le compose Docker (`/app/games`). En local, valeur par défaut du serveur : répertoire `PartyGame/games` relatif au build. |
| **`PORT`** | Dans le compose : **3000** (port interne du conteneur). |
| **`CORS_ORIGIN`** | Facultatif (développement) ; défaut permissif dans le code si non défini. |

---

## 4. Développement local

À exécuter sous **Linux / macOS / WSL** ou tout environnement où **`npm`** est disponible.

```bash
cd PartyGame/webserver

# Dépendances
npm install

# Variables minimales pour le SPA (proxy Vite → 3000)
export JWT_SECRET="dev-change-me-plus-long-en-vrai"
export PUBLIC_URL="http://127.0.0.1:5173"

# Terminal 1 — API sur le port 3000
npm run dev:server

# Terminal 2 — Frontend Vite (proxy /api et /socket.io vers 127.0.0.1:3000)
npm run dev:client
```

- **Ou** tout-en-un **:** `npm run dev` (lance les deux sous-processus avec `concurrently`).
- Ouverture : **http://127.0.0.1:5173** (le SPA proxy les appels **`/api`** et **`socket.io`**).

### Build local de vérification

```bash
cd PartyGame/webserver
npm install
npm run build
npm test
npm start   # après build : serve sur PORT (défaut 3000) + fichiers dans dist/client
```

---

## 5. Déploiement Docker (production)

À lancer depuis **`PartyGame/`** (pour que **`context: .`** inclue **`games/`**).

```bash
cd PartyGame

# .env doit contenir au minimum JWT_SECRET (et PUBLIC_URL/PARTYGAMES_HOST adaptés).
cp .env.example .env
# Éditer .env

docker compose build --no-cache
docker compose up -d
docker compose logs -f buzzy-live-games-web
```

Contrôles rapides depuis le serveur :

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -skI -H 'Host: partygames.from-beyond.fr' https://127.0.0.1/
```

(le second test force le **`Host`** vers Traefik pour vérifier le routage si Traefik écoute en local.)

### Traefik

- Réseau **externe** **`traefik`** : le service **`buzzy-live-games-web`** doit y être attaché (déjà le cas dans **`docker-compose.yml`**).
- **Port cible Traefik → conteneur** : **`3000`** (`traefik.http.services.partygames.loadbalancer.server.port=3000`).

Si tu modifies le fichier compose Traefik racine (**`/home/cyrille/dev/traefik`** sur ton installation), vérifie que la version d’image **Traefik** est compatible avec la **Docker API** du démon (`v3.6+` a corrigé l’erreur « client API 1.24 too old » rencontrée avec Docker Engine très récent).

---

## 6. DNS — vérifications pas à pas

Si le site « ne répond pas » ou erreur navigateur (**ERR_NAME_NOT_FOUND**, **ERR_TUNNEL_CONNECTION_FAILED**, **CERT**…), suivre cet ordre.

### 6.1 Le nom existe-t-il d’un point de vue DNS global ?

```bash
# Résolver public (exemples)
dig +short partygames.from-beyond.fr A @8.8.8.8
dig +short partygames.from-beyond.fr A @1.1.1.1
```

Si **vide** ou **SERVFAIL**, le problème principal est encore le **DNS** (pas Traefik ni l’application).

### 6.2 La zone autoritaire reflète bien ton enregistrement ?

Chez Infomaniak, interroger **directement** les NS du domaine (**pas** uniquement une exportation depuis le manager).

```bash
dig NS from-beyond.fr +short
dig +short partygames.from-beyond.fr A @nsany1.infomaniak.com.
```

**Piège vu en pratique :** une **exportation zone** depuis le tableau de bord montrait des enregistrements (**ex. série SOA différente, ligne `partygames` présente**) alors que les réponses depuis **`nsany1.infomaniak.com`** renvoyaient encore **NXDOMAIN** ou une **ancienne série SOA**. Cela signifie que soit :

- La révision DNS **n’est pas publiée** sur les serveurs autoritaires,
- Ou l’enregistrement a été créé dans un écran (« adresse Web » / hébergement) qui **ne met pas à jour** la **zone DNS** du domaine,
- Ou un problème doit être résolu avec le **support Infomaniak** (en mentionnant la **série SOA** attendue vs celle observée au `dig @nsany1`).

Critère de succès : **`dig @nsany1`** (et les résolveurs publics après propagation **TTL**) renvoient **l’A** vers **`54.38.98.213`** (ou l’IPv4 finalement choisie pour ce VPS).

### 6.3 Cohérence IP

- L’enregistrement **A** de **`partygames.from-beyond.fr`** doit viser **l’IP du serveur qui exécute Traefik** et qui publie les ports **80/443** sur Internet.

### 6.4 Enregistrement AAAA

Si un **AAAA** existe : le navigateur peut privilégier **IPv6**. Si le chemin IPv6 jusqu’à ton VPS ou les pare-feux sont incomplets → erreurs « tunnel » / timeout. À tester :

- désactiver **AAAA** le temps du diagnostic ;
- tester depuis réseau **4G**.

### 6.5 Après résolution DNS : certificat TLS

Une fois **`A`** visible partout :

- Les logs **Traefik / ACME** doivent montrer l’émission d’un certificat pour **`partygames.from-beyond.fr`**. Tant que **Let’s Encrypt** voit encore **NXDOMAIN**, le HTTPS restera fragile (certificat par défaut / erreur TLS).

---

## 7. « Je crois qu’il y a un autre problème » — causes fréquentes

| Symptôme possible | Cause typique à vérifier |
|-------------------|---------------------------|
| **DNS parfois OK / parfois pas** | TTL, propagation, ancien résolveur en cache (**OS**, box, **entreprise**) |
| **`ERR_TUNNEL_CONNECTION_FAILED`** (Chrome) | Souvent IPv6 (**AAAA**) ou intervention **proxy/antivirus**/VPN |
| **`404`/aucune réponse derrière bon Host** | **Traefik** ne charge pas les labels Docker (vérif erreurs provider Docker dans les logs Traefik) |
| **Self-signed / erreur cert** | DNS pas encore résolu lors de la tentative **ACME** ; redémarrer Traefik après DNS OK |

---

## 8. Synthèse des commandes

| Action | Commande |
|--------|----------|
| Install local | `cd PartyGame/webserver && npm install` |
| Build + tests | `npm run build && npm run test && npm test` |
| Dév API + SPA | `npm run dev` |
| Image prod | Depuis **`PartyGame/`** : `docker compose build` |
| Démarrage prod | Depuis **`PartyGame/`** : `docker compose up -d` |
| Santé | `curl -fsS http://127:3000/api/health` *(depuis la machine hôte avec port mappé si besoin)* |

---

## 9. Support

En cas de **décrochage prolongé DNS** alors que **tout est correct dans le fichier exporté**, joindre le support hébergeur avec :

- **`dig`** + capture (`@nsany1`, `@8.8.8.8`),
- série **SOA** affichée,
- description : *« ligne `partygames` présente dans l’export mais absente dans les réponses live des NS autoritaires »*.
