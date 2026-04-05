import { describe, test, expect, vi } from 'vitest'
import {
  RspiStub,
  RSPI_BASE_ADDR,
  RSPI_CHANNEL_STRIDE,
  RSPI_CHANNEL_COUNT,
  RSPI_STATUS_BITS,
} from '@/lib/emulator/peripherals/rspi'

// RZ/A1L hardware manual chapter 16. Each RSPI channel lives at
// 0xE800C800 + 0x800 * n. Register offsets within a channel are fixed.
const OFF_SPCR = 0x00
const OFF_SPSR = 0x03
const OFF_SPDR = 0x04
const OFF_SPBR = 0x0a
const OFF_SPDCR = 0x0b
const OFF_SPCMD0 = 0x10
const OFF_SPBFDR = 0x22

function offsetForChannel(channel: number, reg: number): number {
  return channel * RSPI_CHANNEL_STRIDE + reg
}

describe('RspiStub reset values', () => {
  test('SPSR resets to 0x60 (TEND+SPTEF)', () => {
    const r = new RspiStub()
    for (let ch = 0; ch < RSPI_CHANNEL_COUNT; ch++) {
      expect(r.read8(offsetForChannel(ch, OFF_SPSR))).toBe(
        RSPI_STATUS_BITS.TEND | RSPI_STATUS_BITS.SPTEF,
      )
    }
  })

  test('SPBR resets to 0xFF', () => {
    const r = new RspiStub()
    for (let ch = 0; ch < RSPI_CHANNEL_COUNT; ch++) {
      expect(r.read8(offsetForChannel(ch, OFF_SPBR))).toBe(0xff)
    }
  })

  test('SPDCR resets to 0x20', () => {
    const r = new RspiStub()
    expect(r.read8(offsetForChannel(0, OFF_SPDCR))).toBe(0x20)
    expect(r.read8(offsetForChannel(3, OFF_SPDCR))).toBe(0x20)
  })

  test('SPCMD0..3 reset to 0x070D', () => {
    const r = new RspiStub()
    expect(r.read16(offsetForChannel(0, OFF_SPCMD0))).toBe(0x070d)
    expect(r.read16(offsetForChannel(0, OFF_SPCMD0 + 2))).toBe(0x070d)
    expect(r.read16(offsetForChannel(0, OFF_SPCMD0 + 4))).toBe(0x070d)
    expect(r.read16(offsetForChannel(0, OFF_SPCMD0 + 6))).toBe(0x070d)
  })

  test('SPCR, SSLP, SPPCR, SPBFDR all reset to 0', () => {
    const r = new RspiStub()
    expect(r.read8(offsetForChannel(0, OFF_SPCR))).toBe(0)
    expect(r.read8(offsetForChannel(0, 0x01))).toBe(0)
    expect(r.read8(offsetForChannel(0, 0x02))).toBe(0)
    expect(r.read16(offsetForChannel(0, OFF_SPBFDR))).toBe(0)
  })

  test('base address and size cover all 5 channels', () => {
    const r = new RspiStub()
    expect(r.baseAddr).toBe(RSPI_BASE_ADDR)
    expect(r.baseAddr).toBe(0xe800c800)
    expect(r.size).toBe(5 * 0x800)
  })
})

describe('Channel independence', () => {
  test('writing SPCR on channel 0 does not touch channel 2', () => {
    const r = new RspiStub()
    r.write8(offsetForChannel(0, OFF_SPCR), 0x40)
    expect(r.read8(offsetForChannel(0, OFF_SPCR))).toBe(0x40)
    expect(r.read8(offsetForChannel(2, OFF_SPCR))).toBe(0x00)
  })
})

describe('SPDR transmit loopback', () => {
  test('read after byte write returns the written byte', () => {
    const r = new RspiStub()
    r.write8(offsetForChannel(0, OFF_SPDR), 0xa5)
    expect(r.read8(offsetForChannel(0, OFF_SPDR))).toBe(0xa5)
  })

  test('SPRF bit is set after a transmit', () => {
    const r = new RspiStub()
    r.write8(offsetForChannel(0, OFF_SPDR), 0x33)
    const spsr = r.read8(offsetForChannel(0, OFF_SPSR))
    expect(spsr & RSPI_STATUS_BITS.SPRF).toBeTruthy()
  })

  test('onTransmit callback fires with channel and byte', () => {
    const r = new RspiStub()
    const cb = vi.fn()
    r.onTransmit(cb)
    r.write8(offsetForChannel(1, OFF_SPDR), 0x77)
    expect(cb).toHaveBeenCalledWith(1, 0x77)
  })

  test('16-bit SPDR write emits two bytes, low first', () => {
    const r = new RspiStub()
    const cb = vi.fn()
    r.onTransmit(cb)
    r.write16(offsetForChannel(0, OFF_SPDR), 0xbeef)
    expect(cb).toHaveBeenNthCalledWith(1, 0, 0xef)
    expect(cb).toHaveBeenNthCalledWith(2, 0, 0xbe)
  })

  test('32-bit SPDR write emits four bytes, LSB first', () => {
    const r = new RspiStub()
    const cb = vi.fn()
    r.onTransmit(cb)
    r.write32(offsetForChannel(0, OFF_SPDR), 0x11223344)
    expect(cb).toHaveBeenNthCalledWith(1, 0, 0x44)
    expect(cb).toHaveBeenNthCalledWith(2, 0, 0x33)
    expect(cb).toHaveBeenNthCalledWith(3, 0, 0x22)
    expect(cb).toHaveBeenNthCalledWith(4, 0, 0x11)
  })
})

describe('clearStatus', () => {
  test('clearing SPRF after a transmit', () => {
    const r = new RspiStub()
    r.write8(offsetForChannel(0, OFF_SPDR), 0x10)
    expect(r.read8(offsetForChannel(0, OFF_SPSR)) & RSPI_STATUS_BITS.SPRF).toBeTruthy()
    r.clearStatus(0, RSPI_STATUS_BITS.SPRF)
    expect(r.read8(offsetForChannel(0, OFF_SPSR)) & RSPI_STATUS_BITS.SPRF).toBe(0)
  })
})

describe('reset returns to power-on state', () => {
  test('clears SPDR state and restores SPSR', () => {
    const r = new RspiStub()
    r.write8(offsetForChannel(0, OFF_SPDR), 0xff)
    r.write8(offsetForChannel(0, OFF_SPCR), 0x55)
    r.reset()
    expect(r.read8(offsetForChannel(0, OFF_SPCR))).toBe(0)
    expect(r.read8(offsetForChannel(0, OFF_SPSR))).toBe(
      RSPI_STATUS_BITS.TEND | RSPI_STATUS_BITS.SPTEF,
    )
    expect(r.read8(offsetForChannel(0, OFF_SPDR))).toBe(0)
  })
})
