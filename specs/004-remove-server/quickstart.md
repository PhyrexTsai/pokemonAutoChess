# Quickstart: Remove Server

**Feature**: 004-remove-server
**Date**: 2026-03-08

## What This Phase Does

Removes the Express/Node.js server entirely. All REST API `fetch()` calls are replaced with direct function calls to existing modules. Tilemap generation is moved to browser-side by rewriting `Tileset` to use `fetch()` instead of `fs-extra.readJsonSync()`. SPA routing switches from `BrowserRouter` to `HashRouter` (eliminates server-side fallback dependency). The build produces only client-side output. The game runs as a pure static SPA.

## Implementation Strategy

**Principle**: Maximum deletion, minimum creation. Every endpoint already wraps an existing function — just call the function directly.

### Step 0: Switch BrowserRouter to HashRouter (R13 — prerequisite)

```typescript
// BEFORE: requires server-side fallback for SPA routes
import { BrowserRouter } from "react-router-dom"
<BrowserRouter>...</BrowserRouter>

// AFTER: zero server dependency, # routing
import { HashRouter } from "react-router-dom"
<HashRouter>...</HashRouter>
```

### Step 1: Rewrite Tileset to work in browser (R11 — prerequisite)

`Tileset` class uses `readJsonSync` (fs-extra, Node.js only). Must rewrite before client can call `initTilemap()`.

```typescript
// BEFORE: Node.js filesystem read
import { readJsonSync } from "fs-extra"
export default class Tileset {
  constructor(id: DungeonPMDO) {
    this.metadata = readJsonSync(`${src}/${id}/metadata.json`)
  }
  exportToTiled() {
    tilesets.push(readJsonSync(`${src}/${id}/${name}.json`))
  }
}

// AFTER: browser-compatible fetch, private constructor + async factory
export default class Tileset {
  private constructor(id: DungeonPMDO, metadata: TilesetExchangeFile) {
    this.id = id; this.metadata = metadata
  }
  static async create(id: DungeonPMDO): Promise<Tileset> {
    const metadata = await fetch(`/assets/tilesets/${id}/metadata.json`).then(r => r.json())
    return new Tileset(id, metadata)
  }
  async exportToTiled() {
    // readJsonSync → Promise.all(fetch(...)) for all tileset JSONs in parallel
  }
}

// Design constructor accepts tileset param (no longer creates internally)
// initTilemap becomes async, fixes double create() bug
export async function initTilemap(map: DungeonPMDO): Promise<DesignTiled> {
  const tileset = await Tileset.create(map)
  const design = new Design(map, tileset, 5, 0.1)  // constructor calls create() internally
  return await design.exportToTiled()
}
```

### Step 2: Replace fetch() calls with direct function calls

```typescript
// BEFORE: fetch through server
const res = await fetch("/bots?approved=true")
const botList = await res.json()

// AFTER: call directly
import { fetchBotsList } from "../../../services/bots"
const botList = fetchBotsList(true)
```

```typescript
// BEFORE: fetch tilemap from server
fetch(`/tilemap/${mapName}`).then(res => res.json()).then(tilemap => { ... })

// AFTER: generate locally (async pattern preserved)
import { initTilemap } from "../../../../core/design"
initTilemap(mapName as DungeonPMDO).then(tilemap => { ... })
```

### Step 3: Initialize bots at client startup

```typescript
// In network.ts — BEFORE `export const engine = new LocalGameEngine()`
import { loadBotsFromJson } from "../../models/local-store"
loadBotsFromJson() // was called in app.config.ts at server startup; must precede engine init
```

### Step 4: Make meta/leaderboard fetches return empty data

```typescript
// BEFORE
export async function fetchTitles() { return fetch("/titles").then(r => r.json()) }

// AFTER
export async function fetchTitles() { return [] }
```

### Step 5: Delete server files

- `app/index.ts`
- `app/app.config.ts`
- `app/metrics.ts`

### Step 6: Update build pipeline

- `package.json`: remove server scripts and dependencies
- `esbuild.js`: add `context.serve()` for dev mode (skip `entryNames` hash in dev), remove 6 stale FIREBASE_* defines (keep DISCORD_SERVER)
- `tsconfig.json`: clean up includes/outDir (keep `edit/*`, remove `scheduled/*` and `db-commands/*`)

### Step 7: Remove server npm packages

```bash
npm uninstall express helmet cors body-parser cron prom-client pm2-prom-module-client express-basic-auth express-openapi fs-extra pm2 ts-node-dev @types/cors @types/fs-extra openapi-typescript npm-run-all
```

## Files Changed (Summary)

| Action | Files | Lines Changed |
|--------|-------|---------------|
| DELETE | 3 files (`index.ts`, `app.config.ts`, `metrics.ts`) | -214 lines |
| REWRITE | 2 core files (`tileset.ts`, `design.ts` — async factory) | ~100 lines changed |
| MODIFY | 1 file (`index.tsx` — BrowserRouter → HashRouter) | 2 lines changed |
| MODIFY | ~14 client files (replace fetch with direct calls) | ~100 lines changed |
| MODIFY | 3 config files (`package.json`, `esbuild.js`, `tsconfig.json`) | ~40 lines changed |
| REMOVE | 16 npm packages (incl. fs-extra, npm-run-all, openapi-typescript) | - |

**Total estimated effort**: 28 tasks, tileset rewrite is the only non-trivial one.

## Verification

```bash
# Build succeeds (client only)
npm run build

# No server files exist
test ! -f app/index.ts && test ! -f app/app.config.ts && test ! -f app/metrics.ts

# No server dependencies
grep -E "express|helmet|cors|body-parser|prom-client|fs-extra" package.json  # should return nothing

# No fetch to local endpoints in client code
grep -rn 'fetch("/' app/public/src/  # should return nothing (external URLs like github are OK)

# No fs-extra in codebase
grep -rn 'fs-extra' app/ --include='*.ts'  # should return nothing

# Serve statically and play
npx serve app/public/dist/client
```
