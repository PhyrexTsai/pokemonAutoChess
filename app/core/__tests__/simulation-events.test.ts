import { describe, expect, it, vi } from "vitest"
import Synergies from "../../models/colyseus-models/synergies"
import { Pokemon } from "../../models/colyseus-models/pokemon"
import PokemonFactory from "../../models/pokemon-factory"
import type { BattleEvent } from "../../types/BattleEvent"
import { EffectEnum } from "../../types/enum/Effect"
import { Team } from "../../types/enum/Game"
import { Item } from "../../types/enum/Item"
import { Pkm } from "../../types/enum/Pokemon"
import { Weather } from "../../types/enum/Weather"
import type { ISimulationPlayer } from "../../types/interfaces/ISimulationPlayer"
import Simulation from "../simulation"

function createMockPlayer(
  board: Map<string, Pokemon>,
  id: string,
  simulationId: string
): ISimulationPlayer {
  return {
    id,
    name: `Player-${id}`,
    simulationId,
    board,
    effects: new Set<EffectEnum>(),
    synergies: new Synergies(),
    items: [] as Item[],
    life: 100,
    money: 0,
    opponentId: "",
    opponentName: "",
    opponentAvatar: "",
    opponentTitle: "",
    totalPlayerDamageDealt: 0,
    totalMoneyEarned: 0,
    weatherRocks: [],
    isBot: false,
    team: Team.BLUE_TEAM,
    ghost: false,
    streak: 0,
    interest: 0,
    titles: new Set(),
    pokemonsPlayed: new Set(),
    maxInterest: 5,
    firstPartner: undefined,
    groundHoles: [],
    berryTreesType: [],
    games: 0,
    addBattleResult: vi.fn(),
    addMoney: vi.fn(),
    addExperience: vi.fn(),
    transformPokemon: vi.fn(),
    updateSynergies: vi.fn(),
    getPokemonAt: vi.fn(),
    collectMulch: vi.fn(),
    chargeCellBattery: vi.fn(),
    completeMissionOrder: vi.fn(),
    updateWeatherRocks: vi.fn()
  } as unknown as ISimulationPlayer
}

function createBoardWith(pkm: Pkm, x: number, y: number): Map<string, Pokemon> {
  const board = new Map<string, Pokemon>()
  const pokemon = PokemonFactory.createPokemonFromName(pkm)
  pokemon.positionX = x
  pokemon.positionY = y
  board.set(pokemon.id, pokemon)
  return board
}

describe("Simulation event generation", () => {
  it("runs a 1v1 battle to completion and emits SIMULATION_END", () => {
    const simId = "test-sim"
    const blueBoard = createBoardWith(Pkm.GEODUDE, 3, 1)
    const redBoard = createBoardWith(Pkm.GEODUDE, 3, 1)

    const bluePlayer = createMockPlayer(blueBoard, "blue", simId)
    const redPlayer = createMockPlayer(redBoard, "red", simId)

    const simulation = new Simulation(
      simId,
      blueBoard,
      redBoard,
      bluePlayer,
      redPlayer,
      1, // stageLevel
      Weather.NEUTRAL,
      null, // specialGameRule
      false, // isGhostBattle
      undefined // no room
    )

    simulation.start()

    // Run simulation loop — 16ms ticks, up to 120s max
    const allEvents: BattleEvent[] = []
    const maxTicks = 120_000 / 16
    for (let i = 0; i < maxTicks && !simulation.finished; i++) {
      const events = simulation.update(16)
      allEvents.push(...events)
    }

    // Flush any remaining events after loop
    allEvents.push(...simulation.flushEvents())

    expect(simulation.finished).toBe(true)
    expect(allEvents.length).toBeGreaterThan(0)

    const endEvents = allEvents.filter((e) => e.type === "SIMULATION_END")
    expect(endEvents).toHaveLength(1)

    const endEvent = endEvents[0] as Extract<
      BattleEvent,
      { type: "SIMULATION_END" }
    >
    expect(endEvent.visibleSimulationId).toBe(simId)
    expect(endEvent.visibleBluePlayerId).toBe("blue")
    expect(endEvent.visibleRedPlayerId).toBe("red")
    expect(
      endEvent.winnerId === "blue" || endEvent.winnerId === "red"
    ).toBe(true)
  })

  it("emits damage and ability events during battle", () => {
    const simId = "test-sim-2"
    const blueBoard = createBoardWith(Pkm.GEODUDE, 3, 1)
    const redBoard = createBoardWith(Pkm.GEODUDE, 3, 1)

    const bluePlayer = createMockPlayer(blueBoard, "blue2", simId)
    const redPlayer = createMockPlayer(redBoard, "red2", simId)

    const simulation = new Simulation(
      simId,
      blueBoard,
      redBoard,
      bluePlayer,
      redPlayer,
      1,
      Weather.NEUTRAL
    )

    simulation.start()

    const allEvents: BattleEvent[] = []
    const maxTicks = 120_000 / 16
    for (let i = 0; i < maxTicks && !simulation.finished; i++) {
      allEvents.push(...simulation.update(16))
    }
    allEvents.push(...simulation.flushEvents())

    const damageEvents = allEvents.filter((e) => e.type === "POKEMON_DAMAGE")
    expect(damageEvents.length).toBeGreaterThan(0)
  })

  it("runs without room (standalone mode)", () => {
    const simId = "standalone"
    const blueBoard = createBoardWith(Pkm.GEODUDE, 3, 1)
    const redBoard = createBoardWith(Pkm.GEODUDE, 3, 1)

    const bluePlayer = createMockPlayer(blueBoard, "p1", simId)
    const redPlayer = createMockPlayer(redBoard, "p2", simId)

    // No room passed — this is the key assertion
    const simulation = new Simulation(
      simId,
      blueBoard,
      redBoard,
      bluePlayer,
      redPlayer,
      5,
      Weather.NEUTRAL
    )
    expect(simulation.room).toBeUndefined()

    simulation.start()

    let ticks = 0
    const maxTicks = 120_000 / 16
    while (!simulation.finished && ticks < maxTicks) {
      simulation.update(16)
      ticks++
    }

    expect(simulation.finished).toBe(true)
    expect(simulation.winnerId).toBeTruthy()
  })
})
