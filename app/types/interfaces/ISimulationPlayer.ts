import type { PokemonEntity } from "../../core/pokemon-entity"
import type { Pokemon } from "../../models/colyseus-models/pokemon"
import type { BattleResult } from "../enum/Game"
import type { Item, MissionOrder } from "../enum/Item"
import type { Pkm } from "../enum/Pokemon"
import type { Weather } from "../enum/Weather"
import type { IPlayer, Title } from "../index"

/**
 * Narrows the Player class to fields actually accessed by Simulation during battle.
 * The existing Player class satisfies this interface via structural typing.
 */
export interface ISimulationPlayer extends IPlayer {
  // Properties not in IPlayer but accessed during simulation
  titles: Set<Title>
  pokemonsPlayed: Set<Pkm>
  maxInterest: number
  weatherRocks: Item[]
  firstPartner: Pkm | undefined
  groundHoles: number[]
  berryTreesType: Item[]
  games: number

  // Methods called from core simulation files
  addBattleResult(
    id: string,
    name: string,
    result: BattleResult,
    avatar: string,
    weather: Weather | undefined
  ): void
  addMoney(
    value: number,
    countTotalEarned: boolean,
    origin: PokemonEntity | null
  ): void
  addExperience(value: number): void
  transformPokemon(pokemon: Pokemon, newEntry: Pkm): Pokemon
  updateSynergies(): void
  getPokemonAt(x: number, y: number): Pokemon | undefined
  collectMulch(amount: number): void
  chargeCellBattery(amount: number): void
  completeMissionOrder(missionOrder: MissionOrder): void
  updateWeatherRocks(): void
}
