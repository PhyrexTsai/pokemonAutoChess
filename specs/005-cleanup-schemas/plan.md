# Implementation Plan: Cleanup Colyseus Schemas

**Branch**: `005-cleanup-schemas` | **Date**: 2026-03-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-cleanup-schemas/spec.md`
**Guiding Principle**: 用最小改動完成 — minimal changes, maximum preservation of existing code

## Summary

Remove all `@colyseus/schema` residuals from the codebase: 318 `@type()` decorators, 24 `extends Schema` declarations, and 1,311 Schema collection usages (MapSchema/SetSchema/ArraySchema) across 43 files. Replace the Encoder/Decoder loopback in `local-engine.ts` with a lightweight snapshot-diff state tracker (~200 lines) that preserves the exact same `$` callback API, ensuring zero changes to UI consumer code. The only new file is `state-tracker.ts`.

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js >=20.16.0
**Primary Dependencies**: Phaser 3 (rendering), React 19 (UI), Redux Toolkit (state), `idb` (IndexedDB)
**Storage**: IndexedDB via `idb` (player profile, game history)
**Testing**: Manual play-test (no test suite configured). `npm run build` as build gate.
**Target Platform**: Browser (static SPA, any modern browser)
**Project Type**: Single-player browser game (standalone SPA)
**Performance Goals**: 60fps rendering, <50ms per game tick
**Constraints**: Zero behavioral regression. Same `$` callback API for UI consumers.
**Scale/Scope**: 43 files affected, ~25K lines of model code, 1 new file (~200 lines)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Zero External Dependencies | ✅ PASS | Removing `@colyseus/schema` (the last external dependency from original stack). No new external deps added. |
| II. Game Engine Independence | ✅ PASS | Removing `extends Schema` from `simulation.ts` and `pokemon-entity.ts` makes engine fully independent of any framework. |
| III. Gameplay Fidelity | ✅ PASS | All collection APIs are 1:1 compatible (MapSchema→Map, SetSchema→Set, ArraySchema→Array). State tracker fires same callbacks at same cadence. Zero logic changes. |
| IV. Atomic Traceability | ✅ PASS | Plan follows one-commit-per-logical-change. Each commit must pass `npm run build`. |
| V. Incremental Viability | ✅ PASS | Migration order ensures build passes after each step. State tracker is introduced before Schema is removed from engine. |
| VI. Simplicity Over Abstraction | ✅ PASS | One new file (~200 lines). No adapter/strategy patterns. Snapshot-diff is the simplest viable approach. |

**Post-Phase 1 Re-check**: No violations. State tracker is a direct replacement, not an abstraction layer.

## Project Structure

### Documentation (this feature)

```text
specs/005-cleanup-schemas/
├── plan.md              # This file
├── research.md          # Phase 0 output — 7 decisions documented
├── data-model.md        # Phase 1 output — entity migration table
├── quickstart.md        # Phase 1 output — developer guide post-migration
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
app/
├── models/colyseus-models/   # 18 files — strip @type, extends Schema, Schema collections
│   ├── pokemon.ts             # 21,493 lines — 1,116 SetSchema → Set
│   ├── status.ts              # 1,300 lines — 36 @type removed
│   ├── player.ts              # 889 lines — 53 @type, MapSchema → Map, ArraySchema → Array
│   ├── synergies.ts           # 290 lines — MapSchema → Map, SetSchema → Set
│   ├── game-state.ts          # 97 lines — 20 @type, MapSchema → Map
│   ├── tournament.ts          # 104 lines — 14 @type, MapSchema → Map, ArraySchema → Array
│   └── ... (12 more files)    # Smaller models, same pattern
├── core/                      # 9 files — strip @type, extends Schema, Schema collections
│   ├── simulation.ts          # 11 @type, 9 MapSchema → Map
│   ├── pokemon-entity.ts      # 40 @type, 5 SetSchema → Set
│   ├── dps.ts                 # 10 @type
│   ├── mini-game.ts           # 10 MapSchema → Map
│   └── ...
├── utils/
│   └── schemas.ts             # Rewrite for native types
├── types/
│   └── index.ts               # Update type definitions
├── models/
│   ├── pokemon-factory.ts     # Update Schema imports
│   ├── effects.ts             # Update Schema imports
│   └── shop.ts                # Update Schema imports
└── public/src/
    ├── state-tracker.ts       # NEW — lightweight reactive state (~200 lines)
    ├── local-engine.ts        # Replace Encoder/Decoder with StateTracker
    ├── game-engine-phases.ts  # Update Schema imports
    └── game/
        ├── game-container.ts  # clientState → state (alias, minimal diff)
        └── components/        # Update Schema collection imports
```

**Structure Decision**: Pure in-place refactoring. No files moved, no directories renamed. One new file (`state-tracker.ts`). The `colyseus-models/` directory name is kept to avoid 40+ import path changes.

## Implementation Strategy: Minimal Change Order

### Step 1: Create StateTracker (prerequisite, no existing code changes)

Create `app/public/src/state-tracker.ts` with API-compatible `$` proxy:
- `createStateTracker(state)` → `{ $: SchemaCallbackProxy, flush: () => void }`
- `$<T>(obj)` → `CallbackProxy<T>` with `.listen(prop, cb)`, collection `.onAdd(cb)`/`.onRemove(cb)`/`.onChange(cb)`
- `flush()` → snapshot-diff all listeners, fire callbacks

This is the **only architectural change**. Everything else is mechanical replacement.

### Step 2: Wire StateTracker into LocalGameEngine

Replace Encoder/Decoder in `local-engine.ts`:
- Remove `Encoder`, `Decoder`, `getDecoderStateCallbacks` imports
- Remove `clientState` (keep `engineState` as `state`, alias `clientState` for compatibility)
- Initialize StateTracker in constructor
- Replace `syncState()` body: `this.stateTracker.flush()` instead of `encode() → decode()`

### Step 3: Mechanical Schema Collection Replacement

Replace all Schema collection types across 43 files:
- `MapSchema<V>` → `Map<string, V>` (90 occurrences)
- `SetSchema<T>` → `Set<T>` (1,149 occurrences)
- `ArraySchema<T>` → `T[]` (72 occurrences)
- `new MapSchema<V>()` → `new Map<string, V>()`
- `new SetSchema<T>([...])` → `new Set<T>([...])`
- `new ArraySchema<T>()` → `[] as T[]`

Order: models first (dependencies), then core, then utils, then client.

### Step 4: Remove @type Decorators and Schema Inheritance

- Remove all 318 `@type()` decorator lines
- Remove all 24 `extends Schema` → plain class
- Remove `super()` calls in constructors
- Keep constructor guards (`if (id === undefined) return`) as harmless dead code

### Step 5: Update Utility and Type Files

- Rewrite `app/utils/schemas.ts` for native types
- Update `app/types/index.ts` interfaces to use native types
- Remove all remaining `@colyseus/schema` imports

### Step 6: Remove Package Dependency

- Remove `@colyseus/schema` from `package.json`
- Verify `npm run build` passes
- Verify bundle size reduction (target: ≥50KB)

## Complexity Tracking

> No Constitution violations. No complexity justifications needed.

| Aspect | Complexity | Rationale |
|--------|-----------|-----------|
| StateTracker | ~200 lines, 1 new file | Simplest possible reactive layer. No Proxy magic — just snapshot-diff. |
| Collection replacement | Mechanical find-replace | All APIs are 1:1 compatible per research audit. |
| UI consumer changes | Near-zero | Same `$` API preserved. Only `clientState` → `state` alias. |
