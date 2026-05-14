# Buzzy redesign · phase 1 (theme only)

Mini-PR à appliquer sur `Mini-pen/buzzy-live-games`. Aucune logique métier
touchée — uniquement la couche visuelle. Aucun changement de routes, de
sockets, de stockage de session ou d'auth.

## Branche suggérée

```bash
git checkout -b redesign/buzzy-theme
```

## Fichiers à ajouter

- `webserver/client/src/styles/buzzy.css` *(nouveau)*

## Fichiers à remplacer

- `webserver/client/src/main.tsx` *(+1 import)*
- `webserver/client/index.html` *(title + theme-color)*
- `webserver/client/src/App.tsx` — **seulement la fonction `Shell`** (~lignes
  273-289). Le reste du fichier reste **strictement identique**.

## Nouveau `Shell` à coller dans `App.tsx`

Repère la fonction `Shell` existante :

```tsx
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
```

Remplace-la **entièrement** par :

```tsx
function Shell(props: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="bz-app">
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 24px 48px" }}>
        <header className="bz-header">
          <Link to="/" className="bz-logo" style={{ fontSize: 24 }}>
            <span>buzzy</span>
            <span className="bz-logo-dot" />
          </Link>
          <span className="bz-page-title">{props.title}</span>
          <nav>
            <Link to="/">Accueil</Link>
            <Link to="/create">Créer</Link>
            <Link to="/join">Rejoindre</Link>
          </nav>
        </header>
        {props.children}
      </div>
    </div>
  );
}
```

C'est le seul changement JSX. Le reste du visuel découle automatiquement
des règles CSS dans `buzzy.css` qui prennent en main `button`, `input`,
`select`, `textarea`, `h1`/`h2`, `a`, `code` à l'intérieur de `.bz-app`.

## Coups de pinceau optionnels (purement cosmétiques)

Ces touches améliorent visiblement 3 endroits où l'inline-style l'emporte
sur la CSS. Toutes facultatives — la PR reste pertinente sans elles.

### a) Cards "Reprendre" sur la Home

Dans `App.tsx`, fonction `Home`, deux `<section>` de reprise (joueur /
animateur) ont `style={{ ..., background: "#f7f7fb", border: "1px solid #ddd", ... }}`.
Tu peux remplacer ces blocs `style={{}}` par `className="bz-card"` :

```tsx
<section className="bz-card" style={{ marginBottom: 12 }}>
```

### b) Code de partie en mono

Là où le code apparaît (Home : `code <strong>{playerResume.joinCode}</strong>`,
Lobby/Admin : `<strong>{snap.joinCode}</strong>`), tu peux remplacer
`<strong>` par `<code className="bz-code">` pour un rendu monospacé +
fond contrasté.

### c) État de partie

Dans `Play` et `Admin`, le `<p>État : {snap.state}</p>` peut devenir :

```tsx
<p>État&nbsp;: <span className={`bz-pill ${snap.state === "round_active" ? "bz-live" : ""}`}>
  {snap.state === "round_active" && <span className="bz-dot" />}
  {snap.state}
</span></p>
```

## Vérifier en local

```bash
cd webserver
npm install
npm run dev
```

Ouvre `http://127.0.0.1:5173`. Tu dois voir :
- Fond sombre, logo `buzzy` + dot jaune en haut à gauche
- Bouton "Créer / Rejoindre" en jaune électrique (submit primary)
- Inputs avec fond sombre + ring jaune au focus
- Liens en accent jaune

## Commit & push

```bash
git add webserver/client/src/styles/buzzy.css \
        webserver/client/src/main.tsx \
        webserver/client/src/App.tsx \
        webserver/client/index.html
git commit -m "feat(ui): apply Buzzy theme — tokens.css + new Shell"
git push -u origin redesign/buzzy-theme
```

Puis ouvre la PR sur GitHub.

## Prochaines phases (PR séparées)

- **Phase 2** — refonte de la `Home` (hero + cards de reprise)
- **Phase 3** — refonte du `Play` (buzzer plein écran, file de buzz)
- **Phase 4** — refonte de l'`Admin` (QR XXL, scoreboard, file live)
- **Phase 5** — nouveau mode diffusion (`/party/:id/broadcast`)
