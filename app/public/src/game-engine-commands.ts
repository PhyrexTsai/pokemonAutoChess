/**
 * game-engine-commands.ts
 * Plain functions extracted from game-commands.ts Command classes.
 * Each function accepts (state, player, context, params) and mutates state in-place.
 * Replaces Colyseus Command pattern with direct function calls.
 */

import {
  BOARD_SIDE_HEIGHT,
  BOARD_WIDTH,
  GOLDEN_BERRY_TREE_TYPES,
  getAltFormForPlayer,
  OUTLAW_GOLD_REWARD,
  PkmsWithAltForms,
  SHARDS_PER_SHINY_UNOWN_WANDERER,
  SHARDS_PER_UNOWN_WANDERER,
  SynergyTriggers
} from "../../config"
import { OnItemDroppedEffect } from "../../core/effects/effect"
import { ItemEffects } from "../../core/effects/items"
import { PassiveEffects } from "../../core/effects/passives"
import { CountEvolutionRule } from "../../core/evolution-rules"
import { getFlowerPotsUnlocked } from "../../core/flower-pots"
import { canSell } from "../../core/pokemon-entity"
import { getLevelUpCost } from "../../models/colyseus-models/experience-manager"
import Player from "../../models/colyseus-models/player"
import { Pokemon } from "../../models/colyseus-models/pokemon"
import { getSynergyStep } from "../../models/colyseus-models/synergies"
import GameState from "../../models/colyseus-models/game-state"
import { getPlayer } from "../../models/local-store"
import PokemonFactory, {
  getPokemonBaseline
} from "../../models/pokemon-factory"
import { getBuyPrice, getSellPrice } from "../../models/shop"
import {
  Emotion,
  IDragDropCombineMessage,
  IDragDropItemMessage,
  IDragDropMessage,
  IGameEngineContext,
  Transfer
} from "../../types"
import { EffectEnum } from "../../types/enum/Effect"
import {
  GamePhaseState,
  PokemonActionState
} from "../../types/enum/Game"
import {
  ConsumableItems,
  CraftableItemsNoScarves,
  CraftableNoStonesOrScarves,
  Dishes,
  Item,
  ItemComponents,
  ItemComponentsNoFossilOrScarf,
  ItemComponentsNoScarf,
  ItemRecipe,
  Mulches,
  Scarves,
  SynergyGivenByItem,
  SynergyStones,
  UnholdableItems
} from "../../types/enum/Item"
import { Passive } from "../../types/enum/Passive"
import {
  Pkm,
  PkmIndex,
  Unowns
} from "../../types/enum/Pokemon"
import { Synergy } from "../../types/enum/Synergy"
import { WandererType } from "../../types/enum/Wanderer"
import { isIn, removeInArray } from "../../utils/array"
import {
  getFirstAvailablePositionInBench,
  getFirstAvailablePositionOnBoard,
  getFreeSpaceOnBench,
  getMaxTeamSize,
  isOnBench,
  isPositionEmpty
} from "../../utils/board"
import { pickRandomIn } from "../../utils/random"
import { values } from "../../utils/schemas"

export function buyPokemon(
  state: GameState,
  player: Player,
  context: IGameEngineContext,
  { index }: { index: number }
) {
  const name = player.shop[index]
  if (!player.alive || !name || name === Pkm.DEFAULT) return

  const pokemon = PokemonFactory.createPokemonFromName(name, player)
  const isEvolution =
    pokemon.evolutionRule &&
    pokemon.evolutionRule instanceof CountEvolutionRule &&
    pokemon.evolutionRule.canEvolveIfGettingOne(pokemon, player)

  const cost = getBuyPrice(name, state.specialGameRule)
  const freeSpaceOnBench = getFreeSpaceOnBench(player.board)
  const hasSpaceOnBench = freeSpaceOnBench > 0 || isEvolution

  const canBuy = player.money >= cost && hasSpaceOnBench
  if (!canBuy) return

  player.money -= cost

  const x = getFirstAvailablePositionInBench(player.board)
  pokemon.positionX = x !== null ? x : -1
  pokemon.positionY = 0
  player.board.set(pokemon.id, pokemon)
  pokemon.onAcquired(player)

  if (
    pokemon.passive === Passive.UNOWN &&
    (player.effects.has(EffectEnum.EERIE_SPELL) ||
      player.shopsSinceLastUnownShop === 0) &&
    player.shopFreeRolls > 0 &&
    player.shop.every((p) => Unowns.includes(p) || p === Pkm.DEFAULT)
  ) {
    state.shop.assignShop(player, true, state)
    player.shopFreeRolls -= 1
  } else {
    player.shop[index] = Pkm.DEFAULT
  }

  context.checkEvolutionsAfterPokemonAcquired(player.id)
}

export function removeFromShop(
  state: GameState,
  player: Player,
  _context: IGameEngineContext,
  { index }: { index: number }
) {
  if (!player.alive) return
  const name = player.shop[index]
  if (!name || name === Pkm.DEFAULT) return

  const cost = getBuyPrice(name, state.specialGameRule)
  if (player.money >= cost) {
    player.shop[index] = Pkm.DEFAULT
    player.shopLocked = true
    state.shop.releasePokemon(name, player, state)
  }
}

export function sellPokemon(
  state: GameState,
  player: Player,
  context: IGameEngineContext,
  { pokemonId }: { pokemonId: string }
) {
  if (!player.alive) return

  const pokemon = player.board.get(pokemonId)
  if (!pokemon) return
  if (!isOnBench(pokemon) && state.phase === GamePhaseState.FIGHT) {
    return
  }

  if (canSell(pokemon.name, state.specialGameRule) === false) {
    return
  }

  player.board.delete(pokemonId)
  state.shop.releasePokemon(pokemon.name, player, state)

  const sellPrice = getSellPrice(pokemon, state.specialGameRule)
  player.addMoney(sellPrice, false, null)
  pokemon.items.forEach((it) => {
    player.items.push(it)
  })

  player.updateSynergies()
  player.boardSize = context.getTeamSize(player.board)
  pokemon.afterSell(player)
}

export function rerollShop(
  state: GameState,
  player: Player,
  _context: IGameEngineContext
) {
  if (!player.alive) return
  const rollCost = player.shopFreeRolls > 0 ? 0 : 1
  const canRoll = (player.money ?? 0) >= rollCost

  if (canRoll) {
    player.rerollCount++
    player.money -= rollCost
    if (player.shopFreeRolls > 0) {
      player.shopFreeRolls--
    } else {
      const repeatBallHolders = values(player.board).filter((p) =>
        p.items.has(Item.REPEAT_BALL)
      )
      if (repeatBallHolders.length > 0)
        player.shopFreeRolls += repeatBallHolders.length
    }
    state.shop.assignShop(player, true, state)
  }
}

export function levelUp(
  state: GameState,
  player: Player,
  _context: IGameEngineContext
) {
  if (!player.alive) return

  const cost = getLevelUpCost(state.specialGameRule)
  if (player.money >= cost && player.experienceManager.canLevelUp()) {
    player.addExperience(4)
    player.money -= cost
  }
}

export function lockShop(
  _state: GameState,
  player: Player,
  _context: IGameEngineContext
) {
  if (!player.alive) return
  player.shopLocked = !player.shopLocked
}

export function pickBerry(
  _state: GameState,
  player: Player,
  _context: IGameEngineContext,
  { berryIndex }: { berryIndex: number }
) {
  if (!player.alive) return
  if (player.berryTreesStages[berryIndex] >= 3) {
    player.berryTreesStages[berryIndex] = 0
    const type =
      getSynergyStep(player.synergies, Synergy.GRASS) === 4
        ? GOLDEN_BERRY_TREE_TYPES[berryIndex]
        : player.berryTreesType[berryIndex]
    player.items.push(type)
  }
}

function swapPokemonPositions(
  state: GameState,
  player: Player,
  pokemon: Pokemon,
  x: number,
  y: number
) {
  const pokemonToSwap = player.getPokemonAt(x, y)
  if (pokemonToSwap) {
    pokemonToSwap.positionX = pokemon.positionX
    pokemonToSwap.positionY = pokemon.positionY
    pokemonToSwap.onChangePosition(
      pokemon.positionX,
      pokemon.positionY,
      player,
      state
    )
  }
  pokemon.positionX = x
  pokemon.positionY = y
  pokemon.onChangePosition(x, y, player, state)
}

export function dragDropPokemon(
  state: GameState,
  player: Player,
  context: IGameEngineContext,
  { playerId, detail }: { playerId: string; detail: IDragDropMessage }
) {
  let success = false
  let dittoReplaced = false
  const message = {
    updateBoard: true,
    updateItems: true
  }

  if (player && player.alive) {
    message.updateItems = false
    const pokemon = player.board.get(detail.id)
    const { x, y } = detail

    if (
      pokemon &&
      x != null &&
      x >= 0 &&
      x < BOARD_WIDTH &&
      y != null &&
      y >= 0 &&
      y < BOARD_SIDE_HEIGHT
    ) {
      const dropOnBench = y == 0
      const dropFromBench = isOnBench(pokemon)

      if (
        pokemon.name === Pkm.DITTO &&
        dropFromBench &&
        !isPositionEmpty(x, y, player.board) &&
        !(state.phase === GamePhaseState.FIGHT && y > 0)
      ) {
        const pokemonToClone = player.getPokemonAt(x, y)
        if (pokemonToClone && pokemonToClone.canBeCloned) {
          dittoReplaced = true
          let pkm = getPokemonBaseline(pokemonToClone.name)
          if (PkmsWithAltForms.includes(pkm)) {
            pkm = getAltFormForPlayer(pkm, player)
          }
          const replaceDitto = PokemonFactory.createPokemonFromName(
            pkm,
            player
          )
          pokemon.items.forEach((item) => {
            player.items.push(item)
          })
          player.board.delete(detail.id)
          const position = getFirstAvailablePositionInBench(player.board)
          if (position !== null) {
            replaceDitto.positionX = position
            replaceDitto.positionY = 0
            player.board.set(replaceDitto.id, replaceDitto)
            success = true
            message.updateBoard = false
          }
        } else if (dropOnBench) {
          swapPokemonPositions(state, player, pokemon, x, y)
          success = true
        }
      } else if (
        pokemon.name === Pkm.MELTAN &&
        player.getPokemonAt(x, y)?.name === Pkm.MELMETAL
      ) {
        const melmetal = player.getPokemonAt(x, y)!
        melmetal.addMaxHP(50, player)
        pokemon.items.forEach((item) => {
          player.items.push(item)
        })
        player.board.delete(pokemon.id)
        success = true
      } else if (dropOnBench && dropFromBench) {
        swapPokemonPositions(state, player, pokemon, x, y)
        success = true
      } else if (state.phase == GamePhaseState.PICK) {
        const teamSize = context.getTeamSize(player.board)
        const isBoardFull =
          teamSize >=
          getMaxTeamSize(
            player.experienceManager.level,
            state.specialGameRule
          )
        const dropToEmptyPlace = isPositionEmpty(x, y, player.board)
        const target = player.getPokemonAt(x, y)

        if (dropOnBench) {
          if (
            pokemon.canBeBenched &&
            (!target || target.canBePlaced) &&
            !(isBoardFull && pokemon?.doesCountForTeamSize === false)
          ) {
            swapPokemonPositions(state, player, pokemon, x, y)
            success = true
          }
        } else if (
          pokemon.canBePlaced &&
          (!target || target.canBeBenched) &&
          !(
            dropFromBench &&
            dropToEmptyPlace &&
            isBoardFull &&
            pokemon.doesCountForTeamSize
          ) &&
          !(
            dropFromBench &&
            isBoardFull &&
            target?.doesCountForTeamSize === false
          )
        ) {
          swapPokemonPositions(state, player, pokemon, x, y)
          success = true
        }
      }
    }

    if (!success) {
      context.emit(Transfer.DRAG_DROP_CANCEL, message)
    }
    if (dittoReplaced) {
      context.checkEvolutionsAfterPokemonAcquired(playerId)
    }

    if (success) {
      player.updateSynergies()
      player.boardSize = context.getTeamSize(player.board)
    }
  }
}

export function switchBenchAndBoard(
  state: GameState,
  player: Player,
  context: IGameEngineContext,
  { pokemonId }: { pokemonId: string }
) {
  if (!player.alive) return

  const pokemon = player.board.get(pokemonId)
  if (!pokemon) return

  if (state.phase !== GamePhaseState.PICK) return

  if (pokemon.positionY === 0) {
    const teamSize = context.getTeamSize(player.board)
    const isBoardFull =
      teamSize >=
      getMaxTeamSize(
        player.experienceManager.level,
        state.specialGameRule
      )
    const destination = getFirstAvailablePositionOnBoard(
      player.board,
      pokemon.range
    )
    if (
      pokemon.canBePlaced &&
      destination &&
      !(isBoardFull && pokemon.doesCountForTeamSize)
    ) {
      const [x, y] = destination
      pokemon.positionX = x
      pokemon.positionY = y
      pokemon.onChangePosition(x, y, player, state)
    }
  } else {
    const x = getFirstAvailablePositionInBench(player.board)
    if (x !== null) {
      pokemon.positionX = x
      pokemon.positionY = 0
      pokemon.onChangePosition(x, 0, player, state)
    }
  }

  player.updateSynergies()
  player.boardSize = context.getTeamSize(player.board)
}

export function dragDropCombine(
  state: GameState,
  player: Player,
  context: IGameEngineContext,
  { detail }: { detail: IDragDropCombineMessage }
) {
  if (!player.alive) return

  const message = {
    updateBoard: false,
    updateItems: true
  }

  const itemA = detail.itemA
  const itemB = detail.itemB

  if (!player.items.includes(itemA) || !player.items.includes(itemB)) {
    context.emit(Transfer.DRAG_DROP_CANCEL, message)
    return
  } else if (itemA == itemB) {
    let count = 0
    player.items.forEach((item) => {
      if (item == itemA) {
        count++
      }
    })

    if (count < 2) {
      context.emit(Transfer.DRAG_DROP_CANCEL, message)
      return
    }
  }

  let result: Item | undefined = undefined

  if (itemA === Item.EXCHANGE_TICKET || itemB === Item.EXCHANGE_TICKET) {
    const exchangedItem = itemA === Item.EXCHANGE_TICKET ? itemB : itemA
    if (ItemComponentsNoScarf.includes(exchangedItem)) {
      result = pickRandomIn(
        ItemComponentsNoFossilOrScarf.filter((i) => i !== exchangedItem)
      )
    } else if ((SynergyStones as Item[]).includes(exchangedItem)) {
      result = pickRandomIn(SynergyStones.filter((i) => i !== exchangedItem))
    } else if (CraftableItemsNoScarves.includes(exchangedItem)) {
      result = pickRandomIn(
        CraftableNoStonesOrScarves.filter((i) => i !== exchangedItem)
      )
    } else {
      context.emit(Transfer.DRAG_DROP_CANCEL, message)
      return
    }
  } else if (itemA === Item.RECYCLE_TICKET || itemB === Item.RECYCLE_TICKET) {
    const recycledItem = itemA === Item.RECYCLE_TICKET ? itemB : itemA
    const recipe = ItemRecipe[recycledItem]
    if (!recipe) {
      context.emit(Transfer.DRAG_DROP_CANCEL, message)
      return
    }
    if (Scarves.includes(recycledItem)) {
      removeInArray(player.scarvesItems, recycledItem)
    }
    removeInArray(player.items, itemA)
    removeInArray(player.items, itemB)
    player.items.push(recipe[0])
    player.items.push(recipe[1])
    player.updateSynergies()
    return
  } else {
    const recipes = Object.entries(ItemRecipe) as [Item, Item[]][]
    for (const [key, value] of recipes) {
      if (
        (value[0] == itemA && value[1] == itemB) ||
        (value[0] == itemB && value[1] == itemA)
      ) {
        result = key
        break
      }
    }
  }

  if (!result) {
    context.emit(Transfer.DRAG_DROP_CANCEL, message)
    return
  } else {
    if (itemA === Item.SILK_SCARF || itemB === Item.SILK_SCARF) {
      const nbScarvesBasedOnNormalSynergy = getSynergyStep(
        player.synergies,
        Synergy.NORMAL
      )
      if (player.scarvesItems.length < nbScarvesBasedOnNormalSynergy) {
        player.scarvesItems.push(result)
      }
    }

    player.items.push(result)
    removeInArray(player.items, itemA)
    removeInArray(player.items, itemB)
  }

  player.updateSynergies()
}

export function dragDropItem(
  state: GameState,
  player: Player,
  context: IGameEngineContext,
  { detail }: { detail: IDragDropItemMessage }
) {
  if (!player.alive) return

  const message = {
    updateBoard: false,
    updateItems: true
  }

  const { zone, index, id: item } = detail

  if (!player.items.includes(item)) {
    context.emit(Transfer.DRAG_DROP_CANCEL, message)
    return
  }

  let pokemon: Pokemon | undefined
  if (zone === "flower-pot-zone") {
    const nbPots = getFlowerPotsUnlocked(player).length
    if (index >= nbPots) {
      context.emit(Transfer.DRAG_DROP_CANCEL, message)
      return
    }
    pokemon = player.flowerPots[index]
    if (!pokemon || isIn(Mulches, item) === false) {
      context.emit(Transfer.DRAG_DROP_CANCEL, message)
      return
    }
    if (item === Item.RICH_MULCH) {
      if (pokemon.evolution === Pkm.DEFAULT) {
        context.emit(Transfer.DRAG_DROP_CANCEL, {
          ...message,
          text: "fully_grown",
          pokemonId: pokemon.id
        })
        return
      }
      const potEvolution = PokemonFactory.createPokemonFromName(
        pokemon.evolution,
        player
      )
      potEvolution.action = PokemonActionState.SLEEP
      player.flowerPots[index] = potEvolution
      removeInArray(player.items, item)
      context.emit(Transfer.DRAG_DROP_CANCEL, message)
      return
    }
  } else if (zone === "berry-tree-zone") {
    const grassLevel = player.synergies.get(Synergy.GRASS) ?? 0
    const nbTrees = SynergyTriggers[Synergy.GRASS].filter(
      (n) => n <= grassLevel
    ).length

    if (item === Item.RICH_MULCH && index < nbTrees) {
      player.berryTreesStages[index] = 3
      removeInArray(player.items, item)
    } else if (item === Item.AMAZE_MULCH && index < nbTrees) {
      player.berryTreesType[index] = pickRandomIn(
        GOLDEN_BERRY_TREE_TYPES.filter(
          (b) => player.berryTreesType.includes(b) === false
        )
      )
      player.berryTreesStages[index] = 3
      removeInArray(player.items, item)
    }
    context.emit(Transfer.DRAG_DROP_CANCEL, message)
    return
  } else {
    const x = index % BOARD_WIDTH
    const y = Math.floor(index / BOARD_WIDTH)
    pokemon = player.getPokemonAt(x, y)
  }

  if (!pokemon) {
    context.emit(Transfer.DRAG_DROP_CANCEL, message)
    return
  }

  const onItemDroppedEffects: OnItemDroppedEffect[] = [
    ...(ItemEffects[item]?.filter(
      (effect) => effect instanceof OnItemDroppedEffect
    ) ?? []),
    ...(PassiveEffects[pokemon.passive]?.filter(
      (effect) => effect instanceof OnItemDroppedEffect
    ) ?? [])
  ]
  for (const onItemDroppedEffect of onItemDroppedEffects) {
    const shouldEquipItem = onItemDroppedEffect.apply({
      pokemon,
      player,
      item,
      context
    })
    if (shouldEquipItem === false) {
      context.emit(Transfer.DRAG_DROP_CANCEL, message)
      return
    }
  }

  if (isIn(Dishes, item)) {
    if (pokemon.canEat && !pokemon.dishes.has(item)) {
      pokemon.dishes.add(item)
      pokemon.action = PokemonActionState.EAT
      removeInArray(player.items, item)
      context.emit(Transfer.DRAG_DROP_CANCEL, message)
      pokemon.items.add(item)
      const pokemonEvolved = context.checkEvolutionsAfterItemAcquired(
        player.id,
        pokemon
      )
      if (pokemonEvolved) pokemonEvolved.items.delete(item)
      else pokemon.items.delete(item)
      return
    } else {
      context.emit(Transfer.DRAG_DROP_CANCEL, {
        ...message,
        text: pokemon.dishes.size > 0 ? "belly_full" : "not_hungry",
        pokemonId: pokemon.id
      })
      return
    }
  }

  if (UnholdableItems.includes(item) && !ConsumableItems.includes(item)) {
    context.emit(Transfer.DRAG_DROP_CANCEL, message)
    return
  }

  if (
    pokemon.canHoldItems === false &&
    !(UnholdableItems.includes(item) && isIn(ConsumableItems, item))
  ) {
    context.emit(Transfer.DRAG_DROP_CANCEL, message)
    return
  }

  const isBasicItem = ItemComponents.includes(item)
  const existingBasicItemToCombine = values(pokemon.items).find((i) =>
    ItemComponents.includes(i)
  )

  if (
    pokemon.items.size >= 3 &&
    !(isBasicItem && existingBasicItemToCombine) &&
    UnholdableItems.includes(item) === false
  ) {
    context.emit(Transfer.DRAG_DROP_CANCEL, {
      ...message,
      text: "full",
      pokemonId: pokemon.id
    })
    return
  }

  if (!isBasicItem && pokemon.items.has(item)) {
    context.emit(Transfer.DRAG_DROP_CANCEL, {
      ...message,
      text: "already_held",
      pokemonId: pokemon.id
    })
    return
  }

  if (isBasicItem && existingBasicItemToCombine) {
    const recipe = Object.entries(ItemRecipe).find(
      ([_result, recipe]) =>
        (recipe[0] === existingBasicItemToCombine && recipe[1] === item) ||
        (recipe[0] === item && recipe[1] === existingBasicItemToCombine)
    )

    if (!recipe) {
      context.emit(Transfer.DRAG_DROP_CANCEL, message)
      return
    }

    const itemCombined = recipe[0] as Item

    if (recipe[1].includes(Item.SILK_SCARF)) {
      const nbScarvesBasedOnNormalSynergy = getSynergyStep(
        player.synergies,
        Synergy.NORMAL
      )
      if (player.scarvesItems.length < nbScarvesBasedOnNormalSynergy) {
        player.scarvesItems.push(itemCombined)
      }
    }

    pokemon.items.delete(existingBasicItemToCombine)
    removeInArray(player.items, item)

    if (pokemon.items.has(itemCombined)) {
      player.items.push(itemCombined)
    } else if (
      (isIn(SynergyStones, itemCombined) ||
        itemCombined === Item.FRIEND_BOW) &&
      pokemon.types.has(SynergyGivenByItem[itemCombined])
    ) {
      player.items.push(itemCombined)
    } else {
      pokemon.addItem(itemCombined, player)
    }
  } else {
    if (
      (isIn(SynergyStones, item) || item === Item.FRIEND_BOW) &&
      pokemon.types.has(SynergyGivenByItem[item])
    ) {
      context.emit(Transfer.DRAG_DROP_CANCEL, message)
      return
    }
    pokemon.addItem(item, player)
    removeInArray(player.items, item)
  }

  if (pokemon.items.has(Item.SHINY_CHARM)) {
    pokemon.shiny = true
  }

  context.checkEvolutionsAfterItemAcquired(player.id, pokemon)

  if (pokemon.items.has(item) && isIn(UnholdableItems, item)) {
    pokemon.items.delete(item)
    if (!isIn(ConsumableItems, item) && !isIn(Mulches, item)) {
      player.items.push(item)
    }
  }

  player.updateSynergies()
}

export function wandererClicked(
  state: GameState,
  player: Player,
  context: IGameEngineContext,
  { id }: { id: string }
) {
  if (!player.alive) return
  const wanderer = player.wanderers.get(id)
  if (!wanderer) return
  player.wanderers.delete(id)

  if (wanderer.type === WandererType.UNOWN) {
    const unownIndex = PkmIndex[wanderer.pkm]
    const shardsGained = wanderer.shiny
      ? SHARDS_PER_SHINY_UNOWN_WANDERER
      : SHARDS_PER_UNOWN_WANDERER
    const u = getPlayer()
    if (u) {
      const c = u.pokemonCollection.get(unownIndex)
      if (c) {
        c.dust += shardsGained
      } else {
        u.pokemonCollection.set(unownIndex, {
          id: unownIndex,
          unlocked: Buffer.alloc(5, 0),
          dust: shardsGained,
          selectedEmotion: Emotion.NORMAL,
          selectedShiny: false,
          played: 0
        })
      }
    }
  } else if (wanderer.type === WandererType.CATCHABLE) {
    const pokemon = PokemonFactory.createPokemonFromName(wanderer.pkm, player)
    const freeSpaceOnBench = getFreeSpaceOnBench(player.board)
    const hasSpaceOnBench =
      freeSpaceOnBench > 0 ||
      (pokemon.evolutionRule &&
        pokemon.evolutionRule instanceof CountEvolutionRule &&
        pokemon.evolutionRule.canEvolveIfGettingOne(pokemon, player))

    if (hasSpaceOnBench) {
      const x = getFirstAvailablePositionInBench(player.board)
      pokemon.positionX = x !== null ? x : -1
      pokemon.positionY = 0
      player.board.set(pokemon.id, pokemon)
      pokemon.onAcquired(player)
      context.checkEvolutionsAfterPokemonAcquired(player.id)
    }
  } else if (wanderer.type === WandererType.OUTLAW) {
    player.addMoney(OUTLAW_GOLD_REWARD, true, null)
    removeInArray(player.items, Item.WANTED_NOTICE)
  }
}
