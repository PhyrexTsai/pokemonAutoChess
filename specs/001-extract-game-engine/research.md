# Research: Extract Game Engine from Colyseus Schema

## R1: MapSchema → Map Compatibility

**Decision**: MapSchema CAN be replaced with Map for method calls, but CANNOT be stripped from Simulation/PokemonEntity in Phase 0 without breaking Colyseus auto-sync.

**Rationale**: All MapSchema methods used in `app/core/` (`.get()`, `.set()`, `.delete()`, `.forEach()`, `.size`) are standard Map methods. However, `GameRoom.state.simulations` is `MapSchema<Simulation>` — Colyseus requires Simulation to extend Schema for auto-sync to clients. Clients read Pokemon positions, HP, and status effects via Schema sync during battle. Stripping Schema without changing the client (Phase 2) would break rendering.

**Alternatives considered**:
- Create Schema wrapper classes that mirror engine state → Violates "minimal change" constraint, adds ~500 lines of new wrapper code
- Keep Schema inheritance temporarily → Pragmatic, zero client impact, deferred to Phase 4

**Impact on spec**: FR-001 (zero @colyseus/schema in core) and SC-002 are partially deferred. The `room` dependency (the real coupling) is made optional (`room?: GameRoom`) — 8 room references in ability/synergy files are null-guarded, full removal deferred to Phase 2. Schema decoration remains as inert inheritance until Phase 4.

## R2: computeRoundDamage() Extractability

**Decision**: Extract as standalone pure function.

**Rationale**: The method is 10 lines, takes `(opponentTeam, stageLevel)`, returns a number. Zero side effects, zero room state access. Only dependency is the `Passive` enum. Perfect extraction target and first test candidate.

**Implementation**:
```typescript
// app/core/compute-round-damage.ts
export function computeRoundDamage(
  opponentTeam: Map<string, IPokemonEntity>,
  stageLevel: number
): number {
  let damage = Math.ceil(stageLevel / 2)
  opponentTeam.forEach((pokemon) => {
    if (!pokemon.isSpawn && pokemon.passive !== Passive.INANIMATE) {
      damage += 1
    }
  })
  return damage
}
```

## R3: Player Data Surface for SimulationConfig

**Decision**: Define a `ISimulationPlayer` interface that narrows the Player type. GameRoom passes Player objects which satisfy the interface via structural typing — zero call-site changes.

**Rationale**: Simulation reads from Player during battle (`id`, `effects`, `items`, `synergies`, `board`) and writes during `onFinish()` (`life`, `addMoney()`, `addBattleResult()`, etc.). Defining an interface decouples the import without changing behavior.

**Fields needed** (see data-model.md for definitive ISimulationPlayer interface):
- Constructor: `id`, `simulationId`, `board` (for spawning), `effects` (team effects)
- Battle: `items` (item conditionals), `synergies` (synergy checks), `titles`, `pokemonsPlayed`
- onFinish: `life`, `opponentId`, `opponentName`, `opponentAvatar`, `weatherRocks`, `totalPlayerDamageDealt`, `addBattleResult()`, `addMoney()`, `completeMissionOrder()`, `updateWeatherRocks()`

**Why not pure data**: Simulation mutates Player fields in `onFinish()`. Making it pure (return data, caller mutates) is ideal but NOT minimal — it requires restructuring 150+ lines of onFinish logic. Deferred to future cleanup.

## R4: Testing Infrastructure

**Decision**: Add Vitest as dev dependency. Minimal setup.

**Rationale**: Zero test infrastructure exists. Vitest is TypeScript-first, works with existing tsconfig, no config file required for basic usage. One `npm install -D vitest` and one npm script addition.

**Alternatives considered**:
- Jest: Heavier, needs ts-jest or babel config, slower
- Node assert + ts-node: Works but no watch mode, poor DX
- Colyseus testing (@colyseus/testing already installed): Only useful for room-level tests, not engine unit tests

## R5: specialGameRule Access Pattern

**Decision**: Pass as constructor parameter on Simulation.

**Rationale**: Currently accessed via `this.simulation.room.state.specialGameRule` in PokemonEntity (line 1273). Only read, never written during battle. Pass once at construction, store as `this.specialGameRule`.

## R6: Time Tracking

**Decision**: Add internal elapsed time counter to Simulation.

**Rationale**: `pokemon-state.ts` checks `pokemon.simulation.room.state.time < FIGHTING_PHASE_DURATION` to decide whether to emit damage/heal events. The Simulation already receives `dt` on each update — accumulate it internally as `this.elapsedTime += dt`.
