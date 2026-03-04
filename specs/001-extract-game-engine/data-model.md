# Data Model: Extract Game Engine

## New Types

### BattleEvent (discriminated union)

```typescript
type BattleEvent =
  | { type: "ABILITY"; id: string; skill: Ability | string; positionX: number; positionY: number; orientation: Orientation; targetX?: number; targetY?: number; delay?: number; ap?: number }
  | { type: "POKEMON_DAMAGE"; index: string; attackType: AttackType; amount: number; x: number; y: number; id: string }
  | { type: "POKEMON_HEAL"; index: string; healType: HealType; amount: number; x: number; y: number; id: string }
  | { type: "BOARD_EVENT"; simulationId: string; x: number; y: number; effect: Effect }
  | { type: "SIMULATION_END"; winnerId: string; /* round damage data included for GameRoom to process */ }
  | { type: "PLAYER_INCOME"; playerId: string; amount: number }
  | { type: "PLAYER_DAMAGE"; playerId: string; amount: number }
```

Maps 1:1 to existing `Transfer.*` broadcast calls. No new event categories needed.

### ISimulationPlayer (interface)

Narrows the Player class to fields actually accessed by Simulation during battle:

```typescript
interface ISimulationPlayer {
  // Read during construction
  id: string
  effects: Set<EffectEnum>

  // Read during battle
  items: Item[]
  synergies: Map<Synergy, number>
  board: Map<string, IPokemon>

  // Read during onFinish
  opponentId: string
  opponentName: string
  opponentAvatar: string
  life: number
  weatherRocks: Item[]
  totalPlayerDamageDealt: number

  // Mutated during onFinish
  addBattleResult(id: string, name: string, result: BattleResult, avatar: string, weather: Weather): void
  addMoney(value: number, countEarned: boolean, origin: string): void
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

## Unchanged Types

- `Board` — no Schema dependency
- `MovingState`, `AttackingState`, `IdleState` — no room access
- `Dps` — extends Schema but no room access (Phase 4 cleanup)
- All types in `app/types/` — untouched
- All config in `app/config/game/` — untouched
