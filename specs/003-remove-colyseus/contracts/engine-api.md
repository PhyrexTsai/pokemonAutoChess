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

## State Change Events (replaces Schema listeners)

| Event | Payload | Replaces |
|-------|---------|----------|
| `state:phase` | `(newPhase, oldPhase)` | `$state.listen("phase", cb)` |
| `state:roundTime` | `(time)` | `$state.listen("roundTime", cb)` |
| `state:stageLevel` | `(level)` | `$state.listen("stageLevel", cb)` |
| `state:gameMode` | `(mode)` | `$state.listen("gameMode", cb)` |
| `state:noElo` | `(value)` | `$state.listen("noElo", cb)` |
| `state:specialGameRule` | `(rule)` | `$state.listen("specialGameRule", cb)` |
| `playerAdded` | `(player)` | `$state.players.onAdd(cb)` |
| `playerRemoved` | `(player)` | `$state.players.onRemove(cb)` |
| `simulationAdded` | `(simulation, id)` | `$state.simulations.onAdd(cb)` |
| `simulationRemoved` | `(simulation, id)` | `$state.simulations.onRemove(cb)` |
| `player:shopChanged` | `(shop, index)` | `$player.shop.onChange(cb)` |
| `player:boardAdded` | `(pokemon, id)` | `$player.board.onAdd(cb)` |
| `player:boardRemoved` | `(pokemon, id)` | `$player.board.onRemove(cb)` |
| `player:fieldChanged` | `(field, value, prev)` | `$player.listen(field, cb)` |

## Lifecycle

```
engine = new LocalGameEngine()
engine.startGame(config)    // initializes state, starts timer
engine.on(event, callback)  // register listeners
// ... game plays ...
engine.dispose()            // stops timer, saves to IndexedDB
```
