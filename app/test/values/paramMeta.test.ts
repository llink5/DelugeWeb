// Round-trip tests for hex <-> display conversion.
// The mapping is lossy in hex space, but must round-trip cleanly in display
// space: displayToHex → hexToDisplay must return the original display value.

import { describe, test, expect } from 'vitest'
import {
  hexToDisplay,
  displayToHex,
  PARAM_META,
  ENVELOPE_PARAM_META,
  PATCH_CABLE_AMOUNT_META,
  formatPan,
  type ParamMeta,
} from '@/lib/values/paramMeta'

/** Hex → display → hex: allow up to 1 LSB of hex drift. */
function hexDriftTolerance(hex: string, backToHex: string): number {
  const a = parseInt(hex.substring(2, 10), 16)
  const b = parseInt(backToHex.substring(2, 10), 16)
  return Math.abs(a - b)
}

describe('hexToDisplay / displayToHex - unipolar (0..50)', () => {
  const meta = PARAM_META.volume

  test('anchor values map correctly', () => {
    expect(hexToDisplay('0x80000000', meta)).toBe(0)
    expect(hexToDisplay('0x00000000', meta)).toBe(25)
    expect(hexToDisplay('0x7FFFFFFF', meta)).toBe(50)
  })

  test('display values round-trip through hex cleanly', () => {
    for (let display = 0; display <= 50; display++) {
      const hex = displayToHex(display, meta)
      const back = hexToDisplay(hex, meta)
      expect(back).toBe(display)
    }
  })

  test('canonical hex values round-trip within LSB tolerance', () => {
    const testValues = [
      '0x80000000', '0x00000000', '0x7FFFFFFF',
      '0x4CCCCCA8', '0xE6666654', '0x1999997E',
      '0x33333320', '0xB3333330', '0x66666640',
    ]
    for (const hex of testValues) {
      const display = hexToDisplay(hex, meta)
      const backToHex = displayToHex(display, meta)
      // Within one display bucket — the hex may differ, but re-parsing hits the same display
      expect(hexToDisplay(backToHex, meta)).toBe(display)
      // And the hex drift stays small relative to the full 32-bit range
      expect(hexDriftTolerance(hex, backToHex)).toBeLessThan(0x04000000)
    }
  })

  test('clamps out-of-range display values', () => {
    expect(displayToHex(-10, meta)).toBe('0x80000000')
    expect(displayToHex(100, meta)).toBe('0x7FFFFFFF')
  })
})

describe('hexToDisplay / displayToHex - bipolar (-50..+50)', () => {
  const meta = PATCH_CABLE_AMOUNT_META

  test('anchor values map correctly', () => {
    expect(hexToDisplay('0x80000000', meta)).toBe(-50)
    expect(hexToDisplay('0x00000000', meta)).toBe(0)
    expect(hexToDisplay('0x7FFFFFFF', meta)).toBe(50)
  })

  test('display values round-trip through hex cleanly', () => {
    for (let display = -50; display <= 50; display++) {
      const hex = displayToHex(display, meta)
      const back = hexToDisplay(hex, meta)
      expect(back).toBe(display)
    }
  })

  test('symmetry: positive and negative values round-trip equally', () => {
    for (let d = 1; d <= 50; d++) {
      const hexPos = displayToHex(d, meta)
      const hexNeg = displayToHex(-d, meta)
      expect(hexToDisplay(hexPos, meta)).toBe(d)
      expect(hexToDisplay(hexNeg, meta)).toBe(-d)
    }
  })
})

describe('hexToDisplay / displayToHex - pan (-32..+32)', () => {
  const meta = PARAM_META.pan

  test('anchor values', () => {
    expect(hexToDisplay('0x80000000', meta)).toBe(-32)
    expect(hexToDisplay('0x00000000', meta)).toBe(0)
    expect(hexToDisplay('0x7FFFFFFF', meta)).toBe(32)
  })

  test('all pan positions round-trip', () => {
    for (let display = -32; display <= 32; display++) {
      const hex = displayToHex(display, meta)
      expect(hexToDisplay(hex, meta)).toBe(display)
    }
  })

  test('formatPan produces L/R suffixes', () => {
    expect(formatPan(0)).toBe('0')
    expect(formatPan(-16)).toBe('16L')
    expect(formatPan(16)).toBe('16R')
    expect(formatPan(-32)).toBe('32L')
    expect(formatPan(32)).toBe('32R')
  })
})

describe('envelope parameter metadata', () => {
  test('all four envelope stages are unipolar 0..50', () => {
    for (const stage of ['attack', 'decay', 'sustain', 'release'] as const) {
      const meta = ENVELOPE_PARAM_META[stage]
      expect(meta.min).toBe(0)
      expect(meta.max).toBe(50)
      expect(meta.formatter).toBe('unipolar')
    }
  })

  test('envelope sustain default is max (0x7FFFFFFF)', () => {
    expect(hexToDisplay(ENVELOPE_PARAM_META.sustain.default, ENVELOPE_PARAM_META.sustain)).toBe(50)
  })

  test('envelope attack/decay/release default to min (0x80000000)', () => {
    for (const stage of ['attack', 'decay', 'release'] as const) {
      const meta = ENVELOPE_PARAM_META[stage]
      expect(hexToDisplay(meta.default, meta)).toBe(0)
    }
  })
})

describe('parameter metadata defaults', () => {
  test('volume default maps to display 40', () => {
    const meta = PARAM_META.volume
    expect(hexToDisplay(meta.default, meta)).toBe(40)
  })

  test('lpfFrequency default is full-open (50)', () => {
    const meta = PARAM_META.lpfFrequency
    expect(hexToDisplay(meta.default, meta)).toBe(50)
  })

  test('hpfFrequency default is closed (0)', () => {
    const meta = PARAM_META.hpfFrequency
    expect(hexToDisplay(meta.default, meta)).toBe(0)
  })

  test('oscAVolume defaults to full (50), oscBVolume to off (0)', () => {
    expect(hexToDisplay(PARAM_META.oscAVolume.default, PARAM_META.oscAVolume)).toBe(50)
    expect(hexToDisplay(PARAM_META.oscBVolume.default, PARAM_META.oscBVolume)).toBe(0)
  })

  test('pan default is center (0)', () => {
    const meta = PARAM_META.pan
    expect(hexToDisplay(meta.default, meta)).toBe(0)
  })

  test('every parameter default is a valid hex string', () => {
    const check = (meta: ParamMeta) => {
      expect(meta.default).toMatch(/^0x[0-9A-Fa-f]{8}$/)
    }
    for (const meta of Object.values(PARAM_META)) check(meta)
    for (const meta of Object.values(ENVELOPE_PARAM_META)) check(meta)
    check(PATCH_CABLE_AMOUNT_META)
  })
})

describe('exhaustive hex round-trip across all params', () => {
  test('every parameter supports full display-range round-trip', () => {
    for (const [key, meta] of Object.entries(PARAM_META)) {
      for (let display = meta.min; display <= meta.max; display++) {
        const hex = displayToHex(display, meta)
        const back = hexToDisplay(hex, meta)
        if (back !== display) {
          throw new Error(
            `Round-trip failed for ${key}: ${display} → ${hex} → ${back}`,
          )
        }
      }
    }
  })
})
