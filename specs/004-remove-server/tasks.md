# Tasks: Remove Server

**Input**: Design documents from `/specs/004-remove-server/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: No test tasks — manual play-testing only (no test suite configured).

**Organization**: Tasks grouped by user story. US1 (game runs without server) is MVP — stop and validate after Phase 3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Branch creation and verification of starting state

- [x] T001 Verify build passes on current branch before any changes (`npm run build`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tileset async rewrite (R11), SPA routing fix, bot init relocation — blocks ALL user story work.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Switch `BrowserRouter` to `HashRouter` in `app/public/src/index.tsx` — import `HashRouter` from `react-router-dom` 替換 `BrowserRouter`。BrowserRouter 依賴伺服器端 fallback（Express 的 `spaRoutes` 列表），移除伺服器後使用者在 `/game` 按 F5 會 404。HashRouter 用 `#` 路由（`/#/lobby`, `/#/game`），瀏覽器永遠只請求根路徑 index.html，零伺服器依賴
- [x] T003 Rewrite `Tileset` class from `readJsonSync` (fs-extra) to async `fetch()` factory pattern in `app/core/tileset.ts` — 移除 `fs-extra` import；`src` 路徑改為 `/assets/tilesets`；constructor 改為 `private`（接受 `id` + `metadata` 參數）；新增 `static async create(id)` factory 用 `fetch` 載入 metadata.json；`exportToTiled()` 改為 async，用 `Promise.all` 並行 fetch 所有 tileset JSON（原 5+ 次串行 readJsonSync → 並行 fetch）
- [x] T004 Update `Design` class and `initTilemap()` to async in `app/core/design.ts` — Design 構造函式改為接受外部傳入的 `tileset: Tileset` 參數（不再內部 `new Tileset()`）；`exportToTiled()` 改為 async（內部 `await this.tileset.exportToTiled()`）；`initTilemap(map)` 改為 `async`：先 `await Tileset.create(map)`，再 `new Design(map, tileset, 5, 0.1)`，再 `await design.exportToTiled()`；修掉雙重 `create()` bug（構造函式已呼叫 `this.create()`，移除 `initTilemap` 中多餘的 `design.create()`）
- [x] T005 Add `loadBotsFromJson()` call at client initialization in `app/public/src/network.ts` — import from `../../models/local-store`，放在 `export const engine = new LocalGameEngine()` **之前**（確保 engine 構造時 bot 資料已就緒）

**Checkpoint**: Tileset works with fetch(), bots load at client init — foundation ready for user story migration

---

## Phase 3: User Story 1 — Game Runs Without Server Process (Priority: P1) 🎯 MVP

**Goal**: Player can open the game from static files and play a complete match. No Node.js process running.

**Independent Test**: Build with `npm run build`. Serve `app/public/dist/client/` with `npx serve`. Start game with bots. Play 5+ rounds. All mechanics work.

### Implementation for User Story 1

- [x] T006 [P] [US1] Replace `fetch("/tilemap/${map}")` with `initTilemap(map)` in `app/public/src/game/scenes/game-scene.ts` — import `initTilemap` from `app/core/design`, use `.then()` async pattern (same shape as existing fetch)
- [x] T007 [P] [US1] Replace `fetch("/tilemap/${map}")` with `initTilemap(map)` in `app/public/src/game/scenes/debug-scene.ts` — same pattern as T006
- [x] T008 [P] [US1] Replace `fetch("/bots?approved=true")` with `fetchBotsList(true)` and `fetch("/bots/${id}")` with `fetchBot(id)` in `app/public/src/pages/lobby.tsx` — import from `app/services/bots`；兩段 fetch 都變同步，移除 `async/await/Promise.all` 包裝，簡化為直接同步呼叫；`fetchBot` returns `IBot | null`，需加 `.filter((b): b is IBot => b !== null)` 過濾 null
- [x] T009 [P] [US1] Replace `fetch("/bots?approved=true")` with `fetchBotsList(true)` in `app/public/src/pages/component/preparation/bot-select-modal.tsx` — state type 從 `IBot[]` 改為 `IBotListItem[]`（`fetchBotsList` 不含 `steps`）；確認 `addBot()` 簽名相容 `IBotListItem`（目前是 `BotDifficulty | IBot`，需擴展為 `BotDifficulty | IBot | IBotListItem`）
- [x] T010 [P] [US1] Replace `fetch("/leaderboards")` with inline `{ leaderboard: [] }` in `app/public/src/pages/game.tsx`
- [x] T011 [P] [US1] Replace `fetch("/leaderboards")` with inline `{ leaderboard: [], botLeaderboard: [], levelLeaderboard: [], eventLeaderboard: [] }` in `app/public/src/pages/component/leaderboard/leaderboard-menu.tsx` — 元件 dispatch 全部 4 個陣列

**Checkpoint**: Game is playable from static files — core loop (shop, battle, bots, tilemap, leaderboard) works without server

---

## Phase 4: User Story 2 — Data Access Works Locally (Priority: P2)

**Goal**: All features that relied on REST endpoints work via direct function calls — bot builder, game history, meta reports, profile.

**Independent Test**: With no server, navigate lobby (bot list loads), start game (tilemaps render), check game history after match, view leaderboard page without errors.

### Implementation for User Story 2

- [x] T012 [P] [US2] Replace `fetch("/game-history/${uid}")` with `getGameHistoryByPlayer(uid)` in `app/public/src/pages/component/profile/game-history.tsx` — `getGameHistoryByPlayer` 回傳全部記錄（sync, in-memory, 最多 100 筆 HISTORY_CAP），可簡化為一次載入 + sort，移除分頁機制（`loadMore`, `hasMore`, `page` 計算）；`IDetailledStatistic` 是 `IGameRecord` 超集（R9 duck typing 相容），不需顯式轉換
- [x] T013 [P] [US2] Replace `fetch("/bots/${botId}")` with `fetchBot(botId)` in `app/public/src/pages/component/bot-builder/bot-builder.tsx` — `fetchBot` returns `IBot | null`，需加 null check；POST `submitBot()` 改為 no-op + toast "Not available in single-player mode"
- [x] T014 [P] [US2] Replace `fetch("/bots")` with `fetchBotsList()` and `fetch("/bots/${id}")` with `fetchBot(id)` in `app/public/src/pages/component/bot-builder/import-bot-modal.tsx` — state type 從 `IBot[]` 改為 `IBotListItem[]`（`fetchBotsList` 不含 `steps`）；`fetchBot` 回傳 `IBot | null`，需加 null check 避免 `JSON.stringify(null)`
- [x] T015 [P] [US2] Replace all fetch calls in `app/public/src/pages/component/bot-builder/bot-manager-panel.tsx` — GET `/bots?pkm=` → `fetchBotsList(undefined, filteredPokemon)`（`fetchBotsList` 已支援第二參數 `usingPkm?: string`），state type 從 `IBotLight[]` 改為 `IBotListItem[]`（`IBotLight = Omit<IBot, "steps"> & { valid: boolean }`，`IBotListItem = Omit<IBot, "steps">`，差異僅 `valid` 欄位——元件未使用 `valid`，替換安全）；DELETE/POST admin ops → no-op + toast
- [x] T016 [P] [US2] Remove player search `fetch("/players?name=")` in `app/public/src/pages/component/profile/profile.tsx` — multiplayer feature, not applicable
- [x] T017 [P] [US2] Replace all fetch wrappers in `app/public/src/api/meta.ts` with inline empty returns — `fetchMetaPokemons()` → `[]`, `fetchTitles()` → `[]`, `fetchDendrogram()` → `null`, etc. (9 functions)
- [x] T018 [P] [US2] Replace `fetch("/chat-history/${uid}")` with inline empty `[]` in `app/public/src/pages/component/profile/profile-chat-history.tsx` — endpoint no longer exists, return empty array

**Checkpoint**: All data access paths work locally — no HTTP fetch to local endpoints remains in client code

---

## Phase 5: User Story 3 — Clean Build Pipeline (Priority: P3)

**Goal**: Build produces only client output. Server files, dependencies, and scripts removed.

**Independent Test**: `npm run build` succeeds with client-only output. `package.json` has no server deps. `app/index.ts`, `app/app.config.ts`, `app/metrics.ts` don't exist. `npm run dev` starts esbuild dev server only.

### Implementation for User Story 3

- [x] T019 [US3] Delete server files: `app/index.ts`, `app/app.config.ts`, `app/metrics.ts`
- [x] T020 [US3] Update `esbuild.js` — add `context.serve({ servedir, fallback, port: 9000 })` for dev mode；dev mode 跳過 `entryNames` hash（避免 serve() 與 hashIndexPlugin 的 race condition，hash 僅 production 需要）；移除 6 個 stale `FIREBASE_*` defines；保留 `DISCORD_SERVER`（`auth.tsx` 和 `main-sidebar.tsx` 仍使用）、`MODE`、`NODE_ENV`、`MIN_HUMAN_PLAYERS`
- [x] T021 [US3] Update `package.json` scripts — remove `build-server`, `start`, `dev-server`, `monitor-bot`, `deploy-live`, `setup-live`, `collection-migration`; update `build` to only `npm run build-client`; update `dev` to `node esbuild.js --dev`; remove `main` field
- [x] T022 [US3] Remove server-only npm dependencies (16 packages): `npm uninstall express helmet cors body-parser cron prom-client pm2-prom-module-client express-basic-auth express-openapi fs-extra pm2 ts-node-dev @types/cors @types/fs-extra openapi-typescript npm-run-all`
- [x] T023 [US3] Update `tsconfig.json` — remove `outDir`, add `noEmit: true`, remove `declaration` and `sourceMap`, remove `./scheduled/*` and `./db-commands/*` from includes (keep `./edit/*`)
- [x] T024 [US3] Update `tsconfig.tsx.json` — remove `./scheduled/**/*` and `./db-commands/**/*` from includes (keep `./edit/**/*`)
- [x] T025 [US3] Verify build passes with `npm run build` after all cleanup

**Checkpoint**: Project builds client-only, zero server artifacts remain

---

## Phase 6: Polish & Validation

**Purpose**: End-to-end validation and cleanup

- [x] T026 Verify no `fetch("/` calls to local endpoints remain in `app/public/src/` (external URLs like github are OK)
- [x] T027 Verify no `fs-extra` imports remain in `app/` (should be zero after Tileset rewrite)
- [ ] T028 Run quickstart.md validation (MANUAL — serve static, play full match, verify SPA routing) — serve `app/public/dist/client/` with `npx serve`, play full match (15+ rounds), verify all mechanics work; verify SPA routing (F5 on `/#/game` should reload correctly)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — verify starting state
- **Foundational (Phase 2)**: Depends on Phase 1 — T003→T004 sequential (Design depends on Tileset), T002 and T005 independent
- **US1 (Phase 3)**: Depends on Phase 2 completion — T006/T007 depend on T003+T004 (tileset async), T008/T009 depend on T005 (bot init)
- **US2 (Phase 4)**: Depends on Phase 2 completion — can run in parallel with US1 (different files)
- **US3 (Phase 5)**: Depends on US1 + US2 completion — server deletion must happen AFTER all fetch migrations
- **Polish (Phase 6)**: Depends on all phases complete

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational (Phase 2) — no dependencies on other stories
- **US2 (P2)**: Depends on Foundational (Phase 2) — no dependencies on US1 (different files)
- **US3 (P3)**: Depends on US1 + US2 — must delete server files ONLY after all fetch→direct-call migrations are done

### Within Each User Story

- All [P] tasks within a story can run in parallel (each touches different files)
- Commit after each task

### Parallel Opportunities

- **Phase 2**: T003→T004 must be sequential; T002 and T005 can run in parallel with T003/T004
- **Phase 3**: All 6 tasks (T006–T011) can run in parallel — each modifies a different file
- **Phase 4**: All 7 tasks (T012–T018) can run in parallel — each modifies a different file
- **Phase 3 + Phase 4**: US1 and US2 can run in parallel after Phase 2 (different files entirely)
- **Phase 5**: T019→T020→T021→T022 loosely sequential; T023/T024 parallel with each other

---

## Parallel Example: User Story 1

```bash
# All US1 tasks touch different files — launch all 6 in parallel:
Task: "T006 Replace tilemap fetch in game-scene.ts"
Task: "T007 Replace tilemap fetch in debug-scene.ts"
Task: "T008 Replace bots fetch in lobby.tsx"
Task: "T009 Replace bots fetch in bot-select-modal.tsx"
Task: "T010 Replace leaderboards fetch in game.tsx"
Task: "T011 Replace leaderboards fetch in leaderboard-menu.tsx"
```

## Parallel Example: User Story 2

```bash
# All US2 tasks touch different files — launch all 7 in parallel:
Task: "T012 Replace game-history fetch in game-history.tsx"
Task: "T013 Replace bot fetch + disable submit in bot-builder.tsx"
Task: "T014 Replace bot fetch in import-bot-modal.tsx"
Task: "T015 Replace all fetch calls in bot-manager-panel.tsx"
Task: "T016 Remove player search in profile.tsx"
Task: "T017 Replace meta fetch wrappers in meta.ts"
Task: "T018 Replace chat-history fetch in profile-chat-history.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Verify build
2. Complete Phase 2: Tileset rewrite + bot init (the only non-trivial work)
3. Complete Phase 3: US1 — 6 fetch→direct-call replacements
4. **STOP and VALIDATE**: Serve statically, play full match
5. Game is playable without server — MVP achieved

### Incremental Delivery

1. Phase 1 + Phase 2 → Foundation ready
2. Add US1 (Phase 3) → Game playable from static files (MVP!)
3. Add US2 (Phase 4) → All secondary features work locally
4. Add US3 (Phase 5) → Server code deleted, build pipeline clean
5. Phase 6 → Final validation

---

## Notes

- Total: 28 tasks (1 setup, 4 foundational, 6 US1, 7 US2, 7 US3, 3 polish)
- Tileset rewrite (T003+T004) is the only non-trivial change — everything else is mechanical fetch→direct-call replacement or deletion
- No new abstractions, no new files created (except possible toast utility if not already available)
- `[spec-004]` commit prefix for all commits
- Build must pass at every commit (Constitution principle IV)
