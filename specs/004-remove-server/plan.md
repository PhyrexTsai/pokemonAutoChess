# Implementation Plan: Remove Server

**Branch**: `004-remove-server` | **Date**: 2026-03-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-remove-server/spec.md`
**Design Principle**: Maximum deletion, minimum creation. Every endpoint wraps an existing function — call it directly.

## Summary

Delete the Express/Node.js server (`app/index.ts`, `app/app.config.ts`, `app/metrics.ts`). Replace all client-side `fetch("/endpoint")` calls with direct function calls to the existing modules they already wrap (`fetchBotsList()`, `fetchBot()`, `getGameHistoryByPlayer()`). Tilemap generation requires special handling: `Tileset` class uses `fs-extra.readJsonSync()` (Node.js only), so must be rewritten to use `fetch()` for JSON loading, making `initTilemap()` async (see R11). SPA routing switches from `BrowserRouter` to `HashRouter` to eliminate server-side fallback dependency (see R13). Endpoints returning empty data (`/leaderboards`, `/titles`, `/meta/*`) are replaced with inline empty returns. Update `esbuild.js` to use its built-in `serve()` API for development and clean up 6 stale FIREBASE_* defines. Remove 16 server-only npm packages (including `fs-extra`, `npm-run-all`). The result is a pure static SPA — `npm run build` produces only client output, deployable to any CDN.

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js >=20.16.0
**Primary Dependencies**: Phaser 3 (rendering), React 19 (UI), Redux Toolkit (state), `@colyseus/schema` (data structures — retained for Phase 4), `idb` (IndexedDB)
**Storage**: IndexedDB via `idb` (player profile, game history — from Phase 1)
**Testing**: Manual play-testing (no test suite configured)
**Target Platform**: Modern browsers (Chrome, Firefox, Safari, Edge)
**Project Type**: Browser game (static SPA)
**Performance Goals**: 60 FPS game loop, no regression from Phase 2
**Constraints**: Offline-capable, zero server dependency
**Scale/Scope**: 3 files deleted, ~21 files modified (incl. tileset.ts/design.ts async rewrite, index.tsx HashRouter), 16 npm packages removed. Low-risk phase overall, tileset rewrite is the only non-trivial change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Zero External Dependencies | PASS | This phase removes Express, the last server dependency. Only `@colyseus/schema` remains (Phase 4). |
| II. Game Engine Independence | PASS | Engine already independent (Phases 0+2). No engine changes in this phase. |
| III. Gameplay Fidelity | PASS | No game logic changes. Only data access paths change (fetch → direct call). |
| IV. Atomic Traceability | PASS | Each task = one commit. Build must pass at every commit. |
| V. Incremental Viability | PASS | App works at each step. fetch→direct-call migrations are independent. |
| VI. Simplicity Over Abstraction | PASS | Pure deletion and inline replacement. Zero new abstractions. |

**Gate result**: PASS — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/004-remove-server/
├── plan.md              # This file
├── research.md          # Phase 0 output: 13 research decisions
├── data-model.md        # Phase 1 output: data access migration
├── quickstart.md        # Phase 1 output: implementation guide
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
app/
├── index.ts                    # DELETE — server entry point
├── app.config.ts               # DELETE — Express config + 13 endpoints
├── metrics.ts                  # DELETE — Prometheus metrics
├── core/
│   ├── design.ts               # MODIFY — initTilemap() → async (Design uses async Tileset factory)
│   └── tileset.ts              # MODIFY — readJsonSync (fs-extra) → fetch(), constructor → async factory
├── models/
│   └── local-store.ts          # UNCHANGED — loadBotsFromJson() called from client init
├── services/
│   └── bots.ts                 # UNCHANGED — fetchBotsList()/fetchBot() called directly
├── public/src/
│   ├── api/
│   │   └── meta.ts             # MODIFY — fetch wrappers → return empty data inline
│   ├── game/scenes/
│   │   ├── game-scene.ts       # MODIFY — fetch("/tilemap") → initTilemap()
│   │   └── debug-scene.ts      # MODIFY — fetch("/tilemap") → initTilemap()
│   ├── index.tsx               # MODIFY — BrowserRouter → HashRouter (R13)
│   ├── network.ts              # MODIFY — add loadBotsFromJson() call before LocalGameEngine init
│   ├── pages/
│   │   ├── lobby.tsx           # MODIFY — fetch("/bots") → fetchBotsList()/fetchBot()
│   │   ├── game.tsx            # MODIFY — fetch("/leaderboards") → inline empty
│   │   └── component/
│   │       ├── profile/
│   │       │   ├── profile.tsx         # MODIFY — remove player search fetch
│   │       │   └── game-history.tsx    # MODIFY — fetch("/game-history") → direct call
│   │       ├── leaderboard/
│   │       │   └── leaderboard-menu.tsx # MODIFY — fetch → inline empty
│   │       ├── preparation/
│   │       │   └── bot-select-modal.tsx # MODIFY — fetch("/bots") → fetchBotsList()
│   │       └── bot-builder/
│   │           ├── bot-builder.tsx      # MODIFY — fetch("/bots/:id") → fetchBot()
│   │           ├── import-bot-modal.tsx # MODIFY — fetch("/bots") → fetchBotsList()/fetchBot()
│   │           └── bot-manager-panel.tsx # MODIFY — GET /bots → fetchBotsList(), DELETE/POST → no-op + toast
│   ├── pages/component/profile/
│   │   └── profile-chat-history.tsx   # MODIFY — fetch("/chat-history") → inline empty []
esbuild.js                       # MODIFY — add serve() for dev mode, remove stale FIREBASE_* defines
package.json                     # MODIFY — remove server deps/scripts
tsconfig.json                    # MODIFY — remove outDir, remove scheduled/+db-commands/ from includes (keep edit/)
tsconfig.tsx.json                # MODIFY — remove scheduled/+db-commands/ from includes (keep edit/)
```

**Structure Decision**: No structural changes. The project was already a monorepo with shared `app/` code. After this phase, `app/` contains only client-bundled code (via esbuild) and shared game logic.

## Fetch-to-Direct-Call Migration Table

| Client File | Current `fetch()` | Replacement | Sync/Async |
|------------|-------------------|-------------|------------|
| `lobby.tsx:113` | `fetch("/bots?approved=true")` | `fetchBotsList(true)` | sync→sync |
| `lobby.tsx:131` | `fetch(\`/bots/${b.id}\`)` | `fetchBot(b.id)` — returns `IBot \| null`，需 null 過濾 | async→sync |
| `bot-select-modal.tsx:39` | `fetch(\`/bots?approved=true\`)` | `fetchBotsList(true)` — state type 改 `IBotListItem[]` | async→sync |
| `bot-builder.tsx:81` | `fetch(\`/bots/${botId}\`)` | `fetchBot(botId)` | async→sync |
| `bot-builder.tsx:373` | `fetch("/bots", { method: "POST" })` | No-op + toast "Not available in single-player mode" | |
| `import-bot-modal.tsx:16` | `fetch("/bots")` | `fetchBotsList()` — state type 改 `IBotListItem[]` | async→sync |
| `import-bot-modal.tsx:62` | `fetch(\`/bots/${id}\`)` | `fetchBot(id)` | async→sync |
| `bot-manager-panel.tsx:78` | `fetch(\`/bots?pkm=...\`)` | `fetchBotsList(undefined, filteredPokemon)` — state type 改 `IBotListItem[]` | async→sync |
| `bot-manager-panel.tsx:94` | `fetch(\`/bots/${id}\`, DELETE)` | No-op + toast (admin, single-player N/A) | |
| `bot-manager-panel.tsx:103` | `fetch(\`/bots/${id}/approve\`, POST)` | No-op + toast (admin, single-player N/A) | |
| `game-scene.ts:353` | `fetch(\`/tilemap/${map}\`)` | `initTilemap(map)` (async — Tileset rewritten per R11) | async→async |
| `debug-scene.ts:192` | `fetch(\`/tilemap/${map}\`)` | `initTilemap(map)` (async — same as above) | async→async |
| `game-history.tsx:43` | `fetch(\`/game-history/${uid}\`)` | `getGameHistoryByPlayer(uid)` + sort，移除分頁（in-memory 最多 100 筆，見 R9） | async→sync |
| `leaderboard-menu.tsx:24` | `fetch("/leaderboards")` | `{ leaderboard: [], botLeaderboard: [], levelLeaderboard: [], eventLeaderboard: [] }` inline | async→sync |
| `game.tsx:331` | `fetch("/leaderboards")` | `{ leaderboard: [] }` inline | async→sync |
| `profile.tsx:51` | `fetch(\`/players?name=\`)` | Remove (multiplayer search) | |
| `meta.ts:181-214` | `fetch("/meta/*")`, `fetch("/titles")`, etc. | Return `[]` or `null` inline | async→sync |
| `profile-chat-history.tsx:17` | `fetch(\`/chat-history/${uid}\`)` | Return `[]` inline (endpoint already removed) | async→sync |
