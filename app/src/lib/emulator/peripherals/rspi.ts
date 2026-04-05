// RSPI (Renesas Serial Peripheral Interface) peripheral stub.
//
// The RZ/A1L has five RSPI channels (chapter 16 of the hardware manual
// R01UH0437EJ). Deluge firmware uses RSPI0 for both the OLED display and
// the CV DAC — the destination is distinguished by D/C GPIO state plus
// a PIC-side signal, not by the SPI channel.
//
// Channel base addresses (table 16.1):
//   RSPI0  0xE800C800
//   RSPI1  0xE800D000
//   RSPI2  0xE800D800
//   RSPI3  0xE800E000
//   RSPI4  0xE800E800
//
// Per-channel register map (from the iodefine struct — matches chapter 16):
//   0x00  SPCR    8-bit RW, reset 0x00 — Control
//   0x01  SSLP    8-bit RW, reset 0x00 — Slave-Select Polarity
//   0x02  SPPCR   8-bit RW, reset 0x00 — Pin Control
//   0x03  SPSR    8-bit RW, reset 0x60 — Status (bit 7 SPRF, 6 TEND, 5 SPTEF,
//                                        2 MODF, 0 OVRF)
//   0x04  SPDR   32-bit RW — Data Register (8/16/32-bit access)
//   0x08  SPSCR   8-bit RW, reset 0x00
//   0x09  SPSSR   8-bit RO, reset 0x00
//   0x0A  SPBR    8-bit RW, reset 0xFF — Bit-Rate
//   0x0B  SPDCR   8-bit RW, reset 0x20 — Data-Control (frame length, direction)
//   0x0C  SPCKD   8-bit RW, reset 0x00
//   0x0D  SSLND   8-bit RW, reset 0x00
//   0x0E  SPND    8-bit RW, reset 0x00
//   0x10  SPCMD0 16-bit RW, reset 0x070D
//   0x12  SPCMD1 16-bit RW, reset 0x070D
//   0x14  SPCMD2 16-bit RW, reset 0x070D
//   0x16  SPCMD3 16-bit RW, reset 0x070D
//   0x20  SPBFCR  8-bit RW, reset 0x00 — Buffer Control
//   0x22  SPBFDR 16-bit RO, reset 0x0000 — Buffer Data Count
//
// Firmware accesses SPDR one byte at a time (SPDR.BYTE.LL) for 8-bit SPI
// transactions. After each write it busy-waits on SPSR.SPRF, so the stub
// sets SPRF=1 immediately and loops back the transmitted byte so the
// firmware can read it back.

import { BasePeripheralStub } from './PeripheralStub'

/** Byte-level transmit callback: called for each byte written to SPDR.BYTE.LL. */
export type RspiTxCallback = (channel: number, byte: number) => void

// SPSR bits
const SPSR_OVRF = 1 << 0
const SPSR_MODF = 1 << 2
const SPSR_SPTEF = 1 << 5
const SPSR_TEND = 1 << 6
const SPSR_SPRF = 1 << 7

// Per-channel offsets
const OFF_SPCR = 0x00
const OFF_SSLP = 0x01
const OFF_SPPCR = 0x02
const OFF_SPSR = 0x03
const OFF_SPDR = 0x04
const OFF_SPSCR = 0x08
const OFF_SPSSR = 0x09
const OFF_SPBR = 0x0a
const OFF_SPDCR = 0x0b
const OFF_SPCKD = 0x0c
const OFF_SSLND = 0x0d
const OFF_SPND = 0x0e
const OFF_SPCMD0 = 0x10
const OFF_SPCMD1 = 0x12
const OFF_SPCMD2 = 0x14
const OFF_SPCMD3 = 0x16
const OFF_SPBFCR = 0x20
const OFF_SPBFDR = 0x22

const CHANNEL_STRIDE = 0x800
const CHANNEL_COUNT = 5
const RSPI_BASE = 0xe800c800

/** Snapshot of reset values for one channel, keyed by offset. */
function makeChannelResetMap(): Map<number, number> {
  return new Map<number, number>([
    [OFF_SPCR, 0x00],
    [OFF_SSLP, 0x00],
    [OFF_SPPCR, 0x00],
    [OFF_SPSR, SPSR_TEND | SPSR_SPTEF], // 0x60 — transmit end + transmit buffer empty
    [OFF_SPDR, 0x00000000],
    [OFF_SPSCR, 0x00],
    [OFF_SPSSR, 0x00],
    [OFF_SPBR, 0xff],
    [OFF_SPDCR, 0x20],
    [OFF_SPCKD, 0x00],
    [OFF_SSLND, 0x00],
    [OFF_SPND, 0x00],
    [OFF_SPCMD0, 0x070d],
    [OFF_SPCMD1, 0x070d],
    [OFF_SPCMD2, 0x070d],
    [OFF_SPCMD3, 0x070d],
    [OFF_SPBFCR, 0x00],
    [OFF_SPBFDR, 0x0000],
  ])
}

export class RspiStub extends BasePeripheralStub {
  readonly name = 'RSPI'
  readonly baseAddr = RSPI_BASE
  // 5 channels × 0x800 stride = 0x2800. Round up to 0x2800.
  readonly size = CHANNEL_STRIDE * CHANNEL_COUNT

  private txCallback: RspiTxCallback | null = null
  /** Last byte written to SPDR on each channel, used for loopback. */
  private lastTxByte: number[] = new Array<number>(CHANNEL_COUNT).fill(0)

  constructor() {
    super()
    this.reset()
  }

  onTransmit(cb: RspiTxCallback | null): void {
    this.txCallback = cb
  }

  reset(): void {
    super.reset()
    this.lastTxByte = new Array<number>(CHANNEL_COUNT).fill(0)
    // Apply the documented reset pattern to every channel.
    for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
      const base = ch * CHANNEL_STRIDE
      for (const [off, value] of makeChannelResetMap()) {
        this.writeResetValue(base + off, value, off)
      }
    }
  }

  private writeResetValue(offset: number, value: number, localOff: number): void {
    // Width depends on which register.
    if (
      localOff === OFF_SPCMD0 ||
      localOff === OFF_SPCMD1 ||
      localOff === OFF_SPCMD2 ||
      localOff === OFF_SPCMD3 ||
      localOff === OFF_SPBFDR
    ) {
      super.write16(offset, value & 0xffff)
    } else if (localOff === OFF_SPDR) {
      super.write32(offset, value >>> 0)
    } else {
      super.write8(offset, value & 0xff)
    }
  }

  private channelOf(offset: number): { channel: number; localOff: number } {
    const channel = Math.floor(offset / CHANNEL_STRIDE)
    const localOff = offset - channel * CHANNEL_STRIDE
    return { channel, localOff }
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  read8(offset: number): number {
    const { channel, localOff } = this.channelOf(offset)
    if (localOff >= OFF_SPDR && localOff < OFF_SPDR + 4) {
      // Reading a byte from SPDR returns the loopback byte (OLED is
      // write-only but firmware reads back to release the SPI engine).
      if (localOff === OFF_SPDR) return this.lastTxByte[channel] & 0xff
      // Higher bytes of SPDR — mirror the same byte for simplicity.
      return this.lastTxByte[channel] & 0xff
    }
    return super.read8(offset)
  }

  read16(offset: number): number {
    const { channel, localOff } = this.channelOf(offset)
    if (localOff === OFF_SPDR) {
      const b = this.lastTxByte[channel] & 0xff
      return (b | (b << 8)) & 0xffff
    }
    return super.read16(offset)
  }

  read32(offset: number): number {
    const { channel, localOff } = this.channelOf(offset)
    if (localOff === OFF_SPDR) {
      const b = this.lastTxByte[channel] & 0xff
      return (b | (b << 8) | (b << 16) | (b << 24)) >>> 0
    }
    return super.read32(offset)
  }

  // ---------------------------------------------------------------------------
  // Writes — capture SPDR transmits
  // ---------------------------------------------------------------------------

  write8(offset: number, value: number): void {
    super.write8(offset, value)
    const { channel, localOff } = this.channelOf(offset)
    // SPDR byte access. BYTE.LL = offset 0x04 (little-endian). Deluge
    // firmware writes the data byte through SPDR.BYTE.LL (= SPDR+0).
    if (localOff === OFF_SPDR) {
      this.emitTx(channel, value & 0xff)
    }
  }

  write16(offset: number, value: number): void {
    super.write16(offset, value)
    const { channel, localOff } = this.channelOf(offset)
    if (localOff === OFF_SPDR) {
      // 16-bit TX: low byte goes out first.
      this.emitTx(channel, value & 0xff)
      this.emitTx(channel, (value >>> 8) & 0xff)
    }
  }

  write32(offset: number, value: number): void {
    super.write32(offset, value)
    const { channel, localOff } = this.channelOf(offset)
    if (localOff === OFF_SPDR) {
      // 32-bit TX: four bytes from LSB upward.
      this.emitTx(channel, value & 0xff)
      this.emitTx(channel, (value >>> 8) & 0xff)
      this.emitTx(channel, (value >>> 16) & 0xff)
      this.emitTx(channel, (value >>> 24) & 0xff)
    }
  }

  private emitTx(channel: number, byte: number): void {
    if (channel < 0 || channel >= CHANNEL_COUNT) return
    this.lastTxByte[channel] = byte
    // Mark SPSR.SPRF so the firmware's busy-wait loop exits immediately.
    const spsrOffset = channel * CHANNEL_STRIDE + OFF_SPSR
    const current = super.read8(spsrOffset)
    super.write8(spsrOffset, (current | SPSR_SPRF | SPSR_TEND) & 0xff)
    if (this.txCallback) this.txCallback(channel, byte)
  }

  /** Clear transient SPSR bits on the given channel (e.g. by error handlers). */
  clearStatus(channel: number, mask: number): void {
    if (channel < 0 || channel >= CHANNEL_COUNT) return
    const offset = channel * CHANNEL_STRIDE + OFF_SPSR
    const current = super.read8(offset)
    super.write8(offset, (current & ~mask) & 0xff)
  }
}

export const RSPI_STATUS_BITS = {
  OVRF: SPSR_OVRF,
  MODF: SPSR_MODF,
  SPTEF: SPSR_SPTEF,
  TEND: SPSR_TEND,
  SPRF: SPSR_SPRF,
} as const

export const RSPI_CHANNEL_COUNT = CHANNEL_COUNT
export const RSPI_CHANNEL_STRIDE = CHANNEL_STRIDE
export const RSPI_BASE_ADDR = RSPI_BASE
