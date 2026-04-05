// Abstract ARM core interface.
//
// The emulator frontend (EmulatorWorker) doesn't care how ARM instructions
// are executed — only that some backend can step the CPU, expose registers,
// and surface memory hooks. This file defines the contract that backend
// must satisfy. Today the only production-grade option is Unicorn Engine
// compiled to WASM (`unicorn-engine` on npm, or a custom Emscripten build);
// it can be slotted in by wrapping it behind this interface.
//
// A second `NullArmCore` implementation lives in `NullArmCore.ts` and is
// used for tests that don't need to execute code but still want to drive
// the surrounding infrastructure (memory map, peripherals, worker protocol).

export type HookId = number

export type MemoryHookCallback = (
  op: 'read' | 'write',
  address: number,
  width: 1 | 2 | 4,
  value: number,
) => void

export type CodeHookCallback = (address: number) => void

export interface ArmCoreRegisters {
  r0: number; r1: number; r2: number; r3: number
  r4: number; r5: number; r6: number; r7: number
  r8: number; r9: number; r10: number; r11: number
  r12: number
  /** Stack pointer */
  sp: number
  /** Link register */
  lr: number
  /** Program counter */
  pc: number
  /** Current program status register */
  cpsr: number
}

export interface ArmMemoryRegion {
  start: number
  size: number
  perms: 'r--' | 'r-x' | 'rw-' | 'rwx'
  /** Backing buffer, or undefined for peripheral windows. */
  buffer?: Uint8Array
}

/**
 * Minimal, backend-agnostic ARM32 execution contract.
 *
 * All methods are synchronous — a Unicorn-backed implementation runs inside
 * the worker's own thread and doesn't need async.
 */
export interface ArmCore {
  /** Map a memory region. Must be called before execution starts. */
  mapRegion(region: ArmMemoryRegion): void

  /** Copy bytes into mapped memory. */
  writeMemory(address: number, data: Uint8Array): void

  /** Copy bytes out of mapped memory. */
  readMemory(address: number, length: number): Uint8Array

  /** Set the program counter (entry point). */
  setPC(address: number): void

  /** Read the complete register file. */
  getRegisters(): ArmCoreRegisters

  /** Set a specific register by name. */
  setRegister(name: keyof ArmCoreRegisters, value: number): void

  /**
   * Run up to `maxInstructions` instructions starting at the current PC.
   * Returns the number of instructions actually executed, which may be less
   * than `maxInstructions` if a hook requested a pause.
   */
  run(maxInstructions: number): number

  /** Register a memory-access hook over `[start, start+size)`. */
  addMemoryHook(
    start: number,
    size: number,
    callback: MemoryHookCallback,
  ): HookId

  /** Register a code hook at `address`. Fires every time that PC is reached. */
  addCodeHook(address: number, callback: CodeHookCallback): HookId

  /** Remove a previously registered hook. */
  removeHook(id: HookId): void

  /** Release all backend resources. */
  close(): void
}
