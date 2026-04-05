// Tiny ARMv7 assembler for tests.
//
// Emits just the instruction subset our interpreter targets. Each helper
// returns a 32-bit instruction word (or a 16-bit Thumb halfword). Tests
// build programs by concatenating these into arrays and loading them into
// ArmCpu memory.
//
// Conditions are always AL (always execute) unless stated otherwise.

export const COND_AL = 0xe
export const COND_EQ = 0x0
export const COND_NE = 0x1
export const COND_GE = 0xa
export const COND_LT = 0xb

// ---------------------------------------------------------------------------
// ARM mode encoders
// ---------------------------------------------------------------------------

/** DP register form: cond 000 I=0 opcode S Rn Rd shiftamt shifttype 0 Rm */
function dpReg(
  cond: number,
  opcode: number,
  S: number,
  Rn: number,
  Rd: number,
  shiftAmt: number,
  shiftType: number,
  Rm: number,
): number {
  return (
    ((cond & 0xf) << 28) |
    (opcode << 21) |
    ((S & 1) << 20) |
    ((Rn & 0xf) << 16) |
    ((Rd & 0xf) << 12) |
    ((shiftAmt & 0x1f) << 7) |
    ((shiftType & 0x3) << 5) |
    (Rm & 0xf)
  ) >>> 0
}

/** DP immediate form: cond 001 I=1 opcode S Rn Rd rotate imm8 */
function dpImm(
  cond: number,
  opcode: number,
  S: number,
  Rn: number,
  Rd: number,
  rotate: number,
  imm8: number,
): number {
  return (
    ((cond & 0xf) << 28) |
    (0b001 << 25) |
    (opcode << 21) |
    ((S & 1) << 20) |
    ((Rn & 0xf) << 16) |
    ((Rd & 0xf) << 12) |
    ((rotate & 0xf) << 8) |
    (imm8 & 0xff)
  ) >>> 0
}

export function mov(Rd: number, value: number, S = 0): number {
  return dpImm(COND_AL, 0xd, S, 0, Rd, 0, value)
}
export function mvn(Rd: number, value: number, S = 0): number {
  return dpImm(COND_AL, 0xf, S, 0, Rd, 0, value)
}
export function movReg(Rd: number, Rm: number, S = 0): number {
  return dpReg(COND_AL, 0xd, S, 0, Rd, 0, 0, Rm)
}
export function movRegShift(
  Rd: number,
  Rm: number,
  shiftType: number,
  shiftAmt: number,
  S = 0,
): number {
  return dpReg(COND_AL, 0xd, S, 0, Rd, shiftAmt, shiftType, Rm)
}

export function addImm(Rd: number, Rn: number, value: number, S = 0): number {
  return dpImm(COND_AL, 0x4, S, Rn, Rd, 0, value)
}
export function addReg(Rd: number, Rn: number, Rm: number, S = 0): number {
  return dpReg(COND_AL, 0x4, S, Rn, Rd, 0, 0, Rm)
}
export function subImm(Rd: number, Rn: number, value: number, S = 0): number {
  return dpImm(COND_AL, 0x2, S, Rn, Rd, 0, value)
}
export function subReg(Rd: number, Rn: number, Rm: number, S = 0): number {
  return dpReg(COND_AL, 0x2, S, Rn, Rd, 0, 0, Rm)
}
export function andImm(Rd: number, Rn: number, value: number, S = 0): number {
  return dpImm(COND_AL, 0x0, S, Rn, Rd, 0, value)
}
export function orrImm(Rd: number, Rn: number, value: number, S = 0): number {
  return dpImm(COND_AL, 0xc, S, Rn, Rd, 0, value)
}
export function eorImm(Rd: number, Rn: number, value: number, S = 0): number {
  return dpImm(COND_AL, 0x1, S, Rn, Rd, 0, value)
}
export function bicImm(Rd: number, Rn: number, value: number, S = 0): number {
  return dpImm(COND_AL, 0xe, S, Rn, Rd, 0, value)
}
export function cmpImm(Rn: number, value: number): number {
  return dpImm(COND_AL, 0xa, 1, Rn, 0, 0, value)
}
export function cmpReg(Rn: number, Rm: number): number {
  return dpReg(COND_AL, 0xa, 1, Rn, 0, 0, 0, Rm)
}
export function tstImm(Rn: number, value: number): number {
  return dpImm(COND_AL, 0x8, 1, Rn, 0, 0, value)
}
export function adcImm(Rd: number, Rn: number, value: number, S = 0): number {
  return dpImm(COND_AL, 0x5, S, Rn, Rd, 0, value)
}
export function sbcImm(Rd: number, Rn: number, value: number, S = 0): number {
  return dpImm(COND_AL, 0x6, S, Rn, Rd, 0, value)
}
export function rsbImm(Rd: number, Rn: number, value: number, S = 0): number {
  return dpImm(COND_AL, 0x3, S, Rn, Rd, 0, value)
}

// ---------------------------------------------------------------------------
// Load / store
// ---------------------------------------------------------------------------

/** LDR Rd, [Rn, #imm12] — pre-indexed, no writeback, word access. */
export function ldrImm(Rd: number, Rn: number, imm12: number): number {
  const U = imm12 >= 0 ? 1 : 0
  const offset = Math.abs(imm12) & 0xfff
  return (
    (COND_AL << 28) |
    (0b010 << 25) |
    (1 << 24) | // P=1
    (U << 23) |
    (0 << 22) | // B=0 (word)
    (0 << 21) | // W=0
    (1 << 20) | // L=1
    ((Rn & 0xf) << 16) |
    ((Rd & 0xf) << 12) |
    offset
  ) >>> 0
}

export function strImm(Rd: number, Rn: number, imm12: number): number {
  const U = imm12 >= 0 ? 1 : 0
  const offset = Math.abs(imm12) & 0xfff
  return (
    (COND_AL << 28) |
    (0b010 << 25) |
    (1 << 24) |
    (U << 23) |
    (0 << 22) |
    (0 << 21) |
    (0 << 20) |
    ((Rn & 0xf) << 16) |
    ((Rd & 0xf) << 12) |
    offset
  ) >>> 0
}

export function ldrbImm(Rd: number, Rn: number, imm12: number): number {
  const U = imm12 >= 0 ? 1 : 0
  const offset = Math.abs(imm12) & 0xfff
  return (
    (COND_AL << 28) |
    (0b010 << 25) |
    (1 << 24) |
    (U << 23) |
    (1 << 22) |
    (0 << 21) |
    (1 << 20) |
    ((Rn & 0xf) << 16) |
    ((Rd & 0xf) << 12) |
    offset
  ) >>> 0
}

export function strbImm(Rd: number, Rn: number, imm12: number): number {
  const U = imm12 >= 0 ? 1 : 0
  const offset = Math.abs(imm12) & 0xfff
  return (
    (COND_AL << 28) |
    (0b010 << 25) |
    (1 << 24) |
    (U << 23) |
    (1 << 22) |
    (0 << 21) |
    (0 << 20) |
    ((Rn & 0xf) << 16) |
    ((Rd & 0xf) << 12) |
    offset
  ) >>> 0
}

/** LDRH Rd, [Rn, #imm] — halfword load, immediate offset, pre-indexed. */
export function ldrhImm(Rd: number, Rn: number, imm8: number): number {
  const U = imm8 >= 0 ? 1 : 0
  const off = Math.abs(imm8) & 0xff
  return (
    (COND_AL << 28) |
    (0b000 << 25) |
    (1 << 24) | // P
    (U << 23) |
    (1 << 22) | // I=1 (immediate)
    (0 << 21) | // W
    (1 << 20) | // L
    ((Rn & 0xf) << 16) |
    ((Rd & 0xf) << 12) |
    ((off >>> 4) << 8) |
    (0b1011 << 4) |
    (off & 0xf)
  ) >>> 0
}

export function strhImm(Rd: number, Rn: number, imm8: number): number {
  const U = imm8 >= 0 ? 1 : 0
  const off = Math.abs(imm8) & 0xff
  return (
    (COND_AL << 28) |
    (0b000 << 25) |
    (1 << 24) |
    (U << 23) |
    (1 << 22) |
    (0 << 21) |
    (0 << 20) |
    ((Rn & 0xf) << 16) |
    ((Rd & 0xf) << 12) |
    ((off >>> 4) << 8) |
    (0b1011 << 4) |
    (off & 0xf)
  ) >>> 0
}

export function ldrshImm(Rd: number, Rn: number, imm8: number): number {
  const U = imm8 >= 0 ? 1 : 0
  const off = Math.abs(imm8) & 0xff
  return (
    (COND_AL << 28) |
    (0b000 << 25) |
    (1 << 24) |
    (U << 23) |
    (1 << 22) |
    (0 << 21) |
    (1 << 20) |
    ((Rn & 0xf) << 16) |
    ((Rd & 0xf) << 12) |
    ((off >>> 4) << 8) |
    (0b1111 << 4) |
    (off & 0xf)
  ) >>> 0
}

export function ldrsbImm(Rd: number, Rn: number, imm8: number): number {
  const U = imm8 >= 0 ? 1 : 0
  const off = Math.abs(imm8) & 0xff
  return (
    (COND_AL << 28) |
    (0b000 << 25) |
    (1 << 24) |
    (U << 23) |
    (1 << 22) |
    (0 << 21) |
    (1 << 20) |
    ((Rn & 0xf) << 16) |
    ((Rd & 0xf) << 12) |
    ((off >>> 4) << 8) |
    (0b1101 << 4) |
    (off & 0xf)
  ) >>> 0
}

// ---------------------------------------------------------------------------
// Branch
// ---------------------------------------------------------------------------

/** B <label> — encode a branch by giving the byte offset from PC+8. */
export function b(byteOffset: number, cond = COND_AL): number {
  const off = Math.round(byteOffset / 4) & 0x00ffffff
  return (
    ((cond & 0xf) << 28) | (0b101 << 25) | (0 << 24) | off
  ) >>> 0
}

export function bl(byteOffset: number, cond = COND_AL): number {
  const off = Math.round(byteOffset / 4) & 0x00ffffff
  return (
    ((cond & 0xf) << 28) | (0b101 << 25) | (1 << 24) | off
  ) >>> 0
}

export function bx(Rm: number): number {
  return (
    (COND_AL << 28) |
    (0b00010010 << 20) |
    (0xfff << 8) |
    (0x1 << 4) |
    (Rm & 0xf)
  ) >>> 0
}

export function blxReg(Rm: number): number {
  return (
    (COND_AL << 28) |
    (0b00010010 << 20) |
    (0xfff << 8) |
    (0x3 << 4) |
    (Rm & 0xf)
  ) >>> 0
}

// ---------------------------------------------------------------------------
// Multiply
// ---------------------------------------------------------------------------

export function mul(Rd: number, Rm: number, Rs: number): number {
  return (
    (COND_AL << 28) |
    (0 << 21) | // A=0
    (0 << 20) | // S=0
    ((Rd & 0xf) << 16) |
    (0 << 12) | // SBZ
    ((Rs & 0xf) << 8) |
    (0b1001 << 4) |
    (Rm & 0xf)
  ) >>> 0
}

export function mla(
  Rd: number,
  Rm: number,
  Rs: number,
  Rn: number,
): number {
  return (
    (COND_AL << 28) |
    (1 << 21) |
    (0 << 20) |
    ((Rd & 0xf) << 16) |
    ((Rn & 0xf) << 12) |
    ((Rs & 0xf) << 8) |
    (0b1001 << 4) |
    (Rm & 0xf)
  ) >>> 0
}

export function umull(
  RdLo: number,
  RdHi: number,
  Rm: number,
  Rs: number,
): number {
  return (
    (COND_AL << 28) |
    (0b100 << 21) |
    (0 << 20) |
    ((RdHi & 0xf) << 16) |
    ((RdLo & 0xf) << 12) |
    ((Rs & 0xf) << 8) |
    (0b1001 << 4) |
    (Rm & 0xf)
  ) >>> 0
}

export function smull(
  RdLo: number,
  RdHi: number,
  Rm: number,
  Rs: number,
): number {
  return (
    (COND_AL << 28) |
    (0b110 << 21) |
    (0 << 20) |
    ((RdHi & 0xf) << 16) |
    ((RdLo & 0xf) << 12) |
    ((Rs & 0xf) << 8) |
    (0b1001 << 4) |
    (Rm & 0xf)
  ) >>> 0
}

// ---------------------------------------------------------------------------
// Status register
// ---------------------------------------------------------------------------

/** MRS Rd, CPSR */
export function mrs(Rd: number): number {
  return (
    (COND_AL << 28) |
    (0b00010 << 23) |
    (0 << 22) | // R=0 (CPSR)
    (0b00 << 20) |
    (0xf << 16) |
    ((Rd & 0xf) << 12)
  ) >>> 0
}

/** MSR CPSR_fsxc, Rm — with mask=0xf (all fields) */
export function msr(Rm: number, fieldMask = 0xf): number {
  return (
    (COND_AL << 28) |
    (0b00010 << 23) |
    (0 << 22) |
    (0b10 << 20) |
    ((fieldMask & 0xf) << 16) |
    (0xf << 12) |
    (Rm & 0xf)
  ) >>> 0
}

// ---------------------------------------------------------------------------
// Coprocessor
// ---------------------------------------------------------------------------

/** MRC p15, op1, Rd, CRn, CRm, op2 */
export function mrc(
  cpnum: number,
  opc1: number,
  Rd: number,
  CRn: number,
  CRm: number,
  opc2: number,
): number {
  return (
    (COND_AL << 28) |
    (0b1110 << 24) |
    ((opc1 & 0x7) << 21) |
    (1 << 20) | // L=1 (read)
    ((CRn & 0xf) << 16) |
    ((Rd & 0xf) << 12) |
    ((cpnum & 0xf) << 8) |
    ((opc2 & 0x7) << 5) |
    (1 << 4) |
    (CRm & 0xf)
  ) >>> 0
}

export function mcr(
  cpnum: number,
  opc1: number,
  Rd: number,
  CRn: number,
  CRm: number,
  opc2: number,
): number {
  return (
    (COND_AL << 28) |
    (0b1110 << 24) |
    ((opc1 & 0x7) << 21) |
    (0 << 20) |
    ((CRn & 0xf) << 16) |
    ((Rd & 0xf) << 12) |
    ((cpnum & 0xf) << 8) |
    ((opc2 & 0x7) << 5) |
    (1 << 4) |
    (CRm & 0xf)
  ) >>> 0
}

// ---------------------------------------------------------------------------
// Block data transfer
// ---------------------------------------------------------------------------

/** STMDB SP!, {list}  — same as PUSH {list} */
export function push(regList: number[]): number {
  let list = 0
  for (const r of regList) list |= 1 << (r & 0xf)
  // P=1, U=0, W=1, L=0, Rn=13
  return (
    (COND_AL << 28) |
    (0b100 << 25) |
    (1 << 24) |
    (0 << 23) |
    (0 << 22) |
    (1 << 21) |
    (0 << 20) |
    (13 << 16) |
    (list & 0xffff)
  ) >>> 0
}

/** LDMIA SP!, {list} — same as POP {list} */
export function pop(regList: number[]): number {
  let list = 0
  for (const r of regList) list |= 1 << (r & 0xf)
  // P=0, U=1, W=1, L=1, Rn=13
  return (
    (COND_AL << 28) |
    (0b100 << 25) |
    (0 << 24) |
    (1 << 23) |
    (0 << 22) |
    (1 << 21) |
    (1 << 20) |
    (13 << 16) |
    (list & 0xffff)
  ) >>> 0
}

// ---------------------------------------------------------------------------
// Program loader
// ---------------------------------------------------------------------------

/** Pack an array of 32-bit instruction words into a Uint8Array (little-endian). */
export function packProgram(words: number[]): Uint8Array {
  const out = new Uint8Array(words.length * 4)
  const view = new DataView(out.buffer)
  for (let i = 0; i < words.length; i++) {
    view.setUint32(i * 4, words[i] >>> 0, true)
  }
  return out
}

/** Pack an array of 16-bit halfwords into a Uint8Array (little-endian). */
export function packThumb(halfwords: number[]): Uint8Array {
  const out = new Uint8Array(halfwords.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < halfwords.length; i++) {
    view.setUint16(i * 2, halfwords[i] & 0xffff, true)
  }
  return out
}
