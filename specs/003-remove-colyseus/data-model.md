# Data Model: Remove Colyseus

## Entities

### LocalGameEngine (NEW — 3-file split)

Central game controller replacing all 4 Colyseus rooms. Split across 3 files for maintainability:

- **`app/public/src/local-engine.ts`** (~800 lines) — core engine class, game loop, syncState, event emitter, `IGameEngineContext` implementation
- **`app/public/src/game-engine-commands.ts`** (~1000 lines) — extracted player action functions (buy, sell, drag-drop, etc.)
- **`app/public/src/game-engine-phases.ts`** (~1200 lines) — extracted `OnUpdatePhaseCommand` phase transition logic

| Field | Type | Description |
|-------|------|-------------|
| engineState | GameState | Engine-side state — mutated by game logic |
| clientState | GameState | Client-side state — read by UI, updated via decode |
| encoder | Encoder | `@colyseus/schema` Encoder for engineState |
| decoder | Decoder | `@colyseus/schema` Decoder for clientState |
| intervalId | number | Timer handle for game loop |
| eventEmitter | EventEmitter | Typed event bus for Transfer messages (ABILITY, DAMAGE, etc.) |
| humanPlayerId | string | The local player's ID |
| botManager | BotManager | Reuses existing bot management logic |
| miniGame | MiniGame | Reuses existing minigame class |
| delayedActions | DelayedAction[] | Engine-level delayed action queue (replaces `room.clock.setTimeout()`) |
| elapsedTime | number | Accumulated game time for delayed action scheduling |

**Methods (reuse existing command logic)**:
- `startGame(config: GameConfig): void` — initializes engineState+clientState, encoder/decoder (with `encodeAll()` for initial full snapshot + `discardChanges()`), players, shop, starts loop
- `tick(deltaTime: number): void` — runs one game frame (reuses OnUpdateCommand logic from `game-engine-phases.ts`), processes `delayedActions` queue, then calls `syncState()`
- `syncState(): void` — `encoder.encode(engineState)` → `decoder.decode(patches, clientState)` → `encoder.discardChanges()` — fires all Schema callbacks. Must call `discardChanges()` after each encode to clear tracked changes. Called after each tick AND after each player action for immediate UI feedback (see R7 in research.md).
- `addDelayedAction(delayMs, callback): void` — adds to engine-level delayed action queue (replaces `room.clock.setTimeout()`)
- `buyPokemon(index: number): void` — calls function from `game-engine-commands.ts`, then `syncState()`
- `sellPokemon(pokemonId: string): void` — calls function from `game-engine-commands.ts`
- `rerollShop(): void` — calls function from `game-engine-commands.ts`
- `levelUp(): void` — calls function from `game-engine-commands.ts`
- `lockShop(): void` — calls function from `game-engine-commands.ts`
- `dragDropPokemon(detail): void` — calls function from `game-engine-commands.ts`
- `dragDropItem(detail): void` — calls function from `game-engine-commands.ts`
- `dragDropCombine(detail): void` — calls function from `game-engine-commands.ts`
- `pickPokemonProposition(proposition): void` — calls function from `game-engine-commands.ts`
- `pickItem(item): void` — calls function from `game-engine-commands.ts`
- `showEmote(emote?): void` — display player emote
- `pickBerry(index): void` — pick berry from tree (berry-tree.ts)
- `wandererClicked(id): void` — click wandering Pokemon (wanderers-manager.ts)
- `switchBenchAndBoard(pokemonId): void` — switch Pokemon between bench/board (game-scene.ts)
- `removeFromShop(index): void` — remove Pokemon from shop (game-scene.ts)
- `sellPokemonFromScene(pokemonId): void` — sell from game scene context (game-scene.ts)
- `reportLoadingProgress(progress): void` — report asset loading progress (game-scene.ts)
- `reportLoadingComplete(): void` — report asset loading complete (game-scene.ts)
- `sendVector(vector): void` — minigame joystick input (game-scene.ts)
- `on(event, callback): void` — register Transfer message listener (delegates to eventEmitter)
- `dispose(): void` — stops timer, saves game history + ELO to IndexedDB
- `processBattleEvent(event: BattleEvent): void` — emits event via eventEmitter

### IGameEngineContext (NEW)

Interface that replaces `GameRoom` in simulation.ts, mini-game.ts, and effect.ts. Provides the subset of room functionality that core game logic needs:

```typescript
interface IGameEngineContext {
  state: GameState
  addDelayedAction(delayMs: number, callback: () => void): void
  emit(event: string, payload: any): void
  spawnOnBench(player: Player, pokemon: Pokemon, reason: string): void
  spawnWanderingPokemon(params: WanderingPokemonParams): void
  checkEvolutionsAfterPokemonAcquired(playerId: string): void
  checkEvolutionsAfterItemAcquired(playerId: string): void
  getTeamSize(board: MapSchema<Pokemon>): number
}
```

`LocalGameEngine` implements `IGameEngineContext`. Core logic files (`simulation.ts`, `mini-game.ts`, `effect.ts`, `abilities.ts`, etc.) accept `IGameEngineContext` instead of `GameRoom`.

**Note**: `WanderingPokemonParams` type must be defined in `app/types/index.ts` (fields inferred from `game-room.ts` `spawnWanderingPokemon` usage: pkm, type, behavior, player). This type does not currently exist in the codebase — it is created as part of T002.

### GameConfig (NEW)

Configuration for starting a new game. Replaces preparation room state.

| Field | Type | Description |
|-------|------|-------------|
| botDifficulty | BotDifficulty | Easy/Medium/Hard bot selection |
| specialGameRule | SpecialGameRule or null | Optional special rules |
| playerProfile | IUserMetadataJSON | Local player's profile from IndexedDB |
| gameMode | GameMode | Default: RANKED or NORMAL |

### EngineStateProxy — ELIMINATED

**Not needed.** Replaced by Schema encode/decode loopback (see R2 in research.md). The `getDecoderStateCallbacks(decoder)` function from `@colyseus/schema` provides the exact same `.listen()`, `.onAdd()`, `.onRemove()`, `.onChange()` API that `getStateCallbacks(room)` did. No custom compatibility layer required.

### Existing Entities (PRESERVED, no changes)

These existing Schema classes continue to function as data containers:

- **GameState** (game-state.ts) — phase, time, stageLevel, players MapSchema, simulations MapSchema, shop
- **Player** (player.ts) — money, life, board, items, synergies, experienceManager
- **Simulation** (simulation.ts) — blueTeam, redTeam, weather, update() returns BattleEvent[]. Note: `room?: GameRoom` field → replaced with `IGameEngineContext` interface
- **PokemonEntity** (pokemon-entity.ts) — position, HP, stats, status, abilities
- **Shop** — Pokemon pool, reroll logic, shop assignment
- **BotManager** — Bot AI board configurations from static JSON

## State Transitions

### Game Lifecycle

```
[Lobby] → startGame(config) → [PICK Phase] → timer expires → [FIGHT Phase]
    ↑                              ↑                              |
    |                              |          simulation.update()  |
    |                              |          BattleEvent[]        |
    |                              ←──── all simulations done ─────┘
    |                              |
    |                         [TOWN Phase] (minigame, every N rounds)
    |                              |
    |                    player eliminated? → assign rank
    |                              |
    |                    last player? → [Game Over]
    |                              |
    ←────── save history ──── [AfterGame]
```

### Phase Transitions (reuses OnUpdatePhaseCommand logic)

| From | To | Trigger | Key Actions |
|------|----|---------|-------------|
| PICK | FIGHT | timer reaches 0 | Create Simulations, assign opponents |
| FIGHT | PICK | all simulations done | Apply damage, income, ranking |
| FIGHT | TOWN | PvE round complete | Start minigame |
| TOWN | PICK | timer reaches 0 | End minigame, assign shop |

## Deletion Summary

### State files — MOVE vs DELETE

| State file | Action | Reason |
|------------|--------|--------|
| `game-state.ts` | **MOVE** to `app/models/colyseus-models/` | Still used by engine + Schema loopback; 9 files import it |
| `lobby-state.ts` | DELETE | Multiplayer-only |
| `preparation-state.ts` | DELETE | Multiplayer-only |
| `after-game-state.ts` | DELETE | Multiplayer-only |

### File counts

| Category | Files Deleted | Lines Deleted |
|----------|--------------|---------------|
| Room files | 4 (game-room, lobby-room, prep-room, after-game-room) | ~2640 |
| Command files | 3 (game-commands, lobby-commands, prep-commands) | ~4420 |
| State files | 3 (lobby-state, prep-state, after-game-state — **not** game-state) | ~200 |
| Client pages | 1 (preparation.tsx) | ~265 |
| Client components | 2 (game-rooms-menu.tsx, game-room-item.tsx) | ~150 |
| Tournament UI | 6 (tournament-item.tsx + CSS, tournaments-list.tsx + CSS, tournaments-admin.tsx + CSS) | ~300 |
| Client stores | 1 (PreparationStore.ts) | ~50 |
| Core | 1 (tournament-logic.ts) | ~100 |
| Network | 1 (network.ts rewritten) | ~263 |
| **Total** | **~22 files deleted** | **~8400 lines** |

**Note**: `game-state.ts` is MOVED (not deleted) to `app/models/colyseus-models/game-state.ts`. All 9 import paths across the codebase must be updated.
