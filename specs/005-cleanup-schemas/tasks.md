# Tasks: Cleanup Colyseus Schemas

**Input**: Design documents from `/specs/005-cleanup-schemas/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, quickstart.md

**Tests**: No test suite configured. Verification via `npm run build` and manual play-test.

**Organization**: Tasks follow plan.md's 6-step implementation strategy, mapped to 3 user stories from spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All file paths are relative to repository root

---

## Phase 1: Setup

**Purpose**: Verify starting point is clean

- [x] T001 Verify clean build on branch `005-cleanup-schemas` via `npm run build`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the StateTracker that replaces Colyseus Encoder/Decoder — MUST complete before any user story work

**⚠️ CRITICAL**: US1 cannot begin until StateTracker exists with full API surface

- [x] T002 Create `app/public/src/state-tracker.ts` (~350 lines) implementing `createStateTracker()` → `{ $, flush }` API per plan.md constraints C1–C6

**StateTracker must implement:**
- `$<T>(obj)` → proxy with `.listen(prop, cb)` for scalar changes
- `.onAdd(cb, triggerAll=true)` / `.onRemove(cb)` / `.onChange(cb)` for Map and Set (C2: retroactive onAdd with opt-out)
- `.onChange(cb)` for Array per-index tracking (C3)
- Dual collection detection: `instanceof` + `constructor.name` duck-typing (C1)
- Automatic listener cleanup via `WeakMap<object, Listener[]>` on collection removal (C4)
- Zero-allocation fast-path on no-change flushes (C5)

**Checkpoint**: StateTracker exists as standalone module. No existing code modified yet.

---

## Phase 3: User Story 1 — Game Plays Identically (Priority: P1) 🎯 MVP

**Goal**: Replace Encoder/Decoder loopback with StateTracker so the game runs with identical behavior

**Independent Test**: Start a game, play through all phases (pick → preparation → battle → carousel → end), verify all UI updates fire correctly

### Implementation for User Story 1

- [ ] T003 [US1] Wire StateTracker into `app/public/src/local-engine.ts` — remove Encoder/Decoder/getDecoderStateCallbacks imports, replace `syncState()` body with `this.stateTracker.flush()`, keep `clientState` as getter alias for `engineState`
- [ ] T004 [US1] Build verification (`npm run build`) + manual play-test: full game session confirming shop/drag-drop/battles/abilities/items/synergies all work. Also verify loading existing IndexedDB saved data works correctly (FR-011/SC-006)

**Checkpoint**: Game is fully playable with StateTracker. Schema collections still present (duck-typing active). US1 complete.

---

## Phase 4: User Story 2 — Build Without @colyseus/schema (Priority: P2)

**Goal**: Remove all `@colyseus/schema` residuals so the project builds without the package

**Independent Test**: `rm -rf node_modules && npm install && npm run build` succeeds. `grep -r "@colyseus/schema" app/` returns zero matches.

### Step 3: Schema Collection Replacement

Replace `MapSchema<V>` → `Map<string, V>`, `SetSchema<T>` → `Set<T>`, `ArraySchema<T>` → `T[]` across all files. Order: models → core → utils → client.

- [ ] T005 [P] [US2] Replace 1,116 `SetSchema` → `Set` in `app/models/colyseus-models/pokemon.ts` (mechanical: `new SetSchema([...])` → `new Set([...])`)
- [ ] T006 [P] [US2] Replace Schema collections in `app/models/colyseus-models/player.ts` (3 MapSchema→Map, 12 ArraySchema→Array), `game-state.ts` (7 MapSchema→Map), `synergies.ts` (MapSchema→Map, SetSchema→Set), `tournament.ts` (5 MapSchema→Map, 8 ArraySchema→Array)
- [ ] T007 [P] [US2] Replace Schema collections in remaining `app/models/colyseus-models/` files: `after-game-player.ts` (5 ArraySchema→Array), `game-record.ts` (5 ArraySchema→Array), and other files with Schema collection usage
- [ ] T008 [P] [US2] Replace Schema collections in `app/core/` files: `simulation.ts` (9 MapSchema→Map), `pokemon-entity.ts` (5 SetSchema→Set), `mini-game.ts` (10 MapSchema→Map), `dps.ts`, and remaining core files
- [ ] T009 [P] [US2] Replace Schema collections in `app/models/pokemon-factory.ts`, `app/models/effects.ts`, `app/models/shop.ts`, `app/public/src/game-engine-phases.ts`, and client component files under `app/public/src/game/`
- [ ] T010 [US2] Build checkpoint: `npm run build` must pass after all collection replacements

### Step 4: Remove Decorators and Schema Inheritance

Remove all 318 `@type()` decorator lines, all 24 `extends Schema` → plain class, all `super()` calls. Keep constructor guards (`if (id === undefined) return`) as harmless dead code.

- [ ] T011 [P] [US2] Remove @type() decorators, `extends Schema`, and `super()` from all `app/models/colyseus-models/` files (18 files: pokemon.ts 34, status.ts 36, player.ts 53, count.ts 20, game-state.ts 20, tournament.ts 14, pokemon-avatar.ts 12, portal.ts 10, and others)
- [ ] T012 [P] [US2] Remove @type() decorators, `extends Schema`, and `super()` from all `app/core/` files (9 files: pokemon-entity.ts 40, simulation.ts 11, dps.ts 10, and others)

### Step 5: Update Utilities and Types

- [ ] T013 [US2] Rewrite `app/utils/schemas.ts` for native types: `keys()`/`values()`/`entries()` → thin wrappers over native methods (30+ call sites for `values()`), `resetArraySchema(arr, newArr)` → `arr.length = 0; arr.push(...newArr)`, delete `convertSchemaToRawObject()` (dead code — 0 call sites)
- [ ] T014 [P] [US2] Update `app/types/index.ts` — replace Schema collection type references with native TypeScript types (`Map`, `Set`, `Array`)
- [ ] T015 [US2] Remove all remaining `@colyseus/schema` imports from all 43 files — no import references should remain

### Step 6: Package Removal and Cleanup

- [ ] T016 [US2] Remove `@colyseus/schema` from `package.json` dependencies
- [ ] T017 [US2] Remove duck-typing dead code (constructor.name checks for `'MapSchema'`/`'SetSchema'`/`'ArraySchema'`) from `app/public/src/state-tracker.ts`
- [ ] T018 [US2] Final clean build verification: `rm -rf node_modules && npm install && npm run build`

**Checkpoint**: Zero `@colyseus/schema` references anywhere. Clean build passes. US2 complete.

---

## Phase 5: User Story 3 — Reduced Bundle Size (Priority: P3)

**Goal**: Verify measurable bundle size reduction from removing schema serialization layer

**Independent Test**: Compare `app/public/dist/client/` output size before and after

- [ ] T019 [P] [US3] Measure client bundle size from `app/public/dist/client/` and compare to pre-refactoring baseline (target: ≥50KB reduction per SC-004)
- [ ] T020 [P] [US3] Verify game startup time (page load → game ready) does not increase compared to pre-refactoring baseline

**Checkpoint**: Bundle size reduction confirmed. US3 complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across all user stories

- [ ] T021 Full manual play-test: complete game session (start → pick → battle × multiple rounds → end) after all changes
- [ ] T022 Validate quickstart.md developer scenarios (add Pokemon field, add collection, build & run)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — verify starting point
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 (StateTracker must exist)
- **US2 (Phase 4)**: Depends on Phase 3 (game must work before refactoring)
  - Step 3 → Step 4 → Step 5 → Step 6 (strictly sequential per plan.md)
- **US3 (Phase 5)**: Depends on Phase 4 (package must be removed to measure)
- **Polish (Phase 6)**: Depends on all phases complete

### Within Phase 4 (US2)

```
Step 3: T005 ─┐
       T006 ─┤
       T007 ─┼→ T010 (build checkpoint)
       T008 ─┤
       T009 ─┘
                  ↓
Step 4: T011 ─┬→ (build passes)
       T012 ─┘
                  ↓
Step 5: T013 ─┬→ T015 (remove imports)
       T014 ─┘
                  ↓
Step 6: T016 → T017 → T018 (clean build)
```

### Parallel Opportunities

- **Step 3**: T005–T009 can all run in parallel (different files, no cross-dependencies)
- **Step 4**: T011, T012 can run in parallel (different directories)
- **Step 5**: T013, T014 can run in parallel (different files)
- **Phase 5**: T019, T020 can run in parallel (independent measurements)

---

## Parallel Example: Step 3 (Collection Replacement)

```bash
# Launch all collection replacement tasks together:
Task: "Replace 1,116 SetSchema→Set in app/models/colyseus-models/pokemon.ts"
Task: "Replace Schema collections in player.ts, game-state.ts, synergies.ts, tournament.ts"
Task: "Replace Schema collections in remaining colyseus-models/ files"
Task: "Replace Schema collections in app/core/ files"
Task: "Replace Schema collections in factory, effects, shop, and client files"
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: StateTracker (T002)
3. Complete Phase 3: Wire + Play-test (T003–T004)
4. **STOP and VALIDATE**: Game plays identically with StateTracker
5. Proceed to US2 only after US1 is confirmed

### Incremental Delivery

1. T001–T002 → Foundation ready
2. T003–T004 → US1 complete: game works with StateTracker (MVP!)
3. T005–T018 → US2 complete: @colyseus/schema fully removed
4. T019–T020 → US3 complete: bundle size verified
5. T021–T022 → Polish: final validation

### Critical Path

```
T001 → T002 → T003 → T004 → T005..T009 → T010 → T011..T012 → T013..T015 → T016 → T017 → T018
```

The bottleneck is T002 (StateTracker, ~350 lines of new code) and T005 (pokemon.ts, 1,116 mechanical replacements). All other tasks are smaller mechanical changes.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Build must pass after each Step (3, 4, 5, 6) — see plan.md build gates
- Commit after each Step per Constitution Principle IV (atomic traceability)
- Commit format: `[spec-005] <type>: <description>`
- No test suite — verification is `npm run build` + manual play-test
- The 6 design constraints (C1–C6) from plan.md are critical for T002 (StateTracker) — implementer must read plan.md before starting
