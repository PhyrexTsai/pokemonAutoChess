# Implementation Plan: Remove Colyseus

**Branch**: `003-remove-colyseus` | **Date**: 2026-03-07 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-remove-colyseus/spec.md`
**Design Principle**: Maximum reuse of existing functions, minimum code changes.

## Summary

Replace the Colyseus networking layer with a `LocalGameEngine` that runs the game loop entirely in-browser. The engine reuses existing game logic (commands, simulation, shop, bot AI) extracted from `game-commands.ts` and `game-room.ts` as plain functions. Client-side state listeners are preserved via a **Schema encode/decode loopback**: the engine maintains two `GameState` instances (engine-side + client-side) connected by `Encoder`/`Decoder` from `@colyseus/schema`. After each tick and player action, patches are encoded and decoded locally, firing all existing Schema callbacks automatically. The ~500 lines of `.listen()` / `.onAdd()` / `.onChange()` callbacks in `game.tsx` and `game-container.ts` remain **100% untouched** — only the `$` function source changes (`getDecoderStateCallbacks(decoder)` replaces `getStateCallbacks(room)`). Other `room.*` references (`.send()`, `.onMessage()`, `.state` direct reads) are modified separately (~34 changes across these two files). Transfer messages (ABILITY, DAMAGE, etc.) use a simple EventEmitter. Networking packages (`@colyseus/sdk`, `colyseus`, `@colyseus/tools`, `@colyseus/drivers`) are removed; `@colyseus/schema` is retained for data structures and loopback sync (Phase 4 removal). Express server is retained for development (Phase 3 removal).

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js >=20.16.0
**Primary Dependencies**: Phaser 3 (rendering), React 19 (UI), Redux Toolkit (state), `@colyseus/schema` (data structures — retained), `idb` (IndexedDB)
**Storage**: IndexedDB via `idb` (player profile, game history — from Phase 1)
**Testing**: Manual play-testing (no test suite configured)
**Target Platform**: Modern browsers (Chrome, Firefox, Safari, Edge)
**Project Type**: Browser game (SPA)
**Performance Goals**: 60 FPS game loop, <16ms per tick
**Constraints**: Offline-capable, zero server dependency for gameplay
**Scale/Scope**: ~50 files modified, ~7600 lines deleted, ~1500 lines added

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
│   ├── simulation.ts               # MODIFY: replace room?: GameRoom with engine context interface
│   ├── mini-game.ts                # MODIFY: replace room: GameRoom constructor with engine context
│   ├── pokemon-entity.ts           # Reused as-is
│   ├── pokemon-state.ts            # Reused as-is
│   ├── abilities/abilities.ts      # Fix 2 room refs
│   ├── abilities/hidden-power.ts   # Fix 2 room refs
│   ├── effects/effect.ts           # MODIFY: replace room?: GameRoom in OnStageStartEffectArgs
│   ├── effects/synergies.ts        # Fix 1 room ref
│   ├── effects/items.ts            # Fix 4 room refs
│   ├── effects/passives.ts         # Fix 1 room ref
│   └── tournament-logic.ts         # DELETE (multiplayer-only)
├── config/game/                    # Balance data (UNTOUCHED)
├── models/colyseus-models/         # Schema data classes (PRESERVED for Phase 4)
├── types/                          # Shared enums/types (UNTOUCHED)
├── rooms/                          # DELETE ENTIRELY (11 files, ~7040 lines)
├── index.ts                        # Strip Colyseus, keep Express (Phase 3 deletes)
├── app.config.ts                   # Strip room defs, keep static routes
└── public/src/
    ├── local-engine.ts             # NEW: LocalGameEngine + loopback sync (~1500 lines)
    ├── network.ts                  # REWRITE: engine calls replace room.send()
    ├── pages/
    │   ├── game.tsx                # MODIFY: ~23 changes (Schema listeners untouched; room.onMessage→engine.on, room.state→clientState, constructor)
    │   ├── after-game.tsx          # MODIFY: full useEffect rewrite (~60 lines, remove reconnection logic)
    │   ├── preparation.tsx         # DELETE
    │   └── lobby.tsx               # MODIFY: add "Start Game", remove MP elements
    ├── game/
    │   ├── game-container.ts       # MODIFY: ~11 changes (Schema listeners untouched; room.send→engine, room.state→clientState, constructor)
    │   ├── lobby-logic.ts          # MODIFY: simplify for local flow
    │   ├── scenes/game-scene.ts    # MODIFY: 8 room.send + 5 room.state + 1 room.onMessage (~14 changes)
    │   └── components/
    │       ├── berry-tree.ts       # MODIFY: 1 room.send → engine method
    │       ├── wanderers-manager.ts # MODIFY: 3 room.send(Transfer.WANDERER_CLICKED) → engine method
    │       ├── minigame-manager.ts  # MODIFY: 1 room.onMessage(Transfer.NPC_DIALOG) → engine.on
    │       ├── pokemon-avatar.ts    # MODIFY: room.state accesses → engine.clientState
    │       ├── loading-manager.ts   # MODIFY: room.state accesses → engine.clientState
    │       └── sell-zone.ts         # MODIFY: room.state accesses → engine.clientState
    └── stores/
        ├── GameStore.ts            # MODIFY: remove Colyseus type imports
        ├── LobbyStore.ts           # MODIFY: remove Colyseus type imports
        ├── PreparationStore.ts     # DELETE or simplify
        └── NetworkStore.ts         # MODIFY: remove room references
```

**Structure Decision**: Existing project structure preserved. One new file added (`local-engine.ts`). `engine-state-proxy.ts` eliminated by Schema encode/decode loopback. No new directories. ~12 files deleted, ~22 files modified.

## Complexity Tracking

No constitution violations to justify.
