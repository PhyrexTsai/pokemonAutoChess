import { IPokemonRecord } from "../../models/colyseus-models/game-record"
import { DungeonPMDO } from "../enum/Dungeon"
import { GameMode } from "../enum/Game"
import { Synergy } from "../enum/Synergy"

export interface IDetailledStatistic {
  playerId: string
  elo: number
  time: number
  name: string
  rank: number
  nbplayers: number
  avatar: string
  pokemons: IPokemonRecord[]
  synergies: Map<Synergy, number>
  regions: DungeonPMDO[]
  gameMode: GameMode
}
