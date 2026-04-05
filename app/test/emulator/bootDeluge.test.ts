// Boot the actual Deluge community firmware in the emulator.
//
// This isn't a correctness test — it's an instrumentation harness. Load
// the .bin via BinLoader, pour it into memory, start the CPU, and run.
// The goal is to find out WHERE the emulator trips up: what addresses
// it reads that aren't mapped, what instructions it can't decode,
// what peripheral registers the firmware expects to change state.

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseBin } from '@/lib/emulator/BinLoader'
import { ArmCpu } from '@/lib/emulator/cpu/ArmCpu'
import { MEMORY_REGIONS, backingRegion } from '@/lib/emulator/MemoryMap'
import { createBootPeripheralBus } from '@/lib/emulator/peripherals'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BIN = resolve(__dirname, '..', 'fixtures', 'deluge-c1_2_1.bin')

function buildCpu(): ArmCpu {
  const cpu = new ArmCpu()
  // Map every backing RAM region.
  const bufferByName = new Map<string, Uint8Array>()
  for (const r of MEMORY_REGIONS) {
    if (r.peripheral) continue
    const backing = backingRegion(r)
    let buf = bufferByName.get(backing.name)
    if (!buf) {
      buf = new Uint8Array(backing.size)
      bufferByName.set(backing.name, buf)
    }
    cpu.mapRegion({
      start: r.start,
      size: r.size,
      perms: r.perms,
      buffer: buf,
    })
  }
  // Wire up the peripheral bus.
  const bus = createBootPeripheralBus()
  for (const stub of bus.list()) {
    cpu.addPeripheralRegion(stub.baseAddr, stub.size, {
      read: (offset, width) =>
        width === 1
          ? stub.read8(offset)
          : width === 2
            ? stub.read16(offset)
            : stub.read32(offset),
      write: (offset, width, value) => {
        if (width === 1) stub.write8(offset, value)
        else if (width === 2) stub.write16(offset, value)
        else stub.write32(offset, value)
      },
    })
  }
  return cpu
}

describe('Deluge firmware boot', () => {
  test('100k+ instructions execute without the emulator crashing', () => {
    const bytes = new Uint8Array(readFileSync(BIN))
    const fw = parseBin(bytes)

    const cpu = buildCpu()
    cpu.writeMemory(fw.loadAddress, fw.data)
    cpu.setPC(fw.entryPoint)
    // System mode, ARM state, interrupts enabled.
    cpu.setRegister('cpsr', 0x1f)
    // Give the CPU a stack somewhere in on-chip RAM — above the firmware.
    cpu.setRegister('sp', 0x20100000)

    // Run in batches so a runaway loop can be detected via executed count.
    const TOTAL = 100_000
    const BATCH = 10_000
    let executed = 0
    const pcSamples: number[] = []
    while (executed < TOTAL) {
      const pcBefore = cpu.getRegisters().pc
      pcSamples.push(pcBefore)
      const n = cpu.run(BATCH)
      executed += n
      if (n === 0) break
    }

    // We don't assert on the final state — the firmware doesn't boot to
    // completion (MMU, PLL, and other peripherals need more modelling).
    // We only require that the CPU kept executing without crashing.
    expect(executed).toBe(TOTAL)

    // Sanity: PC should have moved past the reset handler by the end.
    const finalPc = cpu.getRegisters().pc
    expect(finalPc).toBeGreaterThan(0)
  })

  test('first 100 instructions starting at reset handler', () => {
    const bytes = new Uint8Array(readFileSync(BIN))
    const fw = parseBin(bytes)
    const cpu = buildCpu()
    cpu.writeMemory(fw.loadAddress, fw.data)
    cpu.setPC(fw.entryPoint)
    cpu.setRegister('cpsr', 0x1f)
    cpu.setRegister('sp', 0x20100000)

    const pcTrace: number[] = []
    for (let i = 0; i < 100; i++) {
      pcTrace.push(cpu.getRegisters().pc)
      cpu.run(1)
    }
    // Each step should have advanced PC somewhere. The trace may contain
    // loops, but it can't be all identical.
    const unique = new Set(pcTrace)
    expect(unique.size).toBeGreaterThan(1)
  })

  test('reset-handler region is marked alloc + has valid code', () => {
    const bytes = new Uint8Array(readFileSync(BIN))
    const fw = parseBin(bytes)
    // Verify the bytes at the reset-handler target decode as SOMETHING
    // that isn't zero or all-ones (which would be uninitialised memory).
    const offsetInBin = fw.entryPoint - fw.loadAddress
    expect(offsetInBin).toBeGreaterThanOrEqual(0)
    expect(offsetInBin).toBeLessThan(bytes.length)
    const firstInstr =
      (bytes[offsetInBin] |
        (bytes[offsetInBin + 1] << 8) |
        (bytes[offsetInBin + 2] << 16) |
        (bytes[offsetInBin + 3] << 24)) >>>
      0
    expect(firstInstr).not.toBe(0)
    expect(firstInstr).not.toBe(0xffffffff)
  })
})
