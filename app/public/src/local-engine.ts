/**
 * local-engine.ts
 * LocalGameEngine — runs the entire game loop in-browser.
 * Implements IGameEngineContext so core game logic can call engine methods.
 * Uses Schema encode/decode loopback for state synchronization.
 */

import { Encoder, Decoder, MapSchema } from "@colyseus/schema"
import { nanoid } from "nanoid"
import { MAX_SIMULATION_DELTA_TIME } from "../../config/server/network"
import {
  CountEvolutionRule,
  ItemEvolutionRule
} from "../../core/evolution-rules"
import { MiniGame } from "../../core/mini-game"
import Player from "../../models/colyseus-models/player"
import { Pokemon } from "../../models/colyseus-models/pokemon"
import GameState from "../../models/colyseus-models/game-state"
import { getPlayer } from "../../models/local-store"
import PokemonFactory from "../../models/pokemon-factory"
import {
  getPokemonData,
  PRECOMPUTED_REGIONAL_MONS
} from "../../models/precomputed/precomputed-pokemon-data"
import { PRECOMPUTED_POKEMONS_PER_RARITY } from "../../models/precomputed/precomputed-rarity"
import { getAdditionalsTier1 } from "../../models/shop"
import {
  IGameEngineContext,
  IPokemon,
  IPlayer,
  Role,
  Transfer,
  WanderingPokemonParams
} from "../../types"
import { IGameUser } from "../../models/colyseus-models/game-user"
import { GameMode, PokemonActionState } from "../../types/enum/Game"
import { EloRank } from "../../types/enum/EloRank"
import { Pkm } from "../../types/enum/Pokemon"
import { SpecialGameRule } from "../../types/enum/SpecialGameRule"
import { IPokemonCollectionItemMongo } from "../../types/interfaces/UserMetadata"
import { Wanderer } from "../../models/colyseus-models/wanderer"
import {
  getFirstAvailablePositionInBench
} from "../../utils/board"
import { chance, shuffleArray } from "../../utils/random"
import type { Item } from "../../types/enum/Item"
import type { PkmProposition } from "../../types/enum/Pokemon"

import * as Commands from "./game-engine-commands"
import {
  tick as engineTick,
  pickPokemonProposition,
  pickItemProposition
} from "./game-engine-phases"

interface DelayedAction {
  executeAt: number
  callback: () => void
}

export interface GameConfig {
  users: Record<string, IGameUser>
  name: string
  noElo: boolean
  gameMode: GameMode
  specialGameRule: SpecialGameRule | null
  minRank: EloRank | null
  maxRank: EloRank | null
}

export class LocalGameEngine implements IGameEngineContext {
  engineState!: GameState
  clientState!: GameState
  encoder!: Encoder
  decoder!: Decoder
  intervalId: ReturnType<typeof setInterval> | null = null
  lastTickTime = 0
  humanPlayerId = ""
  miniGame!: MiniGame
  delayedActions: DelayedAction[] = []
  elapsedTime = 0
  additionalUncommonPool: Pkm[] = []
  additionalRarePool: Pkm[] = []
  additionalEpicPool: Pkm[] = []

  private eventListeners = new Map<string, Set<(payload: any) => void>>()

  get state(): GameState {
    return this.engineState
  }

  startGame(config: GameConfig) {
    const preparationId = nanoid()
    this.engineState = new GameState(
      preparationId,
      config.name,
      config.noElo,
      config.gameMode,
      config.minRank,
      config.maxRank,
      config.specialGameRule
    )
    this.clientState = new GameState(
      preparationId,
      config.name,
      config.noElo,
      config.gameMode,
      config.minRank,
      config.maxRank,
      config.specialGameRule
    )

    // Initialize mini-game
    this.miniGame = new MiniGame(this)
    this.miniGame.create(
      this.engineState.avatars,
      this.engineState.floatingItems,
      this.engineState.portals,
      this.engineState.symbols
    )

    // Initialize additional pokemon pools
    this.additionalUncommonPool = getAdditionalsTier1(
      PRECOMPUTED_POKEMONS_PER_RARITY.UNCOMMON
    )
    this.additionalRarePool = getAdditionalsTier1(
      PRECOMPUTED_POKEMONS_PER_RARITY.RARE
    )
    this.additionalEpicPool = getAdditionalsTier1(
      PRECOMPUTED_POKEMONS_PER_RARITY.EPIC
    )

    // Season-based Deerling filtering
    if (config.specialGameRule !== SpecialGameRule.EVERYONE_IS_HERE) {
      const now = new Date()
      const year = now.getFullYear()
      const date = new Date(year, now.getMonth(), now.getDate())
      let season: "spring" | "summer" | "autumn" | "winter"
      const springStart = new Date(year, 2, 20)
      const summerStart = new Date(year, 5, 22)
      const autumnStart = new Date(year, 8, 23)
      const winterStart = new Date(year, 11, 21)

      if (date >= springStart && date < summerStart) {
        season = "spring"
      } else if (date >= summerStart && date < autumnStart) {
        season = "summer"
      } else if (date >= autumnStart && date < winterStart) {
        season = "autumn"
      } else {
        season = "winter"
      }

      this.additionalRarePool = this.additionalRarePool.filter((p) => {
        if (
          (p === Pkm.DEERLING_SPRING && season !== "spring") ||
          (p === Pkm.DEERLING_SUMMER && season !== "summer") ||
          (p === Pkm.DEERLING_AUTUMN && season !== "autumn") ||
          (p === Pkm.DEERLING_WINTER && season !== "winter")
        ) {
          return false
        }
        return true
      })
    }

    shuffleArray(this.additionalUncommonPool)
    shuffleArray(this.additionalRarePool)
    shuffleArray(this.additionalEpicPool)

    if (config.specialGameRule === SpecialGameRule.EVERYONE_IS_HERE) {
      this.additionalUncommonPool.forEach((p) =>
        this.engineState.shop.addAdditionalPokemon(p, this.engineState)
      )
      this.additionalRarePool.forEach((p) =>
        this.engineState.shop.addAdditionalPokemon(p, this.engineState)
      )
      this.additionalEpicPool.forEach((p) =>
        this.engineState.shop.addAdditionalPokemon(p, this.engineState)
      )
    }

    // Initialize players
    for (const id of Object.keys(config.users)) {
      const user = config.users[id]
      if (user.isBot) {
        const player = new Player(
          user.uid,
          user.name,
          user.elo,
          user.games + 1,
          user.avatar,
          true,
          this.engineState.players.size + 1,
          new Map<string, IPokemonCollectionItemMongo>(),
          "",
          Role.BOT,
          this.engineState
        )
        this.engineState.players.set(user.uid, player)
        this.engineState.botManager.addBot(player)
      } else {
        this.humanPlayerId = user.uid
        const localUser = getPlayer()
        if (localUser) {
          const player = new Player(
            localUser.uid,
            localUser.displayName,
            localUser.elo,
            localUser.games + 1,
            localUser.avatar,
            false,
            this.engineState.players.size + 1,
            localUser.pokemonCollection,
            localUser.title,
            localUser.role,
            this.engineState
          )

          this.engineState.players.set(localUser.uid, player)
          this.engineState.shop.assignShop(player, false, this.engineState)

          if (config.specialGameRule === SpecialGameRule.EVERYONE_IS_HERE) {
            PRECOMPUTED_REGIONAL_MONS.forEach((p) => {
              if (getPokemonData(p).stars === 1) {
                this.engineState.shop.addRegionalPokemon(p, player)
              }
            })
          }
        }
      }
    }

    // Schema encode/decode loopback initialization
    Encoder.BUFFER_SIZE = 64 * 1024 // 64 KB — default 8KB overflows on full GameState
    this.encoder = new Encoder(this.engineState)
    this.decoder = new Decoder(this.clientState)

    // First sync: full state snapshot
    const fullSnapshot = this.encoder.encodeAll()
    this.decoder.decode(fullSnapshot)
    this.encoder.discardChanges()

    // Mark game as loaded and start the game loop
    this.engineState.gameLoaded = true
    this.engineState.botManager.updateBots()
    this.miniGame.initialize(this.engineState)

    this.lastTickTime = performance.now()
    this.intervalId = setInterval(() => this.gameTick(), 50)
  }

  private gameTick() {
    const now = performance.now()
    let deltaTime = now - this.lastTickTime
    this.lastTickTime = now
    deltaTime = Math.min(MAX_SIMULATION_DELTA_TIME, deltaTime)

    if (this.engineState.gameFinished || this.engineState.simulationPaused) {
      this.processDelayedActions()
      this.syncState()
      return
    }

    // Process delayed actions
    this.elapsedTime += deltaTime
    this.processDelayedActions()

    // Run the game tick (phase transitions, simulation updates)
    try {
      engineTick(this.engineState, this, deltaTime)
    } catch (error) {
      console.error("Engine tick error:", error)
    }

    // Sync state to client via encode/decode loopback
    this.syncState()
  }

  private processDelayedActions() {
    const now = this.elapsedTime
    const ready: DelayedAction[] = []
    const pending: DelayedAction[] = []

    for (const action of this.delayedActions) {
      if (action.executeAt <= now) {
        ready.push(action)
      } else {
        pending.push(action)
      }
    }

    this.delayedActions = pending

    for (const action of ready) {
      try {
        action.callback()
      } catch (error) {
        console.error("Delayed action error:", error)
      }
    }
  }

  syncState() {
    const patches = this.encoder.encode()
    if (patches && patches.byteLength > 0) {
      this.decoder.decode(patches)
    }
    this.encoder.discardChanges()
  }

  // --- IGameEngineContext implementation ---

  addDelayedAction(delayMs: number, callback: () => void) {
    this.delayedActions.push({
      executeAt: this.elapsedTime + delayMs,
      callback
    })
  }

  emit(event: string, payload: any) {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      for (const cb of listeners) {
        try {
          cb(payload)
        } catch (error) {
          console.error(`Event listener error for ${event}:`, error)
        }
      }
    }
  }

  on(event: string, callback: (payload: any) => void) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event)!.add(callback)
    return () => {
      this.eventListeners.get(event)?.delete(callback)
    }
  }

  spawnOnBench(
    player: IPlayer,
    pkm: Pkm,
    anim: "fishing" | "spawn" = "spawn"
  ) {
    const pokemon = PokemonFactory.createPokemonFromName(pkm, player as Player)
    const x = getFirstAvailablePositionInBench(
      (player as Player).board
    )
    if (x !== null) {
      pokemon.positionX = x
      pokemon.positionY = 0
      if (anim === "fishing") {
        pokemon.action = PokemonActionState.FISH
      }
      ;(player as Player).board.set(pokemon.id, pokemon)
      this.addDelayedAction(1000, () => {
        pokemon.action = PokemonActionState.IDLE
        this.checkEvolutionsAfterPokemonAcquired(player.id)
      })
    }
  }

  spawnWanderingPokemon(params: WanderingPokemonParams) {
    const { pkm, type, behavior, player } = params
    const id = nanoid()
    const wanderer = new Wanderer({
      id,
      pkm,
      type,
      behavior,
      shiny: chance(0.01)
    })
    ;(player as Player).wanderers.set(id, wanderer)
  }

  checkEvolutionsAfterPokemonAcquired(playerId: string): boolean {
    const player = this.engineState.players.get(playerId)
    if (!player) return false
    let hasEvolved = false

    player.board.forEach((pokemon) => {
      if (
        pokemon.hasEvolution &&
        pokemon.evolutionRule instanceof CountEvolutionRule
      ) {
        const pokemonEvolved = pokemon.evolutionRule.tryEvolve(
          pokemon,
          player,
          this.engineState.stageLevel
        )
        if (pokemonEvolved) {
          hasEvolved = true
        }
      }
    })

    player.boardSize = this.getTeamSize(player.board)
    return hasEvolved
  }

  checkEvolutionsAfterItemAcquired(
    playerId: string,
    pokemon: IPokemon
  ): IPokemon | void {
    const player = this.engineState.players.get(playerId)
    if (!player) return

    if (
      (pokemon as Pokemon).evolutionRule &&
      (pokemon as Pokemon).evolutionRule instanceof ItemEvolutionRule
    ) {
      const pokemonEvolved = (
        (pokemon as Pokemon).evolutionRule as ItemEvolutionRule
      ).tryEvolve(pokemon as Pokemon, player, this.engineState.stageLevel)
      return pokemonEvolved
    }
  }

  getTeamSize(board: MapSchema<IPokemon>): number {
    let size = 0
    board.forEach((pokemon) => {
      if (
        pokemon.positionY != 0 &&
        (pokemon as Pokemon).doesCountForTeamSize
      ) {
        size++
      }
    })
    return size
  }

  // --- Player action methods (delegates to game-engine-commands.ts) ---

  private getHumanPlayer(): Player | undefined {
    return this.engineState.players.get(this.humanPlayerId)
  }

  buyPokemon(index: number) {
    const player = this.getHumanPlayer()
    if (!player) return
    Commands.buyPokemon(this.engineState, player, this, { index })
    this.syncState()
  }

  sellPokemon(pokemonId: string) {
    const player = this.getHumanPlayer()
    if (!player) return
    Commands.sellPokemon(this.engineState, player, this, { pokemonId })
    this.syncState()
  }

  rerollShop() {
    const player = this.getHumanPlayer()
    if (!player) return
    Commands.rerollShop(this.engineState, player, this)
    this.syncState()
  }

  levelUp() {
    const player = this.getHumanPlayer()
    if (!player) return
    Commands.levelUp(this.engineState, player, this)
    this.syncState()
  }

  lockShop() {
    const player = this.getHumanPlayer()
    if (!player) return
    Commands.lockShop(this.engineState, player, this)
    this.syncState()
  }

  dragDropPokemon(detail: { id: string; x: number; y: number }) {
    const player = this.getHumanPlayer()
    if (!player) return
    Commands.dragDropPokemon(this.engineState, player, this, {
      playerId: this.humanPlayerId,
      detail
    })
    this.syncState()
  }

  dragDropItem(detail: { zone: string; index: number; id: Item }) {
    const player = this.getHumanPlayer()
    if (!player) return
    Commands.dragDropItem(this.engineState, player, this, { detail })
    this.syncState()
  }

  dragDropCombine(detail: { itemA: Item; itemB: Item }) {
    const player = this.getHumanPlayer()
    if (!player) return
    Commands.dragDropCombine(this.engineState, player, this, { detail })
    this.syncState()
  }

  pickBerry(berryIndex: number) {
    const player = this.getHumanPlayer()
    if (!player) return
    Commands.pickBerry(this.engineState, player, this, { berryIndex })
    this.syncState()
  }

  wandererClicked(id: string) {
    const player = this.getHumanPlayer()
    if (!player) return
    Commands.wandererClicked(this.engineState, player, this, { id })
    this.syncState()
  }

  switchBenchAndBoard(pokemonId: string) {
    const player = this.getHumanPlayer()
    if (!player) return
    Commands.switchBenchAndBoard(this.engineState, player, this, {
      pokemonId
    })
    this.syncState()
  }

  removeFromShop(index: number) {
    const player = this.getHumanPlayer()
    if (!player) return
    Commands.removeFromShop(this.engineState, player, this, { index })
    this.syncState()
  }

  pickPokemon(pkm: PkmProposition) {
    pickPokemonProposition(
      this.engineState,
      this,
      this.humanPlayerId,
      pkm
    )
    this.syncState()
  }

  pickItem(item: Item) {
    pickItemProposition(this.engineState, this.humanPlayerId, item)
    this.syncState()
  }

  showEmote(emote?: string) {
    const player = this.getHumanPlayer()
    if (player) {
      this.emit(Transfer.SHOW_EMOTE, {
        id: this.humanPlayerId,
        emote: emote ?? ""
      })
    }
  }

  reportLoadingProgress(_progress: number) {
    // In single-player, loading is handled locally — no-op
  }

  reportLoadingComplete() {
    this.emit(Transfer.LOADING_COMPLETE, undefined)
  }

  sendVector(vector: { x: number; y: number }) {
    // Minigame joystick input — update the player's avatar body
    // The MiniGame reads this via the avatar model
    const player = this.getHumanPlayer()
    if (player) {
      // Store vector for MiniGame to consume
      const avatarId = player.id
      const avatar = this.engineState.avatars.get(avatarId)
      if (avatar) {
        avatar.x += vector.x
        avatar.y += vector.y
      }
    }
  }

  dispose() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.delayedActions = []
    this.eventListeners.clear()
  }
}
