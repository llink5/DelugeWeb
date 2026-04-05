// CPU register state, CPSR layout, and mode helpers.
//
// The ARMv7-A architecture has banked registers per processor mode, but for
// the Deluge emulator's scope we run exclusively in System mode: R0-R15 are
// the same across every mode we care about. If IRQ/FIQ mode switching is
// added later, this module is where the bank selection would live.

// CPSR bit layout (ARMv7-A):
//   31 N  30 Z  29 C  28 V  ... 7 I  6 F  5 T  4:0 mode
export const CPSR_N = 1 << 31
export const CPSR_Z = 1 << 30
export const CPSR_C = 1 << 29
export const CPSR_V = 1 << 28
export const CPSR_I = 1 << 7
export const CPSR_F = 1 << 6
export const CPSR_T = 1 << 5

export const MODE_USER = 0x10
export const MODE_FIQ = 0x11
export const MODE_IRQ = 0x12
export const MODE_SVC = 0x13
export const MODE_ABT = 0x17
export const MODE_UND = 0x1b
export const MODE_SYS = 0x1f

/** Architectural CPU register file. R13=SP, R14=LR, R15=PC. */
export interface CpuState {
  /** 16 general-purpose registers including SP (r13), LR (r14), PC (r15).
   *  R13 and R14 hold the CURRENT mode's values; banks for other modes
   *  live in lrSys/spSys/lrIrq/spIrq/lrSvc/spSvc and swap on mode change. */
  r: Uint32Array
  /** Current program status register. */
  cpsr: number
  /** Banked R14/R13 for USR/SYS modes (SYS is what we boot into). */
  lrSys: number
  spSys: number
  /** Banked registers for IRQ mode: R14_irq, R13_irq, SPSR_irq. */
  lrIrq: number
  spIrq: number
  spsrIrq: number
  /** Banked registers for SVC mode (minimal support). */
  lrSvc: number
  spSvc: number
  spsrSvc: number
  /** Vector Base Address Register (CP15 c12 c0 0). Default 0x00000000. */
  vbar: number
}

export function createCpuState(): CpuState {
  return {
    r: new Uint32Array(16),
    cpsr: MODE_SYS, // Start in System mode, ARM state, interrupts enabled
    lrSys: 0,
    spSys: 0,
    lrIrq: 0,
    spIrq: 0,
    spsrIrq: 0,
    lrSvc: 0,
    spSvc: 0,
    spsrSvc: 0,
    vbar: 0,
  }
}

// ---------------------------------------------------------------------------
// Flag helpers
// ---------------------------------------------------------------------------

export function flagN(cpsr: number): number {
  return (cpsr >>> 31) & 1
}
export function flagZ(cpsr: number): number {
  return (cpsr >>> 30) & 1
}
export function flagC(cpsr: number): number {
  return (cpsr >>> 29) & 1
}
export function flagV(cpsr: number): number {
  return (cpsr >>> 28) & 1
}

export function isThumb(cpsr: number): boolean {
  return (cpsr & CPSR_T) !== 0
}

export function setFlagsNZ(cpsr: number, result: number): number {
  const r = result >>> 0
  let out = cpsr & ~(CPSR_N | CPSR_Z)
  if (r & 0x80000000) out |= CPSR_N
  if (r === 0) out |= CPSR_Z
  return out >>> 0
}

export function setFlagsNZCV(
  cpsr: number,
  result: number,
  carry: number,
  overflow: number,
): number {
  let out = cpsr & ~(CPSR_N | CPSR_Z | CPSR_C | CPSR_V)
  const r = result >>> 0
  if (r & 0x80000000) out |= CPSR_N
  if (r === 0) out |= CPSR_Z
  if (carry) out |= CPSR_C
  if (overflow) out |= CPSR_V
  return out >>> 0
}

export function setFlagC(cpsr: number, c: number): number {
  if (c) return (cpsr | CPSR_C) >>> 0
  return (cpsr & ~CPSR_C) >>> 0
}

// ---------------------------------------------------------------------------
// Arithmetic result helpers
// ---------------------------------------------------------------------------
// ARM flag convention: for ADD, carry out = unsigned overflow; for SUB,
// carry out = NOT borrow (i.e. 1 when no borrow). Overflow = signed overflow.

export interface ArithResult {
  value: number
  carry: number
  overflow: number
}

export function addWithCarry(
  a: number,
  b: number,
  cin: number,
): ArithResult {
  a = a >>> 0
  b = b >>> 0
  cin = cin & 1
  // Use 33-bit arithmetic to capture the carry out
  const u = a + b + cin
  const value = u >>> 0
  const carry = u > 0xffffffff ? 1 : 0
  const signA = (a >>> 31) & 1
  const signB = (b >>> 31) & 1
  const signR = (value >>> 31) & 1
  // Overflow if both operands share a sign and the result differs.
  const overflow = signA === signB && signR !== signA ? 1 : 0
  return { value, carry, overflow }
}

/** SUB a - b: rewrite as a + ~b + 1 so flag semantics drop out of addWithCarry. */
export function sub(a: number, b: number): ArithResult {
  return addWithCarry(a, (~b) >>> 0, 1)
}

/** SBC a - b - (1-C): a + ~b + C */
export function subWithCarry(a: number, b: number, c: number): ArithResult {
  return addWithCarry(a, (~b) >>> 0, c & 1)
}
