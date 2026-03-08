import { ExpTable } from "../../config"
import { IExperienceManager } from "../../types"
import { SpecialGameRule } from "../../types/enum/SpecialGameRule"

export default class ExperienceManager
  implements IExperienceManager
{
  level: number
  experience: number
  expNeeded: number
  maxLevel: number

  constructor() {
    this.level = 2
    this.experience = 0
    this.expNeeded = ExpTable[2]
    this.maxLevel = 9
  }

  canLevelUp() {
    return this.level < this.maxLevel
  }

  addExperience(quantity: number) {
    let expToAdd = quantity
    while (this.checkForLevelUp(expToAdd)) {
      expToAdd -= ExpTable[this.level]
      this.level += 1
      this.expNeeded = ExpTable[this.level]
    }
  }

  checkForLevelUp(quantity: number) {
    if (
      this.experience + quantity >= ExpTable[this.level] &&
      this.level < this.maxLevel
    ) {
      return true
    } else {
      this.experience += quantity
      return false
    }
  }
}

export function getLevelUpCost(specialGameRule?: SpecialGameRule | null) {
  const cost = 4
  return cost
}
