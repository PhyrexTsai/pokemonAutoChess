import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  getTreasureBoxReward,
  StageDuration,
  TreasureBoxReward
} from "../../config"
import BotManager from "../../core/bot-manager"
import Simulation from "../../core/simulation"
import { FloatingItem } from "./floating-item"
import Player from "./player"
import { PokemonAvatarModel } from "./pokemon-avatar"
import { Portal, SynergySymbol } from "./portal"
import Shop from "../shop"
import { EloRank } from "../../types/enum/EloRank"
import { GameMode, GamePhaseState } from "../../types/enum/Game"
import { Item } from "../../types/enum/Item"
import { Pkm } from "../../types/enum/Pokemon"
import { SpecialGameRule } from "../../types/enum/SpecialGameRule"
import { TownEncounter } from "../../types/enum/TownEncounter"
import { Weather } from "../../types/enum/Weather"
import { pickRandomIn, randomBetween } from "../../utils/random"

export default class GameState {
  afterGameId = ""
  roundTime = StageDuration[0]
  phase = GamePhaseState.TOWN
  players = new Map<string, Player>()
  avatars =
    new Map<string, PokemonAvatarModel>()
  floatingItems = new Map<string, FloatingItem>()
  portals = new Map<string, Portal>()
  symbols = new Map<string, SynergySymbol>()
  additionalPokemons: Pkm[] = []
  stageLevel = 0
  weather: Weather
  shinyEncounter = false
  noElo = false
  gameMode: GameMode = GameMode.CUSTOM_LOBBY
  spectators = new Set<string>()
  simulations = new Map<string, Simulation>()
  lightX = randomBetween(0, BOARD_WIDTH - 1)
  lightY = randomBetween(1, BOARD_HEIGHT / 2)
  specialGameRule: SpecialGameRule | null = null
  townEncounter: TownEncounter | null = null
  time = StageDuration[0] * 1000
  updatePhaseNeeded = false
  botManager: BotManager = new BotManager()
  shop: Shop = new Shop()
  simulationPaused = false
  gameFinished = false
  gameLoaded = false
  name: string
  startTime: number
  endTime: number | undefined = undefined
  preparationId: string
  townEncounters: Set<TownEncounter> = new Set<TownEncounter>()
  pveRewards: Item[] = []
  pveRewardsPropositions: Item[] = []
  minRank: EloRank | null = null
  maxRank: EloRank | null = null
  outlawStage: number | null = null
  treasureBoxRewardGiven: TreasureBoxReward = getTreasureBoxReward()

  constructor(
    preparationId: string,
    name: string,
    noElo: boolean,
    gameMode: GameMode,
    minRank: EloRank | null,
    maxRank: EloRank | null,
    specialGameRule: SpecialGameRule | null
  ) {
    this.preparationId = preparationId
    this.startTime = Date.now()
    this.name = name
    this.noElo = noElo
    this.gameMode = gameMode
    this.minRank = minRank
    this.maxRank = maxRank
    this.weather = Weather.NEUTRAL

    if (gameMode === GameMode.SCRIBBLE) {
      this.specialGameRule = pickRandomIn(Object.values(SpecialGameRule))
    } else {
      this.specialGameRule = specialGameRule
    }
  }
}
