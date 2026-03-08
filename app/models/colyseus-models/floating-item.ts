import { nanoid } from "nanoid"
import { IFloatingItem } from "../../types"
import { Item } from "../../types/enum/Item"

export class FloatingItem implements IFloatingItem {
  id: string
  name: Item
  x: number
  y: number
  avatarId: string = ""
  index: number

  constructor(name: Item, x: number, y: number, index: number) {
    this.id = nanoid()
    this.name = name
    this.x = x
    this.y = y
    this.index = index
  }
}
