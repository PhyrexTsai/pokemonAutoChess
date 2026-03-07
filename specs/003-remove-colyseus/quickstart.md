# Quickstart: Remove Colyseus Implementation

## Prerequisites

- Phase 0 (Extract Game Engine) complete — `Simulation.update()` returns `BattleEvent[]`
- Phase 1 (Remove MongoDB) complete — IndexedDB persistence, static bot JSON
- Branch: `003-remove-colyseus`

## Implementation Strategy: Maximum Reuse, Minimum Change

The core strategy is **extract, don't rewrite**:

1. Game logic from `game-commands.ts` → extracted as plain functions into `local-engine.ts`
2. Game loop from `game-room.ts` → `setInterval` in `local-engine.ts`
3. State sync via **Schema encode/decode loopback** — `Encoder`/`Decoder` pair syncs `engineState` → `clientState` locally, all existing Schema `.listen()` / `.onAdd()` / `.onChange()` callbacks fire automatically with zero changes. Only the `$` function source changes (1 line each). Other `room.*` refs (`.send()`, `.onMessage()`, `.state` reads) still need per-site modification.
4. Transfer messages (ABILITY, DAMAGE, etc.) → simple EventEmitter on engine
5. `network.ts` convenience functions → same names, body calls engine instead of room.send()

## Key Files to Create

| File | Purpose | Estimated Lines |
|------|---------|-----------------|
| `app/public/src/local-engine.ts` | LocalGameEngine core class + game loop + loopback sync | ~800 |
| `app/public/src/game-engine-commands.ts` | Extracted player action functions (buy, sell, drag-drop, etc.) | ~1000 |
| `app/public/src/game-engine-phases.ts` | Extracted OnUpdatePhaseCommand phase transition logic | ~1200 |

## Key Files to Move

| From | To | Reason |
|------|----|--------|
| `app/rooms/states/game-state.ts` | `app/models/colyseus-models/game-state.ts` | Schema class belongs with other Schema models; `rooms/` directory deleted. 9 import paths must be updated. |

## Key Files to Modify

### Client-side files

| File | Change | Scope |
|------|--------|-------|
| `app/public/src/network.ts` | Replace Colyseus client with engine calls | Full rewrite (~260 lines) |
| `app/public/src/pages/game.tsx` | Schema listeners untouched; replace `$` source, 16 `room.onMessage` → `engine.on`, ~20 `room.state` reads → `clientState` (incl. gameContainer.room?.state refs), remove 6 lifecycle refs (leave, onDrop, onReconnect, onLeave, reconnectionToken, roomId), constructor | ~46 changes |
| `app/public/src/game/game-container.ts` | Schema listeners untouched; replace `$` source, 4 `room.send` → engine methods, 1 `room.onMessage` → `engine.on`, 3 `room.state` → `clientState`, remove `SchemaCallbackProxy` type, remove `room.onError`, constructor | ~12 changes |
| `app/public/src/game/scenes/game-scene.ts` | 9 `room?.send` → engine methods (incl. Transfer.VECTOR), 16 `room.state` reads → `clientState`, 1 `room.onMessage` → `engine.on`, Room type | ~27 changes |
| `app/public/src/game/components/berry-tree.ts` | 1 `room.send(Transfer.PICK_BERRY)` → engine method | ~1 change |
| `app/public/src/game/components/wanderers-manager.ts` | 3 `room.send(Transfer.WANDERER_CLICKED)` → engine method | ~3 changes |
| `app/public/src/game/components/minigame-manager.ts` | 1 `room.onMessage(Transfer.NPC_DIALOG)` → `engine.on` + 3 `room.state` reads → `clientState` + update GameState import path | ~5 changes |
| `app/public/src/game/components/board-manager.ts` | Constructor type change (inherits from GameContainer) + update GameState import path | ~3 changes |
| `app/public/src/game/components/pokemon-avatar.ts` | `room.state` accesses → `engine.clientState` | ~3 changes |
| `app/public/src/game/components/loading-manager.ts` | `room.state` access → `engine.clientState` | ~1 change |
| `app/public/src/game/components/sell-zone.ts` | `room.state` access → `engine.clientState` | ~1 change |
| `app/public/src/game/lobby-logic.ts` | Simplify: remove room connection, remove reconnection logic, add "Start Game" | ~200 lines changed |
| `app/public/src/pages/after-game.tsx` | Full useEffect rewrite: remove Colyseus reconnection, read engine final state directly | ~60 lines rewritten |
| `app/public/src/stores/GameStore.ts` | Already clean (zero Colyseus imports) | 0 changes |
| `app/public/src/stores/LobbyStore.ts` | Remove `RoomAvailable` type from `@colyseus/sdk` | ~5 changes |
| `app/public/src/stores/NetworkStore.ts` | Remove `leaveAllRooms`, room references → engine.dispose | ~5 changes |

### Server entry points

| File | Change | Scope |
|------|--------|-------|
| `app/index.ts` | Strip Colyseus server setup, keep Express (Phase 3 deletes Express) | ~30 lines |
| `app/app.config.ts` | Strip room definitions, keep static routes | ~20 lines |

### Core/server-side files

| File | Change | Scope |
|------|--------|-------|
| `app/core/simulation.ts` | Replace `room?: GameRoom` field with `IGameEngineContext` | ~5 refs |
| `app/core/mini-game.ts` | Replace `room: GameRoom` constructor param with `IGameEngineContext`; replace `logger` import from `"colyseus"` with console | ~8 refs + 1 import |
| `app/core/effects/effect.ts` | Replace `room?: GameRoom` in `OnStageStartEffectArgs` with `IGameEngineContext` | ~3 refs |
| `app/core/abilities/abilities.ts` | Fix 6 room refs (via `pokemon.simulation.room` → `IGameEngineContext`) | ~6 refs |
| `app/core/abilities/hidden-power.ts` | Fix 5 room refs (via `unown.simulation.room` → `IGameEngineContext`) | ~5 refs |
| `app/core/effects/synergies.ts` | Fix 1 room ref | ~1 ref |
| `app/core/effects/items.ts` | Fix 7 room refs (clock, broadcast, state, spawnOnBench) | ~7 refs |
| `app/core/effects/passives.ts` | Fix 3 room refs (clock, broadcast) | ~3 refs |
| `app/core/matchmaking.ts` | Update GameState import path | ~1 change |
| `app/core/scribbles.ts` | Update GameState import path | ~1 change |

### Model/type files (import path updates for GameState move)

| File | Change |
|------|--------|
| `app/models/colyseus-models/pokemon.ts` | Update GameState import path |
| `app/models/colyseus-models/player.ts` | Update GameState import path (type-only) |
| `app/models/shop.ts` | Update GameState import path |
| `app/types/index.ts` | Remove `GameRoom` import, add `IGameEngineContext` |

## Key Files to Delete

| File/Directory | Reason |
|----------------|--------|
| `app/rooms/` (11 files, except game-state.ts which MOVES) | All Colyseus room definitions, commands, states |
| `app/core/tournament-logic.ts` | Multiplayer-only |
| `app/public/src/pages/preparation.tsx` | Multiplayer preparation phase — engine auto-starts |
| `app/public/src/pages/component/room-menu/game-rooms-menu.tsx` | Multiplayer room listing UI |
| `app/public/src/pages/component/room-menu/game-room-item.tsx` | Multiplayer room card UI |
| `app/public/src/pages/component/room-menu/tournament-item.tsx` + CSS | Multiplayer tournament UI |
| `app/public/src/pages/component/events-menu/tournaments-list.tsx` + CSS | Multiplayer tournament listing |
| `app/public/src/pages/component/tournaments-admin/tournaments-admin.tsx` + CSS | Multiplayer tournament admin |
| `app/public/src/stores/PreparationStore.ts` | Multiplayer preparation state |

## npm Packages to Remove (9)

Retain `@colyseus/schema` for Phase 4 removal. Remove all others:

`colyseus`, `@colyseus/command`, `@colyseus/monitor`, `@colyseus/redis-driver`, `@colyseus/redis-presence`, `@colyseus/sdk`, `@colyseus/testing`, `@colyseus/tools`, `@colyseus/ws-transport`

## Scope Summary

- **~22 files deleted** (incl. 6 tournament UI files + CSS), **~30 files modified**, **3 new files created**, **1 file moved**
- **~8400 lines deleted**, **~3000 lines added** (3 engine files: 800 + 1000 + 1200)

## Build & Verify

```bash
npm run build   # Must pass at every commit
npm run lint    # Should pass
```

## Reuse Checklist

Before writing new code, check if existing code already does what you need:

- [ ] `Simulation.update(dt)` — battle engine, fully reusable
- [ ] `PokemonFactory.createPokemonFromName()` — Pokemon creation
- [ ] `Shop` class — shop logic (assignShop, reroll, pool management)
- [ ] `BotManager` — bot AI board loading
- [ ] `computeElo()` — ELO calculation (app/core/elo.ts or similar)
- [ ] `computeRoundDamage()` — damage calculation
- [ ] `MiniGame` class — minigame logic
- [ ] `Player` class — player state management
- [ ] `GameState` class — game state container
- [ ] All game config data in `app/config/game/` — balance, shop, pokemons, items
