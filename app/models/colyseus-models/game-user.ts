import { Role } from "../../types"

export interface IGameUser {
  uid: string
  name: string
  avatar: string
  ready: boolean
  isBot: boolean
  elo: number
  games: number
  title: string
  role: Role
  anonymous: boolean
}
export class GameUser implements IGameUser {
  uid: string
  name: string
  avatar: string
  ready: boolean
  isBot: boolean
  elo: number
  games: number
  title: string
  role: Role
  anonymous: boolean

  constructor(
    uid: string,
    name: string,
    elo: number,
    games: number,
    avatar: string,
    isBot: boolean,
    ready: boolean,
    title: string,
    role: Role,
    anonymous: boolean
  ) {
    this.uid = uid
    this.name = name
    this.avatar = avatar
    this.ready = ready
    this.isBot = isBot
    this.elo = elo
    this.games = games
    this.title = title
    this.role = role
    this.anonymous = anonymous
  }
}
