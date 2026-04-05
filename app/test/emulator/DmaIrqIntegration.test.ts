// End-to-end: DMAC TC/END → InterruptController → CPU IRQ dispatch.
//
// Wires up a minimal scenario where a DMA channel completes a transfer
// and fires the IRQ line. The CPU was in a busy-loop; after the IRQ
// fires it jumps to the exception vector.

import { describe, test, expect } from 'vitest'
import { ArmCpu } from '@/lib/emulator/cpu/ArmCpu'
import { DmacStub } from '@/lib/emulator/peripherals/dmac'
import { MODE_SYS } from '@/lib/emulator/cpu/state'

function writeWord(cpu: ArmCpu, addr: number, word: number): void {
  const buf = new Uint8Array(4)
  buf[0] = word & 0xff
  buf[1] = (word >>> 8) & 0xff
  buf[2] = (word >>> 16) & 0xff
  buf[3] = (word >>> 24) & 0xff
  cpu.writeMemory(addr, buf)
}

describe('DMA TC/END raises CPU IRQ', () => {
  test('channel 6 (SSI) completion fires IRQ at source 6', () => {
    const cpu = new ArmCpu()
    cpu.mapRegion({ start: 0x20000000, size: 0x100000, perms: 'rwx' })
    cpu.mapRegion({ start: 0x00000000, size: 0x1000, perms: 'rwx' })
    cpu.state.cpsr = MODE_SYS
    cpu.state.vbar = 0

    // Infinite loop at main PC + at IRQ vector.
    writeWord(cpu, 0x20000000, 0xeafffffe)
    writeWord(cpu, 0x18, 0xeafffffe)
    cpu.setPC(0x20000000)

    // Stand-alone DMAC (not going through the bus, just test the callback).
    const dmac = new DmacStub()
    dmac.onChannelEnd((channel) => cpu.interrupts.request(channel))
    // Configure channel 6 to transfer 4 bytes.
    const CH6 = 6 * 0x40
    // Allocate a peripheral-less memory accessor since src=dst=RAM.
    const memAccess = {
      read8: (a: number) => cpu.memory.read8(a),
      read16: (a: number) => cpu.memory.read16(a),
      read32: (a: number) => cpu.memory.read32(a),
      write8: (a: number, v: number) => cpu.memory.write8(a, v),
      write16: (a: number, v: number) => cpu.memory.write16(a, v),
      write32: (a: number, v: number) => cpu.memory.write32(a, v),
    }
    dmac.write32(CH6 + 0x00, 0x20000100) // N0SA
    dmac.write32(CH6 + 0x04, 0x20000200) // N0DA
    dmac.write32(CH6 + 0x08, 4) // N0TB
    dmac.write32(CH6 + 0x2c, 0) // CHCFG: 8-bit src/dst, both increment
    dmac.write32(CH6 + 0x28, 0x1) // SETEN

    // Pump the channel — transfer completes, callback fires, IRQ raised.
    dmac.pump(memAccess, 100)
    expect(cpu.interrupts.hasPending()).toBe(true)
    expect(cpu.interrupts.nextPending()).toBe(6)

    // Run CPU — should dispatch to IRQ vector.
    cpu.run(3)
    expect(cpu.getRegisters().pc).toBe(0x18)
  })

  test('IRQ is not dispatched when CPSR.I is masked', () => {
    const cpu = new ArmCpu()
    cpu.mapRegion({ start: 0x20000000, size: 0x100000, perms: 'rwx' })
    cpu.mapRegion({ start: 0x00000000, size: 0x1000, perms: 'rwx' })
    cpu.state.cpsr = (MODE_SYS | 0x80) >>> 0 // I-bit set
    cpu.state.vbar = 0

    writeWord(cpu, 0x20000000, 0xeafffffe)
    cpu.setPC(0x20000000)

    cpu.interrupts.request(10)
    cpu.run(5)
    // Still in busy loop — PC unchanged.
    expect(cpu.getRegisters().pc).toBe(0x20000000)
  })
})
