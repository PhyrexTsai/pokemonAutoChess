# Feature Specification: Cleanup Colyseus Schemas

**Feature Branch**: `005-cleanup-schemas`
**Created**: 2026-03-08
**Status**: Draft
**Input**: User description: "參考 PHASE.md 開始進行 Phase 4 — 移除所有 @colyseus/schema 殘留"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Game Plays Identically After Schema Removal (Priority: P1)

A player launches the game, picks Pokemon, battles AI opponents, and completes a full match. The gameplay experience — shop, drag-drop, battles, abilities, items, synergies — is indistinguishable from the pre-refactoring version. No visual glitches, no missing data, no crashes.

**Why this priority**: Zero regression is the absolute constraint. Every other goal is meaningless if the game breaks.

**Independent Test**: Start a game, play through all phases (pick, preparation, battle, carousel, end), and verify all game mechanics work correctly. Compare a full match replay against the current version to confirm identical behavior.

**Acceptance Scenarios**:

1. **Given** a new game session, **When** the player buys Pokemon from the shop and places them on the board, **Then** Pokemon appear correctly with proper stats, abilities, and synergy bonuses
2. **Given** a battle phase begins, **When** Pokemon fight, **Then** abilities fire, damage calculates correctly, status effects apply, and the battle resolves identically to the current version
3. **Given** a full game completes, **When** the after-game screen shows, **Then** player stats, game history, and team composition display correctly
4. **Given** the game is running, **When** any game state changes, **Then** the UI updates in real time without lag or stale data

---

### User Story 2 - Project Builds Without @colyseus/schema Dependency (Priority: P2)

A developer clones the repo, runs `npm install && npm run build`, and the project compiles successfully. The `@colyseus/schema` package no longer appears in `package.json` or `node_modules`. All TypeScript types resolve without errors.

**Why this priority**: Removing the dependency is the primary deliverable. If it still compiles but the package remains, the phase is incomplete.

**Independent Test**: Delete `node_modules`, run `npm install && npm run build`, verify zero errors, and confirm `@colyseus/schema` is absent from `package.json` and the build output.

**Acceptance Scenarios**:

1. **Given** a clean checkout of the branch, **When** `npm run build` is executed, **Then** the build succeeds with zero TypeScript errors
2. **Given** the built project, **When** searching all source files for `@colyseus/schema`, **Then** zero matches are found
3. **Given** `package.json`, **When** inspecting dependencies and devDependencies, **Then** no `@colyseus` packages are listed

---

### User Story 3 - Reduced Bundle Size and Faster Startup (Priority: P3)

After removing the schema serialization layer, the client bundle is smaller and the game initializes faster because it no longer loads the Encoder/Decoder machinery and schema metadata.

**Why this priority**: This is a measurable benefit of the cleanup, but it's a consequence rather than a goal. The game must work first.

**Independent Test**: Compare the client bundle size (esbuild output) and page load time before and after the refactoring.

**Acceptance Scenarios**:

1. **Given** the production build, **When** comparing bundle size to the pre-refactoring version, **Then** the client bundle is at least 50KB smaller
2. **Given** the game loads in a browser, **When** measuring time from page load to game ready, **Then** startup time does not increase

---

### Edge Cases

- What happens when `Map`/`Set`/`Array` iteration order differs subtly from `MapSchema`/`SetSchema`/`ArraySchema`? All game logic relying on iteration must produce consistent results.
- What happens when serialized game state in IndexedDB (saved with old Schema-based format) is loaded after migration? Saved data compatibility must be preserved or a migration path provided.
- What happens when `pokemon.ts` (21,493 lines) has 1,116 `SetSchema` references replaced? The replacement must be mechanical and complete — no partial conversions.
- What happens when the Encoder/Decoder loopback in `local-engine.ts` is removed? The state synchronization between engine and UI must continue to work with the replacement mechanism.
- How does `.toJSON()` behavior differ between Schema objects and plain objects? Any code relying on Schema's automatic serialization must be updated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All `@type()` decorators (318 occurrences across 19 files) MUST be removed
- **FR-002**: All `extends Schema` declarations (24 occurrences across 19 files) MUST be removed — classes become plain TypeScript classes
- **FR-003**: All `MapSchema<V>` usages (90 occurrences across 21 files) MUST be replaced with `Map<string, V>`
- **FR-004**: All `ArraySchema<T>` usages (72 occurrences across 15 files) MUST be replaced with `T[]`
- **FR-005**: All `SetSchema<T>` usages (1,149 occurrences across 12 files, with 1,116 in `pokemon.ts`) MUST be replaced with `Set<T>`
- **FR-006**: The Encoder/Decoder loopback in `local-engine.ts` MUST be replaced with a direct state-passing mechanism that synchronizes engine state to the UI without serialization
- **FR-007**: All `@colyseus/schema` imports (43 files) MUST be removed
- **FR-008**: The `@colyseus/schema` package MUST be removed from `package.json`
- **FR-009**: The `app/utils/schemas.ts` utility file MUST be either removed or rewritten to use native collection types
- **FR-010**: All interface/type definitions in `app/types/index.ts` that reference Schema collection types MUST be updated to use native TypeScript types
- **FR-011**: Game state saved to IndexedDB MUST remain readable after migration, or a data migration MUST be provided
- **FR-012**: The `npm run build` command MUST complete successfully after all changes
- **FR-013**: All existing game functionality MUST be preserved — zero behavioral regressions

### Key Entities

- **Pokemon Model** (`pokemon.ts`, 21,493 lines): The largest model file containing all Pokemon class definitions with 34 `@type` decorators and 1,116 `SetSchema` references. Each Pokemon species uses `SetSchema` for its type set (e.g., `new SetSchema([Synergy.WATER, Synergy.FLYING])`). After migration, these become `new Set([...])`.
- **Status Model** (`status.ts`, 1,300 lines): Tracks all combat status effects with 36 `@type` decorators. Complex boolean and numeric fields that currently rely on Schema change tracking.
- **Player Model** (`player.ts`, 889 lines): Player state with 53 `@type` decorators, 3 `MapSchema` (board, synergies), and 12 `ArraySchema` (items, Pokemon collection). The most diverse Schema usage.
- **Local Engine** (`local-engine.ts`): Currently uses `Encoder`/`Decoder` from `@colyseus/schema` to serialize/deserialize state in a loopback pattern. This is the only file performing actual encode/decode operations and requires an architectural replacement.
- **PokemonEntity** (`pokemon-entity.ts`): Core battle unit with 40 `@type` decorators and 5 `SetSchema` references. Part of the game engine (`app/core/`), shared between server logic and rendering.
- **Simulation** (`simulation.ts`): Battle simulation engine with 11 `@type` decorators and 9 `MapSchema` references. Orchestrates all combat logic.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero occurrences of `@colyseus/schema` in any source file — verified by full-text search returning empty results
- **SC-002**: `npm run build` passes with zero errors on a clean checkout
- **SC-003**: A complete game session (start → pick → battle → end) runs without errors or visual anomalies
- **SC-004**: Client bundle size decreases by at least 50KB compared to the pre-refactoring version
- **SC-005**: All 43 affected files compile without type errors after migration to native TypeScript types
- **SC-006**: Game state persistence (IndexedDB reads/writes) works correctly after migration

## Assumptions

- The `MapSchema`, `ArraySchema`, and `SetSchema` APIs used in this codebase are limited to standard collection operations (get/set/has/delete/forEach/entries/values/keys/size) and can be replaced 1:1 with native `Map`, `Array`, and `Set`. Any non-standard Schema-specific methods will be identified and handled case-by-case.
- The Encoder/Decoder loopback in `local-engine.ts` was a compatibility bridge from Phase 2 (Remove Colyseus). Since the game now runs entirely client-side, state can be passed by direct object reference rather than serialized.
- The `pokemon.ts` file's 1,116 `SetSchema` instances follow a uniform pattern (`new SetSchema([...synergies])`) and can be mechanically replaced with `new Set([...])`.
- Saved game data in IndexedDB uses JSON serialization, so Schema-specific metadata is not persisted. Standard `.toJSON()` on Schema objects produces plain objects that are equivalent to the native type output.
- The `getDecoderStateCallbacks` mechanism used for UI reactivity in the client will need a replacement. The approach will be determined during planning.
