import { describe, test, expect } from 'vitest'
import {
  int16ToFloat32,
  float32ToInt16,
  int24ToFloat32,
  deinterleaveStereo,
} from '@/lib/audio/conversion'

describe('int16ToFloat32', () => {
  test('extremes map correctly', () => {
    const out = int16ToFloat32(new Int16Array([32767, -32768, 0]))
    expect(out[0]).toBeCloseTo(32767 / 32768, 5)
    expect(out[1]).toBeCloseTo(-1.0, 5)
    expect(out[2]).toBe(0)
  })

  test('half-scale values', () => {
    const out = int16ToFloat32(new Int16Array([16384, -16384]))
    expect(out[0]).toBeCloseTo(0.5, 5)
    expect(out[1]).toBeCloseTo(-0.5, 5)
  })

  test('reuses pre-allocated output buffer', () => {
    const pre = new Float32Array(4)
    const out = int16ToFloat32(new Int16Array([0, 0]), pre)
    expect(out).toBe(pre)
  })
})

describe('float32ToInt16', () => {
  test('clips values outside [-1, 1]', () => {
    const out = float32ToInt16(new Float32Array([2.0, -2.0, 0.5]))
    expect(out[0]).toBe(32767)
    expect(out[1]).toBe(-32768)
    expect(out[2]).toBe(16383)
  })

  test('silence maps to zero', () => {
    const out = float32ToInt16(new Float32Array([0, 0, 0]))
    expect(Array.from(out)).toEqual([0, 0, 0])
  })

  test('round-trips through int16ToFloat32 with minimal loss', () => {
    const src = new Int16Array([100, -100, 10000, -10000])
    const float = int16ToFloat32(src)
    const back = float32ToInt16(float)
    for (let i = 0; i < src.length; i++) {
      expect(Math.abs(back[i] - src[i])).toBeLessThanOrEqual(1)
    }
  })
})

describe('int24ToFloat32', () => {
  test('signed 24-bit values', () => {
    const src = new Int32Array([0x000000, 0x7fffff, 0x800000])
    const out = int24ToFloat32(src)
    expect(out[0]).toBe(0)
    expect(out[1]).toBeCloseTo((0x7fffff) / 0x800000, 5)
    expect(out[2]).toBeCloseTo(-1.0, 5)
  })
})

describe('deinterleaveStereo', () => {
  test('splits an interleaved stereo buffer', () => {
    const src = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])
    const { left, right } = deinterleaveStereo(src)
    expect(Array.from(left)).toEqual([0.1, 0.3, 0.5].map((x) => expect.closeTo(x, 5)))
    expect(Array.from(right)).toEqual([0.2, 0.4, 0.6].map((x) => expect.closeTo(x, 5)))
  })

  test('reuses pre-allocated buffers', () => {
    const src = new Float32Array([1, 2, 3, 4])
    const L = new Float32Array(2)
    const R = new Float32Array(2)
    const result = deinterleaveStereo(src, L, R)
    expect(result.left).toBe(L)
    expect(result.right).toBe(R)
  })
})
