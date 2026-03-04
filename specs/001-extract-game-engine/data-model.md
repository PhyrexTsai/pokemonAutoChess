# Data Model: Extract Game Engine

## New Types

### BattleEvent (discriminated union)

```typescript
type BattleEvent =
  | { type: "ABILITY"; id: string; skill: Ability | string; positionX: number; positionY: number; orientation?: Orientation; targetX?: number; targetY?: number; delay?: number; ap?: number }
  | { type: "POKEMON_DAMAGE"; index: string; attackType: AttackType; amount: number; x: number; y: number; id: string }
  | { type: "POKEMON_HEAL"; index: string; healType: HealType; amount: number; x: number; y: number; id: string }
  | { type: "BOARD_EVENT"; simulationId: string; x: number; y: number; effect: Effect }
  | { type: "CLEAR_BOARD"; simulationId: string }
  | { type: "CLEAR_BOARD_EVENT"; simulationId: string; effect: BoardEffect | null; x: number; y: number }
  | { type: "SIMULATION_END"; visibleSimulationId: string; visibleBluePlayerId: string; visibleRedPlayerId: string; winnerId: string; loserId: string; roundDamage: number; weather: Weather }
  | { type: "PLAYER_INCOME"; playerId: string; amount: number }
  | { type: "PLAYER_DAMAGE"; playerId: string; amount: number }
```

9 event variants mapping 1:1 to existing `Transfer.*` broadcast calls (`CLEAR_BOARD` and `CLEAR_BOARD_EVENT` are two distinct Transfer enums with different payloads). No new event categories needed.

**Field name conversions**: The broadcast payloads for `POKEMON_DAMAGE` and `POKEMON_HEAL` use a field named `type` (for attackType/healType), which conflicts with the BattleEvent discriminant. In BattleEvent these are renamed to `attackType` and `healType`. `processBattleEvent()` converts back: `{ type: event.attackType, ... }` when broadcasting. `PLAYER_INCOME` and `PLAYER_DAMAGE` are sent via `client.send()` as raw numbers, not objects — `processBattleEvent()` extracts `event.amount` for the send call.

### ISimulationPlayer (interface)

Narrows the Player class to fields actually accessed by Simulation during battle:

```typescript
interface ISimulationPlayer {
  // Read during construction
  id: string
  simulationId: string
  effects: Set<EffectEnum>

  // Read during battle
  items: Item[]
  synergies: Map<Synergy, number>
  board: Map<string, IPokemon>
  titles: Set<Title>
  pokemonsPlayed: Set<Pkm>

  // Read during onFinish
  opponentId: string
  opponentName: string
  opponentAvatar: string
  life: number
  weatherRocks: Item[]
  totalPlayerDamageDealt: number

  // Mutated during onFinish
  addBattleResult(id: string, name: string, result: BattleResult, avatar: string, weather: Weather): void
  addMoney(value: number, countEarned: boolean, origin: IPokemonEntity | null): void
  completeMissionOrder(item: Item): void
  updateWeatherRocks(): void
}
```

The existing `Player` class satisfies this interface via structural typing. Zero call-site changes needed in GameRoom.

## Modified Types

### Simulation (existing class, modified)

**Removed**:
- `room: GameRoom` property
- All `this.room.broadcast()` calls
- All `this.room.clients` access
- `this.room.computeRoundDamage()` calls
- `this.room.rankPlayers()` calls

**Added**:
- `private events: BattleEvent[]` — internal event buffer
- `private elapsedTime: number` — replaces `room.state.time` checks
- `specialGameRule: SpecialGameRule | null` — constructor param
- `pushEvent(event: BattleEvent): void` — helper to append to buffer

**Modified**:
- `update(dt: number): BattleEvent[]` — returns events (previously void)
- Constructor: removes `room: GameRoom` param, adds `specialGameRule` param

### PokemonEntity (existing class, modified)

**Removed**:
- `broadcastAbility()` method body — replaced with `this.simulation.pushEvent()`

**Unchanged**:
- `this.simulation` reference — still needed for accessing teams, weather, board
- `extends Schema` — temporarily kept for Colyseus sync (deferred to Phase 4)

### Board (existing class, modified)

**Removed**:
- All `simulation.room.broadcast()` calls (3 total: 1 `Transfer.BOARD_EVENT`, 2 `Transfer.CLEAR_BOARD_EVENT`)

**Modified**:
- `addBoardEffect()`: `simulation.room.broadcast(Transfer.BOARD_EVENT, ...)` → `simulation.pushEvent({ type: "BOARD_EVENT", ... })`
- `clearBoardEffect()`: `simulation.room.broadcast(Transfer.CLEAR_BOARD_EVENT, ...)` → `simulation.pushEvent({ type: "CLEAR_BOARD_EVENT", ... })` (2 call sites)

**Unchanged**:
- `simulation: Simulation` parameter — still needed for pushEvent and simulation.id

## Unchanged Types

- `MovingState`, `AttackingState`, `IdleState` — no room access
- `Dps` — extends Schema but no room access (Phase 4 cleanup)
- All types in `app/types/` — untouched
- All config in `app/config/game/` — untouched
