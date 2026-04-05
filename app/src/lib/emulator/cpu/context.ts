// Execution context interface.
//
// The ARM and Thumb decoders don't know about the surrounding ArmCpu class.
// They receive a plain object that exposes just the state, memory, and
// register accessors they need. ArmCpu implements this interface and passes
// itself in.

import type { CpuState } from './state'
import type { CpuMemoryController } from './memory'

export interface ExecutionContext {
  state: CpuState
  memory: CpuMemoryController

  /**
   * Read a GPR. Reads of R15 return PC + 8 (ARM) / PC + 4 (Thumb) to match
   * the prefetch behaviour of a real Cortex-A9 pipeline.
   */
  readReg(n: number): number

  /**
   * Write a GPR. Writes to R15 set the pcModified flag so the run loop
   * skips its auto-increment.
   */
  writeReg(n: number, value: number): void

  /**
   * Overwrite the raw PC without prefetch adjustment. Used when performing
   * a branch with mode switch.
   */
  setPc(address: number): void

  /** Signal that PC was modified by the current instruction. */
  markPcModified(): void
}
