import {
  ITournament,
  ITournamentBracket,
  ITournamentPlayer
} from "../../types/interfaces/Tournament"
import { resetArraySchema } from "../../utils/schemas"

export class TournamentPlayerSchema
  implements ITournamentPlayer
{
  name: string
  avatar: string
  elo: number
  ranks: number[] = []
  eliminated: boolean

  constructor(
    name: string,
    avatar: string,
    elo: number,
    ranks: number[] = [],
    eliminated: boolean = false
  ) {
    this.name = name
    this.avatar = avatar
    this.elo = elo
    resetArraySchema(this.ranks, ranks)
    this.eliminated = eliminated
  }
}

export class TournamentBracketSchema
  implements ITournamentBracket
{
  name: string
  playersId: string[] = []
  finished: boolean

  constructor(
    name: string,
    playersId: string[],
    finished: boolean = false
  ) {
    this.name = name
    this.finished = finished
    resetArraySchema(this.playersId, playersId)
  }
}

export class TournamentSchema implements ITournament {
  id: string
  name: string
  startDate: string
  players =
    new Map<string, TournamentPlayerSchema>()
  brackets =
    new Map<string, TournamentBracketSchema>()
  finished: boolean
  pendingLobbiesCreation: boolean = false

  constructor(
    id: string,
    name: string,
    startDate: string,
    players: Map<string, ITournamentPlayer>,
    brackets: Map<string, ITournamentBracket>,
    finished: boolean = false
  ) {
    this.id = id
    this.name = name
    this.startDate = startDate
    this.finished = finished

    if (players && players.size) {
      players.forEach((p, key) => {
        this.players.set(
          key,
          new TournamentPlayerSchema(
            p.name,
            p.avatar,
            p.elo,
            p.ranks,
            p.eliminated
          )
        )
      })
    }

    if (brackets && brackets.size) {
      brackets.forEach((b, bracketId) => {
        this.brackets.set(
          bracketId,
          new TournamentBracketSchema(b.name, b.playersId, b.finished)
        )
      })
    }
  }
}
