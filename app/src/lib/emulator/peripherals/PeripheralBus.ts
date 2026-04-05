// Peripheral bus — dispatcher for memory-mapped register windows.
//
// Memory accesses to addresses inside the PERIPH windows are funnelled here;
// the bus finds the stub whose range contains the address and forwards the
// request. Overlapping stubs are not allowed (we throw at registration time).
//
// The bus exposes a logging hook so the debugger can trace every peripheral
// interaction during boot. This is expensive, so the logger is off by default.

import type { PeripheralStub } from './PeripheralStub'

export interface PeripheralAccess {
  stub: string
  op: 'read' | 'write'
  width: 8 | 16 | 32
  address: number
  offset: number
  value: number
}

export type PeripheralAccessLogger = (access: PeripheralAccess) => void

export class PeripheralBus {
  private readonly stubs: PeripheralStub[] = []
  private logger: PeripheralAccessLogger | null = null

  /** Register a new stub. Throws if its range overlaps an existing one. */
  register(stub: PeripheralStub): void {
    for (const existing of this.stubs) {
      if (this.overlaps(stub, existing)) {
        throw new Error(
          `Peripheral range overlap: ${stub.name} [0x${stub.baseAddr.toString(16)}, +${stub.size}] collides with ${existing.name}`,
        )
      }
    }
    this.stubs.push(stub)
  }

  /** Remove all registered stubs. Used by `reset()` in tests. */
  clear(): void {
    this.stubs.length = 0
  }

  /** Reset every registered stub to its power-on state. */
  reset(): void {
    for (const stub of this.stubs) stub.reset()
  }

  /** Fire an optional tick on each stub that opts in. */
  tick(cycles: number): void {
    for (const stub of this.stubs) {
      stub.tick?.(cycles)
    }
  }

  /** Attach (or detach) a trace logger. */
  setLogger(logger: PeripheralAccessLogger | null): void {
    this.logger = logger
  }

  /** List all stubs (read-only snapshot). */
  list(): readonly PeripheralStub[] {
    return this.stubs
  }

  /** Locate the stub that owns a given address, or undefined if unmapped. */
  stubForAddress(address: number): PeripheralStub | undefined {
    for (const s of this.stubs) {
      if (address >= s.baseAddr && address < s.baseAddr + s.size) return s
    }
    return undefined
  }

  // ---------------------------------------------------------------------------
  // Dispatcher
  // ---------------------------------------------------------------------------

  read32(address: number): number {
    const stub = this.stubForAddress(address)
    if (!stub) {
      this.log('read', 32, '', address, 0, 0)
      return 0
    }
    const offset = address - stub.baseAddr
    const value = stub.read32(offset) >>> 0
    this.log('read', 32, stub.name, address, offset, value)
    return value
  }

  read16(address: number): number {
    const stub = this.stubForAddress(address)
    if (!stub) {
      this.log('read', 16, '', address, 0, 0)
      return 0
    }
    const offset = address - stub.baseAddr
    const value = stub.read16(offset) & 0xffff
    this.log('read', 16, stub.name, address, offset, value)
    return value
  }

  read8(address: number): number {
    const stub = this.stubForAddress(address)
    if (!stub) {
      this.log('read', 8, '', address, 0, 0)
      return 0
    }
    const offset = address - stub.baseAddr
    const value = stub.read8(offset) & 0xff
    this.log('read', 8, stub.name, address, offset, value)
    return value
  }

  write32(address: number, value: number): void {
    const stub = this.stubForAddress(address)
    if (!stub) {
      this.log('write', 32, '', address, 0, value)
      return
    }
    const offset = address - stub.baseAddr
    stub.write32(offset, value >>> 0)
    this.log('write', 32, stub.name, address, offset, value)
  }

  write16(address: number, value: number): void {
    const stub = this.stubForAddress(address)
    if (!stub) {
      this.log('write', 16, '', address, 0, value)
      return
    }
    const offset = address - stub.baseAddr
    stub.write16(offset, value & 0xffff)
    this.log('write', 16, stub.name, address, offset, value)
  }

  write8(address: number, value: number): void {
    const stub = this.stubForAddress(address)
    if (!stub) {
      this.log('write', 8, '', address, 0, value)
      return
    }
    const offset = address - stub.baseAddr
    stub.write8(offset, value & 0xff)
    this.log('write', 8, stub.name, address, offset, value)
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private overlaps(a: PeripheralStub, b: PeripheralStub): boolean {
    const aEnd = a.baseAddr + a.size
    const bEnd = b.baseAddr + b.size
    return a.baseAddr < bEnd && b.baseAddr < aEnd
  }

  private log(
    op: 'read' | 'write',
    width: 8 | 16 | 32,
    stub: string,
    address: number,
    offset: number,
    value: number,
  ): void {
    if (!this.logger) return
    this.logger({ stub, op, width, address, offset, value })
  }
}
