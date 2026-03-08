# Research: Cleanup Colyseus Schemas

**Date**: 2026-03-08
**Branch**: `005-cleanup-schemas`

## Decision 1: Encoder/Decoder Replacement Strategy

**Decision**: Snapshot-diff state tracker with API-compatible `$` proxy

**Rationale**: The current Encoder/Decoder loopback is the only mechanism providing UI reactivity (change callbacks). The `$` proxy API (`$.listen()`, `.onAdd()`, `.onRemove()`, `.onChange()`) is used in 100+ callback registrations across `game-container.ts` and `game.tsx`. A replacement that preserves the same API signature means **zero changes** to those consumer files.

The snapshot-diff approach:
- On callback registration, store the current value as a snapshot
- On `syncState()` (called every 50ms), compare current values to snapshots
- Fire callbacks for any differences, then update snapshots
- For Map/Set collections, diff key/value sets to detect add/remove

**Alternatives considered**:
- **Proxy-based interception**: Intercepts every property write via `Proxy.set()`. Pro: real-time. Con: performance overhead on every mutation (game engine mutates hundreds of properties per tick), complex for nested objects.
- **Explicit event emission**: Require every state mutation to emit events. Con: requires touching every place that mutates state in the engine (~dozens of files), violates "minimal change" goal.
- **Keep Encoder/Decoder, strip decorators only**: @colyseus/schema v4 requires `@type` decorators for encode/decode to work. Without them, the encoder produces empty buffers. Not viable.

## Decision 2: engineState/clientState Merge

**Decision**: Merge into single state object. Remove the clientState clone.

**Rationale**: The dual-state pattern (engineState + clientState) existed because Colyseus's Decoder needed a separate target object. Without encode/decode, there's no reason to maintain two copies. The UI can read directly from the engine state. This eliminates memory duplication and simplifies the data flow.

**Impact**: `engine.clientState` references in `game.tsx` and `game-container.ts` change to `engine.state` (or keep `clientState` as an alias for zero-change). Choosing alias approach for minimal diff.

## Decision 3: Constructor Guard Handling

**Decision**: Remove `extends Schema` and `super()`. Keep the `if (id === undefined) return` guard as harmless dead code.

**Rationale**: The guard `if (id === undefined) return` was needed because Colyseus's Decoder instantiates Schema classes with no arguments. With Decoder removed, this guard is dead code. However, removing it requires verifying that no other code path creates instances without arguments. For minimal changes, leave it — it costs nothing and avoids risk.

**Alternatives considered**:
- Remove guard entirely: Requires auditing all constructor call sites (24 classes). Higher risk, no functional benefit. Can be done in a future cleanup pass.

## Decision 4: Collection Replacement Strategy

**Decision**: Direct mechanical replacement — `MapSchema<V>` → `Map<string, V>`, `SetSchema<T>` → `Set<T>`, `ArraySchema<T>` → `T[]`

**Rationale**: Codebase audit confirms that all Schema collection usage is limited to standard APIs:
- MapSchema: `.get()`, `.set()`, `.delete()`, `.has()`, `.forEach()`, `.size`, `.entries()`, `.values()`, `.keys()`
- SetSchema: `.add()`, `.delete()`, `.has()`, `.forEach()`, `.size`
- ArraySchema: `.push()`, `.pop()`, `.clear()`, `.forEach()`, `.length`, `[index]`

No non-standard Schema-specific methods are used on collections (no `.clone()`, `.assign()`, `.toJSON()`).

**pokemon.ts special case**: 1,116 `new SetSchema([...])` → `new Set([...])`. All follow the same pattern. Can be done with find-and-replace.

## Decision 5: schemas.ts Utility Handling

**Decision**: Rewrite to work with native types. Keep function signatures, simplify implementations.

**Rationale**: `schemas.ts` provides 5 utility functions:
- `keys(schema)` → `Array.from(map.keys())` or just use `.keys()` directly
- `values(schema)` → `Array.from(map.values())` or `.values()` directly
- `entries(schema)` → `Array.from(map.entries())` or `.entries()` directly
- `resetArraySchema(schema, newArray)` → simple array reassignment or `.length = 0; .push(...newArray)`
- `convertSchemaToRawObject(schema)` → simplify (no more `instanceof Schema` checks needed)

Most callers can switch to native methods directly. Keep the file as a thin wrapper for backward compatibility during migration, remove in a later cleanup.

## Decision 6: State Tracker Scope

**Decision**: New file `app/public/src/state-tracker.ts` (~200 lines). Provides:
1. `createStateTracker(state: T)` → returns `{ $, flush }`
2. `$<T>(obj: T)` → returns `CallbackProxy<T>` with `.listen()`, collection `.onAdd()`/`.onRemove()`/`.onChange()`
3. `flush()` → snapshot-diff all registered listeners and fire callbacks

**Performance characteristics**:
- Scalar listeners: O(N) reference comparisons per flush, where N = registered listeners (~100)
- Collection listeners: O(M) set diff per collection per flush, where M = collection size (typically 3-9 for game objects)
- Flush interval: every 50ms (existing cadence), unchanged

**API compatibility**: The `$` function signature matches `getDecoderStateCallbacks` return type exactly. Consumer files (`game-container.ts`, `game.tsx`) require **zero code changes** to their callback registration logic.

## Decision 7: colyseus-models Directory

**Decision**: Keep the directory name `app/models/colyseus-models/` unchanged during this phase.

**Rationale**: Renaming directories affects import paths across 40+ files. This is a high-risk, low-value change that can be done separately. The "minimal change" principle says: change the contents, not the structure.
