// ARM (A32) mode instruction decode + execute.
//
// Covers the subset required for the Deluge firmware boot:
//   - Data processing: AND, EOR, SUB, RSB, ADD, ADC, SBC, RSC, TST, TEQ,
//     CMP, CMN, ORR, MOV, BIC, MVN (register and immediate operand forms)
//   - Load/store single: LDR, STR, LDRB, STRB
//   - Load/store halfword: LDRH, STRH, LDRSB, LDRSH
//   - Multiply: MUL, MLA, UMULL, SMULL
//   - Branch: B, BL, BX, BLX register
//   - Status register: MRS, MSR
//   - Coprocessor: MRC, MCR (CP15 stubs return 0)
//   - Block data transfer: LDM, STM (for push/pop and stack frames)
//
// Instruction layout reference: ARMv7-A Architecture Reference Manual.

import { checkCondition, COND_NV } from './conditions'
import {
  CPSR_C,
  CPSR_T,
  MODE_IRQ,
  MODE_SVC,
  addWithCarry,
  flagC,
  setFlagsNZ,
  setFlagsNZCV,
  sub,
  subWithCarry,
  type CpuState,
} from './state'
import {
  applyImmediateShift,
  applyShift,
  expandRotatedImmediate,
  SHIFT_ROR,
} from './shifts'
import type { ExecutionContext } from './context'

// ---------------------------------------------------------------------------
// Opcodes
// ---------------------------------------------------------------------------

const OP_AND = 0x0
const OP_EOR = 0x1
const OP_SUB = 0x2
const OP_RSB = 0x3
const OP_ADD = 0x4
const OP_ADC = 0x5
const OP_SBC = 0x6
const OP_RSC = 0x7
const OP_TST = 0x8
const OP_TEQ = 0x9
const OP_CMP = 0xa
const OP_CMN = 0xb
const OP_ORR = 0xc
const OP_MOV = 0xd
const OP_BIC = 0xe
const OP_MVN = 0xf

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

export function executeArm(ctx: ExecutionContext, instr: number): void {
  const cond = (instr >>> 28) & 0xf

  if (cond === COND_NV) {
    // Unconditional encoding space: BLX(imm) lives here. Other entries are
    // treated as no-ops.
    executeUnconditional(ctx, instr)
    return
  }
  if (!checkCondition(cond, ctx.state.cpsr)) return

  // Decode by the "op1" field (bits 27:25) and instruction-specific bits.
  const op1 = (instr >>> 25) & 0x7

  // 000 + 0001_0010 XXXX XXXX XXXX 00X1 = misc (BX, BLX reg, MRS, MSR reg, …)
  // 000 + data processing register form
  // 001 + data processing immediate form
  // 010/011 + load/store single
  // 100/101 + block data transfer / branch
  // 110/111 + coprocessor / SWI

  switch (op1) {
    case 0b000:
      executeBits000(ctx, instr)
      return
    case 0b001:
      executeDataProcessingImmediate(ctx, instr)
      return
    case 0b010:
      executeLoadStoreImm(ctx, instr)
      return
    case 0b011:
      executeLoadStoreReg(ctx, instr)
      return
    case 0b100:
      executeBlockDataTransfer(ctx, instr)
      return
    case 0b101:
      executeBranch(ctx, instr)
      return
    case 0b110:
    case 0b111:
      executeCoproc(ctx, instr)
      return
  }
}

// ---------------------------------------------------------------------------
// Bits 27:25 = 000 — data processing register form, miscellaneous, multiply,
// and halfword load/store all share this top pattern. Disambiguate by the
// bit-4/bit-7 combination.
// ---------------------------------------------------------------------------

function executeBits000(ctx: ExecutionContext, instr: number): void {
  const bit4 = (instr >>> 4) & 1
  const bit7 = (instr >>> 7) & 1

  if (bit4 === 1 && bit7 === 1) {
    // Multiply or halfword/signed load/store (bit7=1,bit4=1) — differentiate
    // by bits 6:5.
    const bits65 = (instr >>> 5) & 0x3
    if (bits65 === 0) {
      executeMultiply(ctx, instr)
      return
    }
    executeHalfwordLoadStore(ctx, instr)
    return
  }

  // Miscellaneous vs data-processing register:
  //   miscellaneous is bits 24:23 == 10 and S == 0 (instr bit 20 == 0)
  const opField = (instr >>> 20) & 0x1f
  if ((opField & 0b11001) === 0b10000) {
    executeMiscellaneous(ctx, instr)
    return
  }
  executeDataProcessingRegister(ctx, instr)
}

// ---------------------------------------------------------------------------
// Data processing — register operand form (I = 0, bits 27:25 = 000)
// ---------------------------------------------------------------------------

function executeDataProcessingRegister(
  ctx: ExecutionContext,
  instr: number,
): void {
  const opcode = (instr >>> 21) & 0xf
  const S = (instr >>> 20) & 1
  const Rn = (instr >>> 16) & 0xf
  const Rd = (instr >>> 12) & 0xf
  const shiftType = (instr >>> 5) & 0x3
  const regShift = (instr >>> 4) & 1
  const Rm = instr & 0xf

  let shiftAmount: number
  if (regShift === 1) {
    // Register-specified shift: amount is in Rs[7:0]. When R15 is an operand
    // in this form, it reads as PC+12 because the instruction stalls one
    // extra cycle. We approximate with PC+8 for simplicity.
    const Rs = (instr >>> 8) & 0xf
    shiftAmount = ctx.readReg(Rs) & 0xff
  } else {
    shiftAmount = (instr >>> 7) & 0x1f
  }

  const rmValue = ctx.readReg(Rm)
  const shifted =
    regShift === 1
      ? applyShift(rmValue, shiftType, shiftAmount, flagC(ctx.state.cpsr))
      : applyImmediateShift(rmValue, shiftType, shiftAmount, flagC(ctx.state.cpsr))

  performDataProcessing(ctx, opcode, S, Rn, Rd, shifted.value, shifted.carry)
}

// ---------------------------------------------------------------------------
// Data processing — immediate operand form (I = 1, bits 27:25 = 001)
// ---------------------------------------------------------------------------

function executeDataProcessingImmediate(
  ctx: ExecutionContext,
  instr: number,
): void {
  const opcode = (instr >>> 21) & 0xf
  const S = (instr >>> 20) & 1
  // MSR immediate overlaps with TST/TEQ/CMP/CMN when S=0 (opcode 1000..1011).
  if (S === 0 && opcode >= OP_TST && opcode <= OP_CMN) {
    tryMsrImmediate(ctx, instr)
    return
  }
  const Rn = (instr >>> 16) & 0xf
  const Rd = (instr >>> 12) & 0xf
  const rotate = (instr >>> 8) & 0xf
  const imm8 = instr & 0xff

  const expanded = expandRotatedImmediate(imm8, rotate, flagC(ctx.state.cpsr))
  performDataProcessing(
    ctx,
    opcode,
    S,
    Rn,
    Rd,
    expanded.value,
    expanded.carry,
  )
}

// ---------------------------------------------------------------------------
// Shared data-processing execute — once operand2 and shifter-carry are known.
// ---------------------------------------------------------------------------

function performDataProcessing(
  ctx: ExecutionContext,
  opcode: number,
  S: number,
  Rn: number,
  Rd: number,
  op2: number,
  shifterCarry: number,
): void {
  const a = ctx.readReg(Rn)
  const b = op2 >>> 0
  let result = 0
  let carry = shifterCarry
  let overflow = 0
  let writeResult = true
  // Instructions that use the carry flag for flag update only (logical ops)
  // don't touch the V flag; arithmetic ops set both C and V.
  let setCV = false

  switch (opcode) {
    case OP_AND:
      result = (a & b) >>> 0
      break
    case OP_EOR:
      result = (a ^ b) >>> 0
      break
    case OP_SUB: {
      const r = sub(a, b)
      result = r.value
      carry = r.carry
      overflow = r.overflow
      setCV = true
      break
    }
    case OP_RSB: {
      const r = sub(b, a)
      result = r.value
      carry = r.carry
      overflow = r.overflow
      setCV = true
      break
    }
    case OP_ADD: {
      const r = addWithCarry(a, b, 0)
      result = r.value
      carry = r.carry
      overflow = r.overflow
      setCV = true
      break
    }
    case OP_ADC: {
      const r = addWithCarry(a, b, flagC(ctx.state.cpsr))
      result = r.value
      carry = r.carry
      overflow = r.overflow
      setCV = true
      break
    }
    case OP_SBC: {
      const r = subWithCarry(a, b, flagC(ctx.state.cpsr))
      result = r.value
      carry = r.carry
      overflow = r.overflow
      setCV = true
      break
    }
    case OP_RSC: {
      const r = subWithCarry(b, a, flagC(ctx.state.cpsr))
      result = r.value
      carry = r.carry
      overflow = r.overflow
      setCV = true
      break
    }
    case OP_TST:
      result = (a & b) >>> 0
      writeResult = false
      break
    case OP_TEQ:
      result = (a ^ b) >>> 0
      writeResult = false
      break
    case OP_CMP: {
      const r = sub(a, b)
      result = r.value
      carry = r.carry
      overflow = r.overflow
      setCV = true
      writeResult = false
      break
    }
    case OP_CMN: {
      const r = addWithCarry(a, b, 0)
      result = r.value
      carry = r.carry
      overflow = r.overflow
      setCV = true
      writeResult = false
      break
    }
    case OP_ORR:
      result = (a | b) >>> 0
      break
    case OP_MOV:
      result = b
      break
    case OP_BIC:
      result = (a & ~b) >>> 0
      break
    case OP_MVN:
      result = (~b) >>> 0
      break
  }

  if (writeResult) {
    ctx.writeReg(Rd, result)
  }
  if (S === 1) {
    if (Rd === 15 && writeResult) {
      // ARMv7-A exception return: CPSR = SPSR (of current mode).
      // PC has already been written via writeReg(15, result).
      // This handles `SUBS PC, LR, #4` / `MOVS PC, LR` IRQ returns.
      restoreCpsrFromSpsr(ctx.state)
    } else if (setCV) {
      ctx.state.cpsr = setFlagsNZCV(ctx.state.cpsr, result, carry, overflow)
    } else {
      ctx.state.cpsr = setFlagsNZ(ctx.state.cpsr, result)
      ctx.state.cpsr =
        ((ctx.state.cpsr & ~CPSR_C) | ((carry & 1) << 29)) >>> 0
    }
  }
}

/** Restore CPSR from the banked SPSR of the current mode and swap banked
 *  R13/R14 back to the destination mode. Implements exception return. */
function restoreCpsrFromSpsr(state: CpuState): void {
  const fromMode = state.cpsr & 0x1f
  if (fromMode === MODE_IRQ) {
    // Save current (IRQ-bank) R13/R14 for next IRQ entry.
    state.spIrq = state.r[13]
    state.lrIrq = state.r[14]
    // Restore USR/SYS bank.
    state.r[13] = state.spSys
    state.r[14] = state.lrSys
    state.cpsr = state.spsrIrq >>> 0
  } else if (fromMode === MODE_SVC) {
    state.spSvc = state.r[13]
    state.lrSvc = state.r[14]
    state.r[13] = state.spSys
    state.r[14] = state.lrSys
    state.cpsr = state.spsrSvc >>> 0
  }
}

// ---------------------------------------------------------------------------
// Miscellaneous (bits 27:20 = 0001 0xx0 and 27:20 = 0011 0xx0)
//   - BX (Rm)
//   - BLX (register)
//   - MRS
//   - MSR (register + immediate)
// ---------------------------------------------------------------------------

function executeMiscellaneous(ctx: ExecutionContext, instr: number): void {
  const op2 = (instr >>> 4) & 0xf

  // BX: cond 0001 0010 1111 1111 1111 0001 Rm
  // BLX: cond 0001 0010 1111 1111 1111 0011 Rm
  if (op2 === 0x1 || op2 === 0x3) {
    const Rm = instr & 0xf
    const target = ctx.readReg(Rm)
    if (op2 === 0x3) {
      // BLX register: save return address in LR
      const returnAddr = (ctx.state.r[15] + 4) >>> 0
      ctx.writeReg(14, returnAddr)
    }
    branchWithExchange(ctx, target)
    return
  }

  // MRS / MSR
  const op = (instr >>> 21) & 0x3
  if (op2 === 0x0) {
    // MRS: cond 00010R00 1111 Rd 0000 0000 0000
    // MSR register: cond 00010R10 XXXX 1111 0000 0000 Rm (op2==0)
    const psrRead = (op & 0x1) === 0
    const psrWrite = (op & 0x1) === 1
    if (psrRead && ((instr >>> 16) & 0xf) === 0xf) {
      // MRS
      const Rd = (instr >>> 12) & 0xf
      ctx.writeReg(Rd, ctx.state.cpsr >>> 0)
      return
    }
    if (psrWrite) {
      // MSR register — write CPSR
      const Rm = instr & 0xf
      const mask = buildPsrMask(instr)
      const value = ctx.readReg(Rm)
      ctx.state.cpsr =
        ((ctx.state.cpsr & ~mask) | (value & mask)) >>> 0
      return
    }
  }
}

// MSR immediate (bits 27:20 = 0011 0x10) is classified as a DP-immediate but
// decoded specially.
function tryMsrImmediate(ctx: ExecutionContext, instr: number): boolean {
  const opField = (instr >>> 20) & 0x1f
  if ((opField & 0b11011) !== 0b10010) return false
  // cond 00110x10 mask 1111 rot imm8
  const rotate = (instr >>> 8) & 0xf
  const imm8 = instr & 0xff
  const expanded = expandRotatedImmediate(imm8, rotate, flagC(ctx.state.cpsr))
  const mask = buildPsrMask(instr)
  ctx.state.cpsr = ((ctx.state.cpsr & ~mask) | (expanded.value & mask)) >>> 0
  return true
}

function buildPsrMask(instr: number): number {
  // Fields bits 19:16: c=0x1, x=0x2, s=0x4, f=0x8
  const fieldMask = (instr >>> 16) & 0xf
  let mask = 0
  if (fieldMask & 0x1) mask |= 0x000000ff
  if (fieldMask & 0x2) mask |= 0x0000ff00
  if (fieldMask & 0x4) mask |= 0x00ff0000
  if (fieldMask & 0x8) mask |= 0xff000000
  return mask >>> 0
}

// ---------------------------------------------------------------------------
// Multiply
// ---------------------------------------------------------------------------

function executeMultiply(ctx: ExecutionContext, instr: number): void {
  // Encoding (ARMv7 A1 form):
  //   31:28 cond
  //   27:24 0000
  //   23:21 op (000=MUL, 001=MLA, 100=UMULL, 101=UMLAL, 110=SMULL, 111=SMLAL)
  //   20    S
  //   19:16 Rd / RdHi
  //   15:12 Rn / RdLo
  //   11:8  Rs
  //   7:4   1001
  //   3:0   Rm
  const op = (instr >>> 21) & 0x7
  const S = (instr >>> 20) & 1
  const Rs = (instr >>> 8) & 0xf
  const Rm = instr & 0xf

  if ((op & 0b100) === 0) {
    // MUL (op=000) or MLA (op=001)
    const Rd = (instr >>> 16) & 0xf
    const Rn = (instr >>> 12) & 0xf
    const mulResult = Math.imul(ctx.readReg(Rm), ctx.readReg(Rs)) >>> 0
    const result =
      ((op & 0b001) === 1
        ? (mulResult + ctx.readReg(Rn)) >>> 0
        : mulResult) >>> 0
    ctx.writeReg(Rd, result)
    if (S === 1) ctx.state.cpsr = setFlagsNZ(ctx.state.cpsr, result)
    return
  }

  // Long multiply (UMULL / UMLAL / SMULL / SMLAL)
  const RdHi = (instr >>> 16) & 0xf
  const RdLo = (instr >>> 12) & 0xf
  const a = ctx.readReg(Rm) >>> 0
  const b = ctx.readReg(Rs) >>> 0
  const signed = (op & 0b010) !== 0
  const accumulate = (op & 0b001) !== 0

  let lo: number, hi: number
  if (signed) {
    const product = BigInt(a | 0) * BigInt(b | 0)
    lo = Number(product & 0xffffffffn) >>> 0
    hi = Number((product >> 32n) & 0xffffffffn) >>> 0
  } else {
    const product = BigInt(a) * BigInt(b)
    lo = Number(product & 0xffffffffn) >>> 0
    hi = Number((product >> 32n) & 0xffffffffn) >>> 0
  }

  if (accumulate) {
    const accLo = ctx.readReg(RdLo) >>> 0
    const accHi = ctx.readReg(RdHi) >>> 0
    const sumLo = lo + accLo
    const carry = sumLo > 0xffffffff ? 1 : 0
    lo = sumLo >>> 0
    hi = (hi + accHi + carry) >>> 0
  }

  ctx.writeReg(RdLo, lo)
  ctx.writeReg(RdHi, hi)
  if (S === 1) {
    let c = ctx.state.cpsr & ~0xc0000000
    if (hi & 0x80000000) c |= 0x80000000
    if (lo === 0 && hi === 0) c |= 0x40000000
    ctx.state.cpsr = c >>> 0
  }
}

// ---------------------------------------------------------------------------
// Halfword / signed load-store (bits 27:25 = 000, bit7 = 1, bit4 = 1,
// bits 6:5 != 00)
// ---------------------------------------------------------------------------

function executeHalfwordLoadStore(
  ctx: ExecutionContext,
  instr: number,
): void {
  const P = (instr >>> 24) & 1
  const U = (instr >>> 23) & 1
  const I = (instr >>> 22) & 1 // immediate when 1
  const W = (instr >>> 21) & 1
  const L = (instr >>> 20) & 1
  const Rn = (instr >>> 16) & 0xf
  const Rd = (instr >>> 12) & 0xf
  const op = (instr >>> 5) & 0x3 // 01=H, 10=SB, 11=SH
  const Rm = instr & 0xf

  let offset: number
  if (I === 1) {
    offset = (((instr >>> 8) & 0xf) << 4) | (instr & 0xf)
  } else {
    offset = ctx.readReg(Rm)
  }

  const base = ctx.readReg(Rn)
  const signed = U ? base + offset : base - offset
  const address = (P === 1 ? signed : base) >>> 0

  if (L === 1) {
    let value = 0
    switch (op) {
      case 0b01: // LDRH
        value = ctx.memory.read16(address)
        break
      case 0b10: // LDRSB
        value = ctx.memory.read8(address)
        if (value & 0x80) value |= 0xffffff00
        value = value >>> 0
        break
      case 0b11: // LDRSH
        value = ctx.memory.read16(address)
        if (value & 0x8000) value |= 0xffff0000
        value = value >>> 0
        break
    }
    ctx.writeReg(Rd, value >>> 0)
  } else {
    // Store: only STRH is encoded (other ops are load-only for ARMv7).
    const value = ctx.readReg(Rd)
    if (op === 0b01) {
      ctx.memory.write16(address, value & 0xffff)
    }
  }

  // Writeback
  if (P === 0 || W === 1) {
    ctx.writeReg(Rn, signed >>> 0)
  }
}

// ---------------------------------------------------------------------------
// Load/store single, immediate offset (bits 27:25 = 010)
// ---------------------------------------------------------------------------

function executeLoadStoreImm(ctx: ExecutionContext, instr: number): void {
  const P = (instr >>> 24) & 1
  const U = (instr >>> 23) & 1
  const B = (instr >>> 22) & 1
  const W = (instr >>> 21) & 1
  const L = (instr >>> 20) & 1
  const Rn = (instr >>> 16) & 0xf
  const Rd = (instr >>> 12) & 0xf
  const offset = instr & 0xfff

  performLoadStore(ctx, P, U, B, W, L, Rn, Rd, offset)
}

// ---------------------------------------------------------------------------
// Load/store single, register offset (bits 27:25 = 011)
// ---------------------------------------------------------------------------

function executeLoadStoreReg(ctx: ExecutionContext, instr: number): void {
  // bit 4 must be 0 for LS reg, otherwise it's a media / misc instruction —
  // those aren't part of our subset, so we treat them as NOPs.
  if ((instr >>> 4) & 1) return

  const P = (instr >>> 24) & 1
  const U = (instr >>> 23) & 1
  const B = (instr >>> 22) & 1
  const W = (instr >>> 21) & 1
  const L = (instr >>> 20) & 1
  const Rn = (instr >>> 16) & 0xf
  const Rd = (instr >>> 12) & 0xf
  const shiftAmount = (instr >>> 7) & 0x1f
  const shiftType = (instr >>> 5) & 0x3
  const Rm = instr & 0xf
  const rmValue = ctx.readReg(Rm)
  const offset = applyImmediateShift(
    rmValue,
    shiftType,
    shiftAmount,
    flagC(ctx.state.cpsr),
  ).value

  performLoadStore(ctx, P, U, B, W, L, Rn, Rd, offset)
}

function performLoadStore(
  ctx: ExecutionContext,
  P: number,
  U: number,
  B: number,
  W: number,
  L: number,
  Rn: number,
  Rd: number,
  offset: number,
): void {
  const base = ctx.readReg(Rn)
  const offsetAddress = (U === 1 ? base + offset : base - offset) >>> 0
  const address = P === 1 ? offsetAddress : base

  if (L === 1) {
    // Load
    const value = B === 1 ? ctx.memory.read8(address) : ctx.memory.read32(address)
    // When Rd == PC (15) and bit 0 of loaded value is set, treat like BX
    // (interworking load). This is used by POP {...,pc}.
    if (Rd === 15 && B === 0) {
      branchWithExchange(ctx, value)
    } else {
      ctx.writeReg(Rd, value >>> 0)
    }
  } else {
    // Store
    const value = ctx.readReg(Rd)
    if (B === 1) {
      ctx.memory.write8(address, value & 0xff)
    } else {
      ctx.memory.write32(address, value >>> 0)
    }
  }

  // Writeback: P=0 => always; P=1,W=1 => pre-indexed writeback
  if (P === 0 || W === 1) {
    if (Rn !== Rd || L === 0) {
      ctx.writeReg(Rn, offsetAddress)
    }
  }
}

// ---------------------------------------------------------------------------
// Block data transfer: LDM / STM (bits 27:25 = 100)
// ---------------------------------------------------------------------------

function executeBlockDataTransfer(
  ctx: ExecutionContext,
  instr: number,
): void {
  const P = (instr >>> 24) & 1
  const U = (instr >>> 23) & 1
  const S = (instr >>> 22) & 1 // privileged bank access — unused in SYS mode
  const W = (instr >>> 21) & 1
  const L = (instr >>> 20) & 1
  const Rn = (instr >>> 16) & 0xf
  const regList = instr & 0xffff

  // Unused banked-register transfer bit.
  void S

  // Count the number of set bits
  let count = 0
  for (let i = 0; i < 16; i++) if ((regList >>> i) & 1) count++
  if (count === 0) return

  const base = ctx.readReg(Rn)
  const totalBytes = count * 4
  const startAddr =
    U === 1
      ? P === 1
        ? base + 4
        : base
      : P === 1
        ? base - totalBytes
        : base - totalBytes + 4

  let addr = startAddr >>> 0
  for (let i = 0; i < 16; i++) {
    if (!((regList >>> i) & 1)) continue
    if (L === 1) {
      const value = ctx.memory.read32(addr)
      if (i === 15) {
        branchWithExchange(ctx, value)
      } else {
        ctx.writeReg(i, value)
      }
    } else {
      ctx.memory.write32(addr, ctx.readReg(i))
    }
    addr = (addr + 4) >>> 0
  }

  if (W === 1) {
    const newBase =
      U === 1 ? (base + totalBytes) >>> 0 : (base - totalBytes) >>> 0
    ctx.writeReg(Rn, newBase)
  }
}

// ---------------------------------------------------------------------------
// Branch: B, BL (bits 27:25 = 101)
// ---------------------------------------------------------------------------

function executeBranch(ctx: ExecutionContext, instr: number): void {
  const link = (instr >>> 24) & 1
  // Sign-extend the 24-bit offset and multiply by 4.
  let offset = instr & 0x00ffffff
  if (offset & 0x00800000) offset -= 0x01000000
  offset = offset * 4
  const pc = ctx.readReg(15) // PC+8 in ARM state
  const target = (pc + offset) >>> 0
  if (link === 1) {
    const returnAddr = (ctx.state.r[15] + 4) >>> 0
    ctx.writeReg(14, returnAddr)
  }
  ctx.setPc((target & ~0x3) >>> 0)
  ctx.markPcModified()
}

// ---------------------------------------------------------------------------
// Coprocessor MRC/MCR (bits 27:25 = 110/111)
// ---------------------------------------------------------------------------

function executeCoproc(ctx: ExecutionContext, instr: number): void {
  // MRC/MCR: cond 1110 opc1 L CRn Rd cpnum opc2 1 CRm
  const bit4 = (instr >>> 4) & 1
  const majorOp = (instr >>> 24) & 0xf
  if (majorOp !== 0xe || bit4 === 0) {
    // CDP / LDC / STC / SWI — treated as NOPs for the boot subset.
    return
  }
  const L = (instr >>> 20) & 1
  const Rd = (instr >>> 12) & 0xf
  // cpnum is bits 11:8 — CP15 is the system control coprocessor.
  // We stub every coprocessor register to read 0 / accept any write.
  if (L === 1) {
    // MRC: read coprocessor register into Rd (or discard if Rd=15).
    if (Rd !== 15) ctx.writeReg(Rd, 0)
  }
  // MCR (L=0) is a no-op in the stub
}

// ---------------------------------------------------------------------------
// Unconditional instruction space (cond = 0xF)
// ---------------------------------------------------------------------------

function executeUnconditional(ctx: ExecutionContext, instr: number): void {
  // BLX(imm): 1111 101H offset24 — sign-extended offset, shift left 2, and
  //     set bit 1 to H (halfword). Switches to Thumb state.
  if ((instr >>> 25) === 0b1111101) {
    const H = (instr >>> 24) & 1
    let offset = instr & 0x00ffffff
    if (offset & 0x00800000) offset -= 0x01000000
    offset = offset * 4 + (H << 1)
    const pc = ctx.readReg(15)
    const target = (pc + offset) >>> 0
    const returnAddr = (ctx.state.r[15] + 4) >>> 0
    ctx.writeReg(14, returnAddr)
    // BLX always enters Thumb state.
    ctx.state.cpsr = (ctx.state.cpsr | CPSR_T) >>> 0
    ctx.setPc(target & ~0x1)
    ctx.markPcModified()
    return
  }

  // CPS (Change Processor State): 1111 0001 0000 imod M 0 0 0 0 0 0 0 0 AIF 0 mode
  // Encoding: 0xF10F0000 with bits 19:18 = imod, bit 17 = M, bits 8:6 = AIF mask, bits 4:0 = mode
  if ((instr & 0xfff10020) === 0xf1000000) {
    const imod = (instr >>> 18) & 0x3
    const M = (instr >>> 17) & 1
    const AIF = (instr >>> 6) & 0x7
    const mode = instr & 0x1f
    // A bit position 8, I at 7, F at 6
    const A_bit = 1 << 8
    const I_bit = 1 << 7
    const F_bit = 1 << 6
    let cpsr = ctx.state.cpsr
    if (imod === 0b10) {
      // Disable interrupts — set A/I/F bits for those in AIF
      if (AIF & 0b100) cpsr |= A_bit
      if (AIF & 0b010) cpsr |= I_bit
      if (AIF & 0b001) cpsr |= F_bit
    } else if (imod === 0b11) {
      // Enable interrupts — clear A/I/F bits
      if (AIF & 0b100) cpsr &= ~A_bit
      if (AIF & 0b010) cpsr &= ~I_bit
      if (AIF & 0b001) cpsr &= ~F_bit
    }
    if (M === 1) {
      cpsr = (cpsr & ~0x1f) | (mode & 0x1f)
    }
    ctx.state.cpsr = cpsr >>> 0
    return
  }

  // DMB / DSB / ISB memory barriers — NOPs in the emulator.
  //   DSB: 1111 0101 0111 1111 1111 0000 0100 option
  //   DMB: 1111 0101 0111 1111 1111 0000 0101 option
  //   ISB: 1111 0101 0111 1111 1111 0000 0110 option
  if ((instr & 0xfffffff0) === 0xf57ff040) return // DSB
  if ((instr & 0xfffffff0) === 0xf57ff050) return // DMB
  if ((instr & 0xfffffff0) === 0xf57ff060) return // ISB

  // PLD / PLDW / PLI — cache preload hints, NOPs
  if ((instr & 0xfd70f000) === 0xf550f000) return

  // MSR immediate lives in the unconditional space too when cond==0xF on
  // some CPUs; otherwise it uses cond!=0xF. Try it.
  if (tryMsrImmediate(ctx, instr)) return
}

// ---------------------------------------------------------------------------
// Mode switch helper
// ---------------------------------------------------------------------------

function branchWithExchange(ctx: ExecutionContext, target: number): void {
  const toThumb = (target & 1) === 1
  if (toThumb) {
    ctx.state.cpsr = (ctx.state.cpsr | CPSR_T) >>> 0
    ctx.setPc((target & ~0x1) >>> 0)
  } else {
    ctx.state.cpsr = (ctx.state.cpsr & ~CPSR_T) >>> 0
    ctx.setPc((target & ~0x3) >>> 0)
  }
  ctx.markPcModified()
}

// Export for tests
export function resetState(state: CpuState): void {
  state.r.fill(0)
  state.cpsr = 0x1f // System mode, ARM state
}

// Re-export the ROR shift type so higher-level code can refer to it.
export { SHIFT_ROR }
