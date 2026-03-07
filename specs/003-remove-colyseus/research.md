# Research: Remove Colyseus

## R1: Game Loop Replacement

**Decision**: Replace `setSimulationInterval` with `setInterval` + `performance.now()` delta-time calculation, capped at `MAX_SIMULATION_DELTA_TIME`.

**Rationale**: `setSimulationInterval` is just a wrapper around `setInterval` with delta-time. The existing `OnUpdateCommand` logic (tick state, run simulations, transition phases) is 95% reusable — only `this.room.processBattleEvent()` calls need replacement.

**Alternatives considered**:
- `requestAnimationFrame`: Not suitable — pauses when tab loses focus. Game needs to run continuously.
- Web Worker: Unnecessary complexity for a single-player game loop.

## R2: State Listener Strategy

**Decision**: Use Schema encode/decode loopback — maintain two `GameState` instances (engine-side `engineState` + client-side `clientState`) connected via `Encoder`/`Decoder` from `@colyseus/schema`. After each engine tick or player action, call `encoder.encode(engineState)` → `decoder.decode(patch, clientState)`. All existing Schema callbacks (`.listen()`, `.onAdd()`, `.onRemove()`, `.onChange()`) fire automatically on `clientState`, exactly as they did when receiving server patches over WebSocket.

**Rationale**: This is the **zero-change** approach for Schema listeners. All ~500 lines of `.listen()` / `.onAdd()` / `.onChange()` callbacks in `game.tsx` and `game-container.ts` remain 100% untouched. Per-Pokemon field listeners (~60 fields each, every tick during battle) work automatically via Schema's `@type()` change tracking.

**Scope clarification**: The loopback eliminates changes to Schema listener code, but `game.tsx` and `game-container.ts` still have other `room.*` references that need modification:
- `room.onMessage(Transfer.*, cb)` → `engine.on(Transfer.*, cb)` (15 in game.tsx, 1 in game-container.ts)
- `room.send(Transfer.*, data)` → `engine.method(data)` (3 in game-container.ts)
- `room.state.*` direct reads → `engine.clientState.*` (5 in game.tsx, 4 in game-container.ts, 5 in game-scene.ts)
- Constructor signatures (`Room<GameState>` → `LocalGameEngine`)
- `room.onDrop()`, `room.onError()` → delete (multiplayer-only)
- `berry-tree.ts:151` → `room.send(Transfer.PICK_BERRY)` → engine method

Total: ~23 changes in game.tsx, ~11 in game-container.ts, ~5 in game-scene.ts, ~1 in berry-tree.ts. Still vastly less than rewriting 500 lines of listeners.

```typescript
// Before
const $ = getStateCallbacks(room)
const $state = $(room.state)
$state.listen("phase", cb)

// After — only this line changes
const $ = getDecoderStateCallbacks(decoder)
const $state = $(engine.clientState)
$state.listen("phase", cb)  // SAME callback, same API, ZERO changes
```

**Verified**: `@colyseus/schema` v4.0.14 exports `Encoder`, `Decoder`, `getDecoderStateCallbacks` independently — no `@colyseus/sdk` or `Room` needed. Source code verification (`SchemaSerializer.ts:19`) confirms `getStateCallbacks(room)` is literally `getDecoderStateCallbacks(room.serializer.decoder)` — a one-line wrapper. The returned `$` function (`getDecoderStateCallbacks.ts:438-442`) accepts **any Schema instance**, not just root state, so `$<Simulation>(sim)`, `$<PokemonEntity>(pokemon)`, `$pokemon.status.listen("burn", cb)` all work identically via recursive Proxy (lines 304-338). The loopback pattern:

```typescript
import { Encoder, Decoder, getDecoderStateCallbacks } from "@colyseus/schema"

const engineState = new GameState()   // engine mutates this
const clientState = new GameState()   // client reads this
const encoder = new Encoder(engineState)
const decoder = new Decoder(clientState)

// FIRST sync — must use encodeAll() for full snapshot:
const fullSnapshot = encoder.encodeAll()
decoder.decode(fullSnapshot, clientState)
encoder.discardChanges()  // clear tracked changes after encode

// SUBSEQUENT syncs — encode() only sends dirty fields:
const patches = encoder.encode(engineState)
decoder.decode(patches, clientState)
encoder.discardChanges()  // MUST call after each encode()
// → all .listen(), .onAdd(), .onRemove() fire automatically
```

**Critical initialization detail**: `encode()` only encodes dirty/changed fields. The first sync MUST use `encodeAll()` to produce a full state snapshot — otherwise `clientState` starts empty with no data. After each `encode()` or `encodeAll()`, `discardChanges()` must be called to clear tracked changes, preventing re-encoding stale deltas.

**Why this beats EngineStateProxy**: The original EngineStateProxy approach required manually emitting events after every state mutation — hundreds of `emit()` calls, per-Pokemon field tracking (positionX, hp, shield, etc. changing every tick), and constant maintenance as new fields are added. The loopback approach delegates all change detection to Schema's existing `@type()` decorators, which is exactly what they were designed for.

**Alternatives considered**:
- EngineStateProxy (manual event emitter): Fatal flaw — requires manual emit after every mutation. Per-Pokemon field listeners (20+ fields × N entities × every tick) would be unmaintainable boilerplate.
- Full listener rewrite: ~500+ line changes across 4 files. Violates "minimize changes".
- Proxy/Object.defineProperty interception: Conflicts with Schema's own property setters.
- Keep `@colyseus/sdk` for callbacks only: Defeats purpose of removing Colyseus.

## R3: Game Command Reuse

**Decision**: Extract game command logic from `game-commands.ts` Command classes into plain functions. Each function accepts `(state: GameState, player: Player, params)` and returns void (mutates state in-place). The `LocalGameEngine` calls these functions directly.

**Rationale**: The command logic is mostly game logic, but has significant Colyseus coupling that must be carefully extracted:

**Actual complexity** (verified counts from `game-commands.ts`):
- ~49 `this.room` references calling 18 unique room methods/properties
- 167 `this.state` references (become explicit `state: GameState` parameter — mechanical replacement)
- 25 `client.send()` calls (become `engine.emit()` calls)
- `OnUpdatePhaseCommand` = 1195 lines (the largest single class to extract)

**All 18 `this.room.*` methods that must become engine methods/context**:
1. `this.room.state` (5×) — becomes `state` parameter
2. `this.room.clients` (6×) — single-player: just `[humanPlayer]`
3. `this.room.getTeamSize` (8×) — move to engine method
4. `this.room.checkEvolutionsAfterPokemonAcquired` (4×) — move to engine method
5. `this.room.broadcast` (2×) — becomes `engine.emit()`
6. `this.room.miniGame` (3×) — becomes `engine.miniGame`
7. `this.room.checkEvolutionsAfterItemAcquired` (2×) — move to engine method
8. `this.room.clock` (2×) — becomes `engine.addDelayedAction()`
9. `this.room.processBattleEvent` (2×) — becomes `engine.emit()`
10. `this.room.additionalEpicPool` (1×) — becomes engine field
11. `this.room.additionalRarePool` (1×) — becomes engine field
12. `this.room.additionalUncommonPool` (1×) — becomes engine field
13. `this.room.disconnect` (1×) — DELETE (multiplayer-only)
14. `this.room.pickItemProposition` (1×) — move to engine method
15. `this.room.pickPokemonProposition` (1×) — move to engine method
16. `this.room.roomId` (1×) — becomes engine field (generate locally)
17. `this.room.setMetadata` (1×) — DELETE (multiplayer-only)
18. `this.room.spawnOnBench` (1×) — move to engine method

The Colyseus Command/Dispatcher pattern adds zero value for local execution.

**Reusable commands (direct extraction)**:
- `buyPokemon(state, player, index)` — from OnBuyPokemonCommand
- `sellPokemon(state, player, pokemonId)` — from OnSellPokemonCommand
- `rerollShop(state, player)` — from OnShopRerollCommand
- `levelUp(state, player)` — from OnLevelUpCommand
- `lockShop(player)` — from OnLockCommand
- `dragDropPokemon(state, player, detail)` — from OnDragDropPokemonCommand
- `dragDropItem(state, player, detail)` — from OnDragDropItemCommand
- `dragDropCombine(state, player, detail)` — from OnDragDropCombineCommand
- `pickPokemonProposition(state, player, proposition)` — from OnPokemonPropositionCommand
- `pickItem(state, player, item)` — from OnPickItemCommand

**Commands to delete (multiplayer-only)**:
- OnJoinCommand, OnLeaveCommand — connection management
- Chat commands — multiplayer-only
- Spectate commands — no other players to watch
- Tournament commands — multiplayer-only
- Admin commands — no admin in single-player

## R4: Room References Resolution

**Decision**: 3 DELETE, 13 REIMPLEMENT with engine-local alternatives via `IGameEngineContext` interface.

### Verified room reference counts (per file)

| File | `room.*` refs | Key methods used |
|------|--------------|-----------------|
| items.ts | 7 | `room.clock.setTimeout` (2×), `room.broadcast` (1×), `room.state` (3×), `room.spawnOnBench` (1×) |
| passives.ts | 3 | `room.clock.setTimeout` (2×), `room.broadcast` (1×) |
| abilities.ts | 6 | guard check (1×), `room.clock.setTimeout` (1×), `room.state.shop.magnetPull` (1×), `room.spawnWanderingPokemon` (1×), conditional checks (2×) |
| hidden-power.ts | 5 | guard check (1×), `room.state.shop.pickFish` (1×), `room.state` (1×), `room.spawnOnBench` (1×), `room.checkEvolutionsAfterPokemonAcquired` (1×) |
| mini-game.ts | 8 | `room.state` (4×), `room.clients` (1×), `room.broadcast` (2×), `room.clock.setTimeout` (1×) |
| simulation.ts | 5 | `room` field declaration + property accesses |
| effect.ts | 3 | `room?: GameRoom` in interface/param types |
| synergies.ts | 1 | `pokemon.simulation.room.clock.setTimeout` (1×) |
| **Total** | **38** | |

### Core game logic references (10)

| Reference | File | Action | Replacement |
|-----------|------|--------|-------------|
| HiddenPowerF (fishing) | hidden-power.ts:111 | REIMPLEMENT | Engine provides `pickFish()` + `spawnOnBench()` directly |
| HiddenPowerO (evolution) | hidden-power.ts:406 | REIMPLEMENT | Call `checkEvolutions()` as engine method |
| Celesteel (fireworks delay) | abilities.ts:292 | REIMPLEMENT | Use engine-level delayed action queue |
| MagnetPull (steel spawn) | abilities.ts:13520 | REIMPLEMENT | Engine provides `spawnWanderingPokemon()` |
| Field synergy (death heal) | synergies.ts:217 | REIMPLEMENT | Use engine-level delayed action queue or immediate execution |
| DodoTicket (stage level) | items.ts:321 | REIMPLEMENT | Engine passes `stageLevel` via simulation context |
| ChefCook (broadcast+delay) | items.ts:330 | REIMPLEMENT | Engine emits COOK event + uses delayed action |
| FishingRod (stage+fish) | items.ts:428 | REIMPLEMENT | Engine provides `pickFish()` + `spawnOnBench()` |
| EvolutionStone (evolution) | items.ts:1200 | REIMPLEMENT | Call `checkEvolutions()` as engine method |
| PachirisuBerry (dig) | passives.ts:507 | REIMPLEMENT | Engine emits DIG event + uses delayed action |

### Infrastructure references (3)

| Reference | File | Action | Replacement |
|-----------|------|--------|-------------|
| MiniGame constructor | mini-game.ts | REIMPLEMENT | Constructor takes `room: GameRoom` for `room.state`, `room.clients`, `room.broadcast()`, `room.clock.setTimeout()` — replace with `IGameEngineContext` |
| Simulation.room field | simulation.ts:94,127,1499 | REIMPLEMENT | Optional `room?: GameRoom` field passed to abilities/effects — replace with `IGameEngineContext` interface |
| Effect args | effects/effect.ts | REIMPLEMENT | `OnStageStartEffectArgs` has `room?: GameRoom` — replace with `IGameEngineContext` interface |

### Additional note: `mini-game.ts` logger

`mini-game.ts` line 2 imports `logger` from `"colyseus"` — must be replaced with `console` or a custom logger.

### Delayed action mechanism

**Key pattern**: Most references use `room.clock.setTimeout()` for delayed effects. The existing per-Pokemon `DelayedCommand` pattern (`commands.push(new DelayedCommand(callback, delay))`) only covers effects tied to a specific Pokemon entity. Effects without a Pokemon context (e.g., MiniGame timers, ChefCook broadcast, PachirisuBerry dig) need an engine-level mechanism.

**Solution**: Add a `delayedActions` queue to `LocalGameEngine`:

```typescript
// Engine-level delayed actions (replaces room.clock.setTimeout)
interface DelayedAction {
  executeAt: number      // timestamp when to fire
  callback: () => void
}

class LocalGameEngine {
  private delayedActions: DelayedAction[] = []
  private elapsedTime = 0

  addDelayedAction(delayMs: number, callback: () => void) {
    this.delayedActions.push({
      executeAt: this.elapsedTime + delayMs,
      callback
    })
  }

  tick(deltaTime: number) {
    this.elapsedTime += deltaTime
    // Process delayed actions
    this.delayedActions = this.delayedActions.filter(action => {
      if (this.elapsedTime >= action.executeAt) {
        action.callback()
        return false  // remove executed action
      }
      return true
    })
    // ... rest of tick logic
  }
}
```

Core logic accesses this via the engine context interface (same interface that replaces `room` in simulation.ts, mini-game.ts, effect.ts):

```typescript
interface IGameEngineContext {
  state: GameState
  addDelayedAction(delayMs: number, callback: () => void): void
  emit(event: string, payload: any): void
  // ... other methods previously on room
}
```

## R5: Transfer Message Handling

**Decision**: The `LocalGameEngine` acts as both sender (emitting events after state changes) and receiver (accepting method calls from UI). Transfer messages become engine events.

**Message flow changes**:
```
// Before: Client → WebSocket → Server Room → broadcast → Client
room.send(Transfer.SHOP, {id})        // client sends
room.onMessage(Transfer.ABILITY, cb)  // client receives

// After: Client → Engine method → emit event → Client
engine.buyPokemon(id)                 // client calls directly
engine.on(Transfer.ABILITY, cb)       // client listens locally
```

**Additional client→engine message**: `Transfer.VECTOR` (minigame joystick input from game-scene.ts:474) — becomes `engine.sendVector(vector)` method.

**Deleted Transfer messages** (multiplayer-only, no single-player equivalent):
- `Transfer.SPECTATE` — no other players to watch
- `Transfer.NEW_MESSAGE` — multiplayer chat
- `Transfer.OVERWRITE_BOARD` — admin-only board override

## R6: Game Flow Simplification

**Decision**: Three-screen flow: Lobby → Game → AfterGame. Preparation screen deleted.

| Screen | Before | After |
|--------|--------|-------|
| Lobby | Colyseus lobby room, room list, chat | Simplified: profile, collection, "Start Game" panel |
| Preparation | Colyseus prep room, player ready | DELETED — engine auto-starts with selected bots |
| Game | Colyseus game room, WebSocket sync | LocalGameEngine in-browser, event-based rendering |
| AfterGame | Colyseus after-game room | Local: read final state from engine, display results |

## R7: syncState() Timing

**Decision**: Call `syncState()` both after each tick AND after each player action method. Player actions call `syncState()` immediately after mutating `engineState` so UI updates are instantaneous (no 16ms latency).

**Rationale**: In the original Colyseus model, server state mutations are batched and sent in the next tick's patch. But for local execution, there's no network latency to hide — the user expects immediate feedback when they buy a Pokemon or drag-drop. Calling `syncState()` after each action adds negligible overhead (encode/decode is fast for small deltas like a single shop purchase).

**Pattern**:
```typescript
buyPokemon(index: number) {
  // ... mutate engineState ...
  this.syncState()  // immediate UI update
}

tick(deltaTime: number) {
  // ... run simulation, update timers, transition phases ...
  this.syncState()  // batch update all tick changes
}
```

**Exception**: During FIGHT phase simulation ticks, `syncState()` is called once per tick (not per-Pokemon-mutation). The simulation may modify hundreds of Pokemon fields per tick — batching them into a single encode/decode is both correct (matches original behavior) and efficient.

## R8: processBattleEvent Replacement

**Decision**: The `processBattleEvent()` method (~100 lines in game-room.ts) is 100% network-specific. Replace with direct EventEmitter emission from the engine. The BattleEvent data structure stays the same — only the delivery mechanism changes.

```typescript
// Before (game-room.ts)
processBattleEvent(event: BattleEvent) {
  switch(event.type) {
    case "ABILITY": this.broadcast(Transfer.ABILITY, event); break;
    case "POKEMON_DAMAGE": this.broadcast(Transfer.POKEMON_DAMAGE, event); break;
  }
}

// After (local-engine.ts)
processBattleEvent(event: BattleEvent) {
  this.emit(event.type, event)  // Same event, local delivery
}
```
