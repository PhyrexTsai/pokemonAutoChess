import { Pkm } from "../../types/enum/Pokemon"
import type { WandererBehavior, WandererType } from "../../types/enum/Wanderer"

export class Wanderer {
  id!: string
  pkm!: Pkm
  shiny: boolean = false
  type!: WandererType
  behavior!: WandererBehavior
  data: string = ""

  constructor(params?: {
    id: string
    pkm: Pkm
    shiny: boolean
    type: WandererType
    behavior: WandererBehavior
    data?: string
  }) {
    if (!params) return // Schema Decoder creates instances without args
    this.id = params.id
    this.pkm = params.pkm
    this.shiny = params.shiny
    this.type = params.type
    this.behavior = params.behavior
    this.data = params.data ?? ""
  }
}
