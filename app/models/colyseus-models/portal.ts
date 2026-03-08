import { nanoid } from "nanoid"
import { IPortal, ISynergySymbol } from "../../types"
import { DungeonPMDO } from "../../types/enum/Dungeon"
import { Synergy } from "../../types/enum/Synergy"

export class Portal implements IPortal {
  id: string
  x: number
  y: number
  avatarId: string = ""
  map: DungeonPMDO = DungeonPMDO.TinyWoods
  index: number

  constructor(x: number, y: number, index: number) {
    this.id = nanoid()
    this.x = x
    this.y = y
    this.index = index
  }
}

export class SynergySymbol implements ISynergySymbol {
  id: string
  x: number
  y: number
  synergy: Synergy
  portalId: string = ""
  index: number

  constructor(x: number, y: number, synergy: Synergy, index: number) {
    this.id = nanoid()
    this.x = x
    this.y = y
    this.synergy = synergy
    this.index = index
  }
}
