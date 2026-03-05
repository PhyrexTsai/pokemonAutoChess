# Tasks: Extract Game Engine from Colyseus Schema

**Input**: Design documents from `/specs/001-extract-game-engine/`
**Prerequisites**: plan.md, spec.md, data-model.md, research.md, quickstart.md
**Tests**: Included (user requested: "需要撰寫測試來確保結果正確")

**Organization**: Tasks follow plan.md's implementation order (US2 → US3 → US1), which differs from priority order (US1 → US2 → US3), because US1 (standalone mode) requires US3's broadcast replacements to be complete first.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All file paths are relative to repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Testing framework and type definitions that all stories depend on

- [x] T001 Install Vitest as devDependency, add `"test": "vitest run"` to scripts in `package.json`
- [x] T002 [P] Create `BattleEvent` discriminated union type (9 variants) in `app/types/BattleEvent.ts` per data-model.md

**Build gate**: `npm run build` passes

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Event buffer infrastructure and pure function extraction — MUST complete before any user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T003 Add `private events: BattleEvent[]`, `pushEvent()`, `private elapsedTime: number` to Simulation; modify `update(dt)` to drain buffer and return `BattleEvent[]` in `app/core/simulation.ts`
- [ ] T004 Extract `computeRoundDamage()` as pure function to `app/core/compute-round-damage.ts` (10 lines); update import and call site in `app/core/simulation.ts` (line 1584)
- [x] T005 Cache `specialGameRule` from `this.room.state.specialGameRule` as Simulation property in constructor; replace `this.simulation.room.state.specialGameRule` access in `app/core/pokemon-entity.ts` (line 1273) with `this.simulation.specialGameRule`

**Build gate**: `npm run build` passes — update() returns empty arrays, existing broadcasts still work

**Checkpoint**: Foundation ready — event buffer exists, pure function extracted, specialGameRule cached

---

## Phase 3: User Story 2 — GameRoom Consumes Simulation Events (Priority: P2)

**Goal**: GameRoom processes returned `BattleEvent[]` and broadcasts to clients, preserving identical multiplayer behavior

**Independent Test**: Run multiplayer game, verify ability animations, damage numbers, heal effects, battle results display identically to pre-refactoring

**Why P2 implemented first**: `processBattleEvent()` MUST exist before Phase 4 replaces broadcasts (plan Step 5 note: "MUST come before Steps 6-8 so there is a consumer ready")

### Implementation for User Story 2

- [ ] T006 [US2] Implement `processBattleEvent(event: BattleEvent, simulation: Simulation)` method on GameRoom with switch for all 9 event types in `app/rooms/game-room.ts` — handle field name conversions (attackType→type, healType→type), format conversions (PLAYER_INCOME/DAMAGE as raw numbers via client.send), and ABILITY routing (spectator client filtering)
- [ ] T007 [US2] Wire `OnUpdateCommand` to capture `simulation.update(deltaTime)` return value and call `this.room.processBattleEvent()` for each event in `app/rooms/commands/game-commands.ts` (line 1039)

**Build gate**: `npm run build` passes — processBattleEvent exists but no events flow yet (buffer is empty)

**Checkpoint**: GameRoom adapter ready — events will flow once broadcasts are replaced in Phase 4

---

## Phase 4: User Story 3 — GameRoom Dependency Removed from Core (Priority: P3)

**Goal**: Zero `room.broadcast()`, `room.clients`, `room.state.time` in core simulation loop files (`simulation.ts`, `pokemon-state.ts`, `board.ts`, `pokemon-entity.ts`)

**Independent Test**: `grep -rn "room\.broadcast\|room\.clients" app/core/` returns zero matches

### Implementation for User Story 3

- [ ] T008 [P] [US3] Replace 7 remaining room operations in `app/core/simulation.ts` with pushEvent/direct calls (1 of 8 already handled by T004 at line 1584): 5 `room.broadcast()` at lines 750, 1432, 1475, 1740, 1749 → `pushEvent()`; `room.clients.find()` at line 1565 → PLAYER_INCOME/PLAYER_DAMAGE events; `room.rankPlayers()` at line 1623 → processBattleEvent calls `this.rankPlayers()` when receiving SIMULATION_END (event already includes roundDamage/weather per data-model.md)
- [ ] T009 [P] [US3] Replace 3 `simulation.room.broadcast()` calls in `app/core/board.ts` with `simulation.pushEvent()`: line 522 (BOARD_EVENT), line 548 (CLEAR_BOARD_EVENT), line 560 (CLEAR_BOARD_EVENT with null effect)
- [ ] T010 [P] [US3] Replace 6 room references in `app/core/pokemon-state.ts`: 3 `room.broadcast()` at lines 330, 367, 728 → `pokemon.simulation.pushEvent()`; 3 `room.state.time` at lines 329, 366, 957 → `pokemon.simulation.elapsedTime`
- [ ] T011 [US3] Replace `broadcastAbility()` body in `app/core/pokemon-entity.ts` (lines 1686-1711) with `this.simulation.pushEvent({ type: "ABILITY", ... })` — move client filtering logic to GameRoom's processBattleEvent (T006)
- [ ] T012 [US3] Remove `room: GameRoom` from `OnStageStartEffectArgs` and `OnItemDroppedEffectArgs` interfaces in `app/core/effects/effect.ts` — replace with `simulation: ISimulation` where effect implementations need simulation access, or remove parameter entirely if unused

**Build gate**: `npm run build` passes — events now flow through buffer → processBattleEvent → clients

**Checkpoint**: Core simulation loop files have zero room.broadcast/room.clients/room.state.time — US3 acceptance scenario 1 verifiable via grep

---

## Phase 5: User Story 1 — Simulation Runs Without Network Context (Priority: P1) 🎯 MVP

**Goal**: Simulation can be instantiated and run to completion without GameRoom — `new Simulation(config)` + `update(dt)` returns `BattleEvent[]`

**Independent Test**: Create Simulation in test without room, call `update(16)` in loop, verify events returned and battle completes

**Why P1 implemented last**: Standalone mode requires all broadcast replacements (Phase 4) to be complete — otherwise room access in simulation.ts/pokemon-state.ts/board.ts would crash when room is undefined

### Implementation for User Story 1

- [ ] T013 [US1] Add 5 null guards (`if (!...simulation.room) return`) to 8 room references: `app/core/abilities/abilities.ts` before lines 291 and 13519; `app/core/abilities/hidden-power.ts` before lines 112 and 405; `app/core/effects/synergies.ts` before line 216 — guards compile as redundant while room is still required, enabling T014 to make room optional without breaking build
- [ ] T014 [US1] Make `room` optional (`room?: GameRoom`) on Simulation, move to last constructor param position, promote `specialGameRule` to constructor param (replacing cache from T005), remove `delete this.room` (line 1477), update `ISimulation` interface in `app/types/index.ts` (lines 359-374) in `app/core/simulation.ts`
- [ ] T015 [US1] Update Simulation constructor calls in `app/rooms/commands/game-commands.ts` (lines 1931, 1986): add `specialGameRule` argument, pass `this.room` as final optional `room` argument
- [ ] T016 [US1] Define `ISimulationPlayer` interface (20 fields/methods per data-model.md) in `app/types/interfaces/`; change Simulation constructor player parameter types from `Player` to `ISimulationPlayer` in `app/core/simulation.ts`

**Build gate**: `npm run build` passes — Simulation is now instantiable without GameRoom

### Tests for User Story 1

- [ ] T017 [P] [US1] Write `computeRoundDamage()` unit tests in `app/core/__tests__/compute-round-damage.test.ts` — test cases: empty team, team with spawns (excluded), standard team, stage level scaling (~30 lines)
- [ ] T018 [US1] Write Simulation event generation integration test in `app/core/__tests__/simulation-events.test.ts` — mock `ISimulationPlayer` objects, 1v1 Pokemon battle, verify `update(dt)` returns non-empty `BattleEvent[]`, verify SIMULATION_END emitted when team eliminated. Use simple Pokemon only (avoid MIND_BLOWN, MAGNET_PULL, UNOWN, FIELD synergy). (~100-120 lines)

**Build gate**: `npm run build` passes, `npx vitest run` passes

**Checkpoint**: US1 fully functional — Simulation runs standalone, events returned, tests verify correctness

---

## Phase 6: Polish & Validation

**Purpose**: Cross-cutting validation ensuring all stories work together

- [ ] T019 Run `npm run build` to verify full compilation (quickstart.md Scenario 1)
- [ ] T020 Run quickstart.md Scenario 4 grep validation: `grep -rn "room\.broadcast\|room\.clients" app/core/` (expect 0), `grep -rn "\.room\." app/core/` (expect exactly 8 matches in abilities.ts/hidden-power.ts/synergies.ts)
- [ ] T021 Run `npx vitest run` to verify all tests pass (quickstart.md Scenarios 2-3)
- [ ] T022 Manual multiplayer test: `npm run dev`, play through battle phase, verify identical behavior (quickstart.md Scenario 5)

**Checkpoint**: All quickstart.md validation scenarios pass — feature complete

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1: Setup ─────────────────┐
                                 ├─→ Phase 2: Foundational ─→ Phase 3: US2 ─→ Phase 4: US3 ─→ Phase 5: US1 ─→ Phase 6: Polish
Phase 1 tasks can run in parallel┘
```

- **Setup (Phase 1)**: No dependencies — T001 ∥ T002
- **Foundational (Phase 2)**: Depends on Phase 1 — T003 → T004 → T005 (all touch simulation.ts, sequential)
- **US2 (Phase 3)**: Depends on Phase 2 — processBattleEvent must exist before broadcasts are replaced
- **US3 (Phase 4)**: Depends on Phase 3 — T008 ∥ T009 ∥ T010 (different files), then T011, T012
- **US1 (Phase 5)**: Depends on Phase 4 — T013 → T014 (null guards before room optional), then T015, T016, T017 ∥ T018
- **Polish (Phase 6)**: Depends on Phase 5 — T019 → T020 → T021 → T022

### Why Implementation Order ≠ Priority Order

| Priority | User Story | Implementation Phase | Reason |
|----------|-----------|---------------------|--------|
| P1 (highest) | US1: Standalone Mode | Phase 5 (last) | Requires all broadcasts replaced (US3) before room can be optional |
| P2 | US2: GameRoom Adapter | Phase 3 (first) | Must exist before broadcasts are replaced to maintain multiplayer |
| P3 | US3: Remove Room from Core | Phase 4 (middle) | The actual broadcast replacement work |

### Within Each Phase

- Sequential tasks in same file (no [P] marker): execute in order
- Parallel tasks ([P] marker): different files, can run concurrently
- Build gate after every task (`npm run build` must pass)

### Parallel Opportunities

**Phase 1**: T001 ∥ T002 (package.json ∥ new type file)
**Phase 4**: T008 ∥ T009 ∥ T010 (simulation.ts ∥ board.ts ∥ pokemon-state.ts)
**Phase 5 tests**: T017 ∥ T018 (pure function test ∥ integration test)

---

## Parallel Example: Phase 4 (US3)

```bash
# These 3 tasks modify different files and can run in parallel:
T008: "Replace 7 remaining room operations in app/core/simulation.ts"
T009: "Replace 3 simulation.room.broadcast() in app/core/board.ts"
T010: "Replace 6 room references in app/core/pokemon-state.ts"

# Then sequential:
T011: "Replace broadcastAbility() in app/core/pokemon-entity.ts"
T012: "Remove GameRoom from app/core/effects/effect.ts"
```

---

## Implementation Strategy

### MVP First (US2 + US3 + US1)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003-T005)
3. Complete Phase 3: US2 — GameRoom adapter ready (T006-T007)
4. Complete Phase 4: US3 — Broadcasts replaced, core clean (T008-T012)
5. Complete Phase 5: US1 — Standalone mode works (T013-T018)
6. **STOP and VALIDATE**: Run all quickstart.md scenarios (T019-T022)

### Incremental Delivery

Each phase adds value and the build passes at every step:
1. After Phase 2 → Event buffer infrastructure exists, no behavior change
2. After Phase 3 → GameRoom adapter ready, no behavior change yet
3. After Phase 4 → Events flow through buffer → adapter → clients (multiplayer works identically)
4. After Phase 5 → Simulation runs standalone + tests verify correctness
5. After Phase 6 → Full validation complete, ready for Phase 2 of the roadmap

### Commit Strategy

One commit per task (per constitution's Atomic Traceability principle). Each commit:
- Passes `npm run build`
- Does not break multiplayer
- Has a clear, descriptive message: `[spec-001] <type>: T0XX description` (per constitution format)

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in same phase
- [Story] label maps task to specific user story for traceability
- Every task must pass `npm run build` before proceeding (FR-012)
- Multiplayer must keep working at every step (SC-003)
- The 5 null-guarded abilities (MIND_BLOWN, MAGNET_PULL, UNOWN F, UNOWN W, FIELD synergy) silently skip in standalone mode — Phase 2 of the roadmap handles their full removal
- Schema inheritance (`extends Schema`, `@type()`) temporarily retained — Phase 4 of the roadmap handles removal
