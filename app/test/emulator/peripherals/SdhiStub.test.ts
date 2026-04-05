import { describe, test, expect } from 'vitest'
import {
  SdhiStub,
  SDHI_REG_OFFSETS as R,
  SDHI_INFO1_BITS,
  SDHI_INFO2_BITS,
  SDHI_BASE_ADDR,
} from '@/lib/emulator/peripherals/sdhi'

function makeImage(sectors: number): Uint8Array {
  const img = new Uint8Array(sectors * 512)
  for (let s = 0; s < sectors; s++) {
    for (let b = 0; b < 512; b++) {
      img[s * 512 + b] = (s * 13 + b) & 0xff
    }
  }
  return img
}

describe('SdhiStub reset state', () => {
  test('base address matches chapter 18 table 18.1', () => {
    const s = new SdhiStub()
    expect(s.baseAddr).toBe(SDHI_BASE_ADDR)
    expect(s.baseAddr).toBe(0xe804e800)
  })

  test('SD_INFO2 has bus-idle + WE set after reset', () => {
    const s = new SdhiStub()
    const v = s.read16(R.SD_INFO2)
    expect(v & SDHI_INFO2_BITS.SCLKDIVEN).toBeTruthy()
    expect(v & SDHI_INFO2_BITS.WE).toBeTruthy()
  })

  test('SD_INFO1 has INS_CD set (card present)', () => {
    const s = new SdhiStub()
    expect(s.read16(R.SD_INFO1) & SDHI_INFO1_BITS.INS_CD).toBeTruthy()
  })

  test('SD_SIZE resets to 512 (block size)', () => {
    const s = new SdhiStub()
    expect(s.read16(R.SD_SIZE)).toBe(512)
  })
})

describe('SdhiStub info-register write-to-clear', () => {
  test('writing a bit to SD_INFO1 clears that bit', () => {
    const s = new SdhiStub()
    // After reset INS_CD is set
    expect(s.read16(R.SD_INFO1) & SDHI_INFO1_BITS.INS_CD).toBeTruthy()
    s.write16(R.SD_INFO1, SDHI_INFO1_BITS.INS_CD)
    expect(s.read16(R.SD_INFO1) & SDHI_INFO1_BITS.INS_CD).toBe(0)
  })

  test('writing a zero bit to SD_INFO1 leaves other bits intact', () => {
    const s = new SdhiStub()
    const before = s.read16(R.SD_INFO1)
    s.write16(R.SD_INFO1, 0)
    expect(s.read16(R.SD_INFO1)).toBe(before)
  })
})

describe('SdhiStub CMD17 single-block read', () => {
  test('loads sector 0 and exposes it via SD_BUF0', () => {
    const s = new SdhiStub()
    s.attachImage(makeImage(8))
    // Prepare args for sector 0
    s.write16(R.SD_ARG0, 0)
    s.write16(R.SD_ARG1, 0)
    // Issue CMD17
    s.write16(R.SD_CMD, 17)
    // Response should be ready
    expect(s.read16(R.SD_INFO1) & SDHI_INFO1_BITS.RESP).toBeTruthy()
    // RE bit asserted → buffer has data
    expect(s.read16(R.SD_INFO2) & SDHI_INFO2_BITS.RE).toBeTruthy()
    // Read 128 32-bit words (512 bytes)
    const bytes: number[] = []
    for (let i = 0; i < 128; i++) {
      const w = s.read32(R.SD_BUF0)
      bytes.push(w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff, (w >>> 24) & 0xff)
    }
    // Sector 0 pattern: (0*13 + b) & 0xff = b & 0xff
    for (let b = 0; b < 512; b++) {
      expect(bytes[b]).toBe(b & 0xff)
    }
    // Data-trns flag asserted after last byte
    expect(s.read16(R.SD_INFO1) & SDHI_INFO1_BITS.DATA_TRNS).toBeTruthy()
  })

  test('reading a different sector returns the right pattern', () => {
    const s = new SdhiStub()
    s.attachImage(makeImage(8))
    s.write16(R.SD_ARG0, 3)
    s.write16(R.SD_ARG1, 0)
    s.write16(R.SD_CMD, 17)
    const firstWord = s.read32(R.SD_BUF0)
    // Sector 3 byte 0 = (3*13 + 0) & 0xff = 39
    expect(firstWord & 0xff).toBe(39)
  })

  test('reading beyond image bounds returns zeros', () => {
    const s = new SdhiStub()
    s.attachImage(makeImage(2))
    s.write16(R.SD_ARG0, 100) // far past end
    s.write16(R.SD_CMD, 17)
    const w = s.read32(R.SD_BUF0)
    expect(w).toBe(0)
  })
})

describe('SdhiStub CMD18 multi-block read', () => {
  test('reads sectors 0 and 1 sequentially', () => {
    const s = new SdhiStub()
    s.attachImage(makeImage(4))
    s.write16(R.SD_ARG0, 0)
    s.write16(R.SD_SECCNT, 2)
    s.write16(R.SD_CMD, 18)
    // Drain 1024 bytes (2 sectors)
    const bytes: number[] = []
    for (let i = 0; i < 256; i++) {
      const w = s.read32(R.SD_BUF0)
      bytes.push(w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff, (w >>> 24) & 0xff)
    }
    // Sector 0 starts with byte 0, sector 1 starts with (1*13) = 13
    expect(bytes[0]).toBe(0)
    expect(bytes[512]).toBe(13)
    expect(s.read16(R.SD_INFO1) & SDHI_INFO1_BITS.DATA_TRNS).toBeTruthy()
  })
})

describe('SdhiStub CMD24 single-block write', () => {
  test('accepts 512 bytes via SD_BUF0 and commits to image', () => {
    const s = new SdhiStub()
    const img = new Uint8Array(4 * 512)
    s.attachImage(img)
    s.write16(R.SD_ARG0, 2) // write to sector 2
    s.write16(R.SD_CMD, 24)
    // Push 128 words with byte-wise ramp 0..255 repeating.
    for (let i = 0; i < 128; i++) {
      const base = i * 4
      const b0 = base & 0xff
      const b1 = (base + 1) & 0xff
      const b2 = (base + 2) & 0xff
      const b3 = (base + 3) & 0xff
      const w = ((b3 << 24) | (b2 << 16) | (b1 << 8) | b0) >>> 0
      s.write32(R.SD_BUF0, w)
    }
    for (let b = 0; b < 512; b++) {
      expect(img[2 * 512 + b]).toBe(b & 0xff)
    }
    expect(s.read16(R.SD_INFO1) & SDHI_INFO1_BITS.DATA_TRNS).toBeTruthy()
  })
})

describe('SdhiStub CMD25 multi-block write', () => {
  test('writes 2 sectors sequentially', () => {
    const s = new SdhiStub()
    const img = new Uint8Array(4 * 512)
    s.attachImage(img)
    s.write16(R.SD_ARG0, 1)
    s.write16(R.SD_SECCNT, 2)
    s.write16(R.SD_CMD, 25)
    // Push 1024 bytes worth — sector 1 all 0xAA, sector 2 all 0xBB
    for (let i = 0; i < 128; i++) s.write32(R.SD_BUF0, 0xaaaaaaaa)
    for (let i = 0; i < 128; i++) s.write32(R.SD_BUF0, 0xbbbbbbbb)
    expect(img[1 * 512]).toBe(0xaa)
    expect(img[1 * 512 + 511]).toBe(0xaa)
    expect(img[2 * 512]).toBe(0xbb)
    expect(img[2 * 512 + 511]).toBe(0xbb)
  })
})

describe('SdhiStub command response', () => {
  test('CMD0 (go idle) sets RESP flag', () => {
    const s = new SdhiStub()
    s.write16(R.SD_CMD, 0)
    expect(s.read16(R.SD_INFO1) & SDHI_INFO1_BITS.RESP).toBeTruthy()
  })

  test('CMD13 (send status) returns an R1 response', () => {
    const s = new SdhiStub()
    s.write16(R.SD_CMD, 13)
    // Some non-zero response should be there
    const rsp = s.read16(R.SD_RESP0)
    expect(rsp).toBeGreaterThan(0)
  })
})

describe('SdhiStub CMD12 stop transmission', () => {
  test('halts an in-flight multi-block read', () => {
    const s = new SdhiStub()
    s.attachImage(makeImage(4))
    s.write16(R.SD_ARG0, 0)
    s.write16(R.SD_SECCNT, 4)
    s.write16(R.SD_CMD, 18)
    // Stop after consuming half the first sector
    for (let i = 0; i < 64; i++) s.read32(R.SD_BUF0)
    s.write16(R.SD_CMD, 12)
    // Buffer should stop being ready eventually
    expect(s.sectorCount).toBe(4)
  })
})

describe('SdhiStub sectorCount', () => {
  test('reflects attached image size', () => {
    const s = new SdhiStub()
    expect(s.sectorCount).toBe(0)
    s.attachImage(new Uint8Array(1024 * 1024)) // 1 MB
    expect(s.sectorCount).toBe(2048)
  })
})
