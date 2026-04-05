import { describe, test, expect, vi } from 'vitest'
import {
  ScifStub,
  SCIF_BASE_ADDR,
  SCIF_CHANNEL_STRIDE,
  SCIF_CHANNEL_COUNT,
  SCIF_REG_OFFSETS,
  SCIF_STATUS_BITS,
} from '@/lib/emulator/peripherals/scif'

function offsetForChannel(channel: number, reg: number): number {
  return channel * SCIF_CHANNEL_STRIDE + reg
}

describe('ScifStub reset values', () => {
  test('base and size cover 8 channels', () => {
    const s = new ScifStub()
    expect(s.baseAddr).toBe(SCIF_BASE_ADDR)
    expect(s.baseAddr).toBe(0xe8007000)
    expect(s.size).toBe(8 * 0x800)
    expect(SCIF_CHANNEL_COUNT).toBe(8)
  })

  test('SCFSR resets with TDFE+TEND set', () => {
    const s = new ScifStub()
    for (let ch = 0; ch < SCIF_CHANNEL_COUNT; ch++) {
      const v = s.read16(offsetForChannel(ch, SCIF_REG_OFFSETS.SCFSR))
      expect(v & SCIF_STATUS_BITS.TDFE).toBeTruthy()
      expect(v & SCIF_STATUS_BITS.TEND).toBeTruthy()
    }
  })

  test('SCBRR resets to 0xFF', () => {
    const s = new ScifStub()
    expect(s.read8(offsetForChannel(1, SCIF_REG_OFFSETS.SCBRR))).toBe(0xff)
  })
})

describe('FTDR transmit', () => {
  test('write8 to FTDR fires onTransmit with channel+byte', () => {
    const s = new ScifStub()
    const cb = vi.fn()
    s.onTransmit(cb)
    s.write8(offsetForChannel(1, SCIF_REG_OFFSETS.FTDR), 0x5a)
    expect(cb).toHaveBeenCalledWith(1, 0x5a)
  })

  test('FTDR is write-only (reads return 0)', () => {
    const s = new ScifStub()
    s.write8(offsetForChannel(1, SCIF_REG_OFFSETS.FTDR), 0xab)
    expect(s.read8(offsetForChannel(1, SCIF_REG_OFFSETS.FTDR))).toBe(0)
  })

  test('each channel has its own FTDR', () => {
    const s = new ScifStub()
    const cb = vi.fn()
    s.onTransmit(cb)
    s.write8(offsetForChannel(0, SCIF_REG_OFFSETS.FTDR), 0x11)
    s.write8(offsetForChannel(1, SCIF_REG_OFFSETS.FTDR), 0x22)
    s.write8(offsetForChannel(7, SCIF_REG_OFFSETS.FTDR), 0x33)
    expect(cb).toHaveBeenNthCalledWith(1, 0, 0x11)
    expect(cb).toHaveBeenNthCalledWith(2, 1, 0x22)
    expect(cb).toHaveBeenNthCalledWith(3, 7, 0x33)
  })
})

describe('SCIF other registers are writable', () => {
  test('SCSCR accepts a 16-bit write', () => {
    const s = new ScifStub()
    s.write16(offsetForChannel(1, SCIF_REG_OFFSETS.SCSCR), 0x00f0)
    expect(s.read16(offsetForChannel(1, SCIF_REG_OFFSETS.SCSCR))).toBe(0x00f0)
  })

  test('SCSMR accepts a 16-bit write', () => {
    const s = new ScifStub()
    s.write16(offsetForChannel(1, SCIF_REG_OFFSETS.SCSMR), 0x0002)
    expect(s.read16(offsetForChannel(1, SCIF_REG_OFFSETS.SCSMR))).toBe(0x0002)
  })
})

describe('reset', () => {
  test('restores channel registers to power-on values', () => {
    const s = new ScifStub()
    s.write16(offsetForChannel(1, SCIF_REG_OFFSETS.SCFSR), 0)
    s.write8(offsetForChannel(1, SCIF_REG_OFFSETS.SCBRR), 0)
    s.reset()
    const fsr = s.read16(offsetForChannel(1, SCIF_REG_OFFSETS.SCFSR))
    expect(fsr & SCIF_STATUS_BITS.TEND).toBeTruthy()
    expect(s.read8(offsetForChannel(1, SCIF_REG_OFFSETS.SCBRR))).toBe(0xff)
  })
})
