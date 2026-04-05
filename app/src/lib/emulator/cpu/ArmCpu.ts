// ARMv7-A interpreter implementing the emulator's ArmCore interface.
//
// Owns the CPU register state, the memory controller, and the main run loop.
// The decoder/executor functions live in armExecute.ts / thumbExecute.ts; this
// class is the glue that fetches the next instruction at PC, calls the right
// executor, and handles the PC-advance + code-hook firing that every
// instruction needs.

import type {
  ArmCore,
  ArmCoreRegisters,
  ArmMemoryRegion,
  CodeHookCallback,
  HookId,
  MemoryHookCallback,
} from '../ArmCore'
import { CpuMemoryController } from './memory'
import {
  createCpuState,
  isThumb,
  CPSR_I,
  CPSR_T,
  MODE_IRQ,
  type CpuState,
} from './state'
import { InterruptController } from './interrupts'
import type { ExecutionContext } from './context'
import { executeArm } from './armExecute'
import { executeThumb } from './thumbExecute'

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

export interface PeripheralHandler {
  read: (offset: number, width: 1 | 2 | 4) => number
  write: (offset: number, width: 1 | 2 | 4, value: number) => void
}

export class ArmCpu implements ArmCore, ExecutionContext {
  readonly state: CpuState = createCpuState()
  readonly memory = new CpuMemoryController()
  readonly interrupts = new InterruptController()

  private memHooks: MemHook[] = []
  private codeHooks: CodeHook[] = []
  private nextHookId = 1
  private pauseRequested = false
  private pcModifiedFlag = false

  // -------------------------------------------------------------------------
  // ExecutionContext — register accessors used by the decoder
  // -------------------------------------------------------------------------

  readReg(n: number): number {
    if (n === 15) {
      const offset = isThumb(this.state.cpsr) ? 4 : 8
      return (this.state.r[15] + offset) >>> 0
    }
    return this.state.r[n] >>> 0
  }

  writeReg(n: number, value: number): void {
    this.state.r[n] = value >>> 0
    if (n === 15) this.pcModifiedFlag = true
  }

  setPc(address: number): void {
    this.state.r[15] = address >>> 0
  }

  markPcModified(): void {
    this.pcModifiedFlag = true
  }

  // -------------------------------------------------------------------------
  // ArmCore — memory mapping
  // -------------------------------------------------------------------------

  mapRegion(region: ArmMemoryRegion): void {
    const buffer = region.buffer ?? new Uint8Array(region.size)
    this.memory.mapRegion({
      start: region.start >>> 0,
      size: region.size,
      perms: region.perms,
      buffer,
    })
  }

  /**
   * Install a peripheral handler that overlays the mapped regions in a range.
   * Reads and writes in [start, start+size) are routed through the handler
   * instead of touching the backing buffer.
   */
  addPeripheralRegion(
    start: number,
    size: number,
    handler: PeripheralHandler,
  ): void {
    this.memory.addPeripheral({
      start: start >>> 0,
      size,
      read: handler.read,
      write: handler.write,
    })
  }

  writeMemory(address: number, data: Uint8Array): void {
    this.memory.writeBytes(address >>> 0, data)
    this.fireMemHooks('write', address, data.length)
  }

  readMemory(address: number, length: number): Uint8Array {
    const out = this.memory.readBytes(address >>> 0, length)
    this.fireMemHooks('read', address, length)
    return out
  }

  // -------------------------------------------------------------------------
  // ArmCore — register access
  // -------------------------------------------------------------------------

  setPC(address: number): void {
    this.state.r[15] = address >>> 0
  }

  getRegisters(): ArmCoreRegisters {
    const r = this.state.r
    return {
      r0: r[0] >>> 0,
      r1: r[1] >>> 0,
      r2: r[2] >>> 0,
      r3: r[3] >>> 0,
      r4: r[4] >>> 0,
      r5: r[5] >>> 0,
      r6: r[6] >>> 0,
      r7: r[7] >>> 0,
      r8: r[8] >>> 0,
      r9: r[9] >>> 0,
      r10: r[10] >>> 0,
      r11: r[11] >>> 0,
      r12: r[12] >>> 0,
      sp: r[13] >>> 0,
      lr: r[14] >>> 0,
      pc: r[15] >>> 0,
      cpsr: this.state.cpsr >>> 0,
    }
  }

  setRegister(name: keyof ArmCoreRegisters, value: number): void {
    const v = value >>> 0
    switch (name) {
      case 'r0': this.state.r[0] = v; break
      case 'r1': this.state.r[1] = v; break
      case 'r2': this.state.r[2] = v; break
      case 'r3': this.state.r[3] = v; break
      case 'r4': this.state.r[4] = v; break
      case 'r5': this.state.r[5] = v; break
      case 'r6': this.state.r[6] = v; break
      case 'r7': this.state.r[7] = v; break
      case 'r8': this.state.r[8] = v; break
      case 'r9': this.state.r[9] = v; break
      case 'r10': this.state.r[10] = v; break
      case 'r11': this.state.r[11] = v; break
      case 'r12': this.state.r[12] = v; break
      case 'sp': this.state.r[13] = v; break
      case 'lr': this.state.r[14] = v; break
      case 'pc': this.state.r[15] = v; break
      case 'cpsr': this.state.cpsr = v; break
    }
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  run(maxInstructions: number): number {
    this.pauseRequested = false
    let executed = 0
    while (executed < maxInstructions && !this.pauseRequested) {
      // Check for pending interrupts. IRQs are taken between
      // instructions when CPSR.I is clear.
      if (
        this.interrupts.hasPending() &&
        (this.state.cpsr & CPSR_I) === 0
      ) {
        this.takeIrq()
      }

      // Fire any code hooks pointed at the current PC.
      const pc = this.state.r[15] >>> 0
      if (this.codeHooks.length > 0) {
        for (const h of this.codeHooks) {
          if (h.address === pc) h.callback(pc)
        }
        if (this.pauseRequested) break
      }

      this.pcModifiedFlag = false
      if (isThumb(this.state.cpsr)) {
        const instr = this.memory.read16(pc)
        const halfwords = executeThumb(this, instr)
        if (!this.pcModifiedFlag) {
          this.state.r[15] = (pc + halfwords * 2) >>> 0
        }
      } else {
        const instr = this.memory.read32(pc)
        executeArm(this, instr)
        if (!this.pcModifiedFlag) {
          this.state.r[15] = (pc + 4) >>> 0
        }
      }
      executed++
    }
    return executed
  }

  /** Stop a running batch. Safe to call from hook callbacks. */
  pause(): void {
    this.pauseRequested = true
  }

  /**
   * Take an IRQ. Per ARMv7-A architecture:
   *   LR_irq  = return address (PC of the next instruction + 4 in ARM state)
   *   SPSR_irq = CPSR at time of exception
   *   CPSR.mode = IRQ, CPSR.I = 1, CPSR.T = 0
   *   PC = VBAR + 0x18
   *
   * After service, firmware returns with `SUBS PC, LR, #4` which restores
   * CPSR from SPSR and jumps to LR-4 (the interrupted instruction's +4
   * offset in the ARM-state exception entry convention).
   */
  private takeIrq(): void {
    const retAddr = (this.state.r[15] + 4) >>> 0 // ARM-state return PC
    // Save outgoing (USR/SYS) R13/R14 to their bank, load IRQ bank into
    // R13/R14, write the return address to R14 (= R14_irq).
    this.state.spSys = this.state.r[13]
    this.state.lrSys = this.state.r[14]
    this.state.r[13] = this.state.spIrq
    this.state.r[14] = retAddr
    this.state.spsrIrq = this.state.cpsr >>> 0
    // Switch mode: IRQ, disable further IRQs, force ARM state.
    this.state.cpsr =
      ((this.state.cpsr & ~0x1f & ~CPSR_T) | MODE_IRQ | CPSR_I) >>> 0
    this.state.r[15] = ((this.state.vbar >>> 0) + 0x18) >>> 0
    this.pcModifiedFlag = true
  }

  // -------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------

  addMemoryHook(
    start: number,
    size: number,
    callback: MemoryHookCallback,
  ): HookId {
    const id = this.nextHookId++
    this.memHooks.push({ id, start: start >>> 0, end: (start + size) >>> 0, callback })
    return id
  }

  addCodeHook(address: number, callback: CodeHookCallback): HookId {
    const id = this.nextHookId++
    this.codeHooks.push({ id, address: address >>> 0, callback })
    return id
  }

  removeHook(id: HookId): void {
    this.memHooks = this.memHooks.filter((h) => h.id !== id)
    this.codeHooks = this.codeHooks.filter((h) => h.id !== id)
  }

  close(): void {
    this.memory.clear()
    this.memHooks = []
    this.codeHooks = []
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private fireMemHooks(
    op: 'read' | 'write',
    address: number,
    length: number,
  ): void {
    if (this.memHooks.length === 0) return
    for (const h of this.memHooks) {
      if (address >= h.start && address < h.end) {
        h.callback(op, address, length as 1 | 2 | 4, 0)
      }
    }
  }
}
