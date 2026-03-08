# Feature Specification: Remove Server

**Feature Branch**: `004-remove-server`
**Created**: 2026-03-08
**Status**: Draft
**Input**: User description: "檢視 PHASE.md 開始進行 Phase 3 — 砍掉 Express/Node.js 後端，改成純靜態 SPA 構建"

## Context

This is Phase 3 of the "Multiplayer → Single Player" refactoring roadmap (see `PHASE.md`). Phases 0–2 have completed:

- **Phase 0** extracted the game engine from Colyseus Schema inheritance
- **Phase 1** replaced MongoDB with IndexedDB (client) and static JSON (bots)
- **Phase 2** replaced Colyseus networking with a local in-browser game engine (LocalGameEngine)

The Express/Node.js server now serves no functional purpose — it merely serves static files and proxies a handful of REST endpoints that already read from local storage or return empty data. This phase removes the server entirely, producing a pure static SPA that can be served from any file server or CDN.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Game Runs Without Server Process (Priority: P1)

A player opens the game from static files (served by any HTTP server or CDN) and plays a complete match. No Node.js process is running. The game loads, starts, and completes entirely in the browser.

**Why this priority**: This is the fundamental goal — if the server is removed but the game doesn't work as a static SPA, nothing else matters.

**Independent Test**: Build the project. Serve `app/public/dist/client/` with any static file server (e.g., `npx serve`). Open in browser. Start a game with bots. Play through 5+ rounds. Verify all game mechanics work identically to Phase 2.

**Acceptance Scenarios**:

1. **Given** the project is built with `npm run build`, **When** the output directory is served with a static file server (no Node.js), **Then** the game loads and is fully playable
2. **Given** a static deployment, **When** the player navigates between lobby, game, and after-game pages, **Then** all SPA routes resolve correctly without 404 errors
3. **Given** no server process, **When** the player starts a match with 7 bot opponents, **Then** all game mechanics (shop, drag-drop, battle, income, damage, ranking) function correctly

---

### User Story 2 — Data Access Works Locally (Priority: P2)

All features that previously relied on REST API endpoints (bot lists, game history, leaderboard, tilemap generation, Pokemon/item data) work by calling local functions directly instead of HTTP fetch.

**Why this priority**: Without converting fetch calls to local function calls, the game would break on features like bot selection, map rendering, and game history display.

**Independent Test**: With no server running, open the game. Navigate to lobby and verify bot list loads. Start a game and verify tilemaps render. After a game, check game history. Verify leaderboard page shows (empty) data without errors.

**Acceptance Scenarios**:

1. **Given** no server process, **When** the lobby page loads, **Then** the bot list populates from local data (static JSON) without HTTP requests
2. **Given** no server process, **When** a game starts and needs a tilemap, **Then** the tilemap is generated locally in the browser
3. **Given** no server process, **When** the player views game history, **Then** records load from local storage without HTTP requests
4. **Given** no server process, **When** the player views the leaderboard, **Then** the page renders without errors (showing local data or empty state)
5. **Given** no server process, **When** the player accesses Pokemon/item/type data endpoints, **Then** the data is available via direct imports, not HTTP fetches

---

### User Story 3 — Clean Build Pipeline (Priority: P3)

The build process produces only client-side output. Server-related scripts, dependencies, and configuration are removed. The project builds faster with fewer dependencies.

**Why this priority**: Cleanup is important for maintainability but doesn't affect runtime functionality.

**Independent Test**: Run `npm run build`. Verify it succeeds and produces only client bundle output. Verify `package.json` contains no server-only dependencies. Verify no server entry points exist.

**Acceptance Scenarios**:

1. **Given** the updated project, **When** `npm run build` is run, **Then** only client-side output is produced (no server compilation)
2. **Given** the updated `package.json`, **When** dependencies are inspected, **Then** no server-only packages (express, helmet, cors, body-parser, prom-client, cron, pm2-prom-module-client) are listed
3. **Given** the updated project, **When** searching for `app/index.ts` and `app/app.config.ts`, **Then** these files do not exist
4. **Given** the updated project, **When** `npm run dev` is run, **Then** it starts only the client dev server (esbuild watch) without attempting to start a Node.js server

---

### Edge Cases

- What happens when a service worker caches stale assets? — Service worker uses cache-first strategy for `/assets/*` and `/SpriteCollab/*` only; HTML/JS are network-first. No server dependency.
- What happens when a user has old bookmarks to server-served routes like `/game` or `/lobby`? — Switch to `HashRouter` (`/#/game`, `/#/lobby`) which requires no server-side fallback. Old bookmarks to `/game` will land on root and redirect to `/#/`.
- What happens when client code accidentally imports a server-only module? — Build must fail or warn if any server-only import (express, helmet, etc.) appears in client bundle.
- What happens to the `dev` workflow? — `npm run dev` must start only the esbuild watch process for client development. A simple static file server (or esbuild's built-in serve) replaces the Express dev server.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The game MUST be fully playable when served as static files from any HTTP server, with no Node.js process required
- **FR-002**: All client-side `fetch()` calls to local REST API endpoints MUST be replaced with direct function calls to the equivalent local logic
- **FR-003**: Tilemap generation MUST execute in the browser (calling `initTilemap()` directly) instead of fetching from `/tilemap/:map`
- **FR-004**: Bot list and bot detail data MUST be accessed via direct function calls (using existing `fetchBotsList`/`fetchBot` from local storage/static JSON) instead of HTTP endpoints
- **FR-005**: Game history MUST be read directly from local storage (IndexedDB) instead of the `/game-history/:playerUid` endpoint
- **FR-006**: The build pipeline MUST produce only client-side output and MUST NOT compile or reference server entry points
- **FR-007**: All server-only npm dependencies MUST be removed from `package.json`
- **FR-008**: All server-related npm scripts MUST be removed or updated to reflect the client-only architecture
- **FR-009**: SPA client-side routing MUST handle all application routes (`/`, `/lobby`, `/game`, `/after`, `/bot-builder`, etc.) without relying on server-side route configuration
- **FR-010**: The `npm run dev` workflow MUST provide a functional development experience with hot-reload and static file serving, without requiring a Node.js server
- **FR-011**: Pokemon, item, type, and title data previously served via REST endpoints MUST be available via direct imports or local data access

### Key Entities

- **Static Build Output**: The client bundle (JS, CSS, HTML, assets) produced by esbuild, deployable to any static hosting
- **Local Data Sources**: Bot lists (static JSON), game history (IndexedDB), tilemap generator (in-browser function), game configuration (imported modules)

## Assumptions

- The esbuild client build already works independently (confirmed in Phase 2)
- `initTilemap()` from `app/core/design.ts` depends on `Tileset` which uses `fs-extra.readJsonSync()` (Node.js only). Must be rewritten to use `fetch()` before it can run in browser. The JSON files it reads are already available as static assets at `/assets/tilesets/<map>/`.
- `fetchBotsList()` and `fetchBot()` from `app/services/bots.ts` already use local storage (converted in Phase 1)
- The service worker (`sw.js`) has no server dependencies and works with static hosting
- Static data endpoints (`/pokemons`, `/pokemons-index`, `/types`, `/items`, `/titles`) return precomputed data that can be directly imported as modules
- The `app/core/` and `app/models/` directories are shared between client and engine and MUST be preserved

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Game is fully playable when served from a static file server with zero Node.js processes — a complete match (15+ rounds) completes without errors
- **SC-002**: Zero HTTP fetch calls to local server endpoints (`/bots`, `/tilemap`, `/game-history`, `/leaderboards`, `/pokemons`, `/items`, `/types`, `/titles`, `/status`, `/meta*`) remain in client code
- **SC-003**: `npm run build` succeeds and produces only client output — no `app/public/dist/server/` directory is generated
- **SC-004**: `package.json` contains zero server-only dependencies (express, helmet, cors, body-parser, cron, prom-client, pm2-prom-module-client, express-basic-auth, express-openapi)
- **SC-005**: `app/index.ts`, `app/app.config.ts`, and `app/metrics.ts` do not exist in the codebase
- **SC-006**: All application routes work correctly via client-side SPA routing when served from static hosting
- **SC-007**: Build passes at every commit
