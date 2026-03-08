/**
 * game-engine-phases.ts
 * Phase transition logic extracted from OnUpdatePhaseCommand.
 * Functions for each phase: PICK→FIGHT, FIGHT→PICK, FIGHT→TOWN, TOWN→PICK.
 * Also includes: game loop tick, achievements, streaks, income, death checks, wanderer spawning.
 */

import { nanoid } from "nanoid"
import {
  AdditionalPicksStages,
  BOARD_WIDTH,
  FIGHTING_PHASE_DURATION,
  ITEM_CAROUSEL_BASE_DURATION,
  ItemCarouselStages,
  ItemSellPricesAtTown,
  PORTAL_CAROUSEL_BASE_DURATION,
  PortalCarouselStages,
  SHINY_UNOWN_ENCOUNTER_CHANCE,
  StageDuration,
  TREASURE_BOX_LIFE_THRESHOLD,
  UNOWN_ENCOUNTER_CHANCE
} from "../../config"
import { castAbility } from "../../core/abilities/abilities"
import { OnStageStartEffect } from "../../core/effects/effect"
import { ItemEffects } from "../../core/effects/items"
import { PassiveEffects } from "../../core/effects/passives"
import { giveRandomEgg } from "../../core/eggs"
import {
  ConditionBasedEvolutionRule,
  CountEvolutionRule,
  HatchEvolutionRule
} from "../../core/evolution-rules"
import { selectMatchups } from "../../core/matchmaking"
import { PokemonEntity } from "../../core/pokemon-entity"
import Simulation from "../../core/simulation"
import Player from "../../models/colyseus-models/player"
import { Pokemon, PokemonClasses } from "../../models/colyseus-models/pokemon"
import { getSynergyStep } from "../../models/colyseus-models/synergies"
import { Wanderer } from "../../models/colyseus-models/wanderer"
import GameState from "../../models/colyseus-models/game-state"
import PokemonFactory from "../../models/pokemon-factory"
import { PVEStages } from "../../models/pve-stages"
import { getSellPrice } from "../../models/shop"
import {
  IGameEngineContext,
  Title,
  Transfer
} from "../../types"
import { BattleEvent } from "../../types/BattleEvent"
import { DungeonPMDO } from "../../types/enum/Dungeon"
import { EffectEnum } from "../../types/enum/Effect"
import {
  BattleResult,
  GamePhaseState,
  Rarity,
  Team
} from "../../types/enum/Game"
import {
  CraftableItems,
  Item,
  ItemComponents,
  ItemComponentsNoScarf,
  ItemsSoldAtTown,
  Scarves,
  ShinyItems,
  Sweets,
  SynergyGems,
  SynergyGivenByGem,
  Tools
} from "../../types/enum/Item"
import { Passive } from "../../types/enum/Passive"
import {
  Pkm,
  PkmIndex,
  PkmRegionalVariants,
  Unowns,
  UnownsForScribble
} from "../../types/enum/Pokemon"
import { SpecialGameRule } from "../../types/enum/SpecialGameRule"
import { Synergy } from "../../types/enum/Synergy"
import { TownEncounters } from "../../types/enum/TownEncounter"
import { WandererBehavior, WandererType } from "../../types/enum/Wanderer"
import { isIn, removeInArray } from "../../utils/array"
import { getAvatarString } from "../../utils/avatar"
import {
  getFirstAvailablePositionInBench,
  getFirstAvailablePositionOnBoard,
  getFreeSpaceOnBench,
  getMaxTeamSize,
  isOnBench
} from "../../utils/board"
import { repeat } from "../../utils/function"
import { max } from "../../utils/number"
import {
  chance,
  pickNRandomIn,
  pickRandomIn,
  randomBetween
} from "../../utils/random"
import { resetArraySchema, values } from "../../utils/schemas"
import { getWeather } from "../../utils/weather"
import type { IPokemonEntity } from "../../types"
import type { PkmProposition } from "../../types/enum/Pokemon"

/**
 * Main phase update — called when timer expires or all simulations finish.
 */
export function updatePhase(state: GameState, context: IGameEngineContext) {
  const prevPhase = state.phase
  state.updatePhaseNeeded = false
  if (state.phase == GamePhaseState.TOWN) {
    console.log("[Phase] TOWN → stopping town, stageLevel:", state.stageLevel)
    stopTownPhase(state, context)
    if (state.stageLevel === 0) {
      state.stageLevel = 1
    }
    console.log("[Phase] TOWN → initializing PICK, stageLevel:", state.stageLevel)
    initializePickingPhase(state, context)
  } else if (state.phase == GamePhaseState.PICK) {
    console.log("[Phase] PICK → FIGHT, stageLevel:", state.stageLevel)
    stopPickingPhase(state, context)
    checkForLazyTeam(state, context)
    initializeFightingPhase(state, context)
  } else if (state.phase == GamePhaseState.FIGHT) {
    console.log("[Phase] FIGHT → next, stageLevel:", state.stageLevel)
    stopFightingPhase(state, context)
    if (
      (ItemCarouselStages.includes(state.stageLevel) ||
        PortalCarouselStages.includes(state.stageLevel)) &&
      !state.gameFinished
    ) {
      initializeTownPhase(state, context)
    } else {
      initializePickingPhase(state, context)
    }
  }
  console.log("[Phase] transition complete:", prevPhase, "→", state.phase, "time:", state.time)
}

/**
 * Game loop tick — called every frame by the engine.
 */
export function tick(
  state: GameState,
  context: IGameEngineContext,
  deltaTime: number
): boolean {
  state.time -= deltaTime
  if (Math.round(state.time / 1000) != state.roundTime) {
    state.roundTime = Math.round(state.time / 1000)
    console.log("[Tick] phase:", state.phase, "roundTime:", state.roundTime, "s", "stageLevel:", state.stageLevel)
  }
  if (state.time < 0) {
    state.updatePhaseNeeded = true
  } else if (state.phase == GamePhaseState.FIGHT) {
    let everySimulationFinished = true

    state.simulations.forEach((simulation) => {
      if (!simulation.finished) {
        if (simulation.started) {
          const events = simulation.update(deltaTime)
          for (const event of events) {
            processBattleEvent(state, context, event)
          }
        }
        everySimulationFinished = false
      }
    })

    if (everySimulationFinished && !state.updatePhaseNeeded) {
      state.time = 3000
      state.updatePhaseNeeded = true
    }
  } else if (state.phase === GamePhaseState.TOWN) {
    context.miniGame?.update(deltaTime)
  }

  if (state.updatePhaseNeeded && state.time < 0) {
    updatePhase(state, context)
    return true
  }
  return false
}

export function processBattleEvent(
  state: GameState,
  context: IGameEngineContext,
  event: BattleEvent
) {
  switch (event.type) {
    case "ABILITY":
      // In single-player, always emit — the human player's spectated view
      context.emit(Transfer.ABILITY, {
        id: event.id,
        skill: event.skill,
        ap: event.ap,
        positionX: event.positionX,
        positionY: event.positionY,
        orientation: event.orientation,
        targetX: event.targetX,
        targetY: event.targetY,
        delay: event.delay
      })
      break

    case "POKEMON_DAMAGE":
      context.emit(Transfer.POKEMON_DAMAGE, {
        index: event.index,
        type: event.attackType,
        amount: event.amount,
        x: event.x,
        y: event.y,
        id: event.id
      })
      break

    case "POKEMON_HEAL":
      context.emit(Transfer.POKEMON_HEAL, {
        index: event.index,
        type: event.healType,
        amount: event.amount,
        x: event.x,
        y: event.y,
        id: event.id
      })
      break

    case "BOARD_EVENT":
      context.emit(Transfer.BOARD_EVENT, {
        simulationId: event.simulationId,
        effect: event.effect,
        x: event.x,
        y: event.y
      })
      break

    case "CLEAR_BOARD":
      context.emit(Transfer.CLEAR_BOARD, {
        simulationId: event.simulationId
      })
      break

    case "CLEAR_BOARD_EVENT":
      context.emit(Transfer.CLEAR_BOARD_EVENT, {
        simulationId: event.simulationId,
        effect: event.effect,
        x: event.x,
        y: event.y
      })
      break

    case "SIMULATION_END":
      context.emit(Transfer.SIMULATION_STOP, undefined)
      rankPlayers(state)
      break

    case "PLAYER_INCOME":
      context.emit(Transfer.PLAYER_INCOME, event.amount)
      break

    case "PLAYER_DAMAGE":
      context.emit(Transfer.PLAYER_DAMAGE, event.amount)
      break
  }
}

function computeAchievements(state: GameState) {
  state.players.forEach((player) => {
    checkSuccess(state, player)
  })
}

function checkSuccess(state: GameState, player: Player) {
  player.titles.add(Title.NOVICE)
  const effects = state.simulations
    .get(player.simulationId)
    ?.getEffects(player.id)
  if (effects) {
    effects.forEach((effect) => {
      switch (effect) {
        case EffectEnum.PURE_POWER:
          player.titles.add(Title.POKEFAN)
          break
        case EffectEnum.OVERGROW:
          player.titles.add(Title.POKEMON_RANGER)
          break
        case EffectEnum.DESOLATE_LAND:
          player.titles.add(Title.KINDLER)
          break
        case EffectEnum.PRIMORDIAL_SEA:
          player.titles.add(Title.FIREFIGHTER)
          break
        case EffectEnum.POWER_SURGE:
          player.titles.add(Title.ELECTRICIAN)
          break
        case EffectEnum.JUSTIFIED:
          player.titles.add(Title.BLACK_BELT)
          break
        case EffectEnum.EERIE_SPELL:
          player.titles.add(Title.TELEKINESIST)
          break
        case EffectEnum.BEAT_UP:
          player.titles.add(Title.DELINQUENT)
          break
        case EffectEnum.MAX_MELTDOWN:
          player.titles.add(Title.ENGINEER)
          break
        case EffectEnum.DEEP_MINER:
          player.titles.add(Title.GEOLOGIST)
          break
        case EffectEnum.TOXIC:
          player.titles.add(Title.TEAM_ROCKET_GRUNT)
          break
        case EffectEnum.DRAGON_DANCE:
          player.titles.add(Title.DRAGON_TAMER)
          break
        case EffectEnum.ANGER_POINT:
          player.titles.add(Title.CAMPER)
          break
        case EffectEnum.MERCILESS:
          player.titles.add(Title.MYTH_TRAINER)
          break
        case EffectEnum.CALM_MIND:
          player.titles.add(Title.RIVAL)
          break
        case EffectEnum.SURGE_SURFER:
          player.titles.add(Title.SURFER)
          break
        case EffectEnum.HEART_OF_THE_SWARM:
          player.titles.add(Title.BUG_MANIAC)
          break
        case EffectEnum.SKYDIVE:
          player.titles.add(Title.BIRD_KEEPER)
          break
        case EffectEnum.FLOWER_POWER:
          player.titles.add(Title.GARDENER)
          break
        case EffectEnum.GOOGLE_SPECS:
          player.titles.add(Title.ALCHEMIST)
          break
        case EffectEnum.BERSERK:
          player.titles.add(Title.BERSERKER)
          break
        case EffectEnum.ETHEREAL:
          player.titles.add(Title.BLOB)
          break
        case EffectEnum.BANQUET:
          player.titles.add(Title.CHEF)
          break
        case EffectEnum.DIAMOND_STORM:
          player.titles.add(Title.HIKER)
          break
        case EffectEnum.CURSE_OF_FATE:
          player.titles.add(Title.HEX_MANIAC)
          break
        case EffectEnum.MOON_FORCE:
          player.titles.add(Title.CUTE_MANIAC)
          break
        case EffectEnum.SHEER_COLD:
          player.titles.add(Title.SKIER)
          break
        case EffectEnum.FORGOTTEN_POWER:
          player.titles.add(Title.MUSEUM_DIRECTOR)
          break
        case EffectEnum.PRESTO:
          player.titles.add(Title.MUSICIAN)
          break
        case EffectEnum.GOLDEN_EGGS:
          player.titles.add(Title.BABYSITTER)
          break
        case EffectEnum.MAX_ILLUMINATION:
          player.titles.add(Title.CHOSEN_ONE)
          break
        default:
          break
      }
    })
    if (effects.size >= 5) {
      player.titles.add(Title.HARLEQUIN)
    }
    if (effects.size >= 10) {
      player.titles.add(Title.TACTICIAN)
    }
    if (effects.size >= 15) {
      player.titles.add(Title.STRATEGIST)
    }
    let shield = 0
    let heal = 0
    const dpsMeter = state.simulations
      .get(player.simulationId)
      ?.getDpsMeter(player.id)

    if (dpsMeter) {
      dpsMeter.forEach((v) => {
        shield += v.shield
        heal += v.heal
      })
    }

    if (shield > 1000) {
      player.titles.add(Title.GARDIAN)
    }
    if (heal > 1000) {
      player.titles.add(Title.NURSE)
    }

    if (state.stageLevel >= 40) {
      player.titles.add(Title.ETERNAL)
    }

    const equippedItems = values(player.board).flatMap((p) => values(p.items))
    if (equippedItems.filter((i) => isIn(Scarves, i)).length >= 5) {
      player.titles.add(Title.SCOUT)
    }
  }
}

function checkEndGame(state: GameState, context: IGameEngineContext): boolean {
  const playersAlive = values(state.players).filter((p) => p.alive)

  if (playersAlive.length <= 1) {
    state.gameFinished = true
    const winner = playersAlive[0]
    if (winner) {
      context.emit(Transfer.FINAL_RANK, 1)
    }
    context.addDelayedAction(30 * 1000, () => {
      context.emit(Transfer.GAME_END, undefined)
    })

    return true
  }

  return false
}

function computeStreak(state: GameState, isPVE: boolean) {
  if (isPVE) return
  state.players.forEach((player) => {
    if (!player.alive) {
      return
    }

    const [previousBattleResult, lastBattleResult] = player.history
      .filter(
        (stage) => stage.id !== "pve" && stage.result !== BattleResult.DRAW
      )
      .map((stage) => stage.result)
      .slice(-2)

    if (lastBattleResult === BattleResult.DRAW) {
      // preserve existing streak
    } else if (lastBattleResult !== previousBattleResult) {
      player.streak = 0
    } else {
      player.streak += 1
    }
  })
}

function computeIncome(
  state: GameState,
  context: IGameEngineContext,
  isPVE: boolean,
  specialGameRule: SpecialGameRule | null
) {
  state.players.forEach((player) => {
    let income = 0
    if (player.alive && !player.isBot) {
      const nbGimmighoulCoins = player.items.filter(
        (item) => item === Item.GIMMIGHOUL_COIN
      ).length
      const nbAmuletCoins =
        player.items.filter((item) => item === Item.AMULET_COIN).length +
        values(player.board).filter((pokemon) =>
          pokemon.items.has(Item.AMULET_COIN)
        ).length
      player.maxInterest = 5 + nbGimmighoulCoins - nbAmuletCoins
      if (specialGameRule !== SpecialGameRule.BLOOD_MONEY) {
        player.interest = max(player.maxInterest)(
          Math.floor(player.money / 10)
        )
        income += player.interest
      }
      if (!isPVE) {
        income += max(5)(player.streak)
      }
      income += 5
      player.addMoney(income, true, null)
      if (income > 0) {
        context.emit(Transfer.PLAYER_INCOME, income)
      }
      player.addExperience(2)
    }
  })
}

function checkDeath(state: GameState, context: IGameEngineContext) {
  state.players.forEach((player: Player) => {
    if (player.life <= 0 && player.alive) {
      if (!player.isBot) {
        player.shop.forEach((pkm) => {
          state.shop.releasePokemon(pkm, player, state)
        })
        player.board.forEach((pokemon) => {
          state.shop.releasePokemon(pokemon.name, player, state)
        })
      }
      player.alive = false
      player.spectatedPlayerId = player.id
      if (!player.isBot) {
        context.emit(Transfer.FINAL_RANK, player.rank)
      }
    }
  })
}

export function rankPlayers(state: GameState) {
  const rankArray = new Array<{ id: string; life: number; level: number }>()
  state.players.forEach((player) => {
    if (!player.alive) {
      return
    }

    rankArray.push({
      id: player.id,
      life: player.life,
      level: player.experienceManager.level
    })
  })

  const sortPlayers = (
    a: { id: string; life: number; level: number },
    b: { id: string; life: number; level: number }
  ) => {
    let diff = b.life - a.life
    if (diff == 0) {
      diff = b.level - a.level
    }
    return diff
  }

  rankArray.sort(sortPlayers)

  rankArray.forEach((rankPlayer, index) => {
    const player = state.players.get(rankPlayer.id)
    if (player) {
      player.rank = index + 1
    }
  })
}

export function computeRoundDamage(
  opponentTeam: Map<string, IPokemonEntity>,
  stageLevel: number
) {
  let damage = Math.ceil(stageLevel / 2)
  if (opponentTeam.size > 0) {
    opponentTeam.forEach((pokemon) => {
      if (!pokemon.isSpawn && pokemon.passive !== Passive.INANIMATE) {
        damage += 1
      }
    })
  }
  return damage
}

function initializePickingPhase(
  state: GameState,
  context: IGameEngineContext
) {
  state.phase = GamePhaseState.PICK
  state.time =
    (StageDuration[state.stageLevel] ?? StageDuration.DEFAULT) * 1000

  if (
    [2, 4].includes(state.stageLevel) &&
    state.specialGameRule === SpecialGameRule.TECHNOLOGIC
  ) {
    state.players.forEach((player: Player) => {
      const itemsSet = Tools.filter(
        (item) => player.artificialItems.includes(item) === false
      )
      resetArraySchema(player.itemsProposition, pickNRandomIn(itemsSet, 3))
    })
  }

  // Additional pick stages
  if (AdditionalPicksStages.includes(state.stageLevel)) {
    const pool =
      state.stageLevel === AdditionalPicksStages[0]
        ? context.additionalUncommonPool!
        : state.stageLevel === AdditionalPicksStages[1]
          ? context.additionalRarePool!
          : context.additionalEpicPool!
    let remainingAddPicks = 8
    state.players.forEach((player: Player) => {
      if (!player.isBot) {
        const items = pickNRandomIn(ItemComponentsNoScarf, 3)
        for (let i = 0; i < 3; i++) {
          const p = pool.pop()
          if (p) {
            const regionalVariants = (PkmRegionalVariants[p] ?? []).filter(
              (pkm) =>
                new PokemonClasses[pkm](pkm).isInRegion(
                  player.map === "town" ? DungeonPMDO.AmpPlains : player.map
                )
            )
            if (regionalVariants.length > 0) {
              player.pokemonsProposition.push(pickRandomIn(regionalVariants))
            } else {
              player.pokemonsProposition.push(p)
            }
            player.itemsProposition.push(items[i])
          }
        }
        remainingAddPicks--
      }
    })

    repeat(remainingAddPicks)(() => {
      const p = pool.pop()
      if (p) {
        state.shop.addAdditionalPokemon(p, state)
      }
    })

    state.players.forEach((p) => p.updateRegionalPool(state, false))
  }

  state.players.forEach((p) => updatePlayerBetweenStages(state, context, p))

  spawnWanderingPokemons(state, context)

  // PvE stage initialization
  const pveStage = PVEStages[state.stageLevel]
  if (pveStage) {
    state.shinyEncounter =
      state.townEncounter === TownEncounters.CELEBI ||
      (state.specialGameRule === SpecialGameRule.SHINY_HUNTER &&
        pveStage.shinyChance !== undefined) ||
      chance(pveStage.shinyChance ?? 0)
  }
}

function updatePlayerBetweenStages(
  state: GameState,
  context: IGameEngineContext,
  player: Player
) {
  const board = values(player.board)

  if (
    getSynergyStep(player.synergies, Synergy.FIRE) === 4 &&
    player.items.includes(Item.FIRE_SHARD) === false &&
    player.life > 2
  ) {
    player.items.push(Item.FIRE_SHARD)
  }

  if (
    player.items.includes(Item.TREASURE_BOX) &&
    player.life <= TREASURE_BOX_LIFE_THRESHOLD
  ) {
    removeInArray(player.items, Item.TREASURE_BOX)

    let rewards: Item[] = []
    let rewardsIcons: Item[] | undefined = undefined
    switch (state.treasureBoxRewardGiven) {
      case "sweets":
        rewardsIcons = [Item.SWEETS]
        rewards = pickNRandomIn(Sweets, 5)
        break
      case "itemComponents":
        rewards = pickNRandomIn(ItemComponents, 4)
        break
      case "componentsAndTickets":
        rewards = [
          ...pickNRandomIn(ItemComponents, 2),
          Item.RECYCLE_TICKET,
          Item.EXCHANGE_TICKET
        ]
        break
      case "craftableItems":
        rewards = pickNRandomIn(CraftableItems, 2)
        break
      case "mushrooms":
        rewardsIcons = [Item.MUSHROOMS]
        rewards = [Item.TINY_MUSHROOM, Item.BIG_MUSHROOM, Item.BALM_MUSHROOM]
        break
      case "goldBow":
        rewards = [Item.GOLD_BOW]
        break
      case "gold":
      default:
        rewards = [Item.BIG_NUGGET]
        break
    }

    const id = nanoid()
    const wanderer = new Wanderer({
      id,
      pkm: Pkm.XATU,
      shiny: false,
      type: WandererType.DIALOG,
      behavior: WandererBehavior.SPECTATE,
      data: (rewardsIcons ?? rewards).join(";")
    })
    context.addDelayedAction(3000, () => player.wanderers.set(id, wanderer))
    context.addDelayedAction(10000, () => {
      if (rewards[0] === Item.BIG_NUGGET) {
        const moneyGained = 10
        player.addMoney(moneyGained, true, null)
        context.emit(Transfer.PLAYER_INCOME, moneyGained)
      } else {
        player.items.push(...rewards)
      }
    })
  }

  const nbTrees = getSynergyStep(player.synergies, Synergy.GRASS)
  for (let i = 0; i < nbTrees; i++) {
    player.berryTreesStages[i] = max(3)(player.berryTreesStages[i] + 1)
  }

  if (getSynergyStep(player.synergies, Synergy.GROUND) > 0) {
    player.board.forEach((pokemon, pokemonId) => {
      if (
        pokemon.types.has(Synergy.GROUND) &&
        !isOnBench(pokemon) &&
        pokemon.items.has(Item.CHEF_HAT) === false
      ) {
        const index =
          (pokemon.positionY - 1) * BOARD_WIDTH + pokemon.positionX
        const hasAlreadyReachedMaxDepth = player.groundHoles[index] === 5
        const isReachingMaxDepth = player.groundHoles[index] === 4
        if (!hasAlreadyReachedMaxDepth) {
          let buriedItem = isReachingMaxDepth
            ? player.buriedItems[index]
            : null
          if (
            pokemon.items.has(Item.EXPLORER_KIT) &&
            isReachingMaxDepth &&
            !buriedItem
          ) {
            if (chance(0.1, pokemon)) {
              buriedItem = Item.BIG_NUGGET
            } else if (chance(0.5, pokemon)) {
              buriedItem = Item.NUGGET
            } else {
              buriedItem = Item.COIN
            }
          }
          context.emit(Transfer.DIG, {
            pokemonId,
            buriedItem
          })
          context.addDelayedAction(1000, () => {
            player.groundHoles[index] = max(5)(player.groundHoles[index] + 1)
            if (pokemon.passive === Passive.ORTHWORM) {
              pokemon.addMaxHP(5, player)
            }
            player.board.forEach((pokemon) => {
              if (
                pokemon.evolutionRule instanceof ConditionBasedEvolutionRule
              ) {
                pokemon.evolutionRule.tryEvolve(
                  pokemon,
                  player,
                  state.stageLevel
                )
              }
            })
          })

          if (buriedItem) {
            context.addDelayedAction(2500, () => {
              if (buriedItem === Item.COIN) {
                player.addMoney(1, true, null)
              } else if (buriedItem === Item.NUGGET) {
                player.addMoney(3, true, null)
              } else if (buriedItem === Item.BIG_NUGGET) {
                player.addMoney(10, true, null)
              } else if (buriedItem === Item.TREASURE_BOX) {
                player.items.push(...pickNRandomIn(ItemComponents, 2))
              } else if (isIn(SynergyGems, buriedItem)) {
                const type = SynergyGivenByGem[buriedItem]
                player.bonusSynergies.set(
                  type,
                  (player.bonusSynergies.get(type) ?? 0) + 1
                )
                player.items.push(buriedItem)
                player.updateSynergies()
              } else {
                player.items.push(buriedItem)
              }
            })
          }
        }
      }
    })
  }

  const rottingItems: Map<Item, Item> = new Map([
    [Item.SIRUPY_APPLE, Item.LEFTOVERS],
    [Item.SWEET_APPLE, Item.SIRUPY_APPLE],
    [Item.TART_APPLE, Item.SWEET_APPLE]
  ])

  for (const rottingItem of rottingItems.keys()) {
    while (player.items.includes(rottingItem as Item)) {
      const index = player.items.indexOf(rottingItem)
      const newItem = rottingItems.get(rottingItem)
      if (index >= 0 && newItem) {
        player.items.splice(index, 1)
        player.items.push(newItem)
      }
    }
  }

  if (
    state.specialGameRule === SpecialGameRule.FIRST_PARTNER &&
    state.stageLevel > 1 &&
    state.stageLevel < 10 &&
    player.firstPartner
  ) {
    context.spawnOnBench(player, player.firstPartner, "spawn")
  }

  if (state.specialGameRule === SpecialGameRule.GO_BIG_OR_GO_HOME) {
    board.forEach((pokemon) => {
      pokemon.addMaxHP(5, player)
    })
  }

  if (
    player.pokemonsTrainingInDojo.some(
      (p) => p.returnStage === state.stageLevel
    )
  ) {
    const returningPokemons = player.pokemonsTrainingInDojo.filter(
      (p) => p.returnStage === state.stageLevel
    )
    returningPokemons.forEach((p) => {
      const substitute = values(player.board).find(
        (s) => s.name === Pkm.SUBSTITUTE && s.id === p.pokemon.id
      )
      if (!substitute) return
      p.pokemon.hp += [50, 100, 150][p.ticketLevel - 1] ?? 0
      p.pokemon.maxHP += [50, 100, 150][p.ticketLevel - 1] ?? 0
      p.pokemon.atk += [5, 10, 15][p.ticketLevel - 1] ?? 0
      p.pokemon.ap += [15, 30, 45][p.ticketLevel - 1] ?? 0
      p.pokemon.positionX = substitute.positionX
      p.pokemon.positionY = substitute.positionY
      player.board.delete(substitute.id)
      player.board.set(p.pokemon.id, p.pokemon)
      p.pokemon.types = new Set<Synergy>(values(p.pokemon.types))
      p.pokemon.items = new Set<Item>()
      p.pokemon.addItems(values(substitute.items), player)
      substitute.items.clear()
      context.checkEvolutionsAfterPokemonAcquired(player.id)
      player.pokemonsTrainingInDojo.splice(
        player.pokemonsTrainingInDojo.indexOf(p),
        1
      )
    })
  }

  board.forEach((pokemon) => {
    // Passives updating every stage
    const passiveEffects =
      PassiveEffects[pokemon.passive]?.filter(
        (p) => p instanceof OnStageStartEffect
      ) ?? []
    passiveEffects.forEach((effect) =>
      effect.apply({ pokemon, player, context })
    )

    // Held item effects on stage start
    const itemEffects =
      values(pokemon.items)
        .flatMap((item) => ItemEffects[item])
        ?.filter((p) => p instanceof OnStageStartEffect) ?? []
    itemEffects.forEach((effect) =>
      effect.apply({ pokemon, player, context })
    )

    // Condition based evolutions on stage start
    if (pokemon.evolutionRule instanceof ConditionBasedEvolutionRule) {
      pokemon.evolutionRule.tryEvolve(pokemon, player, state.stageLevel)
    }
  })

  // Unholdable item effects on stage start
  player.items.forEach((item) => {
    const itemEffects =
      ItemEffects[item]?.filter((p) => p instanceof OnStageStartEffect) ?? []
    itemEffects.forEach((effect) => effect.apply({ player, context }))
  })
}

function checkForLazyTeam(state: GameState, context: IGameEngineContext) {
  state.players.forEach((player) => {
    if (player.isBot) return

    const teamSize = context.getTeamSize(player.board)
    const maxTeamSize = getMaxTeamSize(
      player.experienceManager.level,
      state.specialGameRule
    )
    if (teamSize < maxTeamSize) {
      const numberOfPokemonsToMove = maxTeamSize - teamSize
      for (let i = 0; i < numberOfPokemonsToMove; i++) {
        const pokemon = values(player.board)
          .filter((p) => isOnBench(p) && p.canBePlaced)
          .sort((a, b) => a.positionX - b.positionX)[0]
        if (pokemon) {
          const coordinates = getFirstAvailablePositionOnBoard(
            player.board,
            pokemon.types.has(Synergy.DARK) && pokemon.range === 1
              ? 3
              : pokemon.range
          )

          if (coordinates) {
            pokemon.positionX = coordinates[0]
            pokemon.positionY = coordinates[1]
            pokemon.onChangePosition(
              coordinates[0],
              coordinates[1],
              player,
              state
            )
          }
        }
      }
      if (numberOfPokemonsToMove > 0) {
        player.updateSynergies()
        player.boardSize = context.getTeamSize(player.board)
      }
    }
  })
}

function stopPickingPhase(state: GameState, context: IGameEngineContext) {
  state.players.forEach((player) => {
    const pokemonsProposition = values(player.pokemonsProposition)

    if (pokemonsProposition.length > 0) {
      pickPokemonProposition(
        state,
        context,
        player.id,
        pickRandomIn(pokemonsProposition),
        true
      )
      player.pokemonsProposition.clear()
    }

    const itemsProposition = values(player.itemsProposition)
    if (player.itemsProposition.length > 0) {
      pickItemProposition(state, player.id, pickRandomIn(itemsProposition))
      player.itemsProposition.clear()
    }
  })
}

function stopFightingPhase(state: GameState, context: IGameEngineContext) {
  const isPVE = state.stageLevel in PVEStages

  state.simulations.forEach((simulation) => {
    if (!simulation.finished) {
      simulation.onFinish()
      for (const event of simulation.flushEvents()) {
        processBattleEvent(state, context, event)
      }
    }
    simulation.stop()
  })

  computeAchievements(state)
  computeStreak(state, isPVE)
  checkDeath(state, context)
  const isGameFinished = checkEndGame(state, context)

  if (!isGameFinished) {
    state.stageLevel += 1
    computeIncome(state, context, isPVE, state.specialGameRule)
    state.players.forEach((player: Player) => {
      player.wanderers.clear()
      if (player.alive) {
        if (player.isBot) {
          player.experienceManager.level = max(9)(
            Math.round(state.stageLevel / 2)
          )
        }

        if (isPVE && player.history.at(-1)?.result === BattleResult.WIN) {
          while (player.pveRewards.length > 0) {
            const reward = player.pveRewards.pop()!
            player.items.push(reward)
          }

          if (player.pveRewardsPropositions.length > 0) {
            resetArraySchema(
              player.itemsProposition,
              player.pveRewardsPropositions
            )
            player.pveRewardsPropositions.clear()
          }
        }

        spawnBabyEggs(state, player, isPVE)

        player.board.forEach((pokemon, key) => {
          if (pokemon.evolutionRule) {
            if (pokemon.evolutionRule instanceof HatchEvolutionRule) {
              pokemon.evolutionRule.updateHatch(
                pokemon,
                player,
                state.stageLevel
              )
            }
          }
          if (pokemon.passive === Passive.UNOWN && !isOnBench(pokemon)) {
            player.board.delete(key)
          }
        })

        player.updateSynergies()

        if (!player.isBot) {
          if (!player.shopLocked) {
            if (player.shop.every((p) => Unowns.includes(p))) {
              player.shopFreeRolls -= 1
            }

            state.shop.assignShop(player, false, state)
          } else {
            state.shop.refillShop(player, state)
            player.shopLocked = false
          }
        }
      }
    })
    state.botManager.updateBots()
  }
}

function stopTownPhase(state: GameState, context: IGameEngineContext) {
  context.miniGame?.stop(state)
  state.players.forEach((player: Player) => {
    player.wanderers.clear()
  })
}

function initializeTownPhase(state: GameState, context: IGameEngineContext) {
  state.phase = GamePhaseState.TOWN
  const nbPlayersAlive = values(state.players).filter(
    (p) => p.alive
  ).length

  let minigamePhaseDuration = ITEM_CAROUSEL_BASE_DURATION
  if (PortalCarouselStages.includes(state.stageLevel)) {
    minigamePhaseDuration = PORTAL_CAROUSEL_BASE_DURATION
  } else if (state.stageLevel !== ItemCarouselStages[0]) {
    minigamePhaseDuration += nbPlayersAlive * 2000
  }
  state.time = minigamePhaseDuration
  context.miniGame?.initialize(state)

  state.players.forEach((player: Player) => {
    if (player.alive) {
      const itemsToSell = player.items.filter((item) =>
        isIn(ItemsSoldAtTown, item)
      )
      let totalMoneyGained = 0
      itemsToSell.forEach((item) => {
        player.money += ItemSellPricesAtTown[item] ?? 0
        totalMoneyGained += ItemSellPricesAtTown[item] ?? 0
        removeInArray<Item>(player.items, item)
      })
      if (totalMoneyGained > 0) {
        context.emit(Transfer.PLAYER_INCOME, totalMoneyGained)
      }
    }
  })
}

function initializeFightingPhase(
  state: GameState,
  context: IGameEngineContext
) {
  state.simulations.clear()
  state.phase = GamePhaseState.FIGHT
  state.time = FIGHTING_PHASE_DURATION
  state.roundTime = Math.round(state.time / 1000)

  state.players.forEach((player: Player) => {
    if (player.alive) {
      player.registerPlayedPokemons()
    }
  })

  const pveStage = PVEStages[state.stageLevel]
  if (pveStage) {
    state.players.forEach((player: Player) => {
      if (player.alive) {
        player.opponentId = "pve"
        player.opponentName = pveStage.name
        player.opponentAvatar = getAvatarString(
          PkmIndex[pveStage.avatar],
          state.shinyEncounter,
          pveStage.emotion
        )
        player.opponentTitle = "WILD"
        player.team = Team.BLUE_TEAM

        const rewards = pveStage.getRewards?.(player) ?? ([] as Item[])
        resetArraySchema(player.pveRewards, rewards)

        const rewardsPropositions =
          state.shinyEncounter && state.stageLevel > 1
            ? pickNRandomIn(ShinyItems, 3)
            : (pveStage.getRewardsPropositions?.(player) ?? ([] as Item[]))

        resetArraySchema(player.pveRewardsPropositions, rewardsPropositions)

        const pveBoard = PokemonFactory.makePveBoard(
          pveStage,
          state.shinyEncounter,
          state.townEncounter
        )
        const weather = getWeather(player, null, pveBoard)
        const simulation = new Simulation(
          nanoid(),
          player.board,
          pveBoard,
          player,
          undefined,
          state.stageLevel,
          weather,
          state.specialGameRule ?? null,
          false,
          context
        )
        player.simulationId = simulation.id
        state.simulations.set(simulation.id, simulation)
        simulation.start()
      }
    })
  } else {
    const matchups = selectMatchups(state)
    state.simulationPaused = true

    matchups.forEach((matchup) => {
      const { bluePlayer, redPlayer, ghost } = matchup
      const weather = getWeather(
        bluePlayer,
        redPlayer,
        redPlayer.board,
        ghost
      )
      const simulationId = nanoid()

      bluePlayer.simulationId = simulationId
      bluePlayer.team = Team.BLUE_TEAM
      bluePlayer.opponents.set(
        redPlayer.id,
        (bluePlayer.opponents.get(redPlayer.id) ?? 0) + 1
      )
      bluePlayer.opponentId = redPlayer.id
      bluePlayer.opponentName = matchup.ghost
        ? `Ghost of ${redPlayer.name}`
        : redPlayer.name
      bluePlayer.opponentAvatar = redPlayer.avatar
      bluePlayer.opponentTitle = redPlayer.title ?? ""

      if (!matchup.ghost) {
        redPlayer.simulationId = simulationId
        redPlayer.team = Team.RED_TEAM
        redPlayer.opponents.set(
          bluePlayer.id,
          (redPlayer.opponents.get(bluePlayer.id) ?? 0) + 1
        )
        redPlayer.opponentId = bluePlayer.id
        redPlayer.opponentName = bluePlayer.name
        redPlayer.opponentAvatar = bluePlayer.avatar
        redPlayer.opponentTitle = bluePlayer.title ?? ""
      }

      const simulation = new Simulation(
        simulationId,
        bluePlayer.board,
        redPlayer.board,
        bluePlayer,
        redPlayer,
        state.stageLevel,
        weather,
        state.specialGameRule ?? null,
        matchup.ghost,
        context
      )

      state.simulations.set(simulation.id, simulation)
      context.addDelayedAction(2500, () => {
        state.simulationPaused = false
        simulation.start()
      })
    })
  }

  if (state.specialGameRule === SpecialGameRule.UNOWN_SPELL) {
    state.simulations.forEach((simulation) => {
      const unown = pickRandomIn(UnownsForScribble)
      ;[simulation.bluePlayer, simulation.redPlayer].forEach((player) => {
        if (
          !player ||
          (simulation.isGhostBattle && player === simulation.redPlayer)
        )
          return
        const id = nanoid()
        const wanderer = new Wanderer({
          id,
          pkm: unown,
          shiny: false,
          type: WandererType.UNOWN_SPELL,
          behavior: WandererBehavior.SPECTATE
        })
        ;(player as Player).wanderers.set(id, wanderer)
        context.addDelayedAction(10000, () => {
          ;(player as Player).wanderers.delete(id)
          if (simulation.finished) return
          const caster = new PokemonEntity(
            PokemonFactory.createPokemonFromName(unown),
            9,
            2,
            player.team,
            simulation
          )
          castAbility(
            caster.skill,
            caster,
            simulation.board,
            caster,
            false,
            true
          )
        })
      })
    })
  }
}

function spawnWanderingPokemons(
  state: GameState,
  context: IGameEngineContext
) {
  const isPVE = state.stageLevel in PVEStages

  state.players.forEach((player: Player) => {
    if (player.alive && !player.isBot) {
      if (chance(UNOWN_ENCOUNTER_CHANCE)) {
        const pkm = pickRandomIn(Unowns)
        const shiny = chance(SHINY_UNOWN_ENCOUNTER_CHANCE)
        const id = nanoid()
        const wanderer = new Wanderer({
          id,
          pkm,
          shiny,
          type: WandererType.UNOWN,
          behavior: WandererBehavior.RUN_THROUGH
        })

        context.addDelayedAction(
          Math.round((5 + 15 * Math.random()) * 1000),
          () => player.wanderers.set(id, wanderer)
        )
      }

      if (state.outlawStage != null) {
        if (state.stageLevel === state.outlawStage) {
          const id = nanoid()
          const wanderer = new Wanderer({
            id,
            pkm: Pkm.DROWZEE,
            shiny: false,
            type: WandererType.OUTLAW,
            behavior: WandererBehavior.RUN_THROUGH
          })

          context.addDelayedAction(
            Math.round((5 + 15 * Math.random()) * 1000),
            () => player.wanderers.set(id, wanderer)
          )
        } else if (state.stageLevel < state.outlawStage) {
          const magnezoneChance = chance(state.stageLevel * 0.04)
          if (magnezoneChance) {
            const id = nanoid()
            const wanderer = new Wanderer({
              id,
              pkm: Pkm.MAGNEZONE,
              shiny: false,
              type: WandererType.DIALOG,
              behavior: WandererBehavior.RUN_THROUGH
            })
            context.addDelayedAction(
              Math.round((5 + 15 * Math.random()) * 1000),
              () => player.wanderers.set(id, wanderer)
            )
          } else {
            for (let i = 0; i < randomBetween(1, 3); i++) {
              const id = nanoid()
              const wanderer = new Wanderer({
                id,
                pkm: Pkm.MAGNEMITE,
                shiny: false,
                type: WandererType.DIALOG,
                behavior: WandererBehavior.RUN_THROUGH
              })
              context.addDelayedAction(
                Math.round((5 + 15 * Math.random()) * 1000),
                () => player.wanderers.set(id, wanderer)
              )
            }
          }
        } else if (state.stageLevel > state.outlawStage) {
          removeInArray(player.items, Item.WANTED_NOTICE)
        }
      }

      if (
        isPVE &&
        state.specialGameRule === SpecialGameRule.GOTTA_CATCH_EM_ALL
      ) {
        const nbPokemonsToSpawn = Math.ceil(state.stageLevel / 2)
        for (let i = 0; i < nbPokemonsToSpawn; i++) {
          const id = nanoid()
          const pkm = state.shop.pickPokemon(
            player,
            state,
            -1,
            true
          )
          const wanderer = new Wanderer({
            id,
            pkm,
            shiny: chance(0.01),
            type: WandererType.CATCHABLE,
            behavior: WandererBehavior.RUN_THROUGH
          })

          context.addDelayedAction(
            4000 + i * 400,
            () => player.wanderers.set(id, wanderer)
          )
        }
      }
    }
  })
}

function spawnBabyEggs(state: GameState, player: Player, isPVE: boolean) {
  const hasBabyActive =
    player.effects.has(EffectEnum.HATCHER) ||
    player.effects.has(EffectEnum.BREEDER) ||
    player.effects.has(EffectEnum.GOLDEN_EGGS)
  const hasLostLastBattle =
    player.history.at(-1)?.result === BattleResult.DEFEAT
  const eggsOnBench = values(player.board).filter((p) => p.name === Pkm.EGG)
  const nbOfGoldenEggsOnBench = eggsOnBench.filter((p) => p.shiny).length
  let nbEggsFound = 0
  let goldenEggFound = false

  if (hasLostLastBattle && hasBabyActive) {
    const EGG_CHANCE = 0.1
    const GOLDEN_EGG_CHANCE = 0.05
    const playerEggChanceStacked = player.eggChance
    const playerGoldenEggChanceStacked = player.goldenEggChance
    const babies = values(player.board).filter(
      (p) => !isOnBench(p) && p.types.has(Synergy.BABY)
    )

    for (const baby of babies) {
      if (
        player.effects.has(EffectEnum.GOLDEN_EGGS) &&
        nbOfGoldenEggsOnBench === 0 &&
        chance(GOLDEN_EGG_CHANCE, baby)
      ) {
        nbEggsFound++
        goldenEggFound = true
      } else if (chance(EGG_CHANCE, baby)) {
        nbEggsFound++
      }
      if (player.effects.has(EffectEnum.GOLDEN_EGGS) && !goldenEggFound) {
        player.goldenEggChance += max(0.1)(
          Math.pow(GOLDEN_EGG_CHANCE, 1 - baby.luck / 200)
        )
      } else if (
        player.effects.has(EffectEnum.HATCHER) &&
        nbEggsFound === 0
      ) {
        player.eggChance += max(0.2)(
          Math.pow(EGG_CHANCE, 1 - baby.luck / 100)
        )
      }
    }

    if (
      nbEggsFound === 0 &&
      (player.effects.has(EffectEnum.BREEDER) ||
        player.effects.has(EffectEnum.GOLDEN_EGGS) ||
        chance(playerEggChanceStacked))
    ) {
      nbEggsFound = 1
    }
    if (
      goldenEggFound === false &&
      player.effects.has(EffectEnum.GOLDEN_EGGS) &&
      nbOfGoldenEggsOnBench === 0 &&
      chance(playerGoldenEggChanceStacked)
    ) {
      goldenEggFound = true
    }
  } else if (!isPVE) {
    player.eggChance = 0
    player.goldenEggChance = 0
  }

  if (
    state.specialGameRule === SpecialGameRule.OMELETTE_COOK &&
    [2, 3, 4].includes(state.stageLevel)
  ) {
    nbEggsFound = 1
  }

  for (let i = 0; i < nbEggsFound; i++) {
    if (getFreeSpaceOnBench(player.board) === 0) continue
    const isGoldenEgg =
      goldenEggFound && i === 0 && nbOfGoldenEggsOnBench === 0
    giveRandomEgg(player, isGoldenEgg)
    if (player.effects.has(EffectEnum.HATCHER)) {
      player.eggChance = 0
    }
    if (player.effects.has(EffectEnum.GOLDEN_EGGS) && isGoldenEgg) {
      player.goldenEggChance = 0
    }
  }
}

/**
 * Pick a pokemon proposition for a player.
 * Extracted from GameRoom.pickPokemonProposition.
 */
export function pickPokemonProposition(
  state: GameState,
  context: IGameEngineContext,
  playerId: string,
  pkm: PkmProposition,
  bypassLackOfSpace = false
) {
  const player = state.players.get(playerId)
  if (!player || player.pokemonsProposition.length === 0) return

  if (
    state.additionalPokemons.includes(pkm as Pkm) &&
    state.specialGameRule !== SpecialGameRule.EVERYONE_IS_HERE
  )
    return

  const PkmDuos: Record<string, Pkm[]> = (PokemonFactory as any).PkmDuos ?? {}

  let pokemonsObtained: Pokemon[] = (
    pkm in PkmDuos ? PkmDuos[pkm] : [pkm as Pkm]
  ).map((p) => PokemonFactory.createPokemonFromName(p, player))

  const pokemon = pokemonsObtained[0]
  const isEvolution =
    pokemon.evolutionRule &&
    pokemon.evolutionRule instanceof CountEvolutionRule &&
    pokemon.evolutionRule.canEvolveIfGettingOne(pokemon, player)

  const freeSpace = getFreeSpaceOnBench(player.board)

  if (
    freeSpace < pokemonsObtained.length &&
    !bypassLackOfSpace &&
    !isEvolution
  )
    return

  const selectedIndex = player.pokemonsProposition.indexOf(pkm)
  player.pokemonsProposition.clear()

  if (AdditionalPicksStages.includes(state.stageLevel)) {
    if (pokemonsObtained[0]?.regional) {
      const basePkm = (Object.keys(PkmRegionalVariants).find((p) =>
        PkmRegionalVariants[p].includes(pokemonsObtained[0].name)
      ) ?? pokemonsObtained[0].name) as Pkm
      state.shop.addAdditionalPokemon(basePkm, state)
      player.regionalPokemons.push(pkm as Pkm)
    } else {
      state.shop.addAdditionalPokemon(pkm as Pkm, state)
    }

    if (state.specialGameRule === SpecialGameRule.CHOSEN_ONES) {
      pokemonsObtained = pokemonsObtained.map((pkm) => {
        const evolution = pkm.hasEvolution
          ? pkm.evolutionRule.getEvolution(pkm, player, state.stageLevel)
          : pkm.name
        const rank = [Rarity.UNCOMMON, Rarity.RARE, Rarity.EPIC].indexOf(
          pkm.rarity
        )
        const replacement = PokemonFactory.createPokemonFromName(
          evolution,
          player
        )
        replacement.addMaxHP([50, 100, 150][rank] ?? 50, player)
        replacement.addAttack([5, 10, 15][rank] ?? 5)
        replacement.addAbilityPower([15, 30, 45][rank] ?? 15)
        return replacement
      })
    }

    state.players.forEach((p) => p.updateRegionalPool(state, false))
  }

  if (
    AdditionalPicksStages.includes(state.stageLevel) ||
    state.stageLevel <= 1
  ) {
    const selectedItem = player.itemsProposition[selectedIndex]
    if (player.itemsProposition.length > 0 && selectedItem != null) {
      player.items.push(selectedItem)
      player.itemsProposition.clear()
    }
  }

  if (state.stageLevel <= 1) {
    player.firstPartner = pokemonsObtained[0].name
  }

  pokemonsObtained.forEach((pokemon) => {
    const freeCellX = getFirstAvailablePositionInBench(player.board)
    if (isEvolution) {
      pokemon.positionX = freeCellX ?? -1
      pokemon.positionY = 0
      player.board.set(pokemon.id, pokemon)
      pokemon.onAcquired(player)
      context.checkEvolutionsAfterPokemonAcquired(playerId)
    } else if (freeCellX !== null) {
      pokemon.positionX = freeCellX
      pokemon.positionY = 0
      player.board.set(pokemon.id, pokemon)
      pokemon.onAcquired(player)
    } else {
      const sellPrice = getSellPrice(pokemon, state.specialGameRule)
      player.addMoney(sellPrice, true, null)
    }
  })
}

/**
 * Pick an item proposition for a player.
 */
export function pickItemProposition(
  state: GameState,
  playerId: string,
  item: Item
) {
  const player = state.players.get(playerId)
  if (player && player.itemsProposition.includes(item)) {
    player.items.push(item)
    player.itemsProposition.clear()
  }
}
