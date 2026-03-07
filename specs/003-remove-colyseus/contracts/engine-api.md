# Contract: LocalGameEngine API

## Player Action Methods

These replace `room.send(Transfer.*, payload)` calls in `network.ts`.

| Method | Replaces | Parameters | Effect |
|--------|----------|------------|--------|
| `buyPokemon(index)` | `Transfer.SHOP` | `index: number` | Buy Pokemon from shop slot |
| `sellPokemon(pokemonId)` | `Transfer.SELL_DROP` | `pokemonId: string` | Sell Pokemon for gold |
| `rerollShop()` | `Transfer.REFRESH` | none | Spend gold to refresh shop |
| `levelUp()` | `Transfer.LEVEL_UP` | none | Spend gold to gain XP |
| `lockShop()` | `Transfer.LOCK` | none | Toggle shop lock |
| `dragDropPokemon(detail)` | `Transfer.DRAG_DROP` | `{pokemon, x, y, from}` | Move Pokemon on board/bench |
| `dragDropItem(detail)` | `Transfer.DRAG_DROP_ITEM` | `{item, x, y}` | Equip item on Pokemon |
| `dragDropCombine(detail)` | `Transfer.DRAG_DROP_COMBINE` | `{itemA, itemB}` | Combine two items |
| `pickPokemonProposition(pkm)` | `Transfer.POKEMON_PROPOSITION` | `PkmProposition` | Pick Pokemon from carousel |
| `pickItem(item)` | `Transfer.ITEM` | `Item` | Pick item reward |
| `showEmote(emote?)` | `Transfer.SHOW_EMOTE` | `string?` | Display player emote |
| `pickBerry(index)` | `Transfer.PICK_BERRY` | `index: number` | Pick berry from tree (berry-tree.ts) |

## Event Emissions

These replace `room.onMessage(Transfer.*, callback)` and `room.broadcast()`.

| Event | Payload | Previously |
|-------|---------|------------|
| `Transfer.ABILITY` | `{id, skill, positionX, positionY, ...}` | server broadcast |
| `Transfer.POKEMON_DAMAGE` | `{id, damage, type, ...}` | server broadcast |
| `Transfer.POKEMON_HEAL` | `{id, heal, ...}` | server broadcast |
| `Transfer.BOARD_EVENT` | `{simulationId, type, x, y}` | server broadcast |
| `Transfer.CLEAR_BOARD_EVENT` | `{simulationId, type, x, y}` | server broadcast |
| `Transfer.SIMULATION_STOP` | `{simulationId}` | server broadcast |
| `Transfer.PLAYER_DAMAGE` | `{playerId, damage}` | client.send |
| `Transfer.PLAYER_INCOME` | `{playerId, amount}` | client.send |
| `Transfer.FINAL_RANK` | `{rank}` | client.send |
| `Transfer.SHOW_EMOTE` | `{id, emote}` | server broadcast |
| `Transfer.GAME_END` | `{}` | server broadcast |
| `Transfer.LOADING_COMPLETE` | `{}` | server broadcast |
| `Transfer.COOK` | `{pokemonId, dishes}` | server broadcast |
| `Transfer.DIG` | `{pokemonId, buriedItem}` | server broadcast |
| `Transfer.DRAG_DROP_CANCEL` | `{message}` | server broadcast |
| `Transfer.CLEAR_BOARD` | `{simulationId}` | server broadcast |
| `Transfer.PRELOAD_MAPS` | `maps: string[]` | server broadcast |

## State Change Events — Schema Encode/Decode Loopback

**No custom event system needed.** State changes are handled automatically by the Schema encode/decode loopback:

1. Engine mutates `engineState` (GameState Schema object)
2. `encoder.encode(engineState)` produces binary patches
3. `decoder.decode(patches, clientState)` applies patches to `clientState`
4. All existing Schema callbacks fire automatically via `getDecoderStateCallbacks(decoder)`

This means all existing listeners in `game.tsx` and `game-container.ts` work unchanged:
- `$state.listen("phase", cb)` — fires when phase changes
- `$state.players.onAdd(cb)` — fires when player added
- `$player.board.onAdd(cb)` — fires when Pokemon added to board
- `$(pokemon).listen("hp", cb)` — fires when Pokemon HP changes (every tick during battle)
- etc.

**Only Transfer messages** (ABILITY, DAMAGE, HEAL, etc. from Event Emissions above) need the EventEmitter — these are RPC-style events, not Schema state.

## Lifecycle

```
engine = new LocalGameEngine()
engine.startGame(config)    // initializes engineState+clientState, encoder/decoder, starts timer
engine.on(event, callback)  // register Transfer message listeners
const $ = getDecoderStateCallbacks(engine.decoder)  // Schema listener proxy
const $state = $(engine.clientState)
$state.listen("phase", cb)  // all existing listeners work unchanged
// ... game plays ...
engine.dispose()            // stops timer, saves to IndexedDB
```
