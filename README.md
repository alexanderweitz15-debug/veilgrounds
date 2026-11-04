# Veilgrounds

A 5v5 MOBA against bots, in the browser. Classic mode, lane training, sandbox and trainer modes. The UI is German
(English switchable), the code is English. TypeScript (strict), Vite 5, Three.js 0.170, Vitest. The simulation runs
deterministically at 30 Hz in a Web Worker; all graphics are painted procedurally at runtime (there are no image
files, see [docs/ART.md](docs/ART.md)).

## Requirements

- Node.js 22 or newer (CI uses 24) and npm.
- A current Chromium, Firefox or Safari with WebGL2, module workers and IndexedDB.

## Install

```sh
npm ci            # exact versions from package-lock.json (or: npm install)
```

## Run in development

```sh
npm run dev       # Vite dev server, http://localhost:5173/, hot reload
```

Dev shortcuts (query string): `?play=classic` (straight into a 5v5 match), `?play=lane`, `?play=sandbox`, a trainer
mode name, `?mock` (offline mock link), `?bench` (exposes `window.__vg` / `window.__vgMenu` and steps frames
synchronously, used by the browser test scripts).

In the dev server the sprite cache (IndexedDB) is off: every start paints all sprites again. Use the production build
to see real load times.

## Build and run the production build

```sh
npm run build     # tsc --noEmit, then vite build -> dist/
npm run preview   # serves dist/ at http://localhost:4173/ (add -- --port 4174 --strictPort to choose the port)
```

`npx vite build` alone skips the type check (CI does both: `npm run typecheck` and `npx vite build`).

### The game must be served over http(s)

Opening `dist/index.html` (or `index.html`) as a `file://` URL does **not** work. Verified with the production build in
headless Chromium: the page stays empty and the console shows `Access to script at 'file:///…/assets/index-….js' from
origin 'null' has been blocked by CORS policy`. Reasons: the app is loaded as ES modules (`<script type="module">`,
blocked on `file://`), the sprite bake runs in module workers (`new Worker(url, { type: 'module' })`), the sprite and
terrain cache uses IndexedDB, and the PWA service worker needs a secure context (`http://localhost` counts as one).
Any static file server works (`npm run preview`, `python3 -m http.server -d dist`, GitHub Pages). The build uses
`base: './'`, so it can be served from a sub-path.

## Tests

```sh
npm test                              # the full suite (vitest run), ~4-5 minutes on 4 cores
npx vitest run tests/<file>.test.ts   # one file
npm run typecheck                     # tsc --noEmit
```

Asset and loader tests: `tests/loader*.test.ts`, `tests/assetManifest.test.ts`. Replay/determinism tests
(`tests/replay.test.ts`, `tests/sim/**`) must stay green for every change.

## Bot simulation

Headless bot-vs-bot matches for calibrating the bot ranks and measuring the brain (no browser needed):

```sh
npm run bot-sim -- --rank=gold --games=4 --minutes=20 --seed=101 --variance=0 --report
npm run bot-sim -- --scenario=laneAlone --rank=gold --games=3 --seed=1 --minutes=10
```

All options are documented in the header of [tools/botSim.ts](tools/botSim.ts) (`--jobs=N` runs matches in parallel,
`--brain=new` switches on the beta bot brain, `--out`/`--game-out` write CSV). Targets live in
`tools/botSimTargets.json`.

## Deployment

Every push to `main` runs `.github/workflows/pages.yml` (type check, tests, `vite build`) and publishes `dist/` to
GitHub Pages. The service worker (`public/sw.js`) makes the site installable and cache-first for hashed assets; an old
tab whose lazy chunk has disappeared after a deploy reloads once on its own (`src/render/loader/preloadError.ts`).

## Where things are

| Area | Path |
|---|---|
| Simulation (ECS, abilities, items, jungle), runs in a worker | `src/sim/` |
| Bot brain | `src/ai/` |
| Rendering (Three.js world, painted sprites, fx) | `src/render/` |
| Sprite painters (paper-doll champions, minions, monsters) | `src/render/champions/` |
| Asset loading, manifest, placeholders | `src/render/loader/` |
| HUD, menus, lobby, shop | `src/ui/` |
| Game loop on the client | `src/game/` |
| Data (champions, items, runes, map) | `src/data/` |
| Docs: art pipeline, decisions, roadmap | `docs/ART.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md` |
