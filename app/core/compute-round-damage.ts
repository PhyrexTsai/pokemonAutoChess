import { MapSchema } from "@colyseus/schema"
import { IPokemonEntity } from "../types"
import { Passive } from "../types/enum/Passive"

export function computeRoundDamage(
  opponentTeam: MapSchema<IPokemonEntity>,
  stageLevel: number
): number {
  let damage = Math.ceil(stageLevel / 2)
  if (opponentTeam.size > 0) {
    opponentTeam.forEach((pokemon) => {
      if (!pokemon.isSpawn && pokemon.passive !== Passive.INANIMATE) {
        damage += 1
      }
    })
  }
  return damage
}
