import { MapSchema } from "@colyseus/schema"
import { describe, expect, it } from "vitest"
import { IPokemonEntity } from "../../types"
import { Passive } from "../../types/enum/Passive"
import { computeRoundDamage } from "../compute-round-damage"

function mockPokemon(
  overrides: Partial<IPokemonEntity> = {}
): IPokemonEntity {
  return {
    isSpawn: false,
    passive: Passive.NONE,
    ...overrides
  } as IPokemonEntity
}

describe("computeRoundDamage", () => {
  it("returns base damage from stage level when team is empty", () => {
    const team = new MapSchema<IPokemonEntity>()
    expect(computeRoundDamage(team, 1)).toBe(1) // ceil(1/2)
    expect(computeRoundDamage(team, 2)).toBe(1) // ceil(2/2)
    expect(computeRoundDamage(team, 5)).toBe(3) // ceil(5/2)
    expect(computeRoundDamage(team, 10)).toBe(5) // ceil(10/2)
  })

  it("adds 1 damage per non-spawn non-inanimate pokemon", () => {
    const team = new MapSchema<IPokemonEntity>()
    team.set("a", mockPokemon())
    team.set("b", mockPokemon())
    team.set("c", mockPokemon())
    // base ceil(4/2)=2, plus 3 pokemon = 5
    expect(computeRoundDamage(team, 4)).toBe(5)
  })

  it("excludes spawned pokemon from damage count", () => {
    const team = new MapSchema<IPokemonEntity>()
    team.set("a", mockPokemon())
    team.set("b", mockPokemon({ isSpawn: true }))
    team.set("c", mockPokemon({ isSpawn: true }))
    // base ceil(6/2)=3, only 1 non-spawn = 4
    expect(computeRoundDamage(team, 6)).toBe(4)
  })

  it("excludes inanimate passive pokemon from damage count", () => {
    const team = new MapSchema<IPokemonEntity>()
    team.set("a", mockPokemon())
    team.set("b", mockPokemon({ passive: Passive.INANIMATE }))
    // base ceil(2/2)=1, only 1 non-inanimate = 2
    expect(computeRoundDamage(team, 2)).toBe(2)
  })

  it("scales base damage with stage level", () => {
    const team = new MapSchema<IPokemonEntity>()
    team.set("a", mockPokemon())
    // stage 1: ceil(1/2)=1 + 1 = 2
    expect(computeRoundDamage(team, 1)).toBe(2)
    // stage 20: ceil(20/2)=10 + 1 = 11
    expect(computeRoundDamage(team, 20)).toBe(11)
  })
})
