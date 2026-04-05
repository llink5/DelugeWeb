// Bridges the PeripheralStub interface to a RegisterMap.
//
// The PeripheralBus addresses stubs via (baseAddr, offset). The RegisterMap
// uses absolute addresses so register definitions can stay verbatim from the
// hardware manual. This adapter adds the base back onto the offset before
// dispatching to the map.

import type { PeripheralStub } from './PeripheralStub'
import { RegisterMap, type RegisterDef } from './regs'

export abstract class RegMapStub implements PeripheralStub {
  abstract readonly name: string
  abstract readonly baseAddr: number
  abstract readonly size: number

  protected registers!: RegisterMap

  protected buildRegisters(defs: RegisterDef[]): void {
    this.registers = new RegisterMap(defs)
  }

  reset(): void {
    this.registers?.reset()
  }

  tick?(cycles: number): void

  read8(offset: number): number {
    return this.registers.read8(this.baseAddr + offset)
  }
  read16(offset: number): number {
    return this.registers.read16(this.baseAddr + offset)
  }
  read32(offset: number): number {
    return this.registers.read32(this.baseAddr + offset)
  }
  write8(offset: number, value: number): void {
    this.registers.write8(this.baseAddr + offset, value)
  }
  write16(offset: number, value: number): void {
    this.registers.write16(this.baseAddr + offset, value)
  }
  write32(offset: number, value: number): void {
    this.registers.write32(this.baseAddr + offset, value)
  }
}
