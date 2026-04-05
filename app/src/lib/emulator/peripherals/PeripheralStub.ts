// Shared interface for memory-mapped peripheral stubs.
//
// Each peripheral owns a contiguous address range inside the PERIPH /
// PERIPH2 windows (see MemoryMap). When the emulator sees a load/store that
// falls inside one of these ranges, the PeripheralBus routes the access to
// the matching stub via `read8/16/32` or `write8/16/32`.
//
// Stubs start life as "accept writes, return zero" placeholders and grow
// behaviour incrementally: when the firmware polls a status bit that the
// stub needs to assert, we add the side effect to the relevant register
// write. The goal is not hardware fidelity — only enough behaviour to
// un-stick the boot process.

export interface PeripheralStub {
  /** Human-readable identifier (used in logs and the debugger). */
  readonly name: string
  /** Base address of the register window. */
  readonly baseAddr: number
  /** Window size in bytes. */
  readonly size: number

  /** Return the register at `offset` (relative to baseAddr) as a 32-bit value. */
  read32(offset: number): number
  /** Return the register at `offset` as a 16-bit value. */
  read16(offset: number): number
  /** Return the register at `offset` as an 8-bit value. */
  read8(offset: number): number

  /** Write a 32-bit value at `offset`. */
  write32(offset: number, value: number): void
  /** Write a 16-bit value at `offset`. */
  write16(offset: number, value: number): void
  /** Write an 8-bit value at `offset`. */
  write8(offset: number, value: number): void

  /** Restore the stub to its power-on state. */
  reset(): void

  /**
   * Optional tick handler. Called by the emulator loop with the number of
   * CPU cycles that elapsed since the last tick so counters and timers can
   * advance.
   */
  tick?(cycles: number): void
}

/**
 * Convenience base class that holds a backing store of register bytes and
 * implements byte/halfword/word access on top of it. Subclasses override
 * specific reads/writes to layer side effects on top.
 */
export abstract class BasePeripheralStub implements PeripheralStub {
  abstract readonly name: string
  abstract readonly baseAddr: number
  abstract readonly size: number

  protected registers!: Uint8Array

  protected ensureBacking(): void {
    if (!this.registers) {
      this.registers = new Uint8Array(this.size)
    }
  }

  reset(): void {
    this.ensureBacking()
    this.registers.fill(0)
  }

  read32(offset: number): number {
    this.ensureBacking()
    if (offset + 4 > this.size) return 0
    return (
      this.registers[offset] |
      (this.registers[offset + 1] << 8) |
      (this.registers[offset + 2] << 16) |
      (this.registers[offset + 3] << 24)
    ) >>> 0
  }

  read16(offset: number): number {
    this.ensureBacking()
    if (offset + 2 > this.size) return 0
    return (this.registers[offset] | (this.registers[offset + 1] << 8)) & 0xffff
  }

  read8(offset: number): number {
    this.ensureBacking()
    if (offset >= this.size) return 0
    return this.registers[offset] & 0xff
  }

  write32(offset: number, value: number): void {
    this.ensureBacking()
    if (offset + 4 > this.size) return
    this.registers[offset] = value & 0xff
    this.registers[offset + 1] = (value >>> 8) & 0xff
    this.registers[offset + 2] = (value >>> 16) & 0xff
    this.registers[offset + 3] = (value >>> 24) & 0xff
  }

  write16(offset: number, value: number): void {
    this.ensureBacking()
    if (offset + 2 > this.size) return
    this.registers[offset] = value & 0xff
    this.registers[offset + 1] = (value >>> 8) & 0xff
  }

  write8(offset: number, value: number): void {
    this.ensureBacking()
    if (offset >= this.size) return
    this.registers[offset] = value & 0xff
  }
}
