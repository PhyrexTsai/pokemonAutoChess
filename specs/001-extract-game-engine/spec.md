# Feature Specification: Extract Game Engine from Colyseus Schema

**Feature Branch**: `001-extract-game-engine`
**Created**: 2026-03-05
**Status**: Draft
**Input**: Phase 0 of multiplayer → single-player refactoring. Decouple the battle simulation engine from Colyseus Schema inheritance and GameRoom dependencies so it can run independently.

## Clarifications

### Session 2026-03-05

- Q: Event delivery mechanism — synchronous return array, EventEmitter, or callback injection? → A: `update(dt)` synchronously returns `BattleEvent[]`. Caller processes the returned array each frame.
- Q: Refactoring strategy — rename Simulation to BattleEngine, keep name, or strangler fig wrapper? → A: Keep `Simulation` class name. Refactor in-place by stripping Schema inheritance. No renaming, no wrapper class.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Simulation Runs Without Network Context (Priority: P1)

As a developer, I can instantiate and run a complete battle simulation without any Colyseus Room, WebSocket connection, or network context. The Simulation accepts `ISimulationPlayer` interfaces and configuration parameters, and each `update(dt)` call returns an array of typed battle events describing everything that happened during that tick.

**Why this priority**: This is the foundation of the entire single-player migration. Nothing else can proceed until the engine is self-contained. If Simulation still requires a GameRoom to function, Phase 2 (remove Colyseus) and Phase 4 (cleanup schemas) are blocked.

**Independent Test**: Create a Simulation instance with two team configurations, call `update(16)` in a loop, and verify it returns correct BattleEvent arrays (damage dealt, abilities used, deaths, winner determined) without throwing errors about missing room/broadcast/client references.

**Acceptance Scenarios**:

1. **Given** two team configurations (blue: 3 Pokemon, red: 3 Pokemon), **When** a new Simulation is instantiated with these configurations and `update(16)` is called repeatedly, **Then** each call returns a `BattleEvent[]` describing combat actions for that tick, and eventually a call returns a battle-end event with a winner, without referencing any network objects.

2. **Given** a simulation running a battle, **When** a Pokemon uses an ability, **Then** `update(dt)` returns an ability event in its `BattleEvent[]` containing skill ID, position, orientation, and target — instead of calling `room.broadcast()`.

3. **Given** a simulation running a battle, **When** a Pokemon takes damage, heals, or gains a shield, **Then** `update(dt)` returns corresponding damage/heal/shield events in its `BattleEvent[]` — instead of calling `room.broadcast()`.

4. **Given** a simulation that completes a battle, **When** one team is eliminated, **Then** `update(dt)` returns a simulation-end event with winner ID, round damage, and final DPS stats — instead of calling `room.rankPlayers()` or `client.send()`.

---

### User Story 2 - GameRoom Consumes Simulation Events (Priority: P2)

As a developer maintaining the multiplayer version during the transition period, I can wire the GameRoom to call `simulation.update(dt)`, iterate over the returned `BattleEvent[]`, and relay each event to clients via Colyseus broadcast, preserving all existing multiplayer behavior identically.

**Why this priority**: This ensures backward compatibility during the refactoring. The multiplayer game must continue to work while we extract the engine. Breaking multiplayer before single-player is ready would leave us with nothing working.

**Independent Test**: Run the existing multiplayer game after the refactoring. Start a battle between two players. Verify that ability animations, damage numbers, heal effects, and battle results display identically to the pre-refactoring version.

**Acceptance Scenarios**:

1. **Given** a GameRoom calling `simulation.update(dt)`, **When** the returned array contains an ability event, **Then** the GameRoom translates it into a `Transfer.ABILITY` broadcast that clients receive in the same format as before.

2. **Given** a GameRoom calling `simulation.update(dt)`, **When** the returned array contains damage/heal/shield events, **Then** the GameRoom translates them into `Transfer.POKEMON_DAMAGE` and `Transfer.POKEMON_HEAL` broadcasts identical to the current format.

3. **Given** a GameRoom calling `simulation.update(dt)`, **When** the returned array contains a simulation-end event, **Then** the GameRoom reads round damage from the event, applies it to player HP, distributes income, ranks players, and broadcasts `Transfer.SIMULATION_STOP` — preserving identical client-facing behavior.

4. **Given** a full game session (lobby → preparation → battle → results), **When** played through from start to finish, **Then** no observable difference exists in client behavior compared to the pre-refactoring version.

---

### User Story 3 - GameRoom Dependency Fully Removed from Core (Priority: P3)

As a developer, the `app/core/` simulation loop files (`simulation.ts`, `pokemon-state.ts`, `board.ts`, `pokemon-entity.ts`) have zero `room.broadcast()`, `room.clients`, or `room.state.time` references. The engine is testable in isolation without any network context. 8 null-guarded room references remain in ability/synergy files for 5 abilities (MIND_BLOWN delayed effect, MAGNET_PULL shop/spawn, UNOWN F fishing, UNOWN W evolution check, FIELD synergy delay) — these silently skip when room is absent and are fully removed in Phase 2. Schema inheritance (`extends Schema`) and `@type()` decorators are temporarily retained for Colyseus auto-sync backward compatibility — their full removal is deferred to Phase 4.

**Why this priority**: Removing room access from the core simulation loop is the actual decoupling that enables single-player mode. The 8 remaining ability references are edge cases that don't affect core battle flow. Schema inheritance is inert — it doesn't prevent standalone execution. Phase 4 handles Schema stripping after the client no longer depends on it.

**Independent Test**: Run `grep -rn "room\.broadcast\|room\.clients" app/core/` and verify zero matches. Run `grep -rn "\.room\." app/core/` and verify only 8 matches remain, all in `abilities/abilities.ts` (3), `abilities/hidden-power.ts` (4), and `effects/synergies.ts` (1), all with null guards.

**Acceptance Scenarios**:

1. **Given** the refactored `app/core/` directory, **When** searching for `room.broadcast` or `room.clients`, **Then** zero matches are found. **When** searching for `.room.`, **Then** only 8 matches remain in ability/synergy files (3 in abilities.ts, 4 in hidden-power.ts, 1 in synergies.ts), all null-guarded.

2. **Given** the refactored `app/core/simulation.ts`, **When** examining its constructor, **Then** `room` is an optional parameter (`room?: GameRoom`) at the end of the signature, not a required dependency.

3. **Given** the refactored `app/core/pokemon-entity.ts`, **When** examining `broadcastAbility()`, **Then** it appends to the Simulation's event buffer instead of iterating `room.clients`.

4. **Given** the refactored `app/core/pokemon-state.ts`, **When** examining time checks, **Then** it uses `simulation.elapsedTime` instead of `room.state.time`.

---

### Edge Cases

- What happens when ability events are produced during a simulation with no room context (single-player mode)? The events are returned in the `BattleEvent[]` array regardless; consumption is the caller's responsibility.
- What happens when weather effects (STORM lightning) trigger during simulation? `update(dt)` returns weather events in the array instead of broadcasting directly.
- What happens when a Pokemon spawns a clone/summon mid-battle? The Simulation handles entity creation internally and includes a spawn event in the returned array.
- What happens when fighting phase duration needs to be checked? The Simulation tracks its own elapsed time without accessing room state.
- What happens when `specialGameRule` is needed inside PokemonEntity? The Simulation receives game rules as configuration at construction time, not by reaching through room state.
- What happens when round damage needs to be computed at simulation end? This computation MUST either move into the Simulation or the simulation-end event includes enough data for the caller to compute it.
- What happens when room-dependent abilities (MIND_BLOWN, MAGNET_PULL, UNOWN F, UNOWN W, FIELD synergy) trigger in standalone mode (no room)? The null guard checks `if (!simulation.room) return` — the ability effect silently skips. Core battle (damage, movement, other abilities) is unaffected. These abilities are fully implemented in Phase 2.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All `room.broadcast()`, `client.send()`, `room.clients`, and `room.state.time` access MUST be removed from files under `app/core/`. Exception: 8 room references in `abilities/abilities.ts` (3), `abilities/hidden-power.ts` (4 — lines 112 and 115 are the same `pickFish()` call spanning multiple lines), and `effects/synergies.ts` (1) are null-guarded and retained for multiplayer backward compatibility — these access `room.clock`, `room.state.shop`, room spawn methods, and `room.checkEvolutions` for 5 abilities (MIND_BLOWN delayed effect, MAGNET_PULL, UNOWN F fishing, UNOWN W evolution check, FIELD synergy delay). Full removal deferred to Phase 2 when Colyseus is removed entirely. Note: `@colyseus/schema` imports for `extends Schema` and `@type()` decorators are temporarily retained for Colyseus auto-sync backward compatibility; full removal is deferred to Phase 4 after the client data source changes.
- **FR-002**: The `Simulation` class MUST NOT REQUIRE a `GameRoom` to function. An optional `room?: GameRoom` reference is retained for 5 abilities that access clock, shop, spawn, and evolution-check methods across the simulation boundary (MIND_BLOWN, MAGNET_PULL, UNOWN F, UNOWN W, FIELD synergy). These abilities silently skip when room is absent (standalone/test mode). Full removal of the optional room reference is deferred to Phase 2.
- **FR-003**: The `PokemonEntity` class MUST NOT call `broadcastAbility()` with room access. Instead, ability usage MUST be appended to the Simulation's event buffer, returned by the next `update(dt)` call.
- **FR-004**: All 8 room operations in `simulation.ts` (5 `room.broadcast()`, 1 `room.clients.find()`, 1 `room.computeRoundDamage()`, 1 `room.rankPlayers()`), all 6 room references in `pokemon-state.ts` (3 `room.broadcast()`, 3 `room.state.time` accesses), and all 3 room broadcasts in `board.ts` (1 `Transfer.BOARD_EVENT`, 2 `Transfer.CLEAR_BOARD_EVENT` via `simulation.room.broadcast()`) MUST be replaced with event buffer appends or engine-internal equivalents.
- **FR-005**: The engine MUST define a `BattleEvent` discriminated union type covering all 9 event categories: ability used (`ABILITY`), damage dealt (`POKEMON_DAMAGE`), heal received (`POKEMON_HEAL`), board effect (`BOARD_EVENT`), clear board (`CLEAR_BOARD`), clear board effect (`CLEAR_BOARD_EVENT`), simulation ended (`SIMULATION_END`), player income (`PLAYER_INCOME`), player damage (`PLAYER_DAMAGE`). `CLEAR_BOARD` and `CLEAR_BOARD_EVENT` are distinct Transfer enums with different payloads. The `update(dt)` method MUST return `BattleEvent[]` and clear the internal buffer after each call.
- **FR-006**: `MapSchema` and `ArraySchema` replacement in core engine files is deferred to Phase 4. These types are required for Colyseus `@type()` decorators and auto-sync. Phase 0 focuses on removing `GameRoom` dependency; collection type replacement follows Schema stripping.
- **FR-007**: The `Simulation` constructor MUST NOT REQUIRE `GameRoom` to function. `GameRoom` MAY be passed as an optional parameter (`room?: GameRoom`) for backward compatibility with 5 abilities that access clock, shop, spawn, and evolution-check methods — these silently skip when room is absent. Player parameters MUST be typed as `ISimulationPlayer` (a narrow interface satisfied by the existing Player class via structural typing). The constructor also accepts weather, stage level, game rules, and ghost battle flag. The class name `Simulation` is preserved; no renaming.
- **FR-008**: The existing GameRoom MUST be adapted to call `simulation.update(dt)`, iterate over the returned `BattleEvent[]`, and broadcast each event to clients — preserving all current client-facing behavior.
- **FR-009**: The `Dps` class Schema inheritance removal is deferred to Phase 4. The class has no `room` access and is a pure data container; Schema stripping is low risk but belongs in the same batch as Simulation/PokemonEntity Schema removal.
- **FR-010**: `pokemon-state.ts` MUST NOT access `pokemon.simulation.room` for time checks or broadcasts. Fighting phase duration MUST be tracked within the Simulation itself.
- **FR-011**: The `effect.ts` interfaces MUST NOT reference `GameRoom` type. Effect arguments MUST use engine-internal types only.
- **FR-012**: The application MUST build successfully (`npm run build`) after each incremental change, per the constitution's Atomic Traceability principle.

### Key Entities

- **Simulation**: The existing class, refactored in-place. `room` changed from required to optional (`room?: GameRoom`) — retained for 5 abilities that access clock, shop, spawn, and evolution-check methods. Accepts `ISimulationPlayer` and configuration params. Runs the update loop, accumulates events in an internal buffer, returns `BattleEvent[]` from each `update(dt)` call. `extends Schema` temporarily retained for Colyseus auto-sync (Phase 4 removal). Optional room fully removed in Phase 2.
- **BattleEvent**: A discriminated union type representing all observable simulation outcomes (ability, damage, heal, board effect, simulation end, player income/damage). Replaces direct `room.broadcast()` calls.
- **ISimulationPlayer**: Narrow interface satisfied by the existing Player class via structural typing. Defines the fields and methods Simulation actually accesses during battle and onFinish.
- **PokemonEntity**: Battle unit with state machine (Moving/Attacking/Idle). Room access removed; appends events to its parent Simulation's buffer instead of broadcasting. `extends Schema` temporarily retained (Phase 4 removal).
- **Dps**: Damage/heal tracking data class. Schema removal deferred to Phase 4 (no room access, pure data).

### Assumptions

- The `MapSchema` → `Map` replacement is API-compatible for all usage patterns in the core engine (iteration, get, set, delete, size). This will be verified during implementation.
- `room.computeRoundDamage()` logic can be extracted as a pure function that takes team data and stage level, since it performs a calculation without side effects.
- The existing `@type()` decorators on Colyseus model files (`app/models/colyseus-models/`) are NOT removed in this phase — they remain as-is for the networking wrapper. Phase 4 handles their removal.
- The Phaser client rendering is NOT modified in this phase. It continues to receive data via Colyseus Schema sync from the GameRoom wrapper. Phase 2 changes the client data source.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A battle simulation can be instantiated and run to completion without any network context — `new Simulation(config)` followed by repeated `update(dt)` calls returns `BattleEvent[]` arrays and eventually a battle-end event.
- **SC-002**: Zero `room.broadcast()`, `room.clients`, or `room.state.time` calls remain in `app/core/` after refactoring. Exception: 8 null-guarded room references in `abilities.ts` (3), `hidden-power.ts` (4 — lines 112 and 115 are the same `pickFish()` call), `synergies.ts` (1) access `room.clock`/`room.state.shop`/room spawn/`room.checkEvolutions` methods for 5 abilities — these silently skip when room is absent. Note: `@colyseus/schema` imports for Schema inheritance and `@type()` decorators are temporarily retained; full removal is deferred to Phase 4.
- **SC-003**: The multiplayer game is functionally identical before and after the refactoring — same battle outcomes, same client-visible events, same animations and damage numbers.
- **SC-004**: Every incremental change compiles successfully (`npm run build` passes at every commit).
- **SC-005**: All 17 room operations in `simulation.ts` (8), `pokemon-state.ts` (6), and `board.ts` (3) — including broadcasts, `room.clients`, `room.state`, and room method calls — are replaced with event buffer appends or engine-internal equivalents, returned via `update(dt)`.
- **SC-006**: The Simulation constructor does not REQUIRE a `GameRoom` instance. `GameRoom` is an optional parameter (`room?: GameRoom`) retained for 5 abilities — silently skipped when absent. Player parameters are typed as `ISimulationPlayer` (narrow interface). The existing Player class satisfies this interface via structural typing — zero call-site changes in GameRoom.
