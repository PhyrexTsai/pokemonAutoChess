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

As a developer, I can instantiate and run a complete battle simulation without any Colyseus Room, WebSocket connection, or network context. The Simulation accepts plain configuration objects, and each `update(dt)` call returns an array of typed battle events describing everything that happened during that tick.

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

3. **Given** a GameRoom calling `simulation.update(dt)`, **When** the returned array contains a simulation-end event, **Then** the GameRoom computes round damage, updates player HP, distributes income, ranks players, and broadcasts `Transfer.SIMULATION_STOP` — exactly as it does today.

4. **Given** a full game session (lobby → preparation → battle → results), **When** played through from start to finish, **Then** no observable difference exists in client behavior compared to the pre-refactoring version.

---

### User Story 3 - Schema Decorators Isolated from Game Logic (Priority: P3)

As a developer, the Colyseus `@type()` decorators and `Schema` inheritance remain only on thin networking wrapper classes, not on the core game logic classes. The core classes (Simulation, PokemonEntity, Dps) are plain TypeScript with no Colyseus imports.

**Why this priority**: This cleanly separates concerns so that Phase 4 (cleanup schemas) becomes a mechanical find-and-delete operation rather than a risky logic refactoring. It also makes the engine testable in isolation.

**Independent Test**: Run `grep -r "@colyseus/schema" app/core/` and verify zero results. The core directory has no Colyseus dependency.

**Acceptance Scenarios**:

1. **Given** the refactored `app/core/` directory, **When** searching for any import from `@colyseus/schema`, **Then** zero matches are found.

2. **Given** the refactored `app/core/simulation.ts`, **When** examining its class declaration, **Then** it does not extend `Schema` and has no `@type()` decorators.

3. **Given** the refactored `app/core/pokemon-entity.ts`, **When** examining its class declaration, **Then** it does not extend `Schema` and has no `@type()` decorators.

4. **Given** the refactored `app/core/dps.ts`, **When** examining its class declaration, **Then** it does not extend `Schema` and has no `@type()` decorators.

---

### Edge Cases

- What happens when ability events are produced during a simulation with no room context (single-player mode)? The events are returned in the `BattleEvent[]` array regardless; consumption is the caller's responsibility.
- What happens when weather effects (STORM lightning) trigger during simulation? `update(dt)` returns weather events in the array instead of broadcasting directly.
- What happens when a Pokemon spawns a clone/summon mid-battle? The Simulation handles entity creation internally and includes a spawn event in the returned array.
- What happens when fighting phase duration needs to be checked? The Simulation tracks its own elapsed time without accessing room state.
- What happens when `specialGameRule` is needed inside PokemonEntity? The Simulation receives game rules as configuration at construction time, not by reaching through room state.
- What happens when round damage needs to be computed at simulation end? This computation MUST either move into the Simulation or the simulation-end event includes enough data for the caller to compute it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The battle simulation engine (Simulation, PokemonEntity, PokemonState, Board, MovingState, AttackingState, DPS, Effects) MUST have zero imports from `@colyseus/schema` in any file under `app/core/`.
- **FR-002**: The `Simulation` class MUST NOT hold a reference to `GameRoom` or any network-layer object. It MUST accept only plain data at construction time.
- **FR-003**: The `PokemonEntity` class MUST NOT call `broadcastAbility()` with room access. Instead, ability usage MUST be appended to the Simulation's event buffer, returned by the next `update(dt)` call.
- **FR-004**: All 8 direct `room.broadcast()` calls in `simulation.ts` and all 6 indirect `room.broadcast()` calls in `pokemon-state.ts` MUST be replaced with event buffer appends.
- **FR-005**: The engine MUST define a `BattleEvent` discriminated union type covering all event categories: ability used, damage dealt, heal received, shield applied, entity spawned, entity died, weather effect triggered, simulation ended. The `update(dt)` method MUST return `BattleEvent[]` and clear the internal buffer after each call.
- **FR-006**: `MapSchema` usage in core engine files MUST be replaced with standard `Map<string, T>`. `ArraySchema` MUST be replaced with standard `Array<T>`.
- **FR-007**: The `Simulation` constructor MUST accept a plain configuration object containing team data, weather, stage level, game rules, and ghost battle flag — not Player or GameRoom instances. The class name `Simulation` is preserved; no renaming.
- **FR-008**: The existing GameRoom MUST be adapted to call `simulation.update(dt)`, iterate over the returned `BattleEvent[]`, and broadcast each event to clients — preserving all current client-facing behavior.
- **FR-009**: The `Dps` class MUST be a plain TypeScript class without Schema inheritance while maintaining its current tracking functionality.
- **FR-010**: `pokemon-state.ts` MUST NOT access `pokemon.simulation.room` for time checks or broadcasts. Fighting phase duration MUST be tracked within the Simulation itself.
- **FR-011**: The `effect.ts` interfaces MUST NOT reference `GameRoom` type. Effect arguments MUST use engine-internal types only.
- **FR-012**: The application MUST build successfully (`npm run build`) after each incremental change, per the constitution's Atomic Traceability principle.

### Key Entities

- **Simulation**: The existing class, refactored in-place. Stripped of `extends Schema` and `room: GameRoom`. Accepts plain config, runs the update loop, accumulates events in an internal buffer, returns `BattleEvent[]` from each `update(dt)` call.
- **BattleEvent**: A discriminated union type representing all observable simulation outcomes (ability, damage, heal, shield, spawn, death, weather, end). Replaces direct `room.broadcast()` calls.
- **SimulationConfig**: Plain data object passed to Simulation constructor. Contains teams, weather, stage level, game rules. Replaces the current constructor's GameRoom/Player parameters. (Name subject to planning phase.)
- **PokemonEntity**: Battle unit with state machine (Moving/Attacking/Idle). Refactored to remove Schema inheritance and room access. Appends events to its parent Simulation's buffer instead of broadcasting.
- **Dps**: Damage/heal tracking data class. Refactored to remove Schema inheritance.

### Assumptions

- The `MapSchema` → `Map` replacement is API-compatible for all usage patterns in the core engine (iteration, get, set, delete, size). This will be verified during implementation.
- `room.computeRoundDamage()` logic can be extracted as a pure function that takes team data and stage level, since it performs a calculation without side effects.
- The existing `@type()` decorators on Colyseus model files (`app/models/colyseus-models/`) are NOT removed in this phase — they remain as-is for the networking wrapper. Phase 4 handles their removal.
- The Phaser client rendering is NOT modified in this phase. It continues to receive data via Colyseus Schema sync from the GameRoom wrapper. Phase 2 changes the client data source.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A battle simulation can be instantiated and run to completion without any network context — `new Simulation(config)` followed by repeated `update(dt)` calls returns `BattleEvent[]` arrays and eventually a battle-end event.
- **SC-002**: Zero files under `app/core/` import from `@colyseus/schema` after refactoring (currently 8 files do).
- **SC-003**: The multiplayer game is functionally identical before and after the refactoring — same battle outcomes, same client-visible events, same animations and damage numbers.
- **SC-004**: Every incremental change compiles successfully (`npm run build` passes at every commit).
- **SC-005**: All 14 direct and indirect `room.broadcast()` / `client.send()` calls in the core engine are replaced with event buffer appends returned via `update(dt)`.
- **SC-006**: The Simulation constructor accepts only plain data — no class instances from the networking layer (GameRoom, Player, MapSchema).
