# buzzy-live-games — routage Traefik

**URL publique :** https://partygames.from-beyond.fr/

Ce projet suppose la même convention que `therapia.origin/traefik` :

- Réseau Docker externe : **`traefik`**
- Entrypoints : **`http`** (80), **`https`** (443)
- Résolveur ACME : **`cloudflare`** (HTTP-01 sur l’entrypoint `http`)
- Les conteneurs ne sont pas exposés par défaut : **`traefik.enable=true`** sur le service
- Les routeurs Traefik sont préfixés **`buzzylive-`** (ex. `buzzylive-https`) pour éviter tout doublon avec une ancienne stack encore étiquetée `partygames-*` sur le même hôte.

## Fichiers fournis

- `docker-compose.yml` : service `buzzy-live-games-web` avec labels prêts à l’emploi.
- `.env.example` : valeur par défaut `PARTYGAMES_HOST=partygames.from-beyond.fr`.

## Déploiement

```bash
cd buzzy-live-games
cp .env.example .env   # optionnel : le compose a déjà ce host en repli par défaut
docker compose build
docker compose up -d
```

Vérifier que **`partygames.from-beyond.fr`** résout vers l’hôte où tournent Traefik et ce stack.

## Règles (résumé)

| Label | Rôle |
|--------|------|
| `traefik.enable=true` | Active la découverte Docker (Ton `traefik.yml` a `exposedByDefault: false`). |
| Router `*-http` | `Host(`…`)` sur l’entrypoint `http`, middleware **redirection HTTPS** permanente. |
| Exclusion `/.well-known/acme-challenge/` | Laisse passer le défi Let’s Encrypt sur le port 80. |
| Router `*-https` | Même `Host`, entrypoint `https`, `tls=true`, `tls.certresolver=cloudflare`. |
| `loadbalancer.server.port=3000` | Cible le port **interne** du conteneur Node (`PORT` dans le compose). |

## Réutiliser les middlewares globaux (optionnel)

Si tu préfères réutiliser `redirect-to-https` et `security-headers` déjà définis sur le **conteneur Traefik**, remplace les lignes middleware / redirect du compose par des références `@docker`, par exemple :

`traefik.http.routers.buzzylive-http.middlewares=redirect-to-https@docker`

et sur le router HTTPS :

`traefik.http.routers.buzzylive-https.middlewares=security-headers@docker`

Les noms doivent correspondre exactement aux `traefik.http.middlewares.*` du service Traefik, et les deux conteneurs doivent partager le réseau **`traefik`**.

## WebSockets (plus tard)

Quand le `webserver` exposera une API temps réel, aucun label spécial n’est en général nécessaire : Traefik transmet les en-têtes `Upgrade` / `Connection` tant que le service pointe vers le bon port. Si tu mets API et fichiers statiques sur des ports différents, il faudra soit **deux services** Docker avec deux noms de service Traefik, soit un **router** supplémentaire avec un préfixe de chemin.
