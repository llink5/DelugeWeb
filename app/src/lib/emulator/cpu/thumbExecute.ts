// Thumb (T32) mode instruction decode + execute.
//
// Thumb is a 16-bit ISA that shares register state with ARM. Each instruction
// is one halfword; Thumb-2 extensions add 32-bit forms (e.g. BL.W, B.W) that
// are encoded as two consecutive halfwords. We support classic Thumb plus
// the 32-bit BL / B.W encodings (which GCC emits heavily for calls and
// long branches).
//
// Formats covered (classic Thumb):
//   1  move shifted register (LSL/LSR/ASR imm)
//   2  add/subtract register/imm3
//   3  move/cmp/add/sub immediate
//   4  ALU operations
//   5  hi register operations / BX / BLX
//   6  PC-relative load
//   7  load/store with register offset
//   8  load/store sign-extended byte/halfword
//   9  load/store with immediate offset
//   10 load/store halfword
//   11 SP-relative load/store
//   12 load address (ADR / ADD SP)
//   13 add offset to SP
//   14 push/pop
//   15 multiple load/store
//   16 conditional branch
//   18 unconditional branch
//   19 long branch with link (two-halfword classic + 32-bit Thumb-2)

import { checkCondition } from './conditions'
import {
  CPSR_C,
  CPSR_T,
  addWithCarry,
  flagC,
  setFlagsNZ,
  setFlagsNZCV,
  sub,
  subWithCarry,
} from './state'
import { applyShift, SHIFT_LSL, SHIFT_LSR, SHIFT_ASR, SHIFT_ROR } from './shifts'
import type { ExecutionContext } from './context'

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Execute a single Thumb instruction. If the halfword at PC is the first
 * half of a 32-bit Thumb-2 instruction, this function consumes both halves
 * and returns the number of halfwords executed (2).
 *
 * Returns the size in halfwords (1 or 2) so the caller can advance PC by the
 * right amount.
 */
export function executeThumb(
  ctx: ExecutionContext,
  halfword: number,
): number {
  // 32-bit Thumb-2 instructions start with 11101, 11110, or 11111 in
  // bits 15:11.
  const top5 = (halfword >>> 11) & 0x1f
  if (top5 === 0b11101 || top5 === 0b11110 || top5 === 0b11111) {
    const secondHalf = ctx.memory.read16(
      (ctx.state.r[15] + 2) >>> 0,
    )
    executeThumb32(ctx, halfword, secondHalf)
    return 2
  }

  dispatchThumb16(ctx, halfword)
  return 1
}

// ---------------------------------------------------------------------------
// Classic 16-bit Thumb dispatch
// ---------------------------------------------------------------------------

function dispatchThumb16(ctx: ExecutionContext, instr: number): void {
  const top3 = (instr >>> 13) & 0x7

  switch (top3) {
    case 0b000:
      executeFormat1or2(ctx, instr)
      return
    case 0b001:
      executeFormat3(ctx, instr)
      return
    case 0b010:
      executeFormat4567(ctx, instr)
      return
    case 0b011:
      executeFormat9(ctx, instr)
      return
    case 0b100:
      executeFormat10or11(ctx, instr)
      return
    case 0b101:
      executeFormat12or13or14(ctx, instr)
      return
    case 0b110:
      executeFormat15or16(ctx, instr)
      return
    case 0b111:
      executeFormat18or19(ctx, instr)
      return
  }
}

// ---------------------------------------------------------------------------
// Format 1 (move shifted register) and Format 2 (add/subtract)
//   000 op(2) ... : Format 1 (LSL/LSR/ASR)
//   00011 ...     : Format 2 (add/sub)
// ---------------------------------------------------------------------------

function executeFormat1or2(ctx: ExecutionContext, instr: number): void {
  const bits12_11 = (instr >>> 11) & 0x3
  if (bits12_11 !== 0b11) {
    // Format 1: LSL/LSR/ASR by immediate
    const op = bits12_11
    const offset5 = (instr >>> 6) & 0x1f
    const Rs = (instr >>> 3) & 0x7
    const Rd = instr & 0x7
    const value = ctx.readReg(Rs)
    let shiftType = SHIFT_LSL
    if (op === 1) shiftType = SHIFT_LSR
    else if (op === 2) shiftType = SHIFT_ASR

    // Thumb uses immediate-shift semantics: 0 means #32 for LSR/ASR, but
    // LSL #0 truly does nothing.
    let amount = offset5
    if (amount === 0 && (op === 1 || op === 2)) amount = 32
    const shifted = applyShift(value, shiftType, amount, flagC(ctx.state.cpsr))
    ctx.writeReg(Rd, shifted.value)
    ctx.state.cpsr = setFlagsNZ(ctx.state.cpsr, shifted.value)
    ctx.state.cpsr =
      ((ctx.state.cpsr & ~CPSR_C) | ((shifted.carry & 1) << 29)) >>> 0
    return
  }

  // Format 2: add/subtract register or 3-bit immediate
  const I = (instr >>> 10) & 1
  const op = (instr >>> 9) & 1
  const RnOrImm = (instr >>> 6) & 0x7
  const Rs = (instr >>> 3) & 0x7
  const Rd = instr & 0x7
  const a = ctx.readReg(Rs)
  const b = I === 1 ? RnOrImm : ctx.readReg(RnOrImm)
  const r = op === 0 ? addWithCarry(a, b, 0) : sub(a, b)
  ctx.writeReg(Rd, r.value)
  ctx.state.cpsr = setFlagsNZCV(ctx.state.cpsr, r.value, r.carry, r.overflow)
}

// ---------------------------------------------------------------------------
// Format 3: move / compare / add / subtract immediate
//   001 op(2) Rd(3) imm(8)
// ---------------------------------------------------------------------------

function executeFormat3(ctx: ExecutionContext, instr: number): void {
  const op = (instr >>> 11) & 0x3
  const Rd = (instr >>> 8) & 0x7
  const imm = instr & 0xff

  switch (op) {
    case 0b00: // MOV
      ctx.writeReg(Rd, imm)
      ctx.state.cpsr = setFlagsNZ(ctx.state.cpsr, imm)
      return
    case 0b01: {
      // CMP
      const r = sub(ctx.readReg(Rd), imm)
      ctx.state.cpsr = setFlagsNZCV(ctx.state.cpsr, r.value, r.carry, r.overflow)
      return
    }
    case 0b10: {
      // ADD
      const r = addWithCarry(ctx.readReg(Rd), imm, 0)
      ctx.writeReg(Rd, r.value)
      ctx.state.cpsr = setFlagsNZCV(ctx.state.cpsr, r.value, r.carry, r.overflow)
      return
    }
    case 0b11: {
      // SUB
      const r = sub(ctx.readReg(Rd), imm)
      ctx.writeReg(Rd, r.value)
      ctx.state.cpsr = setFlagsNZCV(ctx.state.cpsr, r.value, r.carry, r.overflow)
      return
    }
  }
}

// ---------------------------------------------------------------------------
// Formats 4/5/6/7/8
//   0100 00 : Format 4 (ALU)
//   0100 01 : Format 5 (hi-reg ops / BX)
//   01001   : Format 6 (PC-relative load)
//   0101 xx : Formats 7/8 (load/store register offset, signed halfword/byte)
// ---------------------------------------------------------------------------

function executeFormat4567(ctx: ExecutionContext, instr: number): void {
  const bits12_10 = (instr >>> 10) & 0x7
  if (bits12_10 === 0b000) {
    executeFormat4(ctx, instr)
    return
  }
  if (bits12_10 === 0b001) {
    executeFormat5(ctx, instr)
    return
  }
  if ((instr >>> 11) === 0b01001) {
    executeFormat6(ctx, instr)
    return
  }
  // 0101 XX : Formats 7 or 8 distinguished by bit 9
  executeFormat7or8(ctx, instr)
}

// Format 4: 010000 op(4) Rs(3) Rd(3)
function executeFormat4(ctx: ExecutionContext, instr: number): void {
  const op = (instr >>> 6) & 0xf
  const Rs = (instr >>> 3) & 0x7
  const Rd = instr & 0x7
  const a = ctx.readReg(Rd)
  const b = ctx.readReg(Rs)
  let result = 0
  let writeBack = true
  let flagCarry = -1
  let flagOverflow = -1

  switch (op) {
    case 0x0: // AND
      result = (a & b) >>> 0
      break
    case 0x1: // EOR
      result = (a ^ b) >>> 0
      break
    case 0x2: {
      // LSL reg
      const s = applyShift(a, SHIFT_LSL, b & 0xff, flagC(ctx.state.cpsr))
      result = s.value
      flagCarry = s.carry
      break
    }
    case 0x3: {
      const s = applyShift(a, SHIFT_LSR, b & 0xff, flagC(ctx.state.cpsr))
      result = s.value
      flagCarry = s.carry
      break
    }
    case 0x4: {
      const s = applyShift(a, SHIFT_ASR, b & 0xff, flagC(ctx.state.cpsr))
      result = s.value
      flagCarry = s.carry
      break
    }
    case 0x5: {
      // ADC
      const r = addWithCarry(a, b, flagC(ctx.state.cpsr))
      result = r.value
      flagCarry = r.carry
      flagOverflow = r.overflow
      break
    }
    case 0x6: {
      // SBC
      const r = subWithCarry(a, b, flagC(ctx.state.cpsr))
      result = r.value
      flagCarry = r.carry
      flagOverflow = r.overflow
      break
    }
    case 0x7: {
      // ROR reg
      const s = applyShift(a, SHIFT_ROR, b & 0xff, flagC(ctx.state.cpsr))
      result = s.value
      flagCarry = s.carry
      break
    }
    case 0x8: // TST
      result = (a & b) >>> 0
      writeBack = false
      break
    case 0x9: {
      // NEG (RSB Rd, Rs, #0)
      const r = sub(0, b)
      result = r.value
      flagCarry = r.carry
      flagOverflow = r.overflow
      // In Thumb NEG, the destination is Rd and source is Rs
      ctx.writeReg(Rd, result)
      ctx.state.cpsr = setFlagsNZCV(
        ctx.state.cpsr,
        result,
        flagCarry,
        flagOverflow,
      )
      return
    }
    case 0xa: {
      // CMP
      const r = sub(a, b)
      result = r.value
      flagCarry = r.carry
      flagOverflow = r.overflow
      writeBack = false
      break
    }
    case 0xb: {
      // CMN
      const r = addWithCarry(a, b, 0)
      result = r.value
      flagCarry = r.carry
      flagOverflow = r.overflow
      writeBack = false
      break
    }
    case 0xc: // ORR
      result = (a | b) >>> 0
      break
    case 0xd: {
      // MUL
      result = Math.imul(a, b) >>> 0
      break
    }
    case 0xe: // BIC
      result = (a & ~b) >>> 0
      break
    case 0xf: // MVN
      result = (~b) >>> 0
      break
  }

  if (writeBack) ctx.writeReg(Rd, result)
  // All Format 4 instructions update NZ; some also update C, V.
  ctx.state.cpsr = setFlagsNZ(ctx.state.cpsr, result)
  if (flagCarry >= 0) {
    ctx.state.cpsr =
      ((ctx.state.cpsr & ~CPSR_C) | ((flagCarry & 1) << 29)) >>> 0
  }
  if (flagOverflow >= 0) {
    ctx.state.cpsr =
      ((ctx.state.cpsr & ~0x10000000) | ((flagOverflow & 1) << 28)) >>> 0
  }
}

// Format 5: 010001 op(2) H1 H2 Rs(3) Rd(3)
function executeFormat5(ctx: ExecutionContext, instr: number): void {
  const op = (instr >>> 8) & 0x3
  const H1 = (instr >>> 7) & 1
  const H2 = (instr >>> 6) & 1
  const Rs = ((instr >>> 3) & 0x7) | (H2 << 3)
  const Rd = (instr & 0x7) | (H1 << 3)

  switch (op) {
    case 0b00: {
      // ADD (no flags)
      const result = (ctx.readReg(Rd) + ctx.readReg(Rs)) >>> 0
      ctx.writeReg(Rd, result)
      return
    }
    case 0b01: {
      // CMP
      const r = sub(ctx.readReg(Rd), ctx.readReg(Rs))
      ctx.state.cpsr = setFlagsNZCV(ctx.state.cpsr, r.value, r.carry, r.overflow)
      return
    }
    case 0b10: {
      // MOV (no flags)
      ctx.writeReg(Rd, ctx.readReg(Rs))
      return
    }
    case 0b11: {
      // BX / BLX
      const target = ctx.readReg(Rs)
      if (H1 === 1) {
        // BLX: set LR to return address (Thumb mode, so OR 1)
        const returnAddr = ((ctx.state.r[15] + 2) >>> 0) | 1
        ctx.writeReg(14, returnAddr)
      }
      branchWithExchange(ctx, target)
      return
    }
  }
}

// Format 6: 01001 Rd(3) imm(8) — LDR Rd, [PC, #imm*4]
function executeFormat6(ctx: ExecutionContext, instr: number): void {
  const Rd = (instr >>> 8) & 0x7
  const imm8 = instr & 0xff
  // PC for LDR is (PC+4) aligned to 4 bytes. Reading R15 returns PC+4 in
  // Thumb state; then we mask out the low 2 bits to align.
  const base = ctx.readReg(15) & ~0x3
  const addr = (base + imm8 * 4) >>> 0
  ctx.writeReg(Rd, ctx.memory.read32(addr))
}

// Formats 7 and 8: 0101 LB 0 Ro Rb Rd (F7) / 0101 HS 1 Ro Rb Rd (F8)
function executeFormat7or8(ctx: ExecutionContext, instr: number): void {
  const bit9 = (instr >>> 9) & 1
  const Ro = (instr >>> 6) & 0x7
  const Rb = (instr >>> 3) & 0x7
  const Rd = instr & 0x7
  const addr = (ctx.readReg(Rb) + ctx.readReg(Ro)) >>> 0

  if (bit9 === 0) {
    const L = (instr >>> 11) & 1
    const B = (instr >>> 10) & 1
    if (L === 0 && B === 0) ctx.memory.write32(addr, ctx.readReg(Rd))
    else if (L === 0 && B === 1) ctx.memory.write8(addr, ctx.readReg(Rd) & 0xff)
    else if (L === 1 && B === 0) ctx.writeReg(Rd, ctx.memory.read32(addr))
    else ctx.writeReg(Rd, ctx.memory.read8(addr))
    return
  }
  // F8: STRH / LDRSB / LDRH / LDRSH
  const H = (instr >>> 11) & 1
  const S = (instr >>> 10) & 1
  if (S === 0 && H === 0) ctx.memory.write16(addr, ctx.readReg(Rd) & 0xffff)
  else if (S === 0 && H === 1) ctx.writeReg(Rd, ctx.memory.read16(addr))
  else if (S === 1 && H === 0) {
    let v = ctx.memory.read8(addr)
    if (v & 0x80) v |= 0xffffff00
    ctx.writeReg(Rd, v >>> 0)
  } else {
    let v = ctx.memory.read16(addr)
    if (v & 0x8000) v |= 0xffff0000
    ctx.writeReg(Rd, v >>> 0)
  }
}

// Format 9: 011 B L imm5 Rb Rd
function executeFormat9(ctx: ExecutionContext, instr: number): void {
  const B = (instr >>> 12) & 1
  const L = (instr >>> 11) & 1
  const imm5 = (instr >>> 6) & 0x1f
  const Rb = (instr >>> 3) & 0x7
  const Rd = instr & 0x7
  const base = ctx.readReg(Rb)
  const offset = B === 1 ? imm5 : imm5 * 4
  const addr = (base + offset) >>> 0
  if (B === 0) {
    if (L === 0) ctx.memory.write32(addr, ctx.readReg(Rd))
    else ctx.writeReg(Rd, ctx.memory.read32(addr))
  } else {
    if (L === 0) ctx.memory.write8(addr, ctx.readReg(Rd) & 0xff)
    else ctx.writeReg(Rd, ctx.memory.read8(addr))
  }
}

// Formats 10/11
//   1000 L imm5 Rb Rd   Format 10 (load/store halfword)
//   1001 L Rd imm8       Format 11 (SP-relative load/store)
function executeFormat10or11(ctx: ExecutionContext, instr: number): void {
  const bits15_12 = (instr >>> 12) & 0xf
  if (bits15_12 === 0b1000) {
    const L = (instr >>> 11) & 1
    const imm5 = (instr >>> 6) & 0x1f
    const Rb = (instr >>> 3) & 0x7
    const Rd = instr & 0x7
    const addr = (ctx.readReg(Rb) + imm5 * 2) >>> 0
    if (L === 0) ctx.memory.write16(addr, ctx.readReg(Rd) & 0xffff)
    else ctx.writeReg(Rd, ctx.memory.read16(addr))
    return
  }
  // Format 11: SP-relative
  const L = (instr >>> 11) & 1
  const Rd = (instr >>> 8) & 0x7
  const imm8 = instr & 0xff
  const addr = (ctx.readReg(13) + imm8 * 4) >>> 0
  if (L === 0) ctx.memory.write32(addr, ctx.readReg(Rd))
  else ctx.writeReg(Rd, ctx.memory.read32(addr))
}

// Formats 12/13/14
//   1010 SP Rd imm8  Format 12 (load address)
//   10110000 S imm7  Format 13 (add offset to SP)
//   1011 L 10 R list Format 14 (push/pop)
function executeFormat12or13or14(ctx: ExecutionContext, instr: number): void {
  const bits15_12 = (instr >>> 12) & 0xf
  if (bits15_12 === 0b1010) {
    // Format 12
    const SP = (instr >>> 11) & 1
    const Rd = (instr >>> 8) & 0x7
    const imm8 = instr & 0xff
    const base =
      SP === 0 ? ctx.readReg(15) & ~0x3 : ctx.readReg(13)
    ctx.writeReg(Rd, (base + imm8 * 4) >>> 0)
    return
  }
  // 1011 ...
  const bits11_8 = (instr >>> 8) & 0xf
  if (bits11_8 === 0b0000) {
    // Format 13: ADD SP, #+imm / #-imm
    const S = (instr >>> 7) & 1
    const imm7 = instr & 0x7f
    const delta = imm7 * 4
    const sp = ctx.readReg(13)
    ctx.writeReg(13, (S === 0 ? sp + delta : sp - delta) >>> 0)
    return
  }
  // Format 14: 1011 L 10 R list
  const L = (instr >>> 11) & 1
  const R = (instr >>> 8) & 1
  const list = instr & 0xff
  let count = 0
  for (let i = 0; i < 8; i++) if ((list >>> i) & 1) count++
  if (R === 1) count++
  let sp = ctx.readReg(13)
  if (L === 0) {
    // PUSH
    sp = (sp - count * 4) >>> 0
    let addr = sp
    for (let i = 0; i < 8; i++) {
      if ((list >>> i) & 1) {
        ctx.memory.write32(addr, ctx.readReg(i))
        addr = (addr + 4) >>> 0
      }
    }
    if (R === 1) {
      ctx.memory.write32(addr, ctx.readReg(14)) // LR
    }
    ctx.writeReg(13, sp)
  } else {
    // POP
    let addr = sp
    for (let i = 0; i < 8; i++) {
      if ((list >>> i) & 1) {
        ctx.writeReg(i, ctx.memory.read32(addr))
        addr = (addr + 4) >>> 0
      }
    }
    if (R === 1) {
      const target = ctx.memory.read32(addr)
      addr = (addr + 4) >>> 0
      ctx.writeReg(13, addr)
      branchWithExchange(ctx, target)
      return
    }
    ctx.writeReg(13, addr)
  }
}

// Formats 15/16
//   1100 L Rb list    Format 15 (multiple load/store)
//   1101 cond offset  Format 16 (conditional branch / SWI)
function executeFormat15or16(ctx: ExecutionContext, instr: number): void {
  const bits15_12 = (instr >>> 12) & 0xf
  if (bits15_12 === 0b1100) {
    // Format 15: LDMIA/STMIA
    const L = (instr >>> 11) & 1
    const Rb = (instr >>> 8) & 0x7
    const list = instr & 0xff
    let addr = ctx.readReg(Rb)
    for (let i = 0; i < 8; i++) {
      if (!((list >>> i) & 1)) continue
      if (L === 0) ctx.memory.write32(addr, ctx.readReg(i))
      else ctx.writeReg(i, ctx.memory.read32(addr))
      addr = (addr + 4) >>> 0
    }
    // Writeback (LDMIA does writeback only if Rb not in list)
    if (L === 0 || !((list >>> Rb) & 1)) {
      ctx.writeReg(Rb, addr)
    }
    return
  }
  // Format 16: conditional branch (cond != 0xF)
  const cond = (instr >>> 8) & 0xf
  if (cond === 0xf) {
    // SWI — stubbed
    return
  }
  if (!checkCondition(cond, ctx.state.cpsr)) return
  let offset = instr & 0xff
  if (offset & 0x80) offset -= 0x100
  const pc = ctx.readReg(15) // PC+4 in Thumb
  const target = (pc + offset * 2) >>> 0
  ctx.setPc(target >>> 0)
  ctx.markPcModified()
}

// Formats 18/19
//   11100 offset11        Format 18 (unconditional branch)
//   11101 / 11110 / 11111 are 32-bit Thumb-2 (handled in executeThumb32)
function executeFormat18or19(ctx: ExecutionContext, instr: number): void {
  // Only format 18 (unconditional B) remains here — the others were already
  // funnelled to executeThumb32 before we arrived.
  let offset = instr & 0x7ff
  if (offset & 0x400) offset -= 0x800
  const pc = ctx.readReg(15)
  ctx.setPc((pc + offset * 2) >>> 0)
  ctx.markPcModified()
}

// ---------------------------------------------------------------------------
// 32-bit Thumb-2 instructions (BL / B.W only for our subset)
// ---------------------------------------------------------------------------

function executeThumb32(
  ctx: ExecutionContext,
  first: number,
  second: number,
): void {
  // BL / B.W family: 11110 S imm10 | 1 J1 x J2 imm11
  // Specifically:
  //   second[15:14] == 10 & second[12] == 1  : B.W (unconditional)
  //   second[15:14] == 11 & second[12] == 1  : BL
  //   second[15:14] == 11 & second[12] == 0  : BLX (switch to ARM)
  //   second[15:14] == 10 & second[12] == 0  : B.W conditional
  if ((first >>> 11) === 0b11110 && ((second >>> 14) & 0x3) === 0b10) {
    executeB_W_orConditional(ctx, first, second)
    return
  }
  if ((first >>> 11) === 0b11110 && ((second >>> 14) & 0x3) === 0b11) {
    executeBL_W(ctx, first, second)
    return
  }
  // Other 32-bit encodings (data processing, load/store wide…) are outside
  // our scope — skip them silently.
}

// 32-bit B.W (unconditional) and conditional B<cond>.W
function executeB_W_orConditional(
  ctx: ExecutionContext,
  first: number,
  second: number,
): void {
  const bit12 = (second >>> 12) & 1
  if (bit12 === 1) {
    // Unconditional B.W
    const S = (first >>> 10) & 1
    const imm10 = first & 0x3ff
    const J1 = (second >>> 13) & 1
    const J2 = (second >>> 11) & 1
    const imm11 = second & 0x7ff
    const I1 = (~(J1 ^ S)) & 1
    const I2 = (~(J2 ^ S)) & 1
    let offset =
      (S << 24) | (I1 << 23) | (I2 << 22) | (imm10 << 12) | (imm11 << 1)
    if (S) offset -= 0x02000000
    const pc = ctx.readReg(15)
    ctx.setPc((pc + offset) >>> 0)
    ctx.markPcModified()
    return
  }
  // Conditional B<cond>.W: cond in first[9:6]
  const cond = (first >>> 6) & 0xf
  if (cond === 0xe || cond === 0xf) return
  if (!checkCondition(cond, ctx.state.cpsr)) return
  const S = (first >>> 10) & 1
  const imm6 = first & 0x3f
  const J1 = (second >>> 13) & 1
  const J2 = (second >>> 11) & 1
  const imm11 = second & 0x7ff
  let offset =
    (S << 20) | (J2 << 19) | (J1 << 18) | (imm6 << 12) | (imm11 << 1)
  if (S) offset -= 0x00200000
  const pc = ctx.readReg(15)
  ctx.setPc((pc + offset) >>> 0)
  ctx.markPcModified()
}

// 32-bit BL
function executeBL_W(
  ctx: ExecutionContext,
  first: number,
  second: number,
): void {
  const S = (first >>> 10) & 1
  const imm10 = first & 0x3ff
  const J1 = (second >>> 13) & 1
  const bit12 = (second >>> 12) & 1
  const J2 = (second >>> 11) & 1
  const imm11 = second & 0x7ff
  const I1 = (~(J1 ^ S)) & 1
  const I2 = (~(J2 ^ S)) & 1
  let offset: number
  if (bit12 === 1) {
    // BL: 25-bit signed offset * 2
    offset =
      (S << 24) | (I1 << 23) | (I2 << 22) | (imm10 << 12) | (imm11 << 1)
    if (S) offset -= 0x02000000
  } else {
    // BLX: offset rounded to multiple of 4 (imm11 & ~1 << 1)
    offset =
      (S << 24) | (I1 << 23) | (I2 << 22) | (imm10 << 12) | ((imm11 & ~1) << 1)
    if (S) offset -= 0x02000000
  }
  // Return address = PC+4 (next instruction after the 32-bit BL)
  const returnAddr = ((ctx.state.r[15] + 4) >>> 0) | 1
  ctx.writeReg(14, returnAddr)
  const pc = ctx.readReg(15)
  const target = (pc + offset) >>> 0
  if (bit12 === 1) {
    // BL: stay in Thumb
    ctx.setPc(target >>> 0)
  } else {
    // BLX: switch to ARM state, align to 4
    ctx.state.cpsr = (ctx.state.cpsr & ~CPSR_T) >>> 0
    ctx.setPc((target & ~0x3) >>> 0)
  }
  ctx.markPcModified()
}

// ---------------------------------------------------------------------------
// Mode switch helper (shared with BX semantics)
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
