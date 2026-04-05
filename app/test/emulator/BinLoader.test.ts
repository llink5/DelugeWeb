// BinLoader tests — exercise vector-table decoding and load-address
// heuristics against synthetic firmware binaries.

import { describe, test, expect } from 'vitest'
import { parseBin, detectFirmwareFormat } from '@/lib/emulator/BinLoader'

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Write a 32-bit little-endian value into `bytes` at `offset`. */
function w32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

/**
 * Build a firmware image with the common Deluge-style vector layout:
 *   8 × `LDR PC, [PC, #0x48]` followed by a literal pool of handler
 *   absolute addresses.
 */
function buildLdrLiteralFirmware(
  handlerAddresses: readonly number[],
  totalSize = 0x80,
): Uint8Array {
  const bytes = new Uint8Array(totalSize)
  // Vectors
  for (let i = 0; i < 8; i++) {
    // LDR PC, [PC, #0x48] = 0xE59FF048
    w32(bytes, i * 4, 0xe59ff048)
  }
  // Literal pool starts at offset 0x50 (= 0x08 + 0x48 for vector 0).
  for (let i = 0; i < handlerAddresses.length; i++) {
    w32(bytes, 0x50 + i * 4, handlerAddresses[i])
  }
  return bytes
}

/** Build a firmware with direct B <offset> vectors. */
function buildBranchFirmware(resetOffsetBytes: number, totalSize = 0x80): Uint8Array {
  const bytes = new Uint8Array(totalSize)
  // B <offset>: cond=1110, op=101 0, off24 is (bytes/4) - 2 (PC+8 prefetch)
  const off24 = (resetOffsetBytes / 4 - 2) & 0x00ffffff
  const instr = (0xe << 28) | (0b101 << 25) | off24
  w32(bytes, 0, instr >>> 0)
  for (let i = 1; i < 8; i++) {
    // Self-branches for unused vectors (infinite loop)
    const selfOff = (-2) & 0x00ffffff // B . (PC+8-8 = PC)
    w32(bytes, i * 4, ((0xe << 28) | (0b101 << 25) | selfOff) >>> 0)
  }
  return bytes
}

// ---------------------------------------------------------------------------
// Tests: LDR PC, [PC, #offset] form
// ---------------------------------------------------------------------------

describe('parseBin — LDR PC literal form', () => {
  test('decodes the Deluge-style vector table', () => {
    const handlers = [
      0x2007b620, // Reset
      0x2007b754, // Undef
      0x2007b754, // SWI
      0x2007b754, // PrefAbort
      0x2007b754, // DataAbort
      0x2007b754, // Reserved
      0x20135934, // IRQ
      0x201358e8, // FIQ
    ]
    const bytes = buildLdrLiteralFirmware(handlers)
    const fw = parseBin(bytes)
    expect(fw.vectorForm).toBe('ldr-literal')
    expect(fw.vectors.reset).toBe(0x2007b620)
    expect(fw.vectors.irq).toBe(0x20135934)
    expect(fw.vectors.fiq).toBe(0x201358e8)
    expect(fw.entryPoint).toBe(0x2007b620)
  })

  test('derives load address by aligning reset target down to 4 KB', () => {
    const bytes = buildLdrLiteralFirmware([0x2007b620, 0, 0, 0, 0, 0, 0, 0])
    const fw = parseBin(bytes)
    expect(fw.loadAddress).toBe(0x2007b000)
  })

  test('explicit loadAddress overrides auto-detection', () => {
    const bytes = buildLdrLiteralFirmware([0x30000100, 0, 0, 0, 0, 0, 0, 0])
    const fw = parseBin(bytes, { loadAddress: 0x30000000 })
    expect(fw.loadAddress).toBe(0x30000000)
    expect(fw.entryPoint).toBe(0x30000100)
  })

  test('handles negative offset in LDR PC (U=0)', () => {
    // Construct LDR PC, [PC, #-4] form: cond(E) 01 P=1 U=0 B=0 W=0 L=1 Rn=F Rd=F off=4
    // = E51FF004
    const bytes = new Uint8Array(0x80)
    // We need a literal value BEFORE the instruction. Put the reset vector
    // at offset 0x20 so [PC, #-offset] can read from offset 0x20-4 = 0x1C+4?
    // Actually this is unusual. Let's just test the decoder accepts E51FF
    // by using a positive offset with the U bit cleared and verify no crash.
    w32(bytes, 0x00, 0xe51ff004) // LDR PC, [PC, #-4]
    // PC+8-4 = offset 4 → put a handler address there
    w32(bytes, 0x04, 0x20001234)
    const fw = parseBin(bytes)
    expect(fw.vectorForm).toBe('ldr-literal')
    expect(fw.entryPoint).toBe(0x20001234)
  })
})

// ---------------------------------------------------------------------------
// Tests: B <offset> form
// ---------------------------------------------------------------------------

describe('parseBin — B <offset> form', () => {
  test('decodes a B <offset> reset vector', () => {
    const bytes = buildBranchFirmware(0x40)
    const fw = parseBin(bytes, { loadAddress: 0x20000000 })
    expect(fw.vectorForm).toBe('branch')
    // Target = PC+8 + offset_bytes, starting at address 0x20000000
    // With resetOffsetBytes=0x40 we expect entryPoint = 0x20000000 + 0x40
    expect(fw.entryPoint).toBe(0x20000040)
    expect(fw.loadAddress).toBe(0x20000000)
  })

  test('uses fallback address for branch vectors', () => {
    const bytes = buildBranchFirmware(0x100)
    const fw = parseBin(bytes, { fallbackLoadAddress: 0x18000000 })
    expect(fw.loadAddress).toBe(0x18000000)
    // Target = 0x18000000 + 0x100 = 0x18000100
    expect(fw.entryPoint).toBe(0x18000100)
  })

  test('backward branch is sign-extended correctly', () => {
    const bytes = new Uint8Array(0x80)
    // B -4: offset = (-4/4) - 2 = -3 = 0x00FFFFFD
    const off24 = (-3) & 0x00ffffff
    w32(bytes, 0, ((0xe << 28) | (0b101 << 25) | off24) >>> 0)
    for (let i = 1; i < 8; i++) w32(bytes, i * 4, 0xe59ff048)
    const fw = parseBin(bytes, { loadAddress: 0x20000000 })
    // Target = 0x20000000 + 8 + (-3 × 4) = 0x20000000 + 8 - 12 = 0x1FFFFFFC
    expect(fw.vectorForm).toBe('branch')
    expect(fw.entryPoint).toBe(0x1ffffffc)
  })
})

// ---------------------------------------------------------------------------
// Tests: edge cases
// ---------------------------------------------------------------------------

describe('parseBin — edge cases', () => {
  test('throws on too-small buffer', () => {
    expect(() => parseBin(new Uint8Array(0x10))).toThrow(/too small/i)
  })

  test('unknown vector form falls back', () => {
    const bytes = new Uint8Array(0x80)
    // Garbage first word
    w32(bytes, 0, 0xdeadbeef)
    const fw = parseBin(bytes, { fallbackLoadAddress: 0x18000000 })
    expect(fw.vectorForm).toBe('unknown')
    expect(fw.loadAddress).toBe(0x18000000)
  })

  test('preserves input bytes in the returned struct', () => {
    const bytes = buildLdrLiteralFirmware([0x20001000, 0, 0, 0, 0, 0, 0, 0])
    const fw = parseBin(bytes)
    expect(fw.data).toBe(bytes)
  })

  test('decodes all 8 vectors', () => {
    const handlers = [
      0x20001000, 0x20001100, 0x20001200, 0x20001300,
      0x20001400, 0x20001500, 0x20001600, 0x20001700,
    ]
    const bytes = buildLdrLiteralFirmware(handlers)
    const fw = parseBin(bytes)
    expect(fw.vectors.reset).toBe(0x20001000)
    expect(fw.vectors.undefined).toBe(0x20001100)
    expect(fw.vectors.softwareInterrupt).toBe(0x20001200)
    expect(fw.vectors.prefetchAbort).toBe(0x20001300)
    expect(fw.vectors.dataAbort).toBe(0x20001400)
    expect(fw.vectors.reserved).toBe(0x20001500)
    expect(fw.vectors.irq).toBe(0x20001600)
    expect(fw.vectors.fiq).toBe(0x20001700)
  })
})

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

describe('detectFirmwareFormat', () => {
  test('recognises ELF magic', () => {
    const bytes = new Uint8Array(64)
    bytes[0] = 0x7f
    bytes[1] = 0x45 // E
    bytes[2] = 0x4c // L
    bytes[3] = 0x46 // F
    expect(detectFirmwareFormat(bytes)).toBe('elf')
  })

  test('returns bin for raw binary', () => {
    const bytes = buildLdrLiteralFirmware([0x20000000, 0, 0, 0, 0, 0, 0, 0])
    expect(detectFirmwareFormat(bytes)).toBe('bin')
  })

  test('short buffers are reported as bin', () => {
    expect(detectFirmwareFormat(new Uint8Array(0))).toBe('bin')
    expect(detectFirmwareFormat(new Uint8Array([0x7f, 0x45]))).toBe('bin')
  })

  test('near-miss on ELF magic is bin', () => {
    const bytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x47]) // last byte wrong
    expect(detectFirmwareFormat(bytes)).toBe('bin')
  })
})
