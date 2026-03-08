import { loadBotsFromJson, setPlayer } from "../../models/local-store"
import { Emotion, Item, Role, Title, Transfer } from "../../types"
import { EloRank } from "../../types/enum/EloRank.js"
import { BotDifficulty } from "../../types/enum/Game.js"
import { PkmProposition } from "../../types/enum/Pokemon.js"
import { SpecialGameRule } from "../../types/enum/SpecialGameRule.js"
import { IBot } from "../../types/interfaces/bot"
import { IUserMetadataJSON } from "../../types/interfaces/UserMetadata"
import { LocalGameEngine } from "./local-engine"
import { loadProfile } from "./persistence/local-db"
import store from "./stores"
import { setProfile } from "./stores/NetworkStore"

loadBotsFromJson()

export const engine = new LocalGameEngine()

// Stub client/rooms for backward compat — deleted when consumer files are updated
export const client: any = {}
export const rooms: any = {
  lobby: undefined,
  preparation: undefined,
  game: undefined,
  after: undefined
}
export type ChatRoom = "lobby" | "preparation"

export function authenticateUser() {
  const state = store.getState().network
  if (state.uid) {
    return Promise.resolve({
      uid: state.uid,
      displayName: state.displayName,
      getIdToken: () => Promise.resolve(state.uid)
    })
  }
  return Promise.reject("USER_NOT_AUTHENTICATED")
}

export async function fetchProfile(forceRefresh: boolean = false) {
  const existing = store.getState().network.profile
  if (!forceRefresh && existing) {
    return existing
  }
  const uid = store.getState().network.uid
  if (!uid) return

  const profile = await loadProfile()
  if (!profile) return

  // Sync to Redux
  const metadataJSON: IUserMetadataJSON = {
    uid: profile.uid,
    displayName: profile.displayName,
    language: profile.language as IUserMetadataJSON["language"],
    avatar: profile.avatar,
    games: profile.games,
    wins: profile.wins,
    exp: profile.exp,
    level: profile.level,
    elo: profile.elo,
    maxElo: profile.elo,
    eventPoints: 0,
    maxEventPoints: 0,
    eventFinishTime: null,
    booster: profile.booster,
    titles: [],
    title: "",
    role: Role.BASIC,
    pokemonCollection: {}
  }
  store.dispatch(setProfile(metadataJSON))

  // Sync to local-store for local-engine
  setPlayer({
    uid: profile.uid,
    displayName: profile.displayName,
    language: profile.language as IUserMetadataJSON["language"],
    avatar: profile.avatar,
    games: profile.games,
    wins: profile.wins,
    exp: profile.exp,
    level: profile.level,
    elo: profile.elo,
    maxElo: profile.elo,
    eventPoints: 0,
    maxEventPoints: 0,
    eventFinishTime: null,
    booster: profile.booster,
    titles: [],
    title: "",
    role: Role.BASIC,
    pokemonCollection: new Map()
  })
}

// Game action functions — delegate to LocalGameEngine

export function lockShop() {
  engine.lockShop()
}

export function levelClick() {
  engine.levelUp()
}

export function buyInShop(id: number) {
  engine.buyPokemon(id)
}

export function pickPokemonProposition(proposition: PkmProposition) {
  engine.pickPokemon(proposition)
}

export function pickItem(item: Item) {
  engine.pickItem(item)
}

export function showEmote(emote?: string) {
  engine.showEmote(emote)
}

// ---- Stub exports for files not yet updated (removed in later tasks) ----

export function leaveRoom(_roomName: string, _allowReconnect = false) {
  return Promise.resolve(-1)
}
export function leaveAllRooms() {
  engine.dispose()
  return Promise.resolve([])
}
export function joinLobby(_room: any) {}
export function joinPreparation(_room: any) {}
export function joinGame(_room: any) {}
export function joinAfter(_room: any) {}
export function sendMessage(_message: string, _source: ChatRoom) {}
export function removeMessage(_message: { id: string }, _source: ChatRoom) {}
export function addBot(_bot: BotDifficulty | IBot) {}
export function removeBot(_id: string) {}
export function toggleReady(_ready: boolean) {}
export function setNoElo(_noElo: boolean) {}
export function gameStartRequest(_token: string) {}
export function changeRoomName(_name: string) {}
export function changeRoomPassword(_password: string | null) {}
export function changeRoomMinMaxRanks(_params: {
  minRank: EloRank | null
  maxRank: EloRank | null
}) {}
export function setSpecialRule(_rule: SpecialGameRule | null) {}
export function buyEmotion(_params: {
  index: string
  emotion: Emotion
  shiny: boolean
}) {}
export function buyBooster(_params: { index: string }) {}
export function openBooster() {}
export function searchById(_id: string) {}
export function deleteTournament(_params: { id: string }) {}
export function remakeTournamentLobby(_params: {
  tournamentId: string
  bracketId: string
}) {}
export function participateInTournament(_params: {
  tournamentId: string
  participate: boolean
}) {}
export function giveBooster(_params: {
  uid: string
  numberOfBoosters: number
}) {}
export function heapSnapshot() {}
export function deleteAccount() {}
export function giveRole(_params: { uid: string; role: Role }) {}
export function giveTitle(_params: { uid: string; title: Title }) {}
export function kick(_playerId: string) {}
export function ban(_params: { uid: string; reason: string }) {}
export function unban(_params: { uid: string; name: string }) {}
export function createTournament(_params: {
  name: string
  startDate: string
}) {}
