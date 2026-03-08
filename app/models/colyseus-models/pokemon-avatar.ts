import { Constraint } from "matter-js"
import { IPokemonAvatar } from "../../types"
import { Orientation, PokemonActionState } from "../../types/enum/Game"
import { Pkm } from "../../types/enum/Pokemon"
import { getPokemonCustomFromAvatar } from "../../utils/avatar"

export class PokemonAvatarModel implements IPokemonAvatar {
  id!: string
  name!: Pkm
  shiny!: boolean
  x!: number
  y!: number
  targetX!: number
  targetY!: number
  action: PokemonActionState = PokemonActionState.IDLE
  orientation: Orientation = Orientation.DOWNLEFT
  timer!: number
  itemId: string = ""
  portalId: string = ""
  constraint: Constraint | undefined

  constructor(id?: string, avatar?: string, x?: number, y?: number, timer?: number) {
    if (id === undefined) return // Schema Decoder creates instances without args
    this.id = id
    this.x = x!
    this.y = y!
    this.targetX = x!
    this.targetY = y!
    this.timer = timer!
    const { name, shiny } = getPokemonCustomFromAvatar(avatar!)
    this.name = name
    this.shiny = shiny ?? false
  }
}
