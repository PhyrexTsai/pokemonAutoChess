import { IAfterGamePlayer, Role } from "../../types"
import { Synergy } from "../../types/enum/Synergy"
import { IPokemonRecord, PokemonRecord } from "./game-record"

export class SampleSynergy {
  name: Synergy
  value: number

  constructor(name: Synergy, value: number) {
    this.name = name
    this.value = value
  }
}

export default class AfterGamePlayer
  implements IAfterGamePlayer
{
  id: string
  name: string
  avatar: string
  rank: number
  pokemons: IPokemonRecord[] = []
  elo: number
  games: number
  title: string
  role: Role
  synergies: {
    name: Synergy
    value: number
  }[] = []
  moneyEarned: number
  playerDamageDealt: number
  rerollCount: number

  constructor(
    id: string,
    name: string,
    avatar: string,
    rank: number,
    pokemons: IPokemonRecord[],
    title: string,
    role: Role,
    synergies: Array<{ name: Synergy; value: number }>,
    elo: number,
    games: number,
    moneyEarned: number,
    playerDamageDealt: number,
    rerollCount: number
  ) {
    this.id = id
    this.name = name
    this.avatar = avatar
    this.rank = rank
    this.title = title
    this.role = role
    this.elo = elo
    this.games = games
    this.moneyEarned = moneyEarned
    this.playerDamageDealt = playerDamageDealt
    this.rerollCount = rerollCount
    pokemons.forEach((pkm) => {
      this.pokemons.push(new PokemonRecord(pkm))
    })
    synergies.forEach((s) => {
      this.synergies.push(new SampleSynergy(s.name, s.value))
    })
  }
}
