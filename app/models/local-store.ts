import { IBot } from "../types/interfaces/bot"
import { IDetailledStatistic } from "../types/interfaces/detailled-statistic"
import { IUserMetadataMongo } from "../types/interfaces/UserMetadata"
import { logger } from "../utils/logger"

const HISTORY_CAP = 100

interface LocalStore {
  currentPlayer: IUserMetadataMongo | null
  gameHistory: IDetailledStatistic[]
  botList: IBot[]
}

const store: LocalStore = {
  currentPlayer: null,
  gameHistory: [],
  botList: []
}

// --- Player ---

export function getPlayer(): IUserMetadataMongo | null {
  return store.currentPlayer
}

export function setPlayer(player: IUserMetadataMongo | null): void {
  store.currentPlayer = player
}

export function updatePlayer(
  updater: (player: IUserMetadataMongo) => void
): void {
  if (store.currentPlayer) {
    updater(store.currentPlayer)
  }
}

// --- Game History ---

export function getGameHistory(): IDetailledStatistic[] {
  return store.gameHistory
}

export function pushGameHistory(entry: IDetailledStatistic): void {
  store.gameHistory.push(entry)
  if (store.gameHistory.length > HISTORY_CAP) {
    store.gameHistory.splice(0, store.gameHistory.length - HISTORY_CAP)
  }
}

export function getGameHistoryByPlayer(
  uid: string
): IDetailledStatistic[] {
  return store.gameHistory.filter((e) => e.playerId === uid)
}

// --- Bots ---

export function getBotList(): IBot[] {
  return store.botList
}

export function setBotList(bots: IBot[]): void {
  store.botList = bots
}

export function getBotById(id: string): IBot | undefined {
  return store.botList.find((b) => b.id === id)
}

export function getBotsInEloRange(min: number, max: number): IBot[] {
  return store.botList.filter((b) => b.elo >= min && b.elo <= max)
}

// --- Init ---

export function loadBotsFromJson(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bots: IBot[] = require("../public/src/assets/bots.json")
    store.botList = bots
    logger.info(`Loaded ${bots.length} bots from bots.json`)
  } catch (e) {
    logger.warn("Failed to load bots.json, using empty bot list")
    store.botList = []
  }
}
