// CPU IRQ delivery tests.
//
// Builds a minimal ARM program that:
//   1. Sits in a WFI-like loop at a known PC
//   2. Takes an IRQ → jumps to the IRQ vector (VBAR + 0x18)
//   3. Services the handler → returns via SUBS PC, LR, #4
//   4. Resumes at the interrupted address + 4

import { describe, test, expect } from 'vitest'
import { ArmCpu } from '@/lib/emulator/cpu/ArmCpu'
import { CPSR_I, MODE_SYS } from '@/lib/emulator/cpu/state'

function setupCpu(): ArmCpu {
  const cpu = new ArmCpu()
  // Map 1 MiB of RAM at 0x20000000
  cpu.mapRegion({ start: 0x20000000, size: 0x100000, perms: 'rwx' })
  // Map a low-address exception vector table region
  cpu.mapRegion({ start: 0x00000000, size: 0x1000, perms: 'rwx' })
  cpu.state.cpsr = MODE_SYS // interrupts enabled
  cpu.state.vbar = 0 // vector table at address 0
  return cpu
}

function writeWord(cpu: ArmCpu, addr: number, word: number): void {
  const buf = new Uint8Array(4)
  buf[0] = word & 0xff
  buf[1] = (word >>> 8) & 0xff
  buf[2] = (word >>> 16) & 0xff
  buf[3] = (word >>> 24) & 0xff
  cpu.writeMemory(addr, buf)
}

describe('ArmCpu IRQ dispatch', () => {
  test('masked IRQs do not preempt (CPSR.I set)', () => {
    const cpu = setupCpu()
    cpu.state.cpsr = (MODE_SYS | CPSR_I) >>> 0 // IRQs masked
    // Code: infinite loop at 0x20000000 (B .)
    writeWord(cpu, 0x20000000, 0xeafffffe)
    cpu.setPC(0x20000000)
    cpu.interrupts.request(0)
    cpu.run(10)
    // PC should still be in the loop — IRQ not taken.
    expect(cpu.getRegisters().pc).toBe(0x20000000)
  })

  test('pending IRQ dispatches to VBAR+0x18 when unmasked', () => {
    const cpu = setupCpu()
    // Vector at 0x18: LDR PC, [PC, #-4] → target at 0x20 (via literal pool)
    // Simpler: put an infinite-loop at 0x18 so we just observe the jump.
    writeWord(cpu, 0x18, 0xeafffffe) // B . at 0x18
    // Main code: infinite loop at 0x20000000
    writeWord(cpu, 0x20000000, 0xeafffffe)
    cpu.setPC(0x20000000)
    cpu.interrupts.request(0)
    cpu.run(5)
    // PC should be inside the IRQ vector (at 0x18)
    expect(cpu.getRegisters().pc).toBe(0x18)
    // CPSR should have I-bit set (IRQs masked on entry)
    expect(cpu.getRegisters().cpsr & CPSR_I).toBeTruthy()
    // SPSR should contain the saved (pre-IRQ) CPSR
    expect(cpu.state.spsrIrq).toBe(MODE_SYS)
    // R14 (banked as LR_irq while in IRQ mode) = interrupted PC + 4
    expect(cpu.state.r[14]).toBe(0x20000004)
  })

  test('SUBS PC, LR, #4 returns from IRQ', () => {
    const cpu = setupCpu()
    // IRQ handler at 0x18: single SUBS PC, LR, #4 instruction.
    // Encoding: 0xE25EF004 (cond=AL, I=1, opcode=SUB, S=1, Rn=14, Rd=15, imm=4)
    writeWord(cpu, 0x18, 0xe25ef004)
    writeWord(cpu, 0x20000000, 0xeafffffe) // B . (main loop)
    cpu.setPC(0x20000000)
    cpu.interrupts.request(0)
    // Step 1: take IRQ (PC → 0x18)
    // Step 2: execute SUBS PC, LR, #4 → restore CPSR + PC = LR-4
    cpu.run(3)
    // After return, CPSR back to System mode, PC back at interrupted PC
    expect(cpu.getRegisters().cpsr & 0x1f).toBe(0x1f) // SYS
    expect(cpu.getRegisters().cpsr & CPSR_I).toBe(0) // IRQs re-enabled
    expect(cpu.getRegisters().pc).toBe(0x20000000)
  })

  test('multiple IRQs can be queued and cleared', () => {
    const cpu = setupCpu()
    cpu.interrupts.request(5)
    cpu.interrupts.request(3)
    cpu.interrupts.request(7)
    expect(cpu.interrupts.hasPending()).toBe(true)
    expect(cpu.interrupts.nextPending()).toBe(3)
    cpu.interrupts.clear(3)
    expect(cpu.interrupts.nextPending()).toBe(5)
    cpu.interrupts.clear(5)
    cpu.interrupts.clear(7)
    expect(cpu.interrupts.hasPending()).toBe(false)
  })

  test('32..63 source range is supported', () => {
    const cpu = setupCpu()
    cpu.interrupts.request(50)
    expect(cpu.interrupts.nextPending()).toBe(50)
    cpu.interrupts.clear(50)
    expect(cpu.interrupts.hasPending()).toBe(false)
  })
})
