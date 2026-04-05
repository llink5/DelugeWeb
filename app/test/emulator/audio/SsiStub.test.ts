import { describe, test, expect, vi } from 'vitest'
import { SsiStub } from '@/lib/emulator/peripherals/ssi'

describe('SsiStub status reads', () => {
  test('SSISR reports TX FIFO empty', () => {
    const s = new SsiStub()
    // Status reg at offset 0x04 (channel 0)
    expect(s.read32(0x04) & 0x02).not.toBe(0)
  })

  test('SSIFSR also reports empty', () => {
    const s = new SsiStub()
    expect(s.read32(0x14) & 0x02).not.toBe(0)
  })

  test('status reads are the same across all SSI channels', () => {
    const s = new SsiStub()
    // Channel 2 is at offset 0x1000 (0x800 stride × 2)
    expect(s.read32(0x1000 + 0x04) & 0x02).not.toBe(0)
  })
})

describe('SsiStub sample capture (32-bit writes, alternating L/R)', () => {
  test('two 32-bit writes pair into a stereo frame', () => {
    // Deluge firmware writes one Int32 per DMA element, alternating L,R.
    // Stub scales Int32 → Int16 via >>16 arithmetic shift.
    const s = new SsiStub()
    const cb = vi.fn()
    s.onSamples(cb)
    // Int32 left = 0x12340000 → Int16 0x1234
    s.write32(0x08, 0x12340000)
    expect(cb).not.toHaveBeenCalled()
    // Int32 right = 0x56780000 → Int16 0x5678
    s.write32(0x08, 0x56780000)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(0x1234, 0x5678)
  })

  test('FIFO register (0x18) alternates L/R the same way', () => {
    const s = new SsiStub()
    const cb = vi.fn()
    s.onSamples(cb)
    s.write32(0x18, 0x20000000) // L = 0x2000
    s.write32(0x18, 0x10000000) // R = 0x1000
    expect(cb).toHaveBeenCalledWith(0x2000, 0x1000)
  })

  test('negative Int32 samples sign-extend to Int16', () => {
    const s = new SsiStub()
    const cb = vi.fn()
    s.onSamples(cb)
    // 0x80000000 (−2^31 as Int32) → −32768 as Int16
    s.write32(0x08, 0x80000000)
    s.write32(0x08, 0xffff0000) // Int32 near −1 * 2^16 → −1
    expect(cb).toHaveBeenCalledWith(-32768, -1)
  })
})

describe('SsiStub sample capture (16-bit writes)', () => {
  test('two 16-bit writes pair into a stereo frame', () => {
    const s = new SsiStub()
    const cb = vi.fn()
    s.onSamples(cb)
    s.write16(0x08, 0x1234)
    expect(cb).not.toHaveBeenCalled() // waiting for the right channel
    s.write16(0x08, 0x5678)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(0x1234, 0x5678)
  })

  test('multiple frames from alternating writes', () => {
    const s = new SsiStub()
    const frames: Array<[number, number]> = []
    s.onSamples((l, r) => frames.push([l, r]))
    s.write16(0x08, 100)
    s.write16(0x08, 200)
    s.write16(0x08, 300)
    s.write16(0x08, 400)
    expect(frames).toEqual([
      [100, 200],
      [300, 400],
    ])
  })

  test('reset clears pending half-frame', () => {
    const s = new SsiStub()
    const cb = vi.fn()
    s.onSamples(cb)
    s.write16(0x08, 100) // left pending
    s.reset()
    s.write16(0x08, 300)
    expect(cb).not.toHaveBeenCalled() // because left is pending again, no pair yet
    s.write16(0x08, 400)
    expect(cb).toHaveBeenCalledWith(300, 400)
  })
})

describe('SsiStub capturedFrames counter', () => {
  test('increments once per L+R pair', () => {
    const s = new SsiStub()
    s.onSamples(() => {})
    // Two pairs of 32-bit writes = 2 stereo frames
    s.write32(0x08, 0x10000)
    s.write32(0x08, 0x20000)
    s.write32(0x08, 0x30000)
    s.write32(0x08, 0x40000)
    expect(s.capturedFrames).toBe(2)
  })

  test('reset zeroes the counter', () => {
    const s = new SsiStub()
    s.onSamples(() => {})
    s.write32(0x08, 0x10000)
    s.write32(0x08, 0x20000)
    s.reset()
    expect(s.capturedFrames).toBe(0)
  })
})

describe('SsiStub no-callback behaviour', () => {
  test('samples are counted even when no callback is attached', () => {
    const s = new SsiStub()
    s.write32(0x08, 0x10000)
    s.write32(0x08, 0x20000)
    s.write32(0x08, 0x30000)
    s.write32(0x08, 0x40000)
    expect(s.capturedFrames).toBe(2)
  })
})

describe('SsiStub non-audio register writes', () => {
  test('writing to SSICR (0x00) does not emit frames', () => {
    const s = new SsiStub()
    const cb = vi.fn()
    s.onSamples(cb)
    s.write32(0x00, 0xffffffff)
    expect(cb).not.toHaveBeenCalled()
  })
})
