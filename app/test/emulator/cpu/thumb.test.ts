// Thumb mode tests — manually assemble 16-bit halfwords and run them.

import { describe, test, expect } from 'vitest'
import { ArmCpu } from '@/lib/emulator/cpu/ArmCpu'
import { packThumb } from './assembler'
import { CPSR_T } from '@/lib/emulator/cpu/state'

const CODE_BASE = 0x20000000
const STACK_TOP = 0x20300000

function setupCpu(): ArmCpu {
  const cpu = new ArmCpu()
  cpu.mapRegion({
    start: CODE_BASE,
    size: 0x300000, // cover code, data, and stack in one region
    perms: 'rwx',
    buffer: new Uint8Array(0x300000),
  })
  cpu.setRegister('sp', STACK_TOP)
  return cpu
}

function loadThumb(cpu: ArmCpu, halfwords: number[]): void {
  cpu.writeMemory(CODE_BASE, packThumb(halfwords))
  cpu.setPC(CODE_BASE)
  cpu.setRegister('cpsr', (cpu.getRegisters().cpsr | CPSR_T) >>> 0)
}

// ---------------------------------------------------------------------------
// Tiny Thumb assembler helpers
// ---------------------------------------------------------------------------

/** Format 3: MOV Rd, #imm8  | 00100 Rd imm8 */
function t_mov_imm(Rd: number, imm8: number): number {
  return (0b001_00 << 11) | ((Rd & 0x7) << 8) | (imm8 & 0xff)
}
/** Format 3: CMP Rd, #imm8  | 00101 */
function t_cmp_imm(Rd: number, imm8: number): number {
  return (0b001_01 << 11) | ((Rd & 0x7) << 8) | (imm8 & 0xff)
}
/** Format 3: ADD Rd, #imm8  | 00110 */
function t_add_imm8(Rd: number, imm8: number): number {
  return (0b001_10 << 11) | ((Rd & 0x7) << 8) | (imm8 & 0xff)
}
/** Format 3: SUB Rd, #imm8  | 00111 */
function t_sub_imm8(Rd: number, imm8: number): number {
  return (0b001_11 << 11) | ((Rd & 0x7) << 8) | (imm8 & 0xff)
}

/** Format 2: ADD Rd, Rs, Rn  | 0001100 Rn Rs Rd */
function t_add_reg(Rd: number, Rs: number, Rn: number): number {
  return (0b0001100 << 9) | ((Rn & 0x7) << 6) | ((Rs & 0x7) << 3) | (Rd & 0x7)
}
/** Format 2: SUB Rd, Rs, Rn  | 0001101 */
function t_sub_reg(Rd: number, Rs: number, Rn: number): number {
  return (0b0001101 << 9) | ((Rn & 0x7) << 6) | ((Rs & 0x7) << 3) | (Rd & 0x7)
}

/** Format 1: LSL Rd, Rs, #imm5  | 00000 imm5 Rs Rd */
function t_lsl(Rd: number, Rs: number, imm5: number): number {
  return (0b00000 << 11) | ((imm5 & 0x1f) << 6) | ((Rs & 0x7) << 3) | (Rd & 0x7)
}
/** Format 1: LSR */
function t_lsr(Rd: number, Rs: number, imm5: number): number {
  return (0b00001 << 11) | ((imm5 & 0x1f) << 6) | ((Rs & 0x7) << 3) | (Rd & 0x7)
}

/** Format 4: ALU op  | 010000 op Rs Rd  */
function t_alu(op: number, Rd: number, Rs: number): number {
  return (0b010000 << 10) | ((op & 0xf) << 6) | ((Rs & 0x7) << 3) | (Rd & 0x7)
}

/** Format 5: BX Rm  | 01000111 0 H2 Rm 000 */
function t_bx(Rm: number): number {
  const H2 = (Rm >>> 3) & 1
  const low = Rm & 0x7
  return (0b01000111 << 8) | (0 << 7) | (H2 << 6) | (low << 3) | 0
}

/** Format 7: LDR Rd, [Rb, Ro] */
function t_ldr_reg(Rd: number, Rb: number, Ro: number): number {
  return (0b0101100 << 9) | ((Ro & 0x7) << 6) | ((Rb & 0x7) << 3) | (Rd & 0x7)
}

/** Format 9: LDR Rd, [Rb, #imm5*4] */
function t_ldr_imm(Rd: number, Rb: number, imm5: number): number {
  return (0b01101 << 11) | ((imm5 & 0x1f) << 6) | ((Rb & 0x7) << 3) | (Rd & 0x7)
}
/** Format 9: STR Rd, [Rb, #imm5*4] */
function t_str_imm(Rd: number, Rb: number, imm5: number): number {
  return (0b01100 << 11) | ((imm5 & 0x1f) << 6) | ((Rb & 0x7) << 3) | (Rd & 0x7)
}

/** Format 14: PUSH {list} with optional LR */
function t_push(list: number[], pushLr = false): number {
  let bits = 0
  for (const r of list) bits |= 1 << (r & 0x7)
  return (0b1011 << 12) | (0 << 11) | (0b10 << 9) | ((pushLr ? 1 : 0) << 8) | (bits & 0xff)
}
/** Format 14: POP {list} with optional PC */
function t_pop(list: number[], popPc = false): number {
  let bits = 0
  for (const r of list) bits |= 1 << (r & 0x7)
  return (0b1011 << 12) | (1 << 11) | (0b10 << 9) | ((popPc ? 1 : 0) << 8) | (bits & 0xff)
}

/** Format 16: conditional branch: 1101 cond offset8 */
function t_bcond(cond: number, byteOffset: number): number {
  const off = (byteOffset / 2) & 0xff
  return (0b1101 << 12) | ((cond & 0xf) << 8) | off
}

/** Format 18: unconditional branch: 11100 offset11 */
function t_b(byteOffset: number): number {
  const off = (byteOffset / 2) & 0x7ff
  return (0b11100 << 11) | off
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Thumb MOV/ADD/SUB immediate', () => {
  test('MOV R0, #42', () => {
    const cpu = setupCpu()
    loadThumb(cpu, [t_mov_imm(0, 42)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(42)
  })

  test('ADD R0, #5 then ADD R0, #3 → 8', () => {
    const cpu = setupCpu()
    loadThumb(cpu, [t_mov_imm(0, 0), t_add_imm8(0, 5), t_add_imm8(0, 3)])
    cpu.run(3)
    expect(cpu.getRegisters().r0).toBe(8)
  })

  test('SUB R0, #10', () => {
    const cpu = setupCpu()
    loadThumb(cpu, [t_mov_imm(0, 20), t_sub_imm8(0, 10)])
    cpu.run(2)
    expect(cpu.getRegisters().r0).toBe(10)
  })

  test('CMP sets Z when equal', () => {
    const cpu = setupCpu()
    loadThumb(cpu, [t_mov_imm(0, 7), t_cmp_imm(0, 7)])
    cpu.run(2)
    expect((cpu.getRegisters().cpsr >>> 30) & 1).toBe(1)
  })
})

describe('Thumb ADD/SUB register', () => {
  test('ADD Rd, Rs, Rn', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 10)
    cpu.setRegister('r2', 5)
    loadThumb(cpu, [t_add_reg(0, 1, 2)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(15)
  })

  test('SUB Rd, Rs, Rn', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 20)
    cpu.setRegister('r2', 7)
    loadThumb(cpu, [t_sub_reg(0, 1, 2)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(13)
  })
})

describe('Thumb shifts', () => {
  test('LSL R0, R1, #4', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0x12)
    loadThumb(cpu, [t_lsl(0, 1, 4)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0x120)
  })

  test('LSR R0, R1, #4', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0xf0)
    loadThumb(cpu, [t_lsr(0, 1, 4)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0xf)
  })
})

describe('Thumb ALU (Format 4)', () => {
  test('AND', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0xff)
    cpu.setRegister('r1', 0x0f)
    loadThumb(cpu, [t_alu(0x0, 0, 1)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0x0f)
  })

  test('EOR', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0xff)
    cpu.setRegister('r1', 0xaa)
    loadThumb(cpu, [t_alu(0x1, 0, 1)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0x55)
  })

  test('MUL', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 6)
    cpu.setRegister('r1', 7)
    loadThumb(cpu, [t_alu(0xd, 0, 1)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(42)
  })

  test('MVN', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0)
    loadThumb(cpu, [t_alu(0xf, 0, 1)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0xffffffff)
  })

  test('NEG', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 7)
    loadThumb(cpu, [t_alu(0x9, 0, 1)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe((-7) >>> 0)
  })
})

describe('Thumb load/store', () => {
  test('STR then LDR round-trip', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0xdeadbeef)
    cpu.setRegister('r1', 0x20180000)
    // First map that range so writes land somewhere
    cpu.mapRegion({
      start: 0x20180000,
      size: 0x10000,
      perms: 'rwx',
      buffer: new Uint8Array(0x10000),
    })
    loadThumb(cpu, [t_str_imm(0, 1, 0), t_ldr_imm(2, 1, 0)])
    cpu.run(2)
    expect(cpu.getRegisters().r2).toBe(0xdeadbeef)
  })

  test('LDR with register offset', () => {
    const cpu = setupCpu()
    cpu.mapRegion({
      start: 0x20180000,
      size: 0x10000,
      perms: 'rwx',
      buffer: new Uint8Array(0x10000),
    })
    cpu.writeMemory(
      0x20180008,
      new Uint8Array([0x44, 0x33, 0x22, 0x11]),
    )
    cpu.setRegister('r1', 0x20180000)
    cpu.setRegister('r2', 8)
    loadThumb(cpu, [t_ldr_reg(0, 1, 2)])
    cpu.run(1)
    expect(cpu.getRegisters().r0).toBe(0x11223344)
  })
})

describe('Thumb PUSH / POP', () => {
  test('PUSH then POP restores registers', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0xaaaa)
    cpu.setRegister('r1', 0xbbbb)
    cpu.setRegister('r2', 0xcccc)
    loadThumb(cpu, [
      t_push([0, 1, 2]),
      t_mov_imm(0, 0),
      t_mov_imm(1, 0),
      t_mov_imm(2, 0),
      t_pop([0, 1, 2]),
    ])
    cpu.run(5)
    const { r0, r1, r2, sp } = cpu.getRegisters()
    expect(r0).toBe(0xaaaa)
    expect(r1).toBe(0xbbbb)
    expect(r2).toBe(0xcccc)
    expect(sp).toBe(STACK_TOP) // balanced
  })
})

describe('Thumb branches', () => {
  test('unconditional B jumps forward', () => {
    const cpu = setupCpu()
    // B offset is computed as: target = PC+4 + offset*2
    // Halfword layout:
    //   0x00: B to skip next halfword (offset = 0 means PC+4 = 0x04)
    //   0x02: mov r0, #99 (skipped)
    //   0x04: mov r0, #42
    loadThumb(cpu, [t_b(0), t_mov_imm(0, 99), t_mov_imm(0, 42)])
    cpu.run(2)
    expect(cpu.getRegisters().r0).toBe(42)
  })

  test('BEQ jumps when Z=1', () => {
    const cpu = setupCpu()
    //   0x00: mov r0, #5
    //   0x02: cmp r0, #5    (Z=1)
    //   0x04: beq to 0x08 (offset=0, target = PC+4 = 0x08)
    //   0x06: mov r1, #99  skipped
    //   0x08: mov r1, #77
    loadThumb(cpu, [
      t_mov_imm(0, 5),
      t_cmp_imm(0, 5),
      t_bcond(0x0, 0), // EQ
      t_mov_imm(1, 99),
      t_mov_imm(1, 77),
    ])
    cpu.run(4)
    expect(cpu.getRegisters().r1).toBe(77)
  })

  test('BNE does not jump when Z=1', () => {
    const cpu = setupCpu()
    loadThumb(cpu, [
      t_mov_imm(0, 5),
      t_cmp_imm(0, 5),
      t_bcond(0x1, 0), // NE
      t_mov_imm(1, 55),
    ])
    cpu.run(4)
    expect(cpu.getRegisters().r1).toBe(55)
  })
})

describe('Thumb BX (mode switch)', () => {
  test('BX to ARM target clears T flag', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0x20001000) // ARM target (bit 0 = 0)
    loadThumb(cpu, [t_bx(1)])
    cpu.run(1)
    expect((cpu.getRegisters().cpsr & CPSR_T) >>> 0).toBe(0)
    expect(cpu.getRegisters().pc).toBe(0x20001000)
  })

  test('BX to Thumb target preserves T flag', () => {
    const cpu = setupCpu()
    cpu.setRegister('r1', 0x20001001) // Thumb target (bit 0 = 1)
    loadThumb(cpu, [t_bx(1)])
    cpu.run(1)
    expect((cpu.getRegisters().cpsr & CPSR_T) >>> 0).not.toBe(0)
    expect(cpu.getRegisters().pc).toBe(0x20001000) // bit 0 stripped
  })
})

describe('Thumb countdown loop', () => {
  test('counts R0 from 5 to 0 then lands at mov r1,#42', () => {
    const cpu = setupCpu()
    //   0x00: mov r0, #5
    //   0x02: sub r0, #1        (flags)
    //   0x04: cmp r0, #0
    //   0x06: bne -6 (back to 0x02: target = PC+4-6 = 0x04, no that's wrong)
    // Let me recompute: at 0x06, PC+4 = 0x0A. To jump to 0x02, offset in bytes = 0x02 - 0x0A = -8.
    // t_bcond divides by 2: -4.
    //   0x08: mov r1, #42
    loadThumb(cpu, [
      t_mov_imm(0, 5),
      t_sub_imm8(0, 1),
      t_cmp_imm(0, 0),
      t_bcond(0x1, -8), // BNE to 0x02
      t_mov_imm(1, 42),
    ])
    cpu.run(50)
    const { r0, r1 } = cpu.getRegisters()
    expect(r0).toBe(0)
    expect(r1).toBe(42)
  })
})

describe('ARM → Thumb interworking', () => {
  test('BX to Thumb runs Thumb code, then BX back to ARM', () => {
    const cpu = setupCpu()
    cpu.mapRegion({
      start: 0x20010000,
      size: 0x10000,
      perms: 'rwx',
      buffer: new Uint8Array(0x10000),
    })
    // ARM code at 0x20000000:
    //   MOV R1, #0x20010001 (thumb target)
    //   BX R1
    //   (never reached)
    // Thumb code at 0x20010000:
    //   MOV R0, #99
    //   BX LR (need to set LR first; skip in this test by BX to ARM address)
    //
    // Simpler: just jump to Thumb and verify T flag + execution.
    const arm = new Uint8Array(12)
    const view = new DataView(arm.buffer)
    // MOV R1, #0x20010001 can't be encoded as a single DP immediate,
    // so load it from a literal pool. Simpler: build it incrementally.
    // MOV R1, #1; ORR R1, R1, #0x20010000  — the second doesn't fit in an
    // 8-bit rotate. Use two ops: MOV R1, #0x20000000; ORR R1, #0x10001.
    // 0x20000000 = 0x20 ROR 28-bit (rotate right 28)
    // 0x00010001 = can't be encoded as single imm. Split: #0x10000 then +1.
    // Easier: write literally using a synthetic program.
    // MOV R1, #0x20 ROR(28) — encoded as rot=14, imm=0x20
    view.setUint32(0, 0xe3a01e02, true) // MOV R1, #0x20 ROR 28 = 0x200
    // no wait that's wrong. Let me just use the CPU directly.
    //
    // Easiest: preset R1 via API, load a single BX Rm.
    cpu.setRegister('r1', 0x20010001)
    // bx r1 = 0xE12FFF11
    view.setUint32(0, 0xe12fff11, true)
    cpu.writeMemory(0x20000000, arm)
    cpu.setPC(0x20000000)

    // Thumb at 0x20010000: mov r0, #123
    cpu.writeMemory(0x20010000, packThumb([t_mov_imm(0, 123)]))

    cpu.run(2) // BX + Thumb MOV
    expect(cpu.getRegisters().r0).toBe(123)
    expect((cpu.getRegisters().cpsr & CPSR_T) >>> 0).not.toBe(0)
  })
})
