# Data Model: Remove Colyseus

## Entities

### LocalGameEngine (NEW)

Central game controller replacing all 4 Colyseus rooms.

| Field | Type | Description |
|-------|------|-------------|
| state | GameState | Reuses existing Schema class (from game-state.ts) |
| intervalId | number | Timer handle for game loop |
| eventEmitter | EventEmitter | Typed event bus for Transfer + state events |
| humanPlayerId | string | The local player's ID |
| botManager | BotManager | Reuses existing bot management logic |
| miniGame | MiniGame | Reuses existing minigame class |

**Methods (reuse existing command logic)**:
- `startGame(config: GameConfig): void` — initializes state, players, shop, starts loop
- `tick(deltaTime: number): void` — runs one game frame (reuses OnUpdateCommand logic)
- `buyPokemon(index: number): void` — reuses OnBuyPokemonCommand logic
- `sellPokemon(pokemonId: string): void` — reuses OnSellPokemonCommand logic
- `rerollShop(): void` — reuses OnShopRerollCommand logic
- `levelUp(): void` — reuses OnLevelUpCommand logic
- `lockShop(): void` — reuses OnLockCommand logic
- `dragDropPokemon(detail): void` — reuses OnDragDropPokemonCommand logic
- `dragDropItem(detail): void` — reuses OnDragDropItemCommand logic
- `dragDropCombine(detail): void` — reuses OnDragDropCombineCommand logic
- `pickPokemonProposition(proposition): void` — reuses OnPokemonPropositionCommand logic
- `pickItem(item): void` — reuses OnPickItemCommand logic
- `dispose(): void` — stops timer, saves game history + ELO to IndexedDB
- `processBattleEvent(event: BattleEvent): void` — emits event via eventEmitter

### GameConfig (NEW)

Configuration for starting a new game. Replaces preparation room state.

| Field | Type | Description |
|-------|------|-------------|
| botDifficulty | BotDifficulty | Easy/Medium/Hard bot selection |
| specialGameRule | SpecialGameRule or null | Optional special rules |
| playerProfile | IUserMetadataJSON | Local player's profile from IndexedDB |
| gameMode | GameMode | Default: RANKED or NORMAL |

### EngineStateProxy (NEW)

Compatibility layer providing `.listen()` API over engine events.

| Method | Signature | Maps to |
|--------|-----------|---------|
| listen | (prop, callback) => unsubscribe | engine.on(`state:${prop}`, callback) |
| players.onAdd | (callback) => unsubscribe | engine.on("playerAdded", callback) |
| players.onRemove | (callback) => unsubscribe | engine.on("playerRemoved", callback) |
| simulations.onAdd | (callback) => unsubscribe | engine.on("simulationAdded", callback) |
| simulations.onRemove | (callback) => unsubscribe | engine.on("simulationRemoved", callback) |

### Existing Entities (PRESERVED, no changes)

These existing Schema classes continue to function as data containers:

- **GameState** (game-state.ts) — phase, time, stageLevel, players MapSchema, simulations MapSchema, shop
- **Player** (player.ts) — money, life, board, items, synergies, experienceManager
- **Simulation** (simulation.ts) — blueTeam, redTeam, weather, update() returns BattleEvent[]
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

| Category | Files Deleted | Lines Deleted |
|----------|--------------|---------------|
| Room files | 4 (game-room, lobby-room, prep-room, after-game-room) | ~2640 |
| Command files | 3 (game-commands, lobby-commands, prep-commands) | ~4420 |
| State files | 4 (game-state, lobby-state, prep-state, after-game-state) | ~270 |
| Network | 1 (network.ts replaced) | ~263 |
| **Total** | **12 files** | **~7600 lines** |
