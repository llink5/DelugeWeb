// NullArmCore — a no-op ArmCore implementation.
//
// Backing the harness with a null core lets us exercise the emulator's
// surrounding infrastructure (message protocol, peripheral bus, memory map,
// snapshots) without pulling in Unicorn or any WASM binary. The core happily
// maps memory and reads/writes bytes, but `run()` is a no-op that returns
// immediately — it reports zero instructions executed and does not advance
// the PC.
//
// Replace this with a Unicorn-backed core (or a pure-TS ARM interpreter) to
// actually execute firmware instructions.

import type {
  ArmCore,
  ArmCoreRegisters,
  ArmMemoryRegion,
  CodeHookCallback,
  HookId,
  MemoryHookCallback,
} from './ArmCore'

interface MemHook {
  id: HookId
  start: number
  end: number
  callback: MemoryHookCallback
}

interface CodeHook {
  id: HookId
  address: number
  callback: CodeHookCallback
}

export class NullArmCore implements ArmCore {
  private regions: ArmMemoryRegion[] = []
  private registers: ArmCoreRegisters = emptyRegisters()
  private memHooks: MemHook[] = []
  private codeHooks: CodeHook[] = []
  private nextHookId = 1

  mapRegion(region: ArmMemoryRegion): void {
    // Allocate a backing buffer if the caller didn't provide one so
    // writeMemory/readMemory still work.
    if (!region.buffer) {
      region = { ...region, buffer: new Uint8Array(region.size) }
    }
    this.regions.push(region)
  }

  writeMemory(address: number, data: Uint8Array): void {
    const hit = this.findRegion(address, data.length)
    if (!hit) return
    const offset = address - hit.region.start
    hit.region.buffer!.set(data, offset)
    for (const h of this.memHooks) {
      if (address >= h.start && address < h.end) {
        h.callback('write', address, data.length as 1 | 2 | 4, 0)
      }
    }
  }

  readMemory(address: number, length: number): Uint8Array {
    const hit = this.findRegion(address, length)
    if (!hit) return new Uint8Array(length)
    const offset = address - hit.region.start
    const out = hit.region.buffer!.slice(offset, offset + length)
    for (const h of this.memHooks) {
      if (address >= h.start && address < h.end) {
        h.callback('read', address, length as 1 | 2 | 4, 0)
      }
    }
    return out
  }

  setPC(address: number): void {
    this.registers.pc = address >>> 0
  }

  getRegisters(): ArmCoreRegisters {
    return { ...this.registers }
  }

  setRegister(name: keyof ArmCoreRegisters, value: number): void {
    this.registers[name] = value >>> 0
  }

  run(_maxInstructions: number): number {
    // No-op: the null core doesn't actually execute. Return 0 so callers can
    // detect that nothing happened.
    return 0
  }

  addMemoryHook(
    start: number,
    size: number,
    callback: MemoryHookCallback,
  ): HookId {
    const id = this.nextHookId++
    this.memHooks.push({ id, start, end: start + size, callback })
    return id
  }

  addCodeHook(address: number, callback: CodeHookCallback): HookId {
    const id = this.nextHookId++
    this.codeHooks.push({ id, address, callback })
    return id
  }

  removeHook(id: HookId): void {
    this.memHooks = this.memHooks.filter((h) => h.id !== id)
    this.codeHooks = this.codeHooks.filter((h) => h.id !== id)
  }

  close(): void {
    this.regions = []
    this.memHooks = []
    this.codeHooks = []
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private findRegion(
    address: number,
    length: number,
  ): { region: ArmMemoryRegion } | undefined {
    for (const r of this.regions) {
      if (address >= r.start && address + length <= r.start + r.size) {
        return { region: r }
      }
    }
    return undefined
  }
}

function emptyRegisters(): ArmCoreRegisters {
  return {
    r0: 0, r1: 0, r2: 0, r3: 0, r4: 0, r5: 0, r6: 0, r7: 0,
    r8: 0, r9: 0, r10: 0, r11: 0, r12: 0,
    sp: 0, lr: 0, pc: 0, cpsr: 0,
  }
}
