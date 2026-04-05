import { describe, test, expect } from 'vitest'
import { AudioRingBuffer } from '@/lib/audio/AudioRingBuffer'

function samples(values: number[]): Float32Array {
  return new Float32Array(values)
}

describe('AudioRingBuffer construction', () => {
  test('rounds capacity up to power of two', () => {
    expect(new AudioRingBuffer({ capacity: 100 }).capacity).toBe(128)
    expect(new AudioRingBuffer({ capacity: 4096 }).capacity).toBe(4096)
  })

  test('allocates buffer of expected byte length', () => {
    const rb = new AudioRingBuffer({ capacity: 64 })
    // header(8) + 64 floats * 4 bytes
    expect(rb.buffer.byteLength).toBe(8 + 64 * 4)
  })

  test('accepts a pre-allocated buffer of matching length', () => {
    const bytes = 8 + 256 * 4
    const buf = new ArrayBuffer(bytes)
    const rb = new AudioRingBuffer({ capacity: 256, buffer: buf })
    expect(rb.buffer).toBe(buf)
  })

  test('throws when supplied buffer length mismatches', () => {
    const buf = new ArrayBuffer(100)
    expect(() => new AudioRingBuffer({ capacity: 64, buffer: buf })).toThrow()
  })

  test('reports isShared correctly', () => {
    const rb = new AudioRingBuffer({
      capacity: 64,
      buffer: new ArrayBuffer(8 + 64 * 4),
    })
    expect(rb.isShared).toBe(false)
  })
})

describe('AudioRingBuffer write/read basics', () => {
  test('writes and reads back the same samples', () => {
    const rb = new AudioRingBuffer({ capacity: 64 })
    const input = samples([0.1, 0.2, 0.3, 0.4])
    expect(rb.write(input)).toBe(4)
    const out = new Float32Array(4)
    expect(rb.read(out)).toBe(4)
    expect(Array.from(out)).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.2, 5),
      expect.closeTo(0.3, 5),
      expect.closeTo(0.4, 5),
    ])
  })

  test('available counters update after write/read', () => {
    const rb = new AudioRingBuffer({ capacity: 16 })
    expect(rb.availableRead()).toBe(0)
    expect(rb.availableWrite()).toBe(16)
    rb.write(new Float32Array(5))
    expect(rb.availableRead()).toBe(5)
    expect(rb.availableWrite()).toBe(11)
    rb.read(new Float32Array(3))
    expect(rb.availableRead()).toBe(2)
    expect(rb.availableWrite()).toBe(14)
  })

  test('write returns short count when buffer is full', () => {
    const rb = new AudioRingBuffer({ capacity: 8 })
    rb.write(new Float32Array(6))
    expect(rb.write(new Float32Array(5))).toBe(2) // only 2 slots remain
    expect(rb.availableRead()).toBe(8)
    expect(rb.write(new Float32Array(1))).toBe(0)
  })

  test('read of empty buffer returns 0 and zero-fills output', () => {
    const rb = new AudioRingBuffer({ capacity: 16 })
    const out = new Float32Array([9, 9, 9, 9])
    expect(rb.read(out)).toBe(0)
    expect(Array.from(out)).toEqual([0, 0, 0, 0])
  })

  test('underrun zero-fills the tail', () => {
    const rb = new AudioRingBuffer({ capacity: 16 })
    rb.write(samples([1, 2, 3]))
    const out = new Float32Array(6)
    expect(rb.read(out)).toBe(3)
    expect(Array.from(out)).toEqual([1, 2, 3, 0, 0, 0])
  })
})

describe('AudioRingBuffer wraparound', () => {
  test('writes that straddle the end wrap correctly', () => {
    const rb = new AudioRingBuffer({ capacity: 8 })
    // Fill, then drain, to move write pointer to 6
    rb.write(samples([1, 1, 1, 1, 1, 1]))
    rb.read(new Float32Array(6))
    // Now write 4 samples — starts at offset 6, wraps to 0
    rb.write(samples([2, 3, 4, 5]))
    const out = new Float32Array(4)
    expect(rb.read(out)).toBe(4)
    expect(Array.from(out)).toEqual([2, 3, 4, 5])
  })

  test('reads that straddle the end wrap correctly', () => {
    const rb = new AudioRingBuffer({ capacity: 8 })
    rb.write(samples([1, 1, 1, 1, 1, 1]))
    rb.read(new Float32Array(6))
    rb.write(samples([10, 20, 30, 40]))
    // Write another 2, now buffer holds 6 samples straddling the boundary
    rb.write(samples([50, 60]))
    const out = new Float32Array(6)
    rb.read(out)
    expect(Array.from(out)).toEqual([10, 20, 30, 40, 50, 60])
  })

  test('interleaved write/read over many wraps', () => {
    const rb = new AudioRingBuffer({ capacity: 16 })
    const total = 1000
    const writeBuf = new Float32Array(7)
    const readBuf = new Float32Array(5)
    let produced = 0
    let consumed = 0
    let nextValue = 0
    while (produced < total || consumed < produced) {
      if (produced < total) {
        const space = rb.availableWrite()
        const chunk = Math.min(writeBuf.length, space, total - produced)
        for (let i = 0; i < chunk; i++) writeBuf[i] = nextValue++
        rb.write(writeBuf.subarray(0, chunk))
        produced += chunk
      }
      if (consumed < produced) {
        const avail = rb.availableRead()
        const chunk = Math.min(readBuf.length, avail)
        rb.read(readBuf.subarray(0, chunk))
        for (let i = 0; i < chunk; i++) {
          expect(readBuf[i]).toBe(consumed++)
        }
      }
    }
  })
})

describe('AudioRingBuffer reset', () => {
  test('reset clears read/write pointers', () => {
    const rb = new AudioRingBuffer({ capacity: 16 })
    rb.write(new Float32Array(5))
    rb.reset()
    expect(rb.availableRead()).toBe(0)
    expect(rb.availableWrite()).toBe(16)
  })
})

describe('AudioRingBuffer fillFactor', () => {
  test('reports 0 when empty, 1 when full', () => {
    const rb = new AudioRingBuffer({ capacity: 8 })
    expect(rb.fillFactor()).toBe(0)
    rb.write(new Float32Array(8))
    expect(rb.fillFactor()).toBe(1)
    rb.read(new Float32Array(4))
    expect(rb.fillFactor()).toBe(0.5)
  })
})
