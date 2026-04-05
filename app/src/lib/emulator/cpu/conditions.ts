// ARM condition codes.
//
// Every ARM instruction carries a 4-bit condition field in bits 31:28 that
// decides whether the instruction actually executes. The same encoding is
// reused in Thumb conditional branch (B<cond>).

export const COND_EQ = 0x0
export const COND_NE = 0x1
export const COND_CS = 0x2 // HS
export const COND_CC = 0x3 // LO
export const COND_MI = 0x4
export const COND_PL = 0x5
export const COND_VS = 0x6
export const COND_VC = 0x7
export const COND_HI = 0x8
export const COND_LS = 0x9
export const COND_GE = 0xa
export const COND_LT = 0xb
export const COND_GT = 0xc
export const COND_LE = 0xd
export const COND_AL = 0xe
export const COND_NV = 0xf

import { flagC, flagN, flagV, flagZ } from './state'

/** Check whether an instruction should execute given the CPSR flags. */
export function checkCondition(cond: number, cpsr: number): boolean {
  const N = flagN(cpsr)
  const Z = flagZ(cpsr)
  const C = flagC(cpsr)
  const V = flagV(cpsr)

  switch (cond & 0xf) {
    case COND_EQ:
      return Z === 1
    case COND_NE:
      return Z === 0
    case COND_CS:
      return C === 1
    case COND_CC:
      return C === 0
    case COND_MI:
      return N === 1
    case COND_PL:
      return N === 0
    case COND_VS:
      return V === 1
    case COND_VC:
      return V === 0
    case COND_HI:
      return C === 1 && Z === 0
    case COND_LS:
      return C === 0 || Z === 1
    case COND_GE:
      return N === V
    case COND_LT:
      return N !== V
    case COND_GT:
      return Z === 0 && N === V
    case COND_LE:
      return Z === 1 || N !== V
    case COND_AL:
      return true
    case COND_NV:
      // Reserved / unconditional opcode space on ARMv7. Higher-level dispatch
      // handles these separately (BLX, CPS, …).
      return false
  }
  return false
}
