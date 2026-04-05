// Exercise BinLoader against the actual shipped Deluge firmware binary.
// This verifies vector decoding on a real, non-synthetic image.

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseBin, detectFirmwareFormat } from '@/lib/emulator/BinLoader'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(__dirname, 'fixtures', 'deluge-c1_2_1.bin')
// fixtures are in test/fixtures, not test/emulator/fixtures
const REAL_BIN = resolve(__dirname, '..', 'fixtures', 'deluge-c1_2_1.bin')

describe('BinLoader vs real Deluge community firmware 1.2.1', () => {
  test('fixture is present', () => {
    const bytes = readFileSync(REAL_BIN)
    expect(bytes.byteLength).toBeGreaterThan(1_000_000)
  })

  test('detects as bin (not ELF)', () => {
    const bytes = new Uint8Array(readFileSync(REAL_BIN))
    expect(detectFirmwareFormat(bytes)).toBe('bin')
  })

  test('decodes LDR-literal vector table', () => {
    const bytes = new Uint8Array(readFileSync(REAL_BIN))
    const fw = parseBin(bytes)
    expect(fw.vectorForm).toBe('ldr-literal')
    // The reset handler in Deluge fw 1.2.1 lives at 0x2007B620.
    expect(fw.vectors.reset).toBe(0x2007b620)
  })

  test('derives load address 0x2007B480 from embedded header', () => {
    // The Deluge firmware stores its load address in a bootloader header
    // at bin offset 0x20 (see start.S: `code_start: .word start`).
    // BinLoader detects the header and uses that address instead of the
    // 4-KB-align heuristic.
    const bytes = new Uint8Array(readFileSync(REAL_BIN))
    const fw = parseBin(bytes)
    expect(fw.loadAddress).toBe(0x2007b480)
  })

  test('byte at bin offset 0x1A0 is reset_handler first instruction (MRC p15)', () => {
    const bytes = new Uint8Array(readFileSync(REAL_BIN))
    const fw = parseBin(bytes)
    const offset = fw.entryPoint - fw.loadAddress
    // The reset_handler in start.S starts with MRC p15, 0, r0, c0, c0, 5
    // which encodes as 0xEE100FB0.
    const instr =
      (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>>
      0
    expect(instr).toBe(0xee100fb0)
  })

  test('entry point equals the Reset vector target', () => {
    const bytes = new Uint8Array(readFileSync(REAL_BIN))
    const fw = parseBin(bytes)
    expect(fw.entryPoint).toBe(fw.vectors.reset)
  })

  test('all vector handlers point into on-chip RAM', () => {
    const bytes = new Uint8Array(readFileSync(REAL_BIN))
    const fw = parseBin(bytes)
    for (const [name, addr] of Object.entries(fw.vectors)) {
      expect(
        addr >= 0x20000000 && addr < 0x20300000,
        `${name} = 0x${addr.toString(16)} should be in on-chip RAM`,
      ).toBe(true)
    }
  })

  test('entry point is within the loaded firmware range', () => {
    const bytes = new Uint8Array(readFileSync(REAL_BIN))
    const fw = parseBin(bytes)
    expect(fw.entryPoint).toBeGreaterThanOrEqual(fw.loadAddress)
    expect(fw.entryPoint).toBeLessThan(fw.loadAddress + bytes.byteLength)
  })
})
