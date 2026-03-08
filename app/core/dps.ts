import { IDps } from "../types"

export default class Dps implements IDps {

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
