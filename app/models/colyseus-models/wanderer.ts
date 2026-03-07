import { Schema, type } from "@colyseus/schema"
import { Pkm } from "../../types/enum/Pokemon"
import type { WandererBehavior, WandererType } from "../../types/enum/Wanderer"

export class Wanderer extends Schema {
  @type("string") id!: string
  @type("string") pkm!: Pkm
  @type("boolean") shiny: boolean = false
  @type("string") type!: WandererType
  @type("string") behavior!: WandererBehavior
  @type("string") data: string = ""

  constructor(params?: {
    id: string
    pkm: Pkm
    shiny: boolean
    type: WandererType
    behavior: WandererBehavior
    data?: string
  }) {
    super()
    if (!params) return // Schema Decoder creates instances without args
    this.id = params.id
    this.pkm = params.pkm
    this.shiny = params.shiny
    this.type = params.type
    this.behavior = params.behavior
    this.data = params.data ?? ""
  }
}
