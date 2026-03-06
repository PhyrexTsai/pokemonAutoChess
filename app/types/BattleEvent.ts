import { Ability } from "./enum/Ability"
import { BoardEffect } from "./enum/Effect"
import { AttackType, HealType, Orientation } from "./enum/Game"
import { Weather } from "./enum/Weather"

export type BattleEvent =
  | {
      type: "ABILITY"
      id: string
      skill: Ability | string
      positionX: number
      positionY: number
      orientation?: Orientation | number
      targetX?: number
      targetY?: number
      delay?: number
      ap?: number
    }
  | {
      type: "POKEMON_DAMAGE"
      index: string
      attackType: AttackType
      amount: number
      x: number
      y: number
      id: string
    }
  | {
      type: "POKEMON_HEAL"
      index: string
      healType: HealType
      amount: number
      x: number
      y: number
      id: string
    }
  | {
      type: "BOARD_EVENT"
      simulationId: string
      x: number
      y: number
      effect: BoardEffect
    }
  | {
      type: "CLEAR_BOARD"
      simulationId: string
    }
  | {
      type: "CLEAR_BOARD_EVENT"
      simulationId: string
      effect: BoardEffect | null
      x: number
      y: number
    }
  | {
      type: "SIMULATION_END"
      visibleSimulationId: string
      visibleBluePlayerId: string
      visibleRedPlayerId: string
      winnerId: string
      loserId: string
      roundDamage: number
      weather: Weather
    }
  | {
      type: "PLAYER_INCOME"
      playerId: string
      amount: number
    }
  | {
      type: "PLAYER_DAMAGE"
      playerId: string
      amount: number
    }
