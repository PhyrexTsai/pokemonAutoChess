# Implementation Plan: Remove Colyseus

**Branch**: `003-remove-colyseus` | **Date**: 2026-03-07 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-remove-colyseus/spec.md`
**Design Principle**: Maximum reuse of existing functions, minimum code changes.

## Summary

Replace the Colyseus networking layer with a `LocalGameEngine` that runs the game loop entirely in-browser. The engine reuses existing game logic (commands, simulation, shop, bot AI) extracted from `game-commands.ts` and `game-room.ts` as plain functions. Client-side state listeners are preserved via a **Schema encode/decode loopback**: the engine maintains two `GameState` instances (engine-side + client-side) connected by `Encoder`/`Decoder` from `@colyseus/schema`. After each tick and player action, patches are encoded and decoded locally, firing all existing Schema callbacks automatically. The ~500 lines of `.listen()` / `.onAdd()` / `.onChange()` callbacks in `game.tsx` and `game-container.ts` remain **100% untouched** — only the `$` function source changes (`getDecoderStateCallbacks(decoder)` replaces `getStateCallbacks(room)`). Other `room.*` references (`.send()`, `.onMessage()`, `.state` direct reads) are modified separately (~42 changes across these two files). Transfer messages (ABILITY, DAMAGE, etc.) use a simple EventEmitter. Networking packages (`@colyseus/sdk`, `colyseus`, `@colyseus/tools`, `@colyseus/drivers`) are removed; `@colyseus/schema` is retained for data structures and loopback sync (Phase 4 removal). Express server is retained for development (Phase 3 removal).

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js >=20.16.0
**Primary Dependencies**: Phaser 3 (rendering), React 19 (UI), Redux Toolkit (state), `@colyseus/schema` (data structures — retained), `idb` (IndexedDB)
**Storage**: IndexedDB via `idb` (player profile, game history — from Phase 1)
**Testing**: Manual play-testing (no test suite configured)
**Target Platform**: Modern browsers (Chrome, Firefox, Safari, Edge)
**Project Type**: Browser game (SPA)
**Performance Goals**: 60 FPS game loop, <16ms per tick
**Constraints**: Offline-capable, zero server dependency for gameplay
**Scale/Scope**: ~16 files deleted, ~28 files modified, ~8100 lines deleted, ~3000 lines added (3 new engine files)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Zero External Dependencies | PARTIAL | Phase 2 removes Colyseus networking. Express server retained (Phase 3). `@colyseus/schema` retained (Phase 4). |
| II. Game Engine Independence | PASS | Simulation already decoupled (Phase 0). This phase removes remaining room refs. |
| III. Gameplay Fidelity | PASS | All game commands reused from existing code. Same logic, different delivery. |
| IV. Atomic Traceability | PASS | Each task = one commit. Build must pass at every commit. |
| V. Incremental Viability | PASS | App works at each step. Engine can coexist with server during transition. |
| VI. Simplicity Over Abstraction | PASS | Schema encode/decode loopback reuses existing `@colyseus/schema` machinery. No custom abstraction needed. |

**Gate result**: PASS — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-remove-colyseus/
├── plan.md              # This file
├── research.md          # Phase 0 output: 8 research decisions
├── data-model.md        # Phase 1 output: entity definitions
├── quickstart.md        # Phase 1 output: implementation guide
├── contracts/
│   └── engine-api.md    # LocalGameEngine public API contract
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
app/
├── core/                           # Battle engine (PRESERVED, fixes for room refs)
│   ├── simulation.ts               # MODIFY: replace room?: GameRoom with IGameEngineContext (~5 refs)
│   ├── mini-game.ts                # MODIFY: replace room: GameRoom constructor with IGameEngineContext (~8 refs); replace logger import from "colyseus" with console
│   ├── matchmaking.ts              # MODIFY: update GameState import path (moves to colyseus-models/)
│   ├── scribbles.ts                # MODIFY: update GameState import path
│   ├── pokemon-entity.ts           # Reused as-is
│   ├── pokemon-state.ts            # Reused as-is
│   ├── abilities/abilities.ts      # MODIFY: fix 3 room refs (via pokemon.simulation.room → IGameEngineContext)
│   ├── abilities/hidden-power.ts   # MODIFY: fix 3 room refs (via unown.simulation.room → IGameEngineContext)
│   ├── effects/effect.ts           # MODIFY: replace room?: GameRoom with IGameEngineContext in OnStageStartEffectArgs (~3 refs)
│   ├── effects/synergies.ts        # MODIFY: fix 2 room refs
│   ├── effects/items.ts            # MODIFY: fix 7 room refs (clock, broadcast, state, spawnOnBench)
│   ├── effects/passives.ts         # MODIFY: fix 3 room refs (clock, broadcast)
│   └── tournament-logic.ts         # DELETE (multiplayer-only)
├── config/game/                    # Balance data (UNTOUCHED)
├── models/
│   ├── colyseus-models/            # Schema data classes (PRESERVED for Phase 4)
│   │   ├── game-state.ts           # MOVED HERE from app/rooms/states/ (9 import paths updated)
│   │   ├── pokemon.ts              # MODIFY: update GameState import path
│   │   └── player.ts              # MODIFY: update GameState import path (type-only import)
│   ├── shop.ts                     # MODIFY: update GameState import path
│   └── pokemon-factory.ts          # Reused as-is (no direct GameState import)
├── types/
│   └── index.ts                    # MODIFY: remove GameRoom import, add IGameEngineContext
├── rooms/                          # DELETE ENTIRELY (11 files, ~7040 lines)
│   └── states/game-state.ts        # MOVE to models/colyseus-models/ (not delete)
├── index.ts                        # Strip Colyseus, keep Express (Phase 3 deletes)
├── app.config.ts                   # Strip room defs, keep static routes
└── public/src/
    ├── local-engine.ts             # NEW: LocalGameEngine core (~800 lines)
    ├── game-engine-commands.ts     # NEW: extracted player action functions (~1000 lines)
    ├── game-engine-phases.ts       # NEW: extracted OnUpdatePhaseCommand logic (~1200 lines)
    ├── network.ts                  # REWRITE: engine calls replace room.send()
    ├── pages/
    │   ├── game.tsx                # MODIFY: ~30 changes (16 onMessage→engine.on, 7 room.state reads→clientState, 6 lifecycle refs removed, $ source change)
    │   ├── after-game.tsx          # MODIFY: full useEffect rewrite (~60 lines, remove reconnection logic)
    │   ├── preparation.tsx         # DELETE
    │   ├── lobby.tsx               # MODIFY: add "Start Game", remove MP elements
    │   └── component/room-menu/
    │       ├── game-rooms-menu.tsx  # DELETE (multiplayer room listing)
    │       └── game-room-item.tsx   # DELETE (multiplayer room card)
    ├── game/
    │   ├── game-container.ts       # MODIFY: ~12 changes (4 send→engine, 1 onMessage→engine.on, 3 state reads→clientState, SchemaCallbackProxy removal, constructor)
    │   ├── lobby-logic.ts          # MODIFY: simplify for local flow, remove reconnection logic
    │   ├── scenes/game-scene.ts    # MODIFY: ~16 changes (9 room.send→engine, 5 room.state→clientState, 1 onMessage→engine.on, Room type)
    │   └── components/
    │       ├── berry-tree.ts       # MODIFY: 1 room.send → engine method
    │       ├── wanderers-manager.ts # MODIFY: 3 room.send(Transfer.WANDERER_CLICKED) → engine method
    │       ├── minigame-manager.ts  # MODIFY: 1 room.onMessage(Transfer.NPC_DIALOG) → engine.on
    │       ├── board-manager.ts     # MODIFY: inherits from GameContainer, constructor type change
    │       ├── pokemon-avatar.ts    # MODIFY: room.state accesses → engine.clientState
    │       ├── loading-manager.ts   # MODIFY: room.state accesses → engine.clientState
    │       └── sell-zone.ts         # MODIFY: room.state accesses → engine.clientState
    └── stores/
        ├── GameStore.ts            # MODIFY: remove Colyseus type imports
        ├── LobbyStore.ts           # MODIFY: remove RoomAvailable type from @colyseus/sdk
        ├── PreparationStore.ts     # DELETE
        └── NetworkStore.ts         # MODIFY: remove room references, leaveAllRooms → engine.dispose
```

**Structure Decision**: Existing project structure preserved. Three new files added (`local-engine.ts`, `game-engine-commands.ts`, `game-engine-phases.ts`). `engine-state-proxy.ts` eliminated by Schema encode/decode loopback. No new directories. ~16 files deleted, ~28 files modified. GameState MOVED from `rooms/states/` to `models/colyseus-models/` (9 import paths updated).

### Files to Move

| From | To | Reason |
|------|----|--------|
| `app/rooms/states/game-state.ts` | `app/models/colyseus-models/game-state.ts` | Schema class belongs with other Schema models; `rooms/` directory deleted |

### npm Packages to Remove (9)

Retain `@colyseus/schema` for Phase 4. Remove all others:

| Package | Reason |
|---------|--------|
| `colyseus` | Server framework — replaced by LocalGameEngine |
| `@colyseus/command` | Command pattern — extracted as plain functions |
| `@colyseus/monitor` | Admin UI — multiplayer-only |
| `@colyseus/redis-driver` | Redis state storage — not needed |
| `@colyseus/redis-presence` | Redis presence — not needed |
| `@colyseus/sdk` | Client SDK — replaced by direct engine calls |
| `@colyseus/testing` | Testing utilities — not needed |
| `@colyseus/tools` | Dev tools — not needed |
| `@colyseus/ws-transport` | WebSocket transport — not needed |

## Complexity Tracking

No constitution violations to justify.
