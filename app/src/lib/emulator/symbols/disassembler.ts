// Minimal ARM disassembler.
//
// Produces single-line textual disassembly for the instruction subset the
// interpreter supports. Optional symbol integration — branch targets can be
// resolved to "name+offset" when a SymbolMap is passed in.
//
// The output format follows GNU `objdump -d` conventions for familiarity:
//   "mov\tr0, #42"
//   "ldr\tr0, [r1, #8]"
//   "bl\t0x20001000 <main>"

import type { SymbolMap } from './SymbolMap'

const COND_SUFFIX = [
  'eq', 'ne', 'cs', 'cc',
  'mi', 'pl', 'vs', 'vc',
  'hi', 'ls', 'ge', 'lt',
  'gt', 'le', '', // AL is empty
  'nv',
]

const DP_MNEMONICS = [
  'and', 'eor', 'sub', 'rsb',
  'add', 'adc', 'sbc', 'rsc',
  'tst', 'teq', 'cmp', 'cmn',
  'orr', 'mov', 'bic', 'mvn',
]

const SHIFT_NAMES = ['lsl', 'lsr', 'asr', 'ror']

export interface Disassembled {
  address: number
  bytes: number
  text: string
}

/** Apply the DP-immediate rotate rule. */
function expandImm(imm8: number, rotate: number): number {
  const shift = (rotate & 0xf) * 2
  if (shift === 0) return imm8 & 0xff
  return ((imm8 >>> shift) | (imm8 << (32 - shift))) >>> 0
}

export function disassembleArm(
  instr: number,
  pc: number,
  symbols?: SymbolMap,
): Disassembled {
  const word = instr >>> 0
  const text = decodeArm(word, pc, symbols)
  return { address: pc >>> 0, bytes: 4, text }
}

function cond(instr: number): string {
  return COND_SUFFIX[(instr >>> 28) & 0xf]
}

function reg(n: number): string {
  if (n === 13) return 'sp'
  if (n === 14) return 'lr'
  if (n === 15) return 'pc'
  return `r${n}`
}

function decodeArm(instr: number, pc: number, symbols?: SymbolMap): string {
  const op1 = (instr >>> 25) & 0x7
  const condCode = (instr >>> 28) & 0xf

  // Unconditional encodings (cond = 0xF): BLX(imm)
  if (condCode === 0xf) {
    if ((instr >>> 25) === 0b1111101) {
      const H = (instr >>> 24) & 1
      let off = instr & 0x00ffffff
      if (off & 0x00800000) off -= 0x01000000
      off = off * 4 + (H << 1)
      const target = ((pc + 8 + off) >>> 0) >>> 0
      return `blx\t${formatTarget(target, symbols)}`
    }
    return dataWord(instr)
  }

  switch (op1) {
    case 0b000:
      return decodeBits000(instr, pc, symbols)
    case 0b001:
      return decodeDpImm(instr)
    case 0b010:
      return decodeLoadStoreImm(instr)
    case 0b011:
      return decodeLoadStoreReg(instr)
    case 0b100:
      return decodeBlock(instr)
    case 0b101:
      return decodeBranch(instr, pc, symbols)
    case 0b110:
    case 0b111:
      return decodeCoproc(instr)
  }
  return dataWord(instr)
}

function decodeBits000(
  instr: number,
  pc: number,
  symbols?: SymbolMap,
): string {
  void pc
  void symbols
  const bit4 = (instr >>> 4) & 1
  const bit7 = (instr >>> 7) & 1

  if (bit4 === 1 && bit7 === 1) {
    const bits65 = (instr >>> 5) & 0x3
    if (bits65 === 0) return decodeMultiply(instr)
    return decodeHalfwordLoadStore(instr)
  }

  const opField = (instr >>> 20) & 0x1f
  if ((opField & 0b11001) === 0b10000) {
    return decodeMisc(instr)
  }
  return decodeDpReg(instr)
}

function decodeMisc(instr: number): string {
  const op2 = (instr >>> 4) & 0xf
  if (op2 === 0x1 || op2 === 0x3) {
    const Rm = instr & 0xf
    const suffix = cond(instr)
    return `${op2 === 0x3 ? 'blx' : 'bx'}${suffix}\t${reg(Rm)}`
  }
  const op = (instr >>> 21) & 0x3
  if (op2 === 0x0) {
    const psrRead = (op & 0x1) === 0
    const psrWrite = (op & 0x1) === 1
    const R = (instr >>> 22) & 1
    if (psrRead && ((instr >>> 16) & 0xf) === 0xf) {
      const Rd = (instr >>> 12) & 0xf
      return `mrs${cond(instr)}\t${reg(Rd)}, ${R ? 'SPSR' : 'CPSR'}`
    }
    if (psrWrite) {
      const Rm = instr & 0xf
      return `msr${cond(instr)}\t${R ? 'SPSR' : 'CPSR'}_${fieldMask(instr)}, ${reg(Rm)}`
    }
  }
  return dataWord(instr)
}

function fieldMask(instr: number): string {
  const mask = (instr >>> 16) & 0xf
  // GNU assembler convention: emit fields in "fsxc" order (high bit first).
  let s = ''
  if (mask & 0x8) s += 'f'
  if (mask & 0x4) s += 's'
  if (mask & 0x2) s += 'x'
  if (mask & 0x1) s += 'c'
  return s || 'none'
}

function decodeMultiply(instr: number): string {
  const op = (instr >>> 21) & 0x7
  const S = (instr >>> 20) & 1
  const Rs = (instr >>> 8) & 0xf
  const Rm = instr & 0xf
  const s = cond(instr) + (S ? 's' : '')
  if ((op & 0b100) === 0) {
    // MUL / MLA
    const Rd = (instr >>> 16) & 0xf
    const Rn = (instr >>> 12) & 0xf
    if ((op & 0b001) === 0) {
      return `mul${s}\t${reg(Rd)}, ${reg(Rm)}, ${reg(Rs)}`
    }
    return `mla${s}\t${reg(Rd)}, ${reg(Rm)}, ${reg(Rs)}, ${reg(Rn)}`
  }
  const RdHi = (instr >>> 16) & 0xf
  const RdLo = (instr >>> 12) & 0xf
  const signed = (op & 0b010) !== 0 ? 's' : 'u'
  const accumulate = (op & 0b001) !== 0 ? 'mlal' : 'mull'
  return `${signed}${accumulate}${s}\t${reg(RdLo)}, ${reg(RdHi)}, ${reg(Rm)}, ${reg(Rs)}`
}

function decodeHalfwordLoadStore(instr: number): string {
  const P = (instr >>> 24) & 1
  const U = (instr >>> 23) & 1
  const I = (instr >>> 22) & 1
  const W = (instr >>> 21) & 1
  const L = (instr >>> 20) & 1
  const Rn = (instr >>> 16) & 0xf
  const Rd = (instr >>> 12) & 0xf
  const op = (instr >>> 5) & 0x3
  const mnemonic =
    L === 0
      ? 'strh'
      : op === 0b01
        ? 'ldrh'
        : op === 0b10
          ? 'ldrsb'
          : 'ldrsh'
  const s = cond(instr)
  const offRaw = I === 1 ? (((instr >>> 8) & 0xf) << 4) | (instr & 0xf) : null
  const sign = U ? '+' : '-'

  let addrTxt: string
  if (I === 1) {
    if (offRaw === 0) addrTxt = `[${reg(Rn)}]`
    else if (P === 1) {
      addrTxt = `[${reg(Rn)}, #${sign}${offRaw}]${W ? '!' : ''}`
    } else {
      addrTxt = `[${reg(Rn)}], #${sign}${offRaw}`
    }
  } else {
    const Rm = instr & 0xf
    if (P === 1) {
      addrTxt = `[${reg(Rn)}, ${sign}${reg(Rm)}]${W ? '!' : ''}`
    } else {
      addrTxt = `[${reg(Rn)}], ${sign}${reg(Rm)}`
    }
  }
  return `${mnemonic}${s}\t${reg(Rd)}, ${addrTxt}`
}

function decodeDpReg(instr: number): string {
  const opcode = (instr >>> 21) & 0xf
  const S = (instr >>> 20) & 1
  const Rn = (instr >>> 16) & 0xf
  const Rd = (instr >>> 12) & 0xf
  const shiftType = (instr >>> 5) & 0x3
  const regShift = (instr >>> 4) & 1
  const Rm = instr & 0xf
  const name = DP_MNEMONICS[opcode]
  const suffix = cond(instr) + (S ? 's' : '')
  const isLogicalTest = opcode >= 0x8 && opcode <= 0xb

  let op2Txt: string
  if (regShift === 1) {
    const Rs = (instr >>> 8) & 0xf
    op2Txt = `${reg(Rm)}, ${SHIFT_NAMES[shiftType]} ${reg(Rs)}`
  } else {
    const amt = (instr >>> 7) & 0x1f
    if (amt === 0 && shiftType === 0) {
      op2Txt = reg(Rm) // just the register
    } else if (amt === 0 && shiftType === 3) {
      op2Txt = `${reg(Rm)}, rrx`
    } else {
      const displayAmt = amt === 0 ? 32 : amt
      op2Txt = `${reg(Rm)}, ${SHIFT_NAMES[shiftType]} #${displayAmt}`
    }
  }

  if (opcode === 0xd || opcode === 0xf) {
    // MOV / MVN — no Rn
    return `${name}${suffix}\t${reg(Rd)}, ${op2Txt}`
  }
  if (isLogicalTest) {
    // TST/TEQ/CMP/CMN — no Rd
    return `${name}${cond(instr)}\t${reg(Rn)}, ${op2Txt}`
  }
  return `${name}${suffix}\t${reg(Rd)}, ${reg(Rn)}, ${op2Txt}`
}

function decodeDpImm(instr: number): string {
  const opcode = (instr >>> 21) & 0xf
  const S = (instr >>> 20) & 1
  // MSR-immediate overlays TST/TEQ/CMP/CMN with S=0
  if (S === 0 && opcode >= 0x8 && opcode <= 0xb) {
    const rotate = (instr >>> 8) & 0xf
    const imm8 = instr & 0xff
    const value = expandImm(imm8, rotate)
    const R = (instr >>> 22) & 1
    return `msr${cond(instr)}\t${R ? 'SPSR' : 'CPSR'}_${fieldMask(instr)}, #0x${value.toString(16)}`
  }
  const Rn = (instr >>> 16) & 0xf
  const Rd = (instr >>> 12) & 0xf
  const rotate = (instr >>> 8) & 0xf
  const imm8 = instr & 0xff
  const value = expandImm(imm8, rotate)
  const name = DP_MNEMONICS[opcode]
  const suffix = cond(instr) + (S ? 's' : '')
  if (opcode === 0xd || opcode === 0xf) {
    return `${name}${suffix}\t${reg(Rd)}, #${fmtImm(value)}`
  }
  if (opcode >= 0x8 && opcode <= 0xb) {
    return `${name}${cond(instr)}\t${reg(Rn)}, #${fmtImm(value)}`
  }
  return `${name}${suffix}\t${reg(Rd)}, ${reg(Rn)}, #${fmtImm(value)}`
}

function decodeLoadStoreImm(instr: number): string {
  const P = (instr >>> 24) & 1
  const U = (instr >>> 23) & 1
  const B = (instr >>> 22) & 1
  const W = (instr >>> 21) & 1
  const L = (instr >>> 20) & 1
  const Rn = (instr >>> 16) & 0xf
  const Rd = (instr >>> 12) & 0xf
  const offset = instr & 0xfff
  const name = (L ? 'ldr' : 'str') + (B ? 'b' : '')
  const suffix = cond(instr)
  const sign = U ? '' : '-'
  let addr: string
  if (P === 1) {
    if (offset === 0) addr = `[${reg(Rn)}]`
    else addr = `[${reg(Rn)}, #${sign}${offset}]${W ? '!' : ''}`
  } else {
    addr = `[${reg(Rn)}], #${sign}${offset}`
  }
  return `${name}${suffix}\t${reg(Rd)}, ${addr}`
}

function decodeLoadStoreReg(instr: number): string {
  if ((instr >>> 4) & 1) return dataWord(instr)
  const P = (instr >>> 24) & 1
  const U = (instr >>> 23) & 1
  const B = (instr >>> 22) & 1
  const W = (instr >>> 21) & 1
  const L = (instr >>> 20) & 1
  const Rn = (instr >>> 16) & 0xf
  const Rd = (instr >>> 12) & 0xf
  const shiftAmt = (instr >>> 7) & 0x1f
  const shiftType = (instr >>> 5) & 0x3
  const Rm = instr & 0xf
  const name = (L ? 'ldr' : 'str') + (B ? 'b' : '')
  const suffix = cond(instr)
  const sign = U ? '' : '-'
  let rmTxt = `${sign}${reg(Rm)}`
  if (!(shiftAmt === 0 && shiftType === 0)) {
    const displayAmt = shiftAmt === 0 ? 32 : shiftAmt
    rmTxt += `, ${SHIFT_NAMES[shiftType]} #${displayAmt}`
  }
  let addr: string
  if (P === 1) addr = `[${reg(Rn)}, ${rmTxt}]${W ? '!' : ''}`
  else addr = `[${reg(Rn)}], ${rmTxt}`
  return `${name}${suffix}\t${reg(Rd)}, ${addr}`
}

function decodeBlock(instr: number): string {
  const P = (instr >>> 24) & 1
  const U = (instr >>> 23) & 1
  const W = (instr >>> 21) & 1
  const L = (instr >>> 20) & 1
  const Rn = (instr >>> 16) & 0xf
  const list = instr & 0xffff
  // PUSH: STMDB SP!   → P=1, U=0, W=1, Rn=13, L=0
  // POP:  LDMIA SP!   → P=0, U=1, W=1, Rn=13, L=1
  if (Rn === 13 && W === 1) {
    if (L === 0 && P === 1 && U === 0) return `push${cond(instr)}\t${regList(list)}`
    if (L === 1 && P === 0 && U === 1) return `pop${cond(instr)}\t${regList(list)}`
  }
  const mnemonic = L ? 'ldm' : 'stm'
  const mode = (U ? 'i' : 'd') + (P ? 'b' : 'a')
  return `${mnemonic}${cond(instr)}${mode}\t${reg(Rn)}${W ? '!' : ''}, ${regList(list)}`
}

function regList(list: number): string {
  const parts: string[] = []
  for (let i = 0; i < 16; i++) {
    if ((list >>> i) & 1) parts.push(reg(i))
  }
  return '{' + parts.join(', ') + '}'
}

function decodeBranch(
  instr: number,
  pc: number,
  symbols?: SymbolMap,
): string {
  const link = (instr >>> 24) & 1
  let off = instr & 0x00ffffff
  if (off & 0x00800000) off -= 0x01000000
  off = off * 4
  const target = ((pc + 8 + off) >>> 0) >>> 0
  const suffix = cond(instr)
  return `${link ? 'bl' : 'b'}${suffix}\t${formatTarget(target, symbols)}`
}

function decodeCoproc(instr: number): string {
  const bit4 = (instr >>> 4) & 1
  const majorOp = (instr >>> 24) & 0xf
  if (majorOp !== 0xe || bit4 === 0) return dataWord(instr)
  const L = (instr >>> 20) & 1
  const opc1 = (instr >>> 21) & 0x7
  const CRn = (instr >>> 16) & 0xf
  const Rd = (instr >>> 12) & 0xf
  const cpnum = (instr >>> 8) & 0xf
  const opc2 = (instr >>> 5) & 0x7
  const CRm = instr & 0xf
  const mnem = L ? 'mrc' : 'mcr'
  return `${mnem}${cond(instr)}\tp${cpnum}, ${opc1}, ${reg(Rd)}, c${CRn}, c${CRm}, ${opc2}`
}

function formatTarget(address: number, symbols?: SymbolMap): string {
  const hex = '0x' + (address >>> 0).toString(16).padStart(8, '0')
  if (!symbols) return hex
  const r = symbols.resolve(address)
  if (!r) return hex
  if (r.offset === 0) return `${hex} <${r.symbol.name}>`
  return `${hex} <${r.symbol.name}+0x${r.offset.toString(16)}>`
}

function fmtImm(value: number): string {
  if (value < 0x100) return value.toString()
  return '0x' + value.toString(16)
}

function dataWord(instr: number): string {
  return `.word\t0x${(instr >>> 0).toString(16).padStart(8, '0')}`
}

// ---------------------------------------------------------------------------
// Helpers for UI views
// ---------------------------------------------------------------------------

/**
 * Disassemble a window of instructions around `pc`. Fetches `beforeCount`
 * instructions before PC and `afterCount` after (including PC itself).
 */
export function disassembleWindow(
  memory: { read32: (addr: number) => number },
  pc: number,
  beforeCount: number,
  afterCount: number,
  symbols?: SymbolMap,
): Disassembled[] {
  const start = Math.max(0, pc - beforeCount * 4)
  const total = beforeCount + afterCount
  const out: Disassembled[] = []
  for (let i = 0; i < total; i++) {
    const addr = (start + i * 4) >>> 0
    out.push(disassembleArm(memory.read32(addr), addr, symbols))
  }
  return out
}
