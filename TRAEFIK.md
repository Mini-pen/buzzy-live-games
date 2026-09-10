# buzzy-live-games — routage Traefik

**URL publique :** `https://games.from-beyond.fr/buzzy-live-games`

Déployé comme application **Compose** dans Dokploy, derrière le Traefik géré par Dokploy.

## Conventions de l'hôte (Dokploy)

- Réseau Docker externe : **`dokploy-network`**
- Entrypoints : **`web`** (80), **`websecure`** (443)
- Résolveur ACME : **`letsencrypt`** (challenge HTTP-01 sur `web`)
- `exposedByDefault: false` → `traefik.enable=true` obligatoire sur le service
- Routeurs préfixés **`buzzylive-`**

## Service mono-conteneur derrière un sous-chemin

L'app (API Fastify + SPA + Socket.IO) est servie sous le sous-chemin `/buzzy-live-games`
du domaine `games.from-beyond.fr`. Le préfixe est :

1. **compilé dans le SPA** par Vite (`base`), via le build arg `APP_BASE_PATH` ;
2. **connu du serveur** via l'env `BASE_PATH` (préfixe les URLs de médias `/games/…`,
   `/avatars/…` renvoyées au navigateur) ;
3. **retiré par Traefik** avant d'atteindre Fastify (middleware `stripprefix`).

Les trois valeurs doivent coïncider. Pour servir à la racine d'un domaine dédié :
mettre `APP_BASE_PATH=/` (ou vide), retirer le middleware `buzzylive-stripprefix`,
et ajuster la règle en `Host(...)` seul.

## Variables (`.env` Dokploy)

| Variable | Rôle | Exemple |
|---|---|---|
| `GAMES_HOST` | Host public | `games.from-beyond.fr` |
| `APP_BASE_PATH` | Sous-chemin (build SPA + `BASE_PATH` serveur + `stripprefix`) | `/buzzy-live-games` |
| `PUBLIC_URL` | URL publique complète (QR codes, liens de reprise animateur) | `https://games.from-beyond.fr/buzzy-live-games` |
| `JWT_SECRET` | **Obligatoire.** Secret de signature JWT | — |

## Labels (résumé)

| Label | Rôle |
|---|---|
| `traefik.enable=true` | Découverte Docker (`exposedByDefault: false`). |
| `traefik.docker.network=dokploy-network` | Réseau que Traefik utilise vers le conteneur. |
| Router `buzzylive-http` | `Host(...) && PathPrefix(...)` sur `web`, middleware redirection HTTPS. |
| Router `buzzylive-https` | Même règle sur `websecure`, `tls.certresolver=letsencrypt`, middleware `stripprefix`. |
| `buzzylive-stripprefix` | Retire `APP_BASE_PATH` avant de transmettre à Fastify. |
| `loadbalancer.server.port=3000` | Port interne du conteneur Node (`PORT`). |

## Déploiement

Push sur `main` → redeploy Dokploy (build Compose : `docker compose up -d --build`).
Le `.env` (avec `JWT_SECRET`) est géré dans l'onglet Environment de l'application Dokploy.

## WebSockets

Socket.IO passe par le même host/port. Le client se connecte sur
`path: <APP_BASE_PATH>/socket.io` ; Traefik retire le préfixe et le serveur
répond sur `/socket.io`. Aucun label spécifique n'est requis (Traefik relaie
`Upgrade`/`Connection`).
