import { BattleResult } from "../../types/enum/Game"
import { Weather } from "../../types/enum/Weather"

export default class HistoryItem {
  id: string
  name: string
  result: BattleResult
  avatar: string
  weather: Weather

  constructor(
    id: string,
    name: string,
    result: BattleResult,
    avatar: string,
    weather: Weather
  ) {
    this.id = id
    this.name = name
    this.result = result
    this.avatar = avatar
    this.weather = weather
  }
}
