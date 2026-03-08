import {
  TournamentBracketSchema,
  TournamentPlayerSchema
} from "../../models/colyseus-models/tournament"

export interface ITournament {
  id: string
  name: string
  startDate: string
  players: Map<string, TournamentPlayerSchema>
  brackets: Map<string, TournamentBracketSchema>
  finished: boolean
}

export interface ITournamentPlayer {
  name: string
  avatar: string
  elo: number
  ranks: number[]
  eliminated: boolean
}

export interface ITournamentBracket {
  name: string
  playersId: string[]
  finished: boolean
}
