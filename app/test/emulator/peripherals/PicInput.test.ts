import { describe, test, expect } from 'vitest'
import {
  encodePadByte,
  encodePadPress,
  encodePadRelease,
  decodePadByte,
  encodeButtonByte,
  encodeButtonPress,
  encodeButtonRelease,
  DELUGE_BUTTONS,
  PIC_RESPONSE_NEXT_PAD_OFF,
  PIC_PAD_MAX,
} from '@/lib/emulator/peripherals/PicInput'

describe('encodePadByte / decodePadByte round-trip', () => {
  test('matches Pad::toChar() formula for corner pads', () => {
    expect(encodePadByte(0, 0)).toBe(0)
    expect(encodePadByte(1, 0)).toBe(72) // odd x → +72
    expect(encodePadByte(2, 0)).toBe(1)
    expect(encodePadByte(0, 7)).toBe(63) // 9*7
    expect(encodePadByte(15, 7)).toBe(63 + 7 + 72) // 9*7 + 7 + 72 = 142
  })

  test('sidebar columns encode correctly', () => {
    expect(encodePadByte(16, 0)).toBe(8)
    expect(encodePadByte(17, 0)).toBe(8 + 72)
  })

  test('round-trip every (x, y)', () => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 18; x++) {
        const b = encodePadByte(x, y)
        expect(b).toBeLessThan(PIC_PAD_MAX)
        const decoded = decodePadByte(b)
        expect(decoded).toEqual({ x, y })
      }
    }
  })

  test('decode rejects bytes ≥ 144', () => {
    expect(decodePadByte(144)).toBeNull()
    expect(decodePadByte(252)).toBeNull()
  })
})

describe('encodePadPress / encodePadRelease', () => {
  test('press is single pad byte', () => {
    expect(encodePadPress(3, 4)).toEqual([encodePadByte(3, 4)])
  })

  test('release is NEXT_PAD_OFF + pad byte', () => {
    const bytes = encodePadRelease(3, 4)
    expect(bytes).toHaveLength(2)
    expect(bytes[0]).toBe(PIC_RESPONSE_NEXT_PAD_OFF)
    expect(bytes[1]).toBe(encodePadByte(3, 4))
  })
})

describe('encodeButtonByte — firmware formula 9*(y+16)+x', () => {
  test('PLAY is (8, 3) → 179', () => {
    expect(DELUGE_BUTTONS.PLAY).toBe(179)
  })
  test('SHIFT is (8, 0) → 152', () => {
    expect(DELUGE_BUTTONS.SHIFT).toBe(152)
  })
  test('RECORD is (8, 2) → 170', () => {
    expect(DELUGE_BUTTONS.RECORD).toBe(170)
  })
  test('Y_ENC (0,0) is 144', () => {
    expect(DELUGE_BUTTONS.Y_ENC).toBe(144)
  })
  test('every named button in 144..179', () => {
    for (const [name, byte] of Object.entries(DELUGE_BUTTONS)) {
      expect(byte).toBeGreaterThanOrEqual(144)
      expect(byte).toBeLessThanOrEqual(179)
      void name
    }
  })
  test('x out of range throws', () => {
    expect(() => encodeButtonByte(9, 0)).toThrow()
  })
  test('y out of range throws', () => {
    expect(() => encodeButtonByte(0, 4)).toThrow()
  })
})

describe('encodeButtonPress / encodeButtonRelease', () => {
  test('PLAY press is single byte 179', () => {
    expect(encodeButtonPress('PLAY')).toEqual([179])
  })
  test('PLAY release is [252, 179]', () => {
    expect(encodeButtonRelease('PLAY')).toEqual([
      PIC_RESPONSE_NEXT_PAD_OFF,
      179,
    ])
  })
  test('unknown button throws', () => {
    expect(() => encodeButtonPress('NOPE')).toThrow()
  })
})

describe('out-of-range inputs throw', () => {
  test('y ≥ 8 throws', () => {
    expect(() => encodePadByte(0, 8)).toThrow()
  })
  test('x ≥ 18 throws', () => {
    expect(() => encodePadByte(18, 0)).toThrow()
  })
  test('negative coords throw', () => {
    expect(() => encodePadByte(-1, 0)).toThrow()
    expect(() => encodePadByte(0, -1)).toThrow()
  })
})
