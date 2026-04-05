// ArmCpu integration tests against manually assembled programs.

import { describe, test, expect, beforeEach } from 'vitest'
import { ArmCpu } from '@/lib/emulator/cpu/ArmCpu'
import {
  mov,
  mvn,
  movReg,
  movRegShift,
  addImm,
  addReg,
  subImm,
  subReg,
  andImm,
  orrImm,
  eorImm,
  bicImm,
  cmpImm,
  cmpReg,
  adcImm,
  sbcImm,
  rsbImm,
  ldrImm,
  strImm,
  ldrbImm,
  strbImm,
  ldrhImm,
  strhImm,
  ldrshImm,
  ldrsbImm,
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
  mcr,
  push,
  pop,
  packProgram,
  COND_EQ,
  COND_NE,
  COND_GE,
  COND_LT,
} from './assembler'

const CODE_BASE = 0x20000000
const DATA_BASE = 0x20100000
const STACK_TOP = 0x20200000

function setupCpu(): ArmCpu {
  const cpu = new ArmCpu()
  // 2 MB of executable RAM
  cpu.mapRegion({
    start: CODE_BASE,
    size: 0x100000,
    perms: 'rwx',
    buffer: new Uint8Array(0x100000),
  })
  // 1 MB of data RAM
  cpu.mapRegion({
    start: DATA_BASE,
    size: 0x100000,
    perms: 'rwx',
    buffer: new Uint8Array(0x100000),
  })
  cpu.setPC(CODE_BASE)
  cpu.setRegister('sp', STACK_TOP)
  return cpu
}

function loadProgram(cpu: ArmCpu, words: number[], at = CODE_BASE): ArmCpu {
  const bytes = packProgram(words)
  cpu.writeMemory(at, bytes)
  cpu.setPC(at)
  return cpu
}

// ---------------------------------------------------------------------------
// Data processing — immediate
// ---------------------------------------------------------------------------

describe('MOV / MVN immediate', () => {
  test('MOV R0, #42', () => {
    const cpu = setupCpu()
    loadProgram(cpu, [mov(0, 42)])
    const n = cpu.run(1)
    expect(n).toBe(1)
    expect(cpu.getRegisters().r0).toBe(42)
  })

  test('MOV R5, #255', () => {
    const cpu = setupCpu()
    loadProgram(cpu, [mov(5, 255)])
    cpu.run(1)
    expect(cpu.getRegisters().r5).toBe(255)
  })

  test('MVN R0, #0 produces 0xFFFFFFFF', () => {
    const cpu = setupCpu()
    loadProgram(cpu, [mvn(0, 0)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0xffffffff)
  })

  test('MOV with S-bit sets Z flag for zero', () => {
    const cpu = setupCpu()
    loadProgram(cpu, [mov(0, 0, 1)])
    cpu.run(1)
    const { cpsr } = cpu.getRegisters()
    expect((cpsr >>> 30) & 1).toBe(1) // Z=1
  })

  test('MOV with S-bit sets N flag for negative', () => {
    const cpu = setupCpu()
    // MVN R0, #0 with S-bit → R0 = 0xFFFFFFFF, N=1
    loadProgram(cpu, [mvn(0, 0, 1)])
    cpu.run(1)
    const { cpsr } = cpu.getRegisters()
    expect((cpsr >>> 31) & 1).toBe(1)
  })
})

describe('ADD / SUB immediate', () => {
  test('ADD R0, R1, #10', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 32)
    loadProgram(cpu, [addImm(0, 1, 10)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(42)
  })

  test('SUB R0, R1, #5', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 20)
    loadProgram(cpu, [subImm(0, 1, 5)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(15)
  })

  test('SUBS sets carry for no-borrow', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 20)
    loadProgram(cpu, [subImm(0, 1, 5, 1)])
    cpu.run(1)
    expect((cpu.getRegisters().cpsr >>> 29) & 1).toBe(1)
  })

  test('SUBS sets C=0 on borrow', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 5)
    loadProgram(cpu, [subImm(0, 1, 20, 1)])
    cpu.run(1)
    expect((cpu.getRegisters().cpsr >>> 29) & 1).toBe(0)
  })

  test('SUBS R0, R0, R0 sets Z flag', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 5)
    loadProgram(cpu, [subReg(0, 0, 0, 1)])
    cpu.run(1)
    const { cpsr, r0 } = cpu.getRegisters()
    expect(r0).toBe(0)
    expect((cpsr >>> 30) & 1).toBe(1)
  })

  test('RSB R0, R1, #0 negates R1', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 7)
    loadProgram(cpu, [rsbImm(0, 1, 0)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe((-7) >>> 0)
  })
})

describe('Logical ops', () => {
  test('AND R0, R1, #0x0F', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0xabcd)
    loadProgram(cpu, [andImm(0, 1, 0x0f)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0x0d)
  })

  test('ORR R0, R1, #0xF0', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0x0a)
    loadProgram(cpu, [orrImm(0, 1, 0xf0)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0xfa)
  })

  test('EOR R0, R1, #0xFF', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0x5a)
    loadProgram(cpu, [eorImm(0, 1, 0xff)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0xa5)
  })

  test('BIC R0, R1, #0xF clears low bits', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0xff)
    loadProgram(cpu, [bicImm(0, 1, 0xf)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0xf0)
  })
})

describe('Compares', () => {
  test('CMP equals -> Z=1', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 42)
    loadProgram(cpu, [cmpImm(0, 42)])
    cpu.run(1)
    expect((cpu.getRegisters().cpsr >>> 30) & 1).toBe(1)
  })

  test('CMP greater -> Z=0, C=1, N=0', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 100)
    loadProgram(cpu, [cmpImm(0, 50)])
    cpu.run(1)
    const { cpsr } = cpu.getRegisters()
    expect((cpsr >>> 30) & 1).toBe(0)
    expect((cpsr >>> 29) & 1).toBe(1)
    expect((cpsr >>> 31) & 1).toBe(0)
  })

  test('CMP R0, R1', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 50)
    cpu.setRegister('r1', 60)
    loadProgram(cpu, [cmpReg(0, 1)])
    cpu.run(1)
    // 50 - 60 = -10, so N=1, Z=0, C=0
    const { cpsr } = cpu.getRegisters()
    expect((cpsr >>> 31) & 1).toBe(1)
    expect((cpsr >>> 30) & 1).toBe(0)
    expect((cpsr >>> 29) & 1).toBe(0)
  })
})

describe('ADC / SBC with carry chain', () => {
  test('ADCS adds 64-bit values correctly', () => {
    const cpu = setupCpu()
    // Low word of A + low word of B into R0, setting C
    // Then high word of A + high word of B + C into R1
    // R2=0xFFFFFFFF (low A), R3=0xFFFFFFFF (low B) → R0=0xFFFFFFFE, C=1
    // R4=0, R5=0 → R1 = 0+0+1 = 1
    cpu.setRegister('r2', 0xffffffff)
    cpu.setRegister('r3', 0xffffffff)
    cpu.setRegister('r4', 0)
    cpu.setRegister('r5', 0)
    loadProgram(cpu, [
      // Plain 32-bit unsigned add with flags:
      // ADD Rd, Rn, Rm, S=1 — reuse addReg
      addReg(0, 2, 3, 1),
      adcImm(1, 4, 0), // ADC R1, R4, #0 — R1 = 0 + 0 + C
    ])
    cpu.run(2)
    const { r0, r1 } = cpu.getRegisters()
    expect(r0).toBe(0xfffffffe)
    expect(r1).toBe(1)
  })

  test('SBCS subtracts 64-bit values correctly', () => {
    const cpu = setupCpu()
    // 0x1_00000000 - 0x0_00000001 = 0x0_FFFFFFFF
    cpu.setRegister('r2', 0) // low of a
    cpu.setRegister('r3', 1) // low of b
    cpu.setRegister('r4', 1) // high of a
    loadProgram(cpu, [
      subReg(0, 2, 3, 1), // 0 - 1 = -1, C=0 (borrow)
      sbcImm(1, 4, 0), // 1 - 0 - !C = 1 - 0 - 1 = 0
    ])
    cpu.run(2)
    const { r0, r1 } = cpu.getRegisters()
    expect(r0).toBe(0xffffffff)
    expect(r1).toBe(0)
  })
})

describe('Barrel shifter', () => {
  test('MOV Rd, Rm, LSL #4', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0x12)
    loadProgram(cpu, [movRegShift(0, 1, 0, 4)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0x120)
  })

  test('MOV Rd, Rm, LSR #4', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0xff00)
    loadProgram(cpu, [movRegShift(0, 1, 1, 4)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0x0ff0)
  })

  test('MOV Rd, Rm, ASR #1 preserves sign', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0x80000000)
    loadProgram(cpu, [movRegShift(0, 1, 2, 1)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0xc0000000)
  })

  test('MOV Rd, Rm, ROR #8', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0x000000ff)
    loadProgram(cpu, [movRegShift(0, 1, 3, 8)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0xff000000)
  })

  test('ADD Rd, Rn, Rm, LSL #2 (array indexing)', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0x20100000)
    cpu.setRegister('r2', 3)
    // ADD Rd, Rn, Rm, LSL #2 : 0x20100000 + (3 << 2) = 0x2010000C
    const dpReg_addShift = // direct encoding
      (0xe << 28) | (0b000 << 25) | (0x4 << 21) | (0 << 20) |
      (1 << 16) | (0 << 12) | (2 << 7) | (0 << 5) | 2
    loadProgram(cpu, [dpReg_addShift])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0x2010000c)
  })
})

// ---------------------------------------------------------------------------
// Load / store
// ---------------------------------------------------------------------------

describe('LDR / STR (word)', () => {
  test('STR then LDR round-trip', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0xcafebabe)
    cpu.setRegister('r1', DATA_BASE)
    loadProgram(cpu, [
      strImm(0, 1, 0),
      ldrImm(2, 1, 0),
    ])
    cpu.run(2)
    expect(cpu.getRegisters().r2).toBe(0xcafebabe)
  })

  test('LDR with positive offset', () => {
    const cpu = setupCpu()
    cpu.writeMemory(
      DATA_BASE + 8,
      new Uint8Array([0x78, 0x56, 0x34, 0x12]),
    )
    cpu.setRegister('r1', DATA_BASE)
    loadProgram(cpu, [ldrImm(0, 1, 8)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0x12345678)
  })

  test('STR with negative offset', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0xdeadbeef)
    cpu.setRegister('r1', DATA_BASE + 16)
    loadProgram(cpu, [strImm(0, 1, -4)])
    cpu.run(1)
    const out = cpu.readMemory(DATA_BASE + 12, 4)
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
    expect(view.getUint32(0, true)).toBe(0xdeadbeef)
  })
})

describe('LDRB / STRB', () => {
  test('STRB writes only low byte', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0xabcdef42)
    cpu.setRegister('r1', DATA_BASE)
    loadProgram(cpu, [strbImm(0, 1, 0)])
    cpu.run(1)
    const byte = cpu.readMemory(DATA_BASE, 4)
    expect(byte[0]).toBe(0x42)
    expect(byte[1]).toBe(0) // rest untouched
  })

  test('LDRB zero-extends', () => {
    const cpu = setupCpu()
    cpu.writeMemory(DATA_BASE, new Uint8Array([0x80, 0, 0, 0]))
    cpu.setRegister('r1', DATA_BASE)
    loadProgram(cpu, [ldrbImm(0, 1, 0)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0x80)
  })
})

describe('LDRH / STRH / LDRSB / LDRSH', () => {
  test('STRH writes 2 bytes', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0xabcd)
    cpu.setRegister('r1', DATA_BASE)
    loadProgram(cpu, [strhImm(0, 1, 0)])
    cpu.run(1)
    const bytes = cpu.readMemory(DATA_BASE, 2)
    expect(bytes[0]).toBe(0xcd)
    expect(bytes[1]).toBe(0xab)
  })

  test('LDRH zero-extends', () => {
    const cpu = setupCpu()
    cpu.writeMemory(DATA_BASE, new Uint8Array([0xff, 0xff, 0, 0]))
    cpu.setRegister('r1', DATA_BASE)
    loadProgram(cpu, [ldrhImm(0, 1, 0)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0xffff)
  })

  test('LDRSH sign-extends', () => {
    const cpu = setupCpu()
    cpu.writeMemory(DATA_BASE, new Uint8Array([0xff, 0xff, 0, 0]))
    cpu.setRegister('r1', DATA_BASE)
    loadProgram(cpu, [ldrshImm(0, 1, 0)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0xffffffff)
  })

  test('LDRSB sign-extends negative byte', () => {
    const cpu = setupCpu()
    cpu.writeMemory(DATA_BASE, new Uint8Array([0x80]))
    cpu.setRegister('r1', DATA_BASE)
    loadProgram(cpu, [ldrsbImm(0, 1, 0)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0xffffff80)
  })

  test('LDRSB preserves positive byte', () => {
    const cpu = setupCpu()
    cpu.writeMemory(DATA_BASE, new Uint8Array([0x7f]))
    cpu.setRegister('r1', DATA_BASE)
    loadProgram(cpu, [ldrsbImm(0, 1, 0)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0x7f)
  })
})

// ---------------------------------------------------------------------------
// Branch
// ---------------------------------------------------------------------------

describe('Branch B / BL', () => {
  test('B skips one instruction', () => {
    const cpu = setupCpu()
    loadProgram(cpu, [
      b(0), // PC+8+0 = 0x08 (skip mov(0,99) at 0x04, land at mov(0,42) at 0x08)
      mov(0, 99), // 0x04: should be skipped
      mov(0, 42), // 0x08: target
    ])
    cpu.run(2)
    expect(cpu.getRegisters().r0).toBe(42)
  })

  test('B backward forms a loop', () => {
    const cpu = setupCpu()
    // Loop 3 times decrementing R0
    loadProgram(cpu, [
      mov(0, 3), // 0x00: R0 = 3
      subImm(0, 0, 1, 1), // 0x04: R0 -= 1, set flags
      b(-16, COND_NE), // 0x08: if !Z, branch back to 0x04
      // Target (0x0C) is after the loop; offset from PC+8 (0x10) back to 0x04
      // means -12 bytes of PC+8. But b() helper is relative to PC+8, so
      // to go from 0x10 back to 0x04 we need -12.
      // Wait — offset 12 from the branch is actual 12 bytes, not -16. Let me reassemble.
      mov(1, 55), // 0x0C: R1 = 55 (landing spot)
    ])
    // Offset math: at instruction 0x08, PC+8 = 0x10.
    // Target is 0x04, so offset = 0x04 - 0x10 = -12 bytes.
    // Let me fix the program:
    cpu.writeMemory(0x20000008, packProgram([b(-12, COND_NE)]))
    cpu.run(20)
    const { r0, r1 } = cpu.getRegisters()
    expect(r0).toBe(0)
    expect(r1).toBe(55)
  })

  test('BL saves return address in LR', () => {
    const cpu = setupCpu()
    loadProgram(cpu, [
      bl(4), // 0x00: call subroutine at 0x0C
      mov(0, 99), // 0x04: would be skipped
      mov(0, 77), // 0x08: return here
      // Subroutine at 0x0C:
      mov(1, 88), // 0x0C: R1 = 88
      bx(14), // 0x10: return via LR
    ])
    // bl(4) with byte offset 4 means PC+8+4 = 0x0C ✓
    cpu.run(4)
    const { r0, r1, lr } = cpu.getRegisters()
    expect(r1).toBe(88) // subroutine ran
    // LR should have been the address of instruction after BL = 0x04
    expect(lr).toBe(0x20000004)
    // After BX returns, we resume at 0x04 and execute mov(0, 99)
    // Wait — BX on ARM mode sets PC to (target & ~3), so we go to 0x04
    // which runs mov(0, 99) giving r0=99
    expect(r0).toBe(99)
  })
})

describe('Conditional execution', () => {
  test('MOVEQ only runs when Z=1', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 5)
    // cond MOV: use dp-imm with condition field = EQ
    const movEq42 =
      ((COND_EQ & 0xf) << 28) | (0b001 << 25) | (0xd << 21) |
      (0 << 20) | (0 << 16) | (0 << 12) | 42
    loadProgram(cpu, [
      cmpImm(0, 5), // sets Z=1
      movEq42 >>> 0, // MOVEQ R0, #42 → should execute
    ])
    cpu.run(2)
    expect(cpu.getRegisters().r0).toBe(42)
  })

  test('MOVNE is skipped when Z=1', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 5)
    const movNe99 =
      ((COND_NE & 0xf) << 28) | (0b001 << 25) | (0xd << 21) |
      (0 << 20) | (0 << 16) | (0 << 12) | 99
    loadProgram(cpu, [
      cmpImm(0, 5), // Z=1
      movNe99 >>> 0, // MOVNE R0, #99 → should NOT execute
    ])
    cpu.run(2)
    expect(cpu.getRegisters().r0).toBe(5)
  })

  test('BGE branches when N==V', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 10)
    loadProgram(cpu, [
      cmpImm(0, 5), // 0x00: 10 > 5 → N=0, V=0, so GE is true
      b(0, COND_GE), // 0x04: target PC+8+0 = 0x0C (skips mov at 0x08)
      mov(1, 99), // 0x08: skipped
      mov(1, 77), // 0x0C: target
    ])
    cpu.run(3)
    expect(cpu.getRegisters().r1).toBe(77)
  })

  test('BLT does not branch when N==V', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 10)
    loadProgram(cpu, [
      cmpImm(0, 5),
      b(0, COND_LT),
      mov(1, 55),
    ])
    cpu.run(3)
    expect(cpu.getRegisters().r1).toBe(55)
  })
})

// ---------------------------------------------------------------------------
// Multiply
// ---------------------------------------------------------------------------

describe('Multiply', () => {
  test('MUL R0, R1, R2', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 7)
    cpu.setRegister('r2', 6)
    loadProgram(cpu, [mul(0, 1, 2)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(42)
  })

  test('MUL large values wrap at 32 bits', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0x10000)
    cpu.setRegister('r2', 0x10000)
    loadProgram(cpu, [mul(0, 1, 2)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0) // 2^32 truncated
  })

  test('MLA R0, R1, R2, R3', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 3)
    cpu.setRegister('r2', 4)
    cpu.setRegister('r3', 100)
    loadProgram(cpu, [mla(0, 1, 2, 3)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(112)
  })

  test('UMULL fills two registers', () => {
    const cpu = setupCpu()
    cpu.setRegister('r2', 0xffffffff)
    cpu.setRegister('r3', 2)
    loadProgram(cpu, [umull(0, 1, 2, 3)])
    cpu.run(1)
    // 0xFFFFFFFF * 2 = 0x1_FFFFFFFE → lo=0xFFFFFFFE, hi=1
    expect(cpu.getRegisters().r0).toBe(0xfffffffe)
    expect(cpu.getRegisters().r1).toBe(1)
  })

  test('SMULL preserves sign', () => {
    const cpu = setupCpu()
    cpu.setRegister('r2', 0xffffffff) // -1
    cpu.setRegister('r3', 2)
    loadProgram(cpu, [smull(0, 1, 2, 3)])
    cpu.run(1)
    // -1 * 2 = -2 = 0xFFFFFFFF_FFFFFFFE
    expect(cpu.getRegisters().r0).toBe(0xfffffffe)
    expect(cpu.getRegisters().r1).toBe(0xffffffff)
  })
})

// ---------------------------------------------------------------------------
// Status register
// ---------------------------------------------------------------------------

describe('MRS / MSR', () => {
  test('MRS reads CPSR into register', () => {
    const cpu = setupCpu()
    cpu.setRegister('cpsr', 0x8000001f) // N=1, mode=SYS
    loadProgram(cpu, [mrs(0)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0x8000001f)
  })

  test('MSR writes CPSR from register', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0x4000001f) // Z=1
    loadProgram(cpu, [msr(0)])
    cpu.run(1)
    expect(cpu.getRegisters().cpsr & 0xff000000).toBe(0x40000000)
  })

  test('MSR respects field mask', () => {
    const cpu = setupCpu()
    cpu.setRegister('cpsr', 0x0000001f)
    cpu.setRegister('r0', 0xffffffff)
    // Only flags field (bit 19:16 = 0b1000)
    loadProgram(cpu, [msr(0, 0x8)])
    cpu.run(1)
    const { cpsr } = cpu.getRegisters()
    // Only top byte should be updated
    expect((cpsr >>> 24) & 0xff).toBe(0xff)
    expect(cpsr & 0x00ffffff).toBe(0x0000001f)
  })
})

// ---------------------------------------------------------------------------
// Coprocessor stubs
// ---------------------------------------------------------------------------

describe('CP15 coprocessor stubs', () => {
  test('MRC reads 0', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0xffffffff) // pre-load
    // MRC p15, 0, R0, C1, C0, 0 (read control register — returns 0 from stub)
    loadProgram(cpu, [mrc(15, 0, 0, 1, 0, 0)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0)
  })

  test('MCR does not crash', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0xdeadbeef)
    loadProgram(cpu, [mcr(15, 0, 0, 1, 0, 0)])
    expect(() => cpu.run(1)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// LDM / STM (PUSH / POP)
// ---------------------------------------------------------------------------

describe('PUSH / POP', () => {
  test('PUSH stores registers on the stack', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0x11111111)
    cpu.setRegister('r1', 0x22222222)
    cpu.setRegister('r2', 0x33333333)
    loadProgram(cpu, [push([0, 1, 2])])
    cpu.run(1)
    const sp = cpu.getRegisters().sp
    expect(sp).toBe(STACK_TOP - 12)
    const dump = cpu.readMemory(sp, 12)
    const view = new DataView(dump.buffer, dump.byteOffset, dump.byteLength)
    expect(view.getUint32(0, true)).toBe(0x11111111)
    expect(view.getUint32(4, true)).toBe(0x22222222)
    expect(view.getUint32(8, true)).toBe(0x33333333)
  })

  test('POP restores registers from the stack', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0x11111111)
    cpu.setRegister('r1', 0x22222222)
    cpu.setRegister('r2', 0x33333333)
    loadProgram(cpu, [
      push([0, 1, 2]),
      mov(0, 0),
      mov(1, 0),
      mov(2, 0),
      pop([0, 1, 2]),
    ])
    cpu.run(5)
    const { r0, r1, r2, sp } = cpu.getRegisters()
    expect(r0).toBe(0x11111111)
    expect(r1).toBe(0x22222222)
    expect(r2).toBe(0x33333333)
    expect(sp).toBe(STACK_TOP) // balanced
  })
})

// ---------------------------------------------------------------------------
// Full mini program
// ---------------------------------------------------------------------------

describe('Sum-of-array program', () => {
  test('computes 1+2+3+4+5 = 15', () => {
    const cpu = setupCpu()
    // Place an array at DATA_BASE
    const arr = new Uint8Array(20)
    const view = new DataView(arr.buffer)
    for (let i = 0; i < 5; i++) view.setUint32(i * 4, i + 1, true)
    cpu.writeMemory(DATA_BASE, arr)

    // R0 = sum, R1 = pointer, R2 = counter
    // loop:
    //   LDR R3, [R1]
    //   ADD R0, R0, R3
    //   ADD R1, R1, #4
    //   SUBS R2, R2, #1
    //   BNE loop
    cpu.setRegister('r0', 0)
    cpu.setRegister('r1', DATA_BASE)
    cpu.setRegister('r2', 5)
    loadProgram(cpu, [
      ldrImm(3, 1, 0), // 0x00
      addReg(0, 0, 3), // 0x04
      addImm(1, 1, 4), // 0x08
      subImm(2, 2, 1, 1), // 0x0C
      b(-20, COND_NE), // 0x10: PC+8 = 0x18; offset = -20 means target = 0x04 ✗
      // Actually we need offset = 0x00 - 0x18 = -24? No, the loop starts at 0x00 not 0x04.
      // Need to reassemble: target 0x00, offset from PC+8 at 0x10 → 0x18. Want to go to 0x00. Offset=-24.
      mov(4, 0x55), // 0x14: marker after loop
    ])
    // Patch offset:
    cpu.writeMemory(0x20000010, packProgram([b(-24, COND_NE)]))
    cpu.run(50)
    const { r0, r2, r4 } = cpu.getRegisters()
    expect(r0).toBe(15)
    expect(r2).toBe(0)
    expect(r4).toBe(0x55)
  })
})

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

describe('Code hooks', () => {
  test('code hook fires at matching PC', () => {
    const cpu = setupCpu()
    loadProgram(cpu, [
      mov(0, 1),
      mov(0, 2),
      mov(0, 3),
    ])
    const addresses: number[] = []
    cpu.addCodeHook(CODE_BASE + 4, (pc) => addresses.push(pc))
    cpu.run(3)
    expect(addresses).toEqual([CODE_BASE + 4])
  })

  test('pause() stops the run loop', () => {
    const cpu = setupCpu()
    loadProgram(cpu, [
      mov(0, 1),
      mov(0, 2),
      mov(0, 3),
      mov(0, 4),
    ])
    cpu.addCodeHook(CODE_BASE + 8, () => cpu.pause())
    const executed = cpu.run(10)
    expect(executed).toBeLessThan(10)
    expect(cpu.getRegisters().r0).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Peripheral routing
// ---------------------------------------------------------------------------

describe('Peripheral regions', () => {
  test('writes to peripheral dispatch to handler', () => {
    const cpu = setupCpu()
    const log: Array<{ op: string; offset: number; value: number }> = []
    cpu.addPeripheralRegion(0xfcfe0000, 0x1000, {
      read: (offset) => {
        log.push({ op: 'read', offset, value: 0 })
        return 0xabcd
      },
      write: (offset, width, value) => {
        log.push({ op: 'write', offset, value: value & 0xffffffff })
        void width
      },
    })
    cpu.setRegister('r0', 0xbeef)
    cpu.setRegister('r1', 0xfcfe0004)
    loadProgram(cpu, [
      strImm(0, 1, 0),
      ldrImm(2, 1, 4),
    ])
    cpu.run(2)
    expect(log[0]).toEqual({ op: 'write', offset: 4, value: 0xbeef })
    expect(log[1].op).toBe('read')
    expect(log[1].offset).toBe(8)
    expect(cpu.getRegisters().r2).toBe(0xabcd)
  })
})

// ---------------------------------------------------------------------------
// Missing regions / unmapped reads
// ---------------------------------------------------------------------------

describe('Unmapped memory', () => {
  test('read from unmapped returns 0', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0x80000000)
    loadProgram(cpu, [ldrImm(0, 1, 0)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0)
  })

  test('write to unmapped does not throw', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0xdeadbeef)
    cpu.setRegister('r1', 0x80000000)
    loadProgram(cpu, [strImm(0, 1, 0)])
    expect(() => cpu.run(1)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Register helpers
// ---------------------------------------------------------------------------

describe('PC behaviour', () => {
  test('reading R15 as source returns PC + 8', () => {
    const cpu = setupCpu()
    // ADD R0, PC, #0 → R0 = PC + 8 at the add instruction
    const addPc = addImm(0, 15, 0)
    loadProgram(cpu, [addPc])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(CODE_BASE + 8)
  })
})
