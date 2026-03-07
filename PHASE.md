# Refactoring Roadmap: Multiplayer → Single Player

## Dependency Graph

```
Phase 0 ─────────────┐
(Extract Engine)      ├──→ Phase 3 ──→ Phase 4
Phase 1 ─────────────┘    (Remove      (Cleanup
(Remove MongoDB)  ┌───────→ Server)      Schemas)
                  │
Phase 2 ──────────┘
(Remove Colyseus)
  ↑ depends on Phase 0
```

- Phase 0 和 Phase 1 **互不依賴**，可並行
- Phase 2 依賴 Phase 0（引擎獨立後才能拔掉 Colyseus）
- Phase 3 依賴 Phase 0 + 1 + 2（全部外部依賴移除後才能砍 server）
- Phase 4 依賴 Phase 3（server 砍完後做最終清理）

---

## Phase 0: Extract Game Engine

**Spec**: `specs/001-extract-game-engine/`
**目標**: 將戰鬥模擬引擎從 Colyseus Schema 繼承中解放，使其能獨立運行
**狀態**: ✅ 完成

### Why First

這是整個重構的**地基**。Simulation 和 PokemonEntity 直接 `extends Schema`，遊戲邏輯和網路序列化混在一起。不先拆開這個，Phase 2 和 Phase 4 都無法進行。

### Before

```typescript
// simulation.ts — 遊戲邏輯 = 網路模型
export default class Simulation extends Schema {
  @type("string") weather: Weather
  @type({ map: PokemonEntity }) blueTeam = new MapSchema<IPokemonEntity>()
  room: GameRoom  // 硬依賴

  update(dt) {
    // 計算戰鬥...
    this.room.broadcast(Transfer.ABILITY, {...})  // 直接廣播
  }
}
```

### After

```typescript
// battle-engine.ts — 純遊戲邏輯，零依賴
export class BattleEngine {
  weather: Weather
  blueTeam: Map<string, PokemonEntity>

  update(dt): BattleEvent[] {
    // 計算戰鬥...
    return [{ type: "ABILITY", ... }]  // 返回事件，不廣播
  }
}
```

### Impact

| 類別 | 數量 | 說明 |
|------|------|------|
| Core engine files with Schema import | 8 files | simulation.ts, pokemon-entity.ts, dps.ts, effect.ts 等 |
| Colyseus model definitions | 17 files | `app/models/colyseus-models/` |
| @type() decorators in models | 237 處 | 需要逐步移除 |
| GameRoom (主戰場) | 1,435 lines | 需要拆分遊戲邏輯 vs 網路邏輯 |

### Key Files

```
app/core/simulation.ts          (1,821 lines) — 解耦 Schema + room 引用
app/core/pokemon-entity.ts      (1,840 lines) — 解耦 Schema
app/core/pokemon-state.ts       (1,314 lines) — 較獨立，輕微修改
app/core/dps.ts                                — 解耦 Schema
app/core/effects/effect.ts                     — 解耦 Schema
app/rooms/game-room.ts          (1,435 lines) — 提取遊戲邏輯到獨立模組
app/models/colyseus-models/     (17 files)     — 標記待清理（Phase 4 完成）
```

### Risk

- 🔴 改壞戰鬥邏輯（同樣的棋盤出不同結果）
- 對策：改動前先記錄幾場戰鬥的輸入/輸出作為 snapshot 基準

### Completion Criteria

```bash
# 這段代碼必須能跑，且不引入 Colyseus 任何依賴：
const engine = new BattleEngine(blueConfig, redConfig)
const events = engine.update(16)  // 不報錯
```

---

## Phase 1: Remove MongoDB

**Spec**: `specs/002-remove-mongodb/`
**目標**: 用 IndexedDB 取代所有 MongoDB 持久化
**狀態**: ✅ 完成

### Why

MongoDB 耦合度只有 3/10，是最好砍的部分。但 51 個文件有 mongoose import，散佈範圍廣。

### Before

```typescript
// 用戶資料存在 MongoDB
const user = await UserMetadata.findOne({ uid })
user.elo = newElo
await user.save()
```

### After

```typescript
// 用戶資料存在 IndexedDB
const user = await localDB.users.get(localPlayerId)
user.elo = newElo
await localDB.users.put(user)
```

### Impact

| 類別 | 數量 | 說明 |
|------|------|------|
| Mongoose model files | 20 files | `app/models/mongo-models/` 全部刪除 |
| Service files | 6 files | `app/services/` 全部刪除 |
| Files importing mongoose | 51 files | 散佈在 rooms、commands、config、scheduled |

### 持久化遷移表

| MongoDB Model | 單機處理方式 | 原因 |
|---------------|-------------|------|
| UserMetadata | IndexedDB | 玩家進度、收藏、ELO 需要保留 |
| DetailledStatistic | IndexedDB (capped 100 records) | 遊戲歷史查詢 |
| BotV2 | 打包成靜態 JSON | AI 對手資料庫，不需動態增刪 |
| ChatV2 | **刪除** | 多人聊天，單機不需要 |
| Tournament | **刪除** | 多人競賽 |
| BannedUser | **刪除** | 多人管理 |
| Meta / MetaV2 | **刪除** | 伺服器端分析 |
| ItemsStatistic | **刪除** | 伺服器端分析 |
| PokemonsStatistic | **刪除** | 伺服器端分析 |
| RegionStatistic | **刪除** | 伺服器端分析 |
| TitleStatistic | **刪除** | 伺服器端配置（可硬編碼） |
| BotMonitoring | **刪除** | 遠端監控 |
| EloBot | **刪除** | 輕量級快照 |
| SocialUser | **刪除** | 已棄用 |
| Chat (v1) | **刪除** | 已棄用 |
| ReportMetadata | **刪除** | 伺服器端分析 |
| Dendrogram | **刪除** | 視覺化分析 |

**保留 3 個，刪除 14+ 個。**

### Risk

- 🟡 Firebase Auth 全面移除（含 Client SDK），登入流程完全改變
- 對策：用 username 輸入 + crypto.randomUUID() 取代，複雜度極低（1 個 input + 1 個 button，淨刪除 3 個 auth 元件 + 13 個 firebase import）

### Completion Criteria

```bash
# package.json 不再包含 mongoose / firebase-admin
grep -r "mongoose" package.json  # 無結果
# app/models/mongo-models/ 目錄不存在
# npm run build 通過
```

---

## Phase 2: Remove Colyseus

**Spec**: `specs/003-remove-colyseus/`
**目標**: 用本地遊戲引擎取代 Colyseus 網路層，Redux 直連引擎
**狀態**: 未開始（依賴 Phase 0）

### Why

Phase 0 讓引擎獨立後，這一步把客戶端從「透過 WebSocket 接收狀態」改成「直接調用本地引擎」。這是改動量最大的 phase。

### Before

```typescript
// 客戶端透過 Colyseus 接收狀態
const $ = getStateCallbacks(room)
$state.listen("phase", (newPhase) => {
  dispatch(setPhase(newPhase))
})

// 客戶端透過 WebSocket 發送指令
rooms.game?.send(Transfer.SHOP, { id: index })
```

### After

```typescript
// 客戶端直接監聽本地引擎事件
localEngine.on("phaseChanged", (newPhase) => {
  dispatch(setPhase(newPhase))
})

// 客戶端直接調用本地引擎方法
localEngine.buyPokemon(index)
```

### Impact

| 類別 | 數量 | 說明 |
|------|------|------|
| Client files importing Colyseus | 40 files | Redux stores, Phaser, UI components |
| Network module | 272 lines | `network.ts` 完全替換 |
| Server room files | 11 files | `app/rooms/` 全部刪除 |
| game.tsx state callbacks | ~300 lines | Colyseus listeners → local engine listeners |
| GameContainer.ts | 791 lines | Schema listeners → event listeners |

### Key Replacements

```
app/public/src/network.ts          → app/public/src/local-engine.ts
app/rooms/game-room.ts             → 邏輯併入 local-engine
app/rooms/commands/game-commands.ts → 方法直接寫在 engine 上
app/rooms/states/game-state.ts     → engine 內部狀態
game.tsx (state callbacks section)  → engine event subscriptions
GameContainer.ts (initializePokemon) → engine event subscriptions
```

### Risk

- 🔴 40 個客戶端文件需要改動，容易遺漏
- 🟡 Phaser 渲染時序依賴 Colyseus delta sync 的推送節奏
- 對策：先寫 engine event adapter，讓現有 listeners 的簽名不變

### Completion Criteria

```bash
# package.json 不再包含 colyseus
grep -r "colyseus" package.json  # 無結果
# app/rooms/ 目錄不存在
# app/public/src/network.ts 不存在
# npm run build 通過
```

---

## Phase 3: Remove Server

**Spec**: `specs/004-remove-server/`
**目標**: 砍掉 Express/Node.js 後端，改成純靜態 SPA 構建
**狀態**: 未開始（依賴 Phase 0 + 1 + 2）

### Why

當遊戲引擎在瀏覽器跑（Phase 0+2），持久化用 IndexedDB（Phase 1），就不再需要 server process。整個 `app/index.ts` + `app/app.config.ts` 可以刪除。

### Before

```
npm start → Node.js → Express → Colyseus → serve static + WebSocket
```

### After

```
npm run build → static files → deploy to any CDN/hosting
```

### Impact

| 類別 | 數量 | 說明 |
|------|------|------|
| Server entry point | 93 lines | `app/index.ts` 刪除 |
| Server config | 615 lines | `app/app.config.ts` 刪除 |
| Express imports | 2 files | 刪除 |
| Build config | 1 file | 修改 esbuild.js 或換 Vite |
| package.json scripts | ~5 scripts | 移除 server 相關 scripts |

### Key Changes

- 刪除 `app/index.ts`、`app/app.config.ts`
- 修改 `package.json`：移除 server scripts，移除 server 依賴
- 修改 build pipeline：只構建 client，輸出純靜態文件
- REST API endpoints（`/pokemons`, `/profile` 等）→ 本地資料直接 import

### Risk

- 🟢 低風險 — 前三個 phase 完成後，server 已經沒有任何功能
- 唯一注意：確認沒有殘留的 server-side only imports 被 client bundle 引入

### Completion Criteria

```bash
# app/index.ts 和 app/app.config.ts 不存在
# package.json 不包含 express, helmet, cors, @colyseus/*, mongoose, firebase-admin
# npm run build 只產出 client bundle
# 用 npx serve app/public/dist 能直接跑遊戲
```

---

## Phase 4: Cleanup Schemas

**Spec**: `specs/005-cleanup-schemas/`
**目標**: 移除所有 Colyseus `@type()` 裝飾器和 Schema 殘留，純化 TypeScript 類型
**狀態**: 未開始（依賴 Phase 3）

### Why

Phase 0-2 讓引擎獨立並替換了網路層，但 `app/models/colyseus-models/` 裡的 17 個文件仍滿是 `@type()` 裝飾器。它們不再有任何用途，是純粹的技術債。

### Before

```typescript
export class Pokemon extends Schema {
  @type("string") name: string
  @type("uint8") hp: number
  @type({ map: Item }) items = new MapSchema<Item>()
}
```

### After

```typescript
export class Pokemon {
  name: string
  hp: number
  items: Map<string, Item> = new Map()
}
```

### Impact

| 類別 | 數量 | 說明 |
|------|------|------|
| @type() decorators (全局) | 373 處 | 全部移除 |
| Colyseus model files | 17 files | 重寫為純 TS class |
| MapSchema → Map | ~30 處 | 替換 Colyseus 集合型別 |
| ArraySchema → Array | ~15 處 | 替換 Colyseus 集合型別 |
| Schema extends | ~20 處 | 移除繼承 |

### Risk

- 🟡 `MapSchema` 和 `Map` 的 API 不完全相同（`.forEach` 行為、`.set` 簽名等）
- 對策：全局搜尋 MapSchema 使用方式，確認 Map 的 API 能 1:1 替代

### Completion Criteria

```bash
# 整個 codebase 不包含 @colyseus/schema 的任何 import
grep -r "@colyseus/schema" app/  # 無結果
grep -r "@type(" app/             # 無結果
# npm run build 通過
# package.json 不包含任何 @colyseus 依賴
```

---

## Summary

| Phase | Spec | 影響文件數 | 核心改動 | 風險 | 依賴 |
|-------|------|-----------|---------|------|------|
| 0 | 001-extract-game-engine | ~25 files | 引擎去 Schema 化 | 🔴 高 | — |
| 1 | 002-remove-mongodb | ~51 files | IndexedDB 替代 | 🟡 中 | — |
| 2 | 003-remove-colyseus | ~51 files | 本地引擎替代網路層 | 🔴 高 | Phase 0 |
| 3 | 004-remove-server | ~5 files | 砍 Express/Node | 🟢 低 | Phase 0+1+2 |
| 4 | 005-cleanup-schemas | ~17 files | 清除 @type 殘留 | 🟡 中 | Phase 3 |
