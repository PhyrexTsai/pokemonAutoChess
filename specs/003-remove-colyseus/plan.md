# Implementation Plan: Remove Colyseus

**Branch**: `003-remove-colyseus` | **Date**: 2026-03-07 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-remove-colyseus/spec.md`
**Design Principle**: Maximum reuse of existing functions, minimum code changes.

## Summary

Replace the Colyseus networking layer with a `LocalGameEngine` that runs the game loop entirely in-browser. The engine reuses existing game logic (commands, simulation, shop, bot AI) extracted from `game-commands.ts` and `game-room.ts` as plain functions. Client-side state listeners are preserved via an `EngineStateProxy` compatibility layer that mimics the Colyseus `SchemaCallbackProxy` API, minimizing changes to `game.tsx` and `game-container.ts`. Networking packages (`@colyseus/sdk`, `colyseus`, `@colyseus/tools`, `@colyseus/drivers`) are removed; `@colyseus/schema` is retained for data structures (Phase 4 removal). Express server is retained for development (Phase 3 removal).

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js >=20.16.0
**Primary Dependencies**: Phaser 3 (rendering), React 19 (UI), Redux Toolkit (state), `@colyseus/schema` (data structures — retained), `idb` (IndexedDB)
**Storage**: IndexedDB via `idb` (player profile, game history — from Phase 1)
**Testing**: Manual play-testing (no test suite configured)
**Target Platform**: Modern browsers (Chrome, Firefox, Safari, Edge)
**Project Type**: Browser game (SPA)
**Performance Goals**: 60 FPS game loop, <16ms per tick
**Constraints**: Offline-capable, zero server dependency for gameplay
**Scale/Scope**: ~50 files modified, ~7600 lines deleted, ~1000 lines added

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Zero External Dependencies | PARTIAL | Phase 2 removes Colyseus networking. Express server retained (Phase 3). `@colyseus/schema` retained (Phase 4). |
| II. Game Engine Independence | PASS | Simulation already decoupled (Phase 0). This phase removes remaining room refs. |
| III. Gameplay Fidelity | PASS | All game commands reused from existing code. Same logic, different delivery. |
| IV. Atomic Traceability | PASS | Each task = one commit. Build must pass at every commit. |
| V. Incremental Viability | PASS | App works at each step. Engine can coexist with server during transition. |
| VI. Simplicity Over Abstraction | PASS | EngineStateProxy is a thin adapter (~150 lines), not a framework. No patterns "for flexibility". |

**Gate result**: PASS — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-remove-colyseus/
├── plan.md              # This file
├── research.md          # Phase 0 output: 7 research decisions
├── data-model.md        # Phase 1 output: entity definitions
├── quickstart.md        # Phase 1 output: implementation guide
├── contracts/
│   └── engine-api.md    # LocalGameEngine public API contract
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
app/
├── core/                           # Battle engine (PRESERVED, minor fixes)
│   ├── simulation.ts               # Reused as-is
│   ├── pokemon-entity.ts           # Reused as-is
│   ├── pokemon-state.ts            # Reused as-is
│   ├── abilities/abilities.ts      # Fix 2 room refs
│   ├── abilities/hidden-power.ts   # Fix 2 room refs
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
    ├── local-engine.ts             # NEW: LocalGameEngine (~800 lines)
    ├── engine-state-proxy.ts       # NEW: Compatibility layer (~150 lines)
    ├── network.ts                  # REWRITE: engine calls replace room.send()
    ├── pages/
    │   ├── game.tsx                # MODIFY: proxy replaces getStateCallbacks
    │   ├── after-game.tsx          # MODIFY: read engine state
    │   ├── preparation.tsx         # DELETE
    │   └── lobby.tsx               # MODIFY: add "Start Game", remove MP elements
    ├── game/
    │   ├── game-container.ts       # MODIFY: proxy replaces getStateCallbacks
    │   ├── lobby-logic.ts          # MODIFY: simplify for local flow
    │   └── scenes/game-scene.ts    # MINOR: remove room.send for loading
    └── stores/
        ├── GameStore.ts            # MODIFY: remove Colyseus type imports
        ├── LobbyStore.ts           # MODIFY: remove Colyseus type imports
        ├── PreparationStore.ts     # DELETE or simplify
        └── NetworkStore.ts         # MODIFY: remove room references
```

**Structure Decision**: Existing project structure preserved. Two new files added (`local-engine.ts`, `engine-state-proxy.ts`). No new directories. ~12 files deleted, ~15 files modified.

## Complexity Tracking

No constitution violations to justify.
