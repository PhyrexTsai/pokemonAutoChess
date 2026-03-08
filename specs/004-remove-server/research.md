# Research: Remove Server

**Feature**: 004-remove-server
**Date**: 2026-03-08

## R1: Server Inventory — What Remains

**Decision**: Delete `app/index.ts`, `app/app.config.ts`, `app/metrics.ts` entirely.

**Rationale**: After Phases 0–2, the Express server does three things: (1) serve static files, (2) handle SPA routes by returning `index.html`, (3) expose 13 REST endpoints. All three are replaceable:

1. Static file serving → any HTTP server or CDN
2. SPA routes → esbuild dev server (dev) or static hosting with fallback-to-index.html (prod)
3. REST endpoints → direct function calls (see R2)

**Files to delete**:
- `app/index.ts` (11 lines) — server entry point
- `app/app.config.ts` (192 lines) — Express app config + all 13 endpoints
- `app/metrics.ts` (11 lines) — Prometheus metrics (imports `prom-client`, `pm2-prom-module-client`)

**Alternatives considered**: Keep Express for dev only → rejected. Adds unnecessary complexity and dependencies. esbuild already has `serve()` API for development.

---

## R2: REST Endpoint Migration Strategy

**Decision**: Replace each `fetch("/endpoint")` with direct function call using existing modules.

| Endpoint | Client Callers | Replacement |
|----------|---------------|-------------|
| `GET /bots?approved=true` | `lobby.tsx`, `bot-select-modal.tsx`, `import-bot-modal.tsx` | `fetchBotsList(approved)` from `app/services/bots.ts` |
| `GET /bots/:id` | `lobby.tsx`, `bot-builder.tsx`, `import-bot-modal.tsx` | `fetchBot(id)` from `app/services/bots.ts` |
| `POST /bots` | `bot-builder.tsx` (submitBot) | Remove — single-player mode doesn't need bot submission to server |
| `DELETE /bots/:id` | `bot-manager-panel.tsx` | Remove — admin-only, not applicable in single-player |
| `POST /bots/:id/approve` | `bot-manager-panel.tsx` | Remove — admin-only |
| `GET /tilemap/:map` | `game-scene.ts`, `debug-scene.ts` | `initTilemap(mapName)` from `app/core/design.ts` |
| `GET /leaderboards` | `leaderboard-menu.tsx`, `game.tsx` | Return `{ leaderboard: [] }` inline |
| `GET /game-history/:uid` | `game-history.tsx` | `getGameHistoryByPlayer(uid)` from `app/models/local-store.ts` |
| `GET /pokemons` | No client callers found | Remove endpoint (unused) |
| `GET /pokemons-index` | No client callers found | Remove endpoint (unused) |
| `GET /types` | No client callers found | Remove endpoint (unused) |
| `GET /items` | No client callers found | Remove endpoint (unused) |
| `GET /types-trigger` | No client callers found | Remove endpoint (unused) |
| `GET /titles` | `title-tab.tsx` (via `fetchTitles()`) | Return `[]` inline |
| `GET /status` | No client callers found | Remove endpoint (unused) |
| `GET /players?name=` | `profile.tsx` | Remove — multiplayer player search, not applicable |
| `GET /meta/*` series | `meta-report/*.tsx` (via `api/meta.ts`) | Return `[]` inline — meta analytics requires server-side data |
| `GET /dendrogram` | `dendrogram-chart.tsx` (via `fetchDendrogram()`) | Return `null` inline |

**Rationale**: Every endpoint either (a) wraps an existing local function or (b) returns empty/static data. Zero new logic needed.

---

## R3: local-store.ts — Server vs Client Usage

**Decision**: `app/models/local-store.ts` is already used from both server (`app.config.ts`) and client (via esbuild bundle). Once `app.config.ts` is deleted, `local-store.ts` is purely client-side. No move needed — esbuild already bundles it.

The `loadBotsFromJson()` function uses `require("../public/src/assets/bots.json")` which works via esbuild's JSON loader. Currently called at server startup in `app.config.ts`. After server removal, call it during client initialization (e.g., in `network.ts` or at app startup).

**Key files importing local-store**:
- `app/services/bots.ts` → `getBotList()`, `getBotById()`
- `app/public/src/game-engine-commands.ts` → `getPlayer()`
- `app/public/src/network.ts` → `setPlayer()`
- `app/public/src/local-engine.ts` → `getPlayer()`
- `app/public/src/pages/lobby.tsx` → `setBotList()`
- `app/core/bot.ts` → `getBotById()`

---

## R4: Build Pipeline Changes

**Decision**: Remove `build-server` (tsc compilation) from the build pipeline. Keep `build-client` (esbuild) as the only build step.

**Changes needed**:
- `package.json` scripts:
  - `build`: `"npm run build-client"` (remove `&& npm run build-server`)
  - Remove: `build-server`, `start`, `dev-server`, `monitor-bot`, `deploy-live`, `setup-live`
  - `dev`: `"node esbuild.js --dev"` (remove npm-run-all, just run client)
  - Remove `main` field (points to server entry)
- `tsconfig.json`: Remove `outDir` (points to server output dir). Keep `include` for IDE type checking. Remove `./scheduled/*` and `./db-commands/*` (directories already deleted in Phase 1). **Keep `./edit/*`** (still exists — contains `add-pokemon.ts` and `assetpack/`).
- `tsconfig.tsx.json`: Remove `./scheduled/**/*` and `./db-commands/**/*`. **Keep `./edit/**/*`**.

**esbuild dev server**: esbuild's `context.serve()` can replace Express for dev. Serves `app/public/dist/client/` with SPA fallback. No extra dependency needed.

**Alternatives considered**: Switch to Vite → rejected (over-engineering for this phase; esbuild already works).

---

## R5: npm Dependencies to Remove

**Decision**: Remove 16 server-only packages.

**Dependencies (production)**:
- `express` — HTTP server framework
- `helmet` — HTTP security headers
- `cors` — CORS middleware
- `body-parser` — JSON parsing middleware
- `cron` — scheduled tasks (unused after Phase 1)
- `prom-client` — Prometheus metrics
- `pm2-prom-module-client` — PM2 monitoring
- `express-basic-auth` — HTTP Basic Auth (unused)
- `express-openapi` — OpenAPI docs (unused)
- `fs-extra` — Node.js filesystem (used only by tileset.ts, replaced by fetch() in R11)

**Dependencies (dev)**:
- `pm2` — process manager (deploy scripts removed)
- `ts-node-dev` — server watch mode (removed in favor of tsx)
- `@types/cors` — type defs for cors
- `@types/fs-extra` — type defs for fs-extra
- `openapi-typescript` — OpenAPI codegen (unused, only stale output in dist/server/)

**Also remove**: `npm-run-all`（唯一使用者是 `dev` script，改為 `node esbuild.js --dev` 後無人使用）。共 16 packages。

**Retain**: `tsx` (still useful for scripts like `add-pokemon`, `csv-export`), `graceful-fs` + `jimp` (used by `edit/add-pokemon.ts`), all client dependencies.

---

## R6: Meta Report Pages — Keep or Delete?

**Decision**: Keep the meta-report UI components but make fetch functions return empty data.

**Rationale**: The meta-report pages (`meta-report/*.tsx`) display server-aggregated statistics that don't exist in single-player mode. Deleting them would be cleaner, but the spec's scope is "Remove Server" not "Remove all server-dependent UI features." Returning empty data is the minimal change. The pages will simply show empty/loading states — users won't navigate to them in normal gameplay anyway.

If the user wants to clean these up, that can be a follow-up task.

---

## R7: Bot Builder — Write Operations

**Decision**: Remove server-side write operations (POST/DELETE/approve) from bot-manager-panel. Keep read-only bot-builder functionality working with local data.

**Rationale**: `bot-builder.tsx` has a `submitBot()` that POSTs to `/bots`. In single-player mode, there's no server to submit to. The bot-builder can still be used to design bots locally, but saving/submitting is a multiplayer feature. `bot-manager-panel.tsx` has delete/approve admin operations — also multiplayer-only.

**Minimal change**: `submitBot()` → 改為 no-op，顯示 "Not available in single-player mode" toast。`deleteBot()` 和 `approveBot()` → 同樣改為 no-op + toast。不刪除 UI 元件（最小改動原則），只讓 write 操作無效化。

---

## R8: esbuild Dev Server Configuration

**Decision**: Use esbuild's built-in `context.serve()` for the dev workflow.

**Configuration**:
```javascript
context.serve({
  servedir: "app/public/dist/client",
  fallback: "app/public/dist/client/index.html", // SPA routing
  port: 9000
})
```

**Rationale**: esbuild already supports serving static files with a built-in HTTP server. The `fallback` option handles SPA routing (returns index.html for unknown paths). This replaces Express entirely for development, with zero new dependencies.

**Note**: The `fallback` option was added in esbuild 0.25+. Current project uses esbuild 0.27.0 — confirmed compatible (verified locally).

---

## R9: GameRecord 格式相容性 — `IDetailledStatistic` vs `IGameRecord`

**Decision**: 直接使用 `getGameHistoryByPlayer()` 返回的 `IDetailledStatistic[]`，不做 `GameRecord` 轉換。

**Rationale**: Server 端 `app.config.ts:149-163` 會將 `IDetailledStatistic[]` 轉換為 `GameRecord[]`（Colyseus Schema class）。但 `game-history.tsx` 實際上只讀取 `IGameRecord` 介面的欄位：`time`, `rank`, `elo`, `gameMode`, `pokemons`。

型別相容性分析：
- `IGameRecord` = `{ time, rank, pokemons: IPokemonRecord[], elo, gameMode }`
- `IDetailledStatistic` = `{ time, rank, pokemons: Pokemon[], elo, gameMode, playerId, name, nbplayers, avatar, synergies, regions }`
- `IPokemonRecord` = `{ name: Pkm, items: Item[], avatar: string }`
- `Pokemon` = `{ name: string, items: string[], avatar: string }`

`IDetailledStatistic` 是 `IGameRecord` 的**超集**（duck typing 相容）。`Pokemon` 與 `IPokemonRecord` 結構相同。多出的欄位（`playerId`, `synergies`, `regions` 等）會被 UI 忽略。

不需要 `GameRecord` 轉換層。直接使用即可。

---

## R10: game-history 分頁邏輯

**Decision**: 刪除分頁機制，一次載入全部記錄 + sort。

**Rationale**: `game-history.tsx` 有無限滾動分頁（`page` 參數，每頁 10 筆）。Server 用 `slice(skip, skip + limit)` 實現。

`getGameHistoryByPlayer(uid)` 返回全部紀錄（最多 100 筆 cap）。有兩個選項：

| 選項 | 改動量 | 風險 |
|------|--------|------|
| (a) 保留分頁邏輯，本地 slice | 最小 — 只改 fetch 行 | 無 |
| (b) 刪除分頁，一次載入全部 | 中等 — 重寫 loadHistory + 刪除 hasMore/loadMore | 可能影響 UI 行為 |

選擇 (b)：100 筆記錄全在 in-memory，分頁無性能收益，反而增加不必要的分頁狀態管理。直接一次載入 + sort，移除 `loadMore`、`hasMore`、`page` 等分頁機制，簡化元件邏輯。

---

## R11: initTilemap() 使用 fs-extra — 不能直接在瀏覽器執行

**Decision**: 重寫 `Tileset` class，將 `readJsonSync()` 替換為 `fetch()`，`initTilemap()` 變為 async。

**問題**: `initTilemap()` (`app/core/design.ts`) 的調用鏈：

```
initTilemap(map)
  → new Design(map)
    → new Tileset(map)
      → readJsonSync(`app/public/dist/client/assets/tilesets/${map}/metadata.json`)  ← fs-extra
    → design.exportToTiled()
      → tileset.exportToTiled()
        → readJsonSync(`.../${map}/tileset_0.json`)  ← fs-extra
        → readJsonSync(`.../${map}/tileset_0_frame0.json`)  ← fs-extra (多次)
```

`Tileset` class 在 constructor 和 `exportToTiled()` 中大量使用 `readJsonSync`（`fs-extra`）。這是 Node.js API，瀏覽器不可用。目前 client 只 import `DesignTiled` type（compile-time erased），所以 `fs-extra` 不在 bundle 中。一旦 import `initTilemap` value，esbuild 會拉入整條 `design.ts → tileset.ts → fs-extra` 鏈，build 直接失敗。

**方案評估**:

| 方案 | 改動量 | 風險 | 結論 |
|------|--------|------|------|
| A: Tileset 改用 fetch() | 中 — tileset.ts constructor → static factory, initTilemap → async | 低 | ✅ 選擇 |
| B: 預先 import 144 個 map metadata | 大 — 144 個 JSON import，bundle 膨脹 | 高 | ❌ |
| C: Build-time 預生成 tilemap | 大 — 地圖隨機生成，不能預生成 | 高 | ❌ |

**方案 A 詳細設計**（方案 B 變體 — 最小改動）:

1. `Tileset` class 改為 async factory pattern：
   - 移除 `fs-extra` import
   - `src` 路徑從 `"app/public/dist/client/assets/tilesets"` 改為 `"/assets/tilesets"`（fetch URL）
   - constructor 改為 `private`，接受 `(id, metadata)` 參數（不做 I/O）
   - 新增 `static async create(id: DungeonPMDO): Promise<Tileset>` — fetch metadata.json
   - `exportToTiled()` 改為 async，用 `Promise.all` 並行 fetch 所有 tileset JSON（原 5+ 次串行 readJsonSync → 並行 fetch，效能更好）

2. `Design` class 對應調整（**構造函式改為接受 Tileset 參數**）：
   - constructor 參數新增 `tileset: Tileset`，不再內部 `new Tileset(id)`
   - constructor 保留 `this.create()` 呼叫（純同步計算，不需要 async）
   - `exportToTiled()` 改為 async（因為 `tileset.exportToTiled()` 是 async）
   - **不需要** Design factory — Design 構造函式本身保持同步

3. `initTilemap()` 改為 async，作為唯一組裝點：
   ```typescript
   export async function initTilemap(map): Promise<DesignTiled> {
     const tileset = await Tileset.create(map)
     const design = new Design(map, tileset, 5, 0.1)
     // 不再呼叫 design.create() — 構造函式已呼叫（修掉雙重 create() bug）
     return await design.exportToTiled()
   }
   ```

4. 客戶端調用方式不變——`game-scene.ts` 和 `debug-scene.ts` 原本就用 `fetch().then()` 的 async pattern，改為 `initTilemap().then()` 即可。

**已發現 bug**: 現有 `initTilemap()` 在 `new Design()` 後又呼叫 `design.create()`，但 Design 構造函式已呼叫 `this.create()`，導致 terrain/mask/layers 雙重生成。重寫時修掉。

**JSON 檔案位置**: 144 個 tileset 目錄已在 `app/public/dist/client/assets/tilesets/<map>/` 下，每個包含 `metadata.json` + `tileset_*.json`。靜態託管下可直接 `fetch()` 讀取。

**影響範圍**:
- `app/core/tileset.ts` — 重寫（移除 `fs-extra` import，constructor → private + async factory，exportToTiled → async + Promise.all）
- `app/core/design.ts` — constructor 接受 `tileset` 參數，`exportToTiled()` → async，`initTilemap()` → async
- `app/public/src/game/scenes/game-scene.ts` — `fetch("/tilemap/")` → `initTilemap()` (async pattern 保留)
- `app/public/src/game/scenes/debug-scene.ts` — 同上

---

## R12: esbuild.js 陳舊的 FIREBASE_* define entries

**Decision**: 清理 esbuild.js 中已廢棄的環境變數定義。

**問題**: Phase 1 已移除 Firebase，但 esbuild.js 仍定義 6 個 `FIREBASE_*` 變數。如果 `.env` 沒有這些值，它們會被替換為 `"undefined"` 字串。

**影響**: 無害（沒有 client 代碼引用），但是技術債。

**保留**: `DISCORD_SERVER`（`auth.tsx:23` 和 `main-sidebar.tsx:340` 仍使用，提供 Discord 社群連結按鈕）、`MODE`、`NODE_ENV`、`MIN_HUMAN_PLAYERS`。

**移除**: 6 個 `FIREBASE_*`（`API_KEY`、`AUTH_DOMAIN`、`PROJECT_ID`、`STORAGE_BUCKET`、`MESSAGING_SENDER_ID`、`APP_ID`）。

**額外發現**: Dev mode 應跳過 `entryNames` hash。`entryNames: '[dir]/[name]-[hash]'` 與 `context.serve()` 存在 race condition（serve 可能在 `hashIndexPlugin` 重寫 index.html 前回應請求）。Production build 保留 hash 用於 cache busting。

---

## R13: SPA 路由 — BrowserRouter 依賴伺服器端 fallback

**Decision**: 將 `BrowserRouter` 改為 `HashRouter`。

**問題**: `app/public/src/index.tsx` 使用 `BrowserRouter`（History API 真實路徑 `/lobby`, `/game`）。Express 的 `app.config.ts` 有明確的 SPA fallback：
```typescript
const spaRoutes = ["/", "/auth", "/lobby", "/game", "/after", "/bot-builder", ...]
spaRoutes.forEach((route) => app.get(route, (req, res) => res.sendFile(viewsSrc)))
```
移除 Express 後，靜態伺服器不知道要把 `/game` 回傳 `index.html`，使用者按 F5 重新整理 → 404。

Service Worker 不攔截導航請求（只快取 `/assets/` 和 `/SpriteCollab/`）。無 CDN rewrite 配置。

**方案評估**:

| 方案 | 改動量 | 平台依賴 | 結論 |
|------|--------|---------|------|
| A: `HashRouter` | 一行 import 改動 | 零 | ✅ 選擇 |
| B: CDN rewrite 規則 | 需為每個平台配置 | 綁定部署平台 | ❌ |
| C: SW 攔截導航 | 中等 | 首次訪問仍 404 | ❌ |

**HashRouter** 用 `#` 路由（`/#/lobby`, `/#/game`），瀏覽器永遠只請求根路徑的 `index.html`，任何靜態伺服器或 CDN 都能直接 work。唯一代價是 URL 不那麼「漂亮」，但對單人遊戲完全可接受。

**影響範圍**: 僅 `app/public/src/index.tsx` — 將 `import { BrowserRouter } from "react-router-dom"` 改為 `import { HashRouter } from "react-router-dom"`，JSX 中 `<BrowserRouter>` 改為 `<HashRouter>`。
