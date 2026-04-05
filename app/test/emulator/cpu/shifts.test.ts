import { describe, test, expect } from 'vitest'
import {
  applyShift,
  applyImmediateShift,
  expandRotatedImmediate,
  SHIFT_LSL,
  SHIFT_LSR,
  SHIFT_ASR,
  SHIFT_ROR,
} from '@/lib/emulator/cpu/shifts'

describe('applyShift (register amount)', () => {
  test('LSL by 4', () => {
    const r = applyShift(0x00000001, SHIFT_LSL, 4, 0)
    expect(r.value).toBe(0x10)
    expect(r.carry).toBe(0)
  })

  test('LSL by 31 puts bit 0 into bit 31', () => {
    const r = applyShift(0x1, SHIFT_LSL, 31, 0)
    expect(r.value).toBe(0x80000000)
    expect(r.carry).toBe(0)
  })

  test('LSL by 32 yields 0, carry = original bit 0', () => {
    const r = applyShift(0x3, SHIFT_LSL, 32, 0)
    expect(r.value).toBe(0)
    expect(r.carry).toBe(1)
  })

  test('LSL by >32 yields 0, carry = 0', () => {
    const r = applyShift(0xff, SHIFT_LSL, 64, 0)
    expect(r.value).toBe(0)
    expect(r.carry).toBe(0)
  })

  test('LSR by 4', () => {
    const r = applyShift(0xf0, SHIFT_LSR, 4, 0)
    expect(r.value).toBe(0x0f)
    expect(r.carry).toBe(0)
  })

  test('LSR by 32 yields 0, carry = bit 31', () => {
    const r = applyShift(0x80000000, SHIFT_LSR, 32, 0)
    expect(r.value).toBe(0)
    expect(r.carry).toBe(1)
  })

  test('ASR preserves sign', () => {
    const r = applyShift(0x80000000, SHIFT_ASR, 1, 0)
    expect(r.value).toBe(0xc0000000)
  })

  test('ASR by 32 on negative gives all-ones', () => {
    const r = applyShift(0x80000000, SHIFT_ASR, 32, 0)
    expect(r.value).toBe(0xffffffff)
    expect(r.carry).toBe(1)
  })

  test('ASR by 32 on positive gives 0', () => {
    const r = applyShift(0x7fffffff, SHIFT_ASR, 32, 0)
    expect(r.value).toBe(0)
    expect(r.carry).toBe(0)
  })

  test('ROR by 8', () => {
    const r = applyShift(0x000000ff, SHIFT_ROR, 8, 0)
    expect(r.value).toBe(0xff000000)
    expect(r.carry).toBe(1)
  })

  test('ROR by 32 is identity', () => {
    const r = applyShift(0x12345678, SHIFT_ROR, 32, 0)
    expect(r.value).toBe(0x12345678)
  })

  test('zero amount preserves carry', () => {
    const r = applyShift(0x1234, SHIFT_LSL, 0, 1)
    expect(r.value).toBe(0x1234)
    expect(r.carry).toBe(1)
  })
})

describe('applyImmediateShift', () => {
  test('LSL #0 is identity', () => {
    const r = applyImmediateShift(0xabcd, SHIFT_LSL, 0, 0)
    expect(r.value).toBe(0xabcd)
  })

  test('LSR #0 means LSR #32', () => {
    const r = applyImmediateShift(0x80000000, SHIFT_LSR, 0, 0)
    expect(r.value).toBe(0)
    expect(r.carry).toBe(1)
  })

  test('ASR #0 means ASR #32', () => {
    const r = applyImmediateShift(0xff000000, SHIFT_ASR, 0, 0)
    expect(r.value).toBe(0xffffffff)
  })

  test('ROR #0 means RRX (rotate through carry)', () => {
    const r = applyImmediateShift(0x00000002, SHIFT_ROR, 0, 1)
    // value >> 1 | carry << 31 = 0x00000001 | 0x80000000 = 0x80000001
    expect(r.value).toBe(0x80000001)
    // new carry = bit 0 of original = 0
    expect(r.carry).toBe(0)
  })

  test('ROR #0 with C=0 and bit 0 set captures carry', () => {
    const r = applyImmediateShift(0x00000003, SHIFT_ROR, 0, 0)
    expect(r.value).toBe(0x00000001)
    expect(r.carry).toBe(1)
  })
})

describe('expandRotatedImmediate', () => {
  test('zero rotate returns imm8 directly', () => {
    const r = expandRotatedImmediate(0xff, 0, 0)
    expect(r.value).toBe(0xff)
  })

  test('rotate=8 gives imm << 16', () => {
    // ror amount = 16, so 0xff ROR 16 = 0x00ff0000
    const r = expandRotatedImmediate(0xff, 8, 0)
    expect(r.value).toBe(0x00ff0000)
  })

  test('rotate=1 gives imm rotated by 2 bits', () => {
    const r = expandRotatedImmediate(0x04, 1, 0)
    // 0x04 ROR 2 = 0x01
    expect(r.value).toBe(0x01)
  })

  test('nonzero rotate sets carry to bit 31', () => {
    // 0x80 ROR 2 = 0x20 (bit 31 = 0)
    let r = expandRotatedImmediate(0x80, 1, 0)
    expect(r.carry).toBe(0)
    // 0x02 ROR 2 = 0x80000000 (bit 31 = 1)
    r = expandRotatedImmediate(0x02, 1, 0)
    expect(r.value).toBe(0x80000000)
    expect(r.carry).toBe(1)
  })
})
