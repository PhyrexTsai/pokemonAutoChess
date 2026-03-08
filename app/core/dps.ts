import { IDps } from "../types"

export default class Dps implements IDps {
  id: string
  name: string
  physicalDamage = 0
  specialDamage = 0
  trueDamage = 0
  physicalDamageReduced = 0
  specialDamageReduced = 0
  shieldDamageTaken = 0
  heal = 0
  shield = 0

  constructor(id: string, name: string) {
    this.id = id
    this.name = name
  }

  update(
    physicalDamage: number,
    specialDamage: number,
    trueDamage: number,
    physicalDamageReduced: number,
    specialDamageReduced: number,
    shieldDamageTaken: number,
    heal: number,
    shield: number
  ) {
    if (this.physicalDamage != physicalDamage) {
      this.physicalDamage = physicalDamage
    }
    if (this.specialDamage != specialDamage) {
      this.specialDamage = specialDamage
    }
    if (this.trueDamage != trueDamage) {
      this.trueDamage = trueDamage
    }
    if (this.physicalDamageReduced != physicalDamageReduced) {
      this.physicalDamageReduced = physicalDamageReduced
    }
    if (this.specialDamageReduced != specialDamageReduced) {
      this.specialDamageReduced = specialDamageReduced
    }
    if (this.shieldDamageTaken != shieldDamageTaken) {
      this.shieldDamageTaken = shieldDamageTaken
    }
    if (this.heal != heal) {
      this.heal = heal
    }
    if (this.shield != shield) {
      this.shield = shield
    }
  }
}
