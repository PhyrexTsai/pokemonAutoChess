# Implementation Plan: Cleanup Colyseus Schemas

**Branch**: `005-cleanup-schemas` | **Date**: 2026-03-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-cleanup-schemas/spec.md`
**Guiding Principle**: 用最小改動完成 — minimal changes, maximum preservation of existing code

## Summary

Remove all `@colyseus/schema` residuals from the codebase: 318 `@type()` decorators, 24 `extends Schema` declarations, and 1,311 Schema collection usages (MapSchema/SetSchema/ArraySchema) across 43 files. Replace the Encoder/Decoder loopback in `local-engine.ts` with a lightweight snapshot-diff state tracker (~300 lines) that preserves the exact same `$` callback API, ensuring zero changes to UI consumer code. The only new file is `state-tracker.ts`.

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js >=20.16.0
**Primary Dependencies**: Phaser 3 (rendering), React 19 (UI), Redux Toolkit (state), `idb` (IndexedDB)
**Storage**: IndexedDB via `idb` (player profile, game history)
**Testing**: Manual play-test (no test suite configured). `npm run build` as build gate.
**Target Platform**: Browser (static SPA, any modern browser)
**Project Type**: Single-player browser game (standalone SPA)
**Performance Goals**: 60fps rendering, <50ms per game tick
**Constraints**: Zero behavioral regression. Same `$` callback API for UI consumers.
**Scale/Scope**: 43 files affected, ~25K lines of model code, 1 new file (~300 lines)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Zero External Dependencies | ✅ PASS | Removing `@colyseus/schema` (the last external dependency from original stack). No new external deps added. |
| II. Game Engine Independence | ✅ PASS | Removing `extends Schema` from `simulation.ts` and `pokemon-entity.ts` makes engine fully independent of any framework. |
| III. Gameplay Fidelity | ✅ PASS | All collection APIs are 1:1 compatible (MapSchema→Map, SetSchema→Set, ArraySchema→Array). State tracker fires same callbacks at same cadence. Zero logic changes. |
| IV. Atomic Traceability | ✅ PASS | Plan follows one-commit-per-logical-change. Each commit must pass `npm run build`. |
| V. Incremental Viability | ✅ PASS | Migration order ensures build passes after each step. State tracker is introduced before Schema is removed from engine. |
| VI. Simplicity Over Abstraction | ✅ PASS | One new file (~300 lines). No adapter/strategy patterns. Snapshot-diff is the simplest viable approach. |

**Post-Phase 1 Re-check**: No violations. State tracker is a direct replacement, not an abstraction layer.

## Critical Design Constraints

These constraints were identified during plan review and MUST be respected during implementation:

### C1: Schema Collections Do NOT Extend Native Types

```typescript
// @colyseus/schema v4 actual declarations:
class MapSchema<V>   implements Map<K, V>   // NOT extends Map
class SetSchema<V>   implements Collection   // NOT implements Set
class ArraySchema<V> implements Array<V>     // NOT extends Array
```

`obj instanceof Map` returns `false` for MapSchema instances. The StateTracker MUST use duck-typing (e.g., `obj.constructor?.name === 'MapSchema'` or checking for Schema-specific symbols) to detect Schema collections during the transition period (Step 1-2), then rely on `instanceof` after native types replace Schema types (Step 3+).

### C2: `onAdd` Must Fire Retroactively for Existing Elements

When `$state.players.onAdd(callback)` is registered AFTER players already exist in the state, Colyseus fires the callback **immediately** for all existing items. This is how game.tsx initializes — callbacks are registered in a React `useEffect` AFTER `startGame()` has already populated the state.

The StateTracker MUST replicate this: when `onAdd(cb)` is registered on a collection that already has elements, invoke `cb(value, key)` synchronously for each existing element.

Without this, the game screen is blank on startup — no players, no Pokemon.

### C3: ArraySchema Requires onChange Tracking

Four ArraySchema fields have `.onChange()` callbacks registered:

| Field | File | Callback |
|-------|------|----------|
| `shop` | game.tsx:642 | `$player.shop.onChange((pkm, index) => dispatch(changeShop(...)))` |
| `items` | game-container.ts:582 | `$player.items.onChange((value, key) => render(...))` |
| `itemsProposition` | game.tsx:787 | `$player.itemsProposition.onChange((value, index) => ...)` |
| `pokemonsProposition` | game.tsx:793 | `$player.pokemonsProposition.onChange((value, index) => ...)` |

The StateTracker MUST snapshot array contents and detect per-index changes on `flush()`.

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
    ├── state-tracker.ts       # NEW — lightweight reactive state (~300 lines)
    ├── local-engine.ts        # Replace Encoder/Decoder with StateTracker
    ├── game-engine-phases.ts  # Update Schema imports
    └── game/
        ├── game-container.ts  # clientState → state (alias, minimal diff)
        └── components/        # Update Schema collection imports
```

**Structure Decision**: Pure in-place refactoring. No files moved, no directories renamed. One new file (`state-tracker.ts`). The `colyseus-models/` directory name is kept to avoid 40+ import path changes.

## Implementation Strategy: Minimal Change Order

### Step 1: Create StateTracker (no existing code changes)

Create `app/public/src/state-tracker.ts` (~300 lines) with API-compatible `$` proxy.

**Required API surface:**

```
createStateTracker(state: T) → { $, flush }

$<T>(obj: T) → CallbackProxy<T>
├── .listen(prop, callback)               — scalar property changes
├── .<mapProp>.onAdd(callback)            — Map new key (+ retroactive for existing keys, see C2)
├── .<mapProp>.onRemove(callback)         — Map removed key (provides old value from snapshot)
├── .<mapProp>.onChange(callback)          — Map value changes
├── .<setProp>.onAdd(callback)            — Set new value (+ retroactive for existing values, see C2)
├── .<setProp>.onRemove(callback)         — Set removed value
├── .<setProp>.onChange(callback)          — Set adds + removes
├── .<arrayProp>.onChange(callback)        — Array per-index element changes (see C3)
└── .<objectProp>.listen(prop, callback)  — nested object properties (recursive)

flush()
├── Compare scalar snapshots → fire listen callbacks for changed props
├── Diff Map key sets → fire onAdd/onRemove/onChange (provide old value for onRemove)
├── Diff Set value sets → fire onAdd/onRemove/onChange
└── Diff Array elements per-index → fire onChange(value, index)
```

**Collection detection strategy (see C1):**
- During transition (Schema collections still present): duck-typing via `obj.constructor?.name` checks for `'MapSchema'`, `'SetSchema'`, `'ArraySchema'`
- After migration (native types): standard `instanceof Map/Set/Array`
- Implementation: check `instanceof` first, fall back to constructor name

**Retroactive `onAdd` (see C2):**
- When `onAdd(cb)` is registered, immediately iterate existing elements and call `cb(value, key)` for each
- Then store empty snapshot so next `flush()` won't re-fire

### Step 2: Wire StateTracker into LocalGameEngine

Replace Encoder/Decoder in `local-engine.ts`:
- Remove `Encoder`, `Decoder`, `getDecoderStateCallbacks` imports
- Keep `clientState` as a getter alias for `engineState` (zero-diff for consumers)
- Initialize StateTracker with `engineState` in constructor
- Replace `syncState()` body: `this.stateTracker.flush()` instead of `encode() → decode()`
- Remove `Encoder.BUFFER_SIZE` config, `encoder.encodeAll()`, `encoder.discardChanges()`

**Build gate**: Build passes because StateTracker detects Schema collections via duck-typing (C1). UI callbacks still work — same `$` API.

### Step 3: Mechanical Schema Collection Replacement

Replace all Schema collection types across 43 files:
- `MapSchema<V>` → `Map<string, V>` (90 occurrences)
- `SetSchema<T>` → `Set<T>` (1,149 occurrences)
- `ArraySchema<T>` → `T[]` (72 occurrences)
- `new MapSchema<V>()` → `new Map<string, V>()`
- `new SetSchema<T>([...])` → `new Set<T>([...])`
- `new ArraySchema<T>(...)` → `[...] as T[]` or `[] as T[]`

Order: models first (dependencies), then core, then utils, then client.

**Build gate**: Build passes because StateTracker also handles native types via `instanceof` (C1 dual detection).

### Step 4: Remove @type Decorators and Schema Inheritance

- Remove all 318 `@type()` decorator lines
- Remove all 24 `extends Schema` → plain class
- Remove `super()` calls in constructors
- Keep constructor guards (`if (id === undefined) return`) as harmless dead code

**Build gate**: Build passes — decorators and Schema base class are no longer used by anything.

### Step 5: Update Utility and Type Files

- Rewrite `app/utils/schemas.ts` for native types:
  - `keys()` / `values()` / `entries()` → thin wrappers over native methods or inline at call sites
  - `resetArraySchema(arr, newArr)` → `arr.length = 0; arr.push(...newArr)` (native Array has no `.clear()`)
  - `convertSchemaToRawObject()` → simplify (no more `instanceof Schema` checks)
- Update `app/types/index.ts` interfaces to use native TypeScript types
- Remove all remaining `@colyseus/schema` imports from all files

**Build gate**: Build passes.

### Step 6: Remove Package Dependency and Cleanup

- Remove `@colyseus/schema` from `package.json`
- Remove duck-typing dead code from StateTracker (constructor name checks no longer needed)
- Verify `npm run build` passes on clean `node_modules`
- Verify bundle size reduction (target: ≥50KB)

**Build gate**: Final verification — `rm -rf node_modules && npm install && npm run build`.

## Complexity Tracking

> No Constitution violations. No complexity justifications needed.

| Aspect | Complexity | Rationale |
|--------|-----------|-----------|
| StateTracker | ~300 lines, 1 new file | Snapshot-diff with retroactive onAdd + Array tracking + dual collection detection. Simplest approach that satisfies all 3 design constraints. |
| Collection replacement | Mechanical find-replace | All APIs are 1:1 compatible per research audit. |
| UI consumer changes | Near-zero | Same `$` API preserved. `clientState` kept as alias. |
