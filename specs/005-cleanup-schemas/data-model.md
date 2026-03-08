# Data Model: Cleanup Colyseus Schemas

**Date**: 2026-03-08
**Branch**: `005-cleanup-schemas`

## Entity Changes Summary

All entities transition from `extends Schema` with `@type()` decorators to plain TypeScript classes with native collection types. No fields are added or removed — only the type system changes.

## Type Mapping

| Before (Colyseus) | After (Native) | Notes |
|-------------------|----------------|-------|
| `extends Schema` | plain class | Remove inheritance + `super()` |
| `@type("string")` | (remove) | Field type already in TS |
| `@type("uint8")` | (remove) | Field type already in TS |
| `@type({ map: X })` | (remove) | Field type already in TS |
| `MapSchema<V>` | `Map<string, V>` | 90 occurrences, 21 files |
| `SetSchema<T>` | `Set<T>` | 1,149 occurrences, 12 files |
| `ArraySchema<T>` | `T[]` | 72 occurrences, 15 files |
| `new MapSchema<V>()` | `new Map<string, V>()` | Constructor replacement |
| `new SetSchema<T>([...])` | `new Set<T>([...])` | Constructor replacement |
| `new ArraySchema<T>()` | `[] as T[]` | Constructor replacement |

## New Entity: StateTracker

A lightweight reactive state wrapper that replaces `@colyseus/schema`'s Encoder/Decoder/getDecoderStateCallbacks.

**Purpose**: Detect state changes per tick and fire registered callbacks.

**Fields**:
- `scalarListeners`: Array of `{ obj, prop, callback, lastValue }` — tracks property changes
- `mapListeners`: Array of `{ map, type, callback, lastSnapshot }` — tracks Map add/remove/change
- `setListeners`: Array of `{ set, type, callback, lastSnapshot }` — tracks Set add/remove/change

**Methods**:
- `createProxy<T>(obj: T) → CallbackProxy<T>` — returns proxy with `.listen()`, collection `.onAdd()`/`.onRemove()`
- `flush()` — compares current values to snapshots, fires callbacks, updates snapshots

**Lifecycle**: Created once per game session in `LocalGameEngine`. `flush()` called every 50ms in the game tick loop (replaces `syncState()`'s encode/decode cycle).

## Affected Entities (No Structural Changes)

These entities only lose their Schema decorators and collection type annotations. All fields, relationships, and business logic remain identical.

| Entity | File | @type Count | Collection Changes |
|--------|------|-------------|-------------------|
| GameState | game-state.ts | 20 | 7 MapSchema → Map |
| Player | player.ts | 53 | 3 MapSchema → Map, 12 ArraySchema → Array |
| Pokemon (all species) | pokemon.ts | 34 | 1,116 SetSchema → Set |
| PokemonEntity | pokemon-entity.ts | 40 | 5 SetSchema → Set |
| Status | status.ts | 36 | — |
| Simulation | simulation.ts | 11 | 9 MapSchema → Map |
| Dps | dps.ts | 10 | — |
| ExperienceManager | experience-manager.ts | 3 | — |
| AfterGamePlayer | after-game-player.ts | 15 | 5 ArraySchema → Array |
| GameRecord | game-record.ts | 8 | 5 ArraySchema → Array |
| Synergies | synergies.ts | — | MapSchema → Map, SetSchema → Set |
| Tournament | tournament.ts | 14 | 5 MapSchema → Map, 8 ArraySchema → Array |
| Count | count.ts | 20 | — |
| Portal | portal.ts | 10 | — |
| Message | message.ts | 6 | — |
| Wanderer | wanderer.ts | 6 | — |
| PokemonAvatar | pokemon-avatar.ts | 12 | — |
| FloatingItem | floating-item.ts | 5 | — |
| HistoryItem | history-item.ts | 5 | — |
