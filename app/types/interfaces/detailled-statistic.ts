import { DungeonPMDO } from "../enum/Dungeon"
import { GameMode } from "../enum/Game"
import { Synergy } from "../enum/Synergy"

export interface Pokemon {
  name: string
  avatar: string
  items: string[]
}

export interface IDetailledStatistic {
  playerId: string
  elo: number
  time: number
  name: string
  rank: number
  nbplayers: number
  avatar: string
  pokemons: Pokemon[]
  synergies: Map<Synergy, number>
  regions: DungeonPMDO[]
  gameMode: GameMode
}
