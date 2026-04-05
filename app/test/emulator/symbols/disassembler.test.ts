import { describe, test, expect } from 'vitest'
import { disassembleArm, disassembleWindow } from '@/lib/emulator/symbols/disassembler'
import { SymbolMap } from '@/lib/emulator/symbols/SymbolMap'
import {
  mov,
  mvn,
  movReg,
  movRegShift,
  addImm,
  addReg,
  subImm,
  ldrImm,
  strImm,
  ldrbImm,
  b,
  bl,
  bx,
  mul,
  mla,
  umull,
  smull,
  mrs,
  msr,
  mrc,
  push,
  pop,
  cmpImm,
  adcImm,
  sbcImm,
  rsbImm,
  andImm,
  orrImm,
} from '../cpu/assembler'

function dis(instr: number, pc = 0x20000000, syms?: SymbolMap): string {
  return disassembleArm(instr, pc, syms).text
}

describe('Disassembler: data processing immediate', () => {
  test('MOV R0, #42', () => {
    expect(dis(mov(0, 42))).toBe('mov\tr0, #42')
  })

  test('MOV R5, #255', () => {
    expect(dis(mov(5, 255))).toBe('mov\tr5, #255')
  })

  test('MVN R0, #0', () => {
    expect(dis(mvn(0, 0))).toBe('mvn\tr0, #0')
  })

  test('MOVS sets the s-suffix', () => {
    expect(dis(mov(0, 5, 1))).toBe('movs\tr0, #5')
  })

  test('ADD R0, R1, #10', () => {
    expect(dis(addImm(0, 1, 10))).toBe('add\tr0, r1, #10')
  })

  test('SUB R0, R1, #5', () => {
    expect(dis(subImm(0, 1, 5))).toBe('sub\tr0, r1, #5')
  })

  test('AND / ORR / RSB immediate', () => {
    expect(dis(andImm(0, 1, 0x0f))).toBe('and\tr0, r1, #15')
    expect(dis(orrImm(0, 1, 0xf0))).toBe('orr\tr0, r1, #240')
    expect(dis(rsbImm(0, 1, 0))).toBe('rsb\tr0, r1, #0')
  })

  test('CMP shows no Rd', () => {
    expect(dis(cmpImm(0, 42))).toBe('cmp\tr0, #42')
  })

  test('ADC / SBC immediate', () => {
    expect(dis(adcImm(1, 4, 0))).toBe('adc\tr1, r4, #0')
    expect(dis(sbcImm(1, 4, 0))).toBe('sbc\tr1, r4, #0')
  })
})

describe('Disassembler: data processing register', () => {
  test('MOV R0, R1', () => {
    expect(dis(movReg(0, 1))).toBe('mov\tr0, r1')
  })

  test('MOV R0, R1, LSL #4', () => {
    expect(dis(movRegShift(0, 1, 0, 4))).toBe('mov\tr0, r1, lsl #4')
  })

  test('MOV R0, R1, LSR #4', () => {
    expect(dis(movRegShift(0, 1, 1, 4))).toBe('mov\tr0, r1, lsr #4')
  })

  test('MOV R0, R1, ASR #1', () => {
    expect(dis(movRegShift(0, 1, 2, 1))).toBe('mov\tr0, r1, asr #1')
  })

  test('MOV R0, R1, ROR #8', () => {
    expect(dis(movRegShift(0, 1, 3, 8))).toBe('mov\tr0, r1, ror #8')
  })

  test('ADD R0, R1, R2', () => {
    expect(dis(addReg(0, 1, 2))).toBe('add\tr0, r1, r2')
  })

  test('PC alias', () => {
    // mov pc, lr  — a typical return sequence
    expect(dis(movReg(15, 14))).toBe('mov\tpc, lr')
  })

  test('SP alias', () => {
    expect(dis(addImm(13, 13, 8))).toBe('add\tsp, sp, #8')
  })
})

describe('Disassembler: loads & stores', () => {
  test('LDR R0, [R1]', () => {
    expect(dis(ldrImm(0, 1, 0))).toBe('ldr\tr0, [r1]')
  })

  test('LDR R0, [R1, #8]', () => {
    expect(dis(ldrImm(0, 1, 8))).toBe('ldr\tr0, [r1, #8]')
  })

  test('STR R0, [R1, #-4]', () => {
    expect(dis(strImm(0, 1, -4))).toBe('str\tr0, [r1, #-4]')
  })

  test('LDRB R0, [R1]', () => {
    expect(dis(ldrbImm(0, 1, 0))).toBe('ldrb\tr0, [r1]')
  })
})

describe('Disassembler: branches', () => {
  test('B target formatted as hex without symbols', () => {
    const instr = b(0)
    const text = dis(instr, 0x20000000)
    // target = pc + 8 + 0 = 0x20000008
    expect(text).toBe('b\t0x20000008')
  })

  test('BL backward branch', () => {
    // bl(-16) encodes byte offset -16. Target = PC + 8 + (-16) = PC - 8.
    // PC = 0x20001000, so target = 0x20000FF8.
    const instr = bl(-16)
    const text = dis(instr, 0x20001000)
    expect(text).toBe('bl\t0x20000ff8')
  })

  test('branch resolves to symbol name', () => {
    const syms = new SymbolMap([
      { name: 'main', address: 0x20000100, size: 0x40, type: 2, sectionIndex: 1 },
    ])
    // Branch from 0x20000000 to 0x20000100. Offset from PC+8 = 0xF8.
    const instr = b(0xf8)
    expect(dis(instr, 0x20000000, syms)).toBe('b\t0x20000100 <main>')
  })

  test('branch to middle of function includes offset', () => {
    const syms = new SymbolMap([
      { name: 'main', address: 0x20000100, size: 0x40, type: 2, sectionIndex: 1 },
    ])
    const instr = b(0xfc) // target 0x20000104
    expect(dis(instr, 0x20000000, syms)).toBe('b\t0x20000104 <main+0x4>')
  })

  test('BX shows register name', () => {
    expect(dis(bx(14))).toBe('bx\tlr')
    expect(dis(bx(0))).toBe('bx\tr0')
  })
})

describe('Disassembler: multiply', () => {
  test('MUL', () => {
    expect(dis(mul(0, 1, 2))).toBe('mul\tr0, r1, r2')
  })

  test('MLA', () => {
    expect(dis(mla(0, 1, 2, 3))).toBe('mla\tr0, r1, r2, r3')
  })

  test('UMULL', () => {
    expect(dis(umull(0, 1, 2, 3))).toBe('umull\tr0, r1, r2, r3')
  })

  test('SMULL', () => {
    expect(dis(smull(0, 1, 2, 3))).toBe('smull\tr0, r1, r2, r3')
  })
})

describe('Disassembler: status register', () => {
  test('MRS R0, CPSR', () => {
    expect(dis(mrs(0))).toBe('mrs\tr0, CPSR')
  })

  test('MSR CPSR_fsxc, R0', () => {
    expect(dis(msr(0))).toBe('msr\tCPSR_fsxc, r0')
  })

  test('MSR CPSR_f, R0', () => {
    expect(dis(msr(0, 0x8))).toBe('msr\tCPSR_f, r0')
  })
})

describe('Disassembler: coprocessor', () => {
  test('MRC p15', () => {
    expect(dis(mrc(15, 0, 0, 1, 0, 0))).toBe('mrc\tp15, 0, r0, c1, c0, 0')
  })
})

describe('Disassembler: block transfers', () => {
  test('PUSH {R0, R1, R2}', () => {
    expect(dis(push([0, 1, 2]))).toBe('push\t{r0, r1, r2}')
  })

  test('POP {R4, R5, LR}', () => {
    expect(dis(pop([4, 5, 14]))).toBe('pop\t{r4, r5, lr}')
  })
})

describe('Disassembler: conditional variants', () => {
  test('MOVEQ', () => {
    const instr =
      (0x0 << 28) | (0b001 << 25) | (0xd << 21) | (0 << 20) |
      (0 << 16) | (0 << 12) | 42
    expect(dis(instr >>> 0)).toBe('moveq\tr0, #42')
  })

  test('BNE', () => {
    // Encode manually: cond NE, branch link=0, offset=0
    const instr = (0x1 << 28) | (0b101 << 25) | 0
    expect(dis(instr >>> 0, 0x20000000)).toBe('bne\t0x20000008')
  })
})

describe('Disassembler: unknown instructions', () => {
  test('0x00000000 decodes as andeq (valid ARM)', () => {
    // 0x00000000 is a valid ARM instruction — matches objdump output.
    expect(dis(0x00000000)).toBe('andeq\tr0, r0, r0')
  })

  test('unmapped encoding space falls back to .word', () => {
    // Coprocessor CDP encoding we don't handle
    expect(dis(0xee000000)).toBe('.word\t0xee000000')
  })
})

describe('disassembleWindow', () => {
  test('returns a sequence centred on PC', () => {
    const program = [
      mov(0, 1),
      mov(1, 2),
      mov(2, 3),
      mov(3, 4),
      mov(4, 5),
    ]
    const memory = {
      read32: (addr: number) => {
        const idx = addr >>> 2
        return program[idx] ?? 0
      },
    }
    const out = disassembleWindow(memory, 0x08, 2, 3)
    // start = 0x08 - 2*4 = 0x00, 5 total entries
    expect(out).toHaveLength(5)
    expect(out[0].text).toBe('mov\tr0, #1')
    expect(out[2].text).toBe('mov\tr2, #3')
    expect(out[4].text).toBe('mov\tr4, #5')
  })
})
