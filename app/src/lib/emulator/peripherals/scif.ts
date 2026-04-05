// SCIF (Serial Communication Interface with FIFO / SCIFA) peripheral stub.
//
// The RZ/A1L has 8 SCIF channels (chapter 17 of the hardware manual). The
// Deluge wires UART channel 1 to the PIC microcontroller (which drives the
// pad grid RGB LEDs, indicator LEDs, 7-seg display and button matrix) and
// UART channel 0 to MIDI in/out.
//
// Channel base addresses (iodefine):
//   SCIF0  0xE8007000
//   SCIF1  0xE8007800  ← PIC UART on Deluge
//   SCIF2  0xE8008000
//   SCIF3  0xE8008800
//   SCIF4  0xE8009000
//   SCIF5  0xE8009800
//   SCIF6  0xE800A000
//   SCIF7  0xE800A800
//
// Per-channel register layout (from the iodefine struct):
//   0x00  SCSMR   16-bit RW  Serial mode
//   0x04  SCBRR    8-bit RW  Bit rate
//   0x08  SCSCR   16-bit RW  Serial control
//   0x0C  FTDR     8-bit WO  Transmit FIFO data   ← PIC bytes go here
//   0x10  SCFSR   16-bit RW  Serial status
//   0x14  SCFRDR   8-bit RO  Receive FIFO data
//   0x18  SCFCR   16-bit RW  FIFO control
//   0x1C  SCFDR   16-bit R   FIFO data count
//   0x20  SCSPTR  16-bit RW  Serial port
//   0x24  SCLSR   16-bit RW  Line status
//   0x28  SCEMR   16-bit RW  Extension mode
//
// SCFSR status bits relevant for TX polling (table 17.7):
//   bit 5 TDFE  — transmit FIFO data-empty flag
//   bit 6 TEND  — transmission-end flag

import { BasePeripheralStub } from './PeripheralStub'

/** Per-channel transmit callback: one byte written to FTDR on `channel`. */
export type ScifTxCallback = (channel: number, byte: number) => void

const OFF_SCSMR = 0x00
const OFF_SCBRR = 0x04
const OFF_SCSCR = 0x08
const OFF_FTDR = 0x0c
const OFF_SCFSR = 0x10
const OFF_SCFRDR = 0x14
const OFF_SCFCR = 0x18
const OFF_SCFDR = 0x1c
const OFF_SCSPTR = 0x20
const OFF_SCLSR = 0x24
const OFF_SCEMR = 0x28

const CHANNEL_STRIDE = 0x800
const CHANNEL_COUNT = 8
const SCIF_BASE = 0xe8007000

// SCFSR bits
const SCFSR_TDFE = 1 << 5
const SCFSR_TEND = 1 << 6

export class ScifStub extends BasePeripheralStub {
  readonly name = 'SCIF'
  readonly baseAddr = SCIF_BASE
  readonly size = CHANNEL_STRIDE * CHANNEL_COUNT

  private txCallback: ScifTxCallback | null = null
  /** Per-channel RX byte queues. Populated by enqueueRx(), drained by
   *  read8() at SCFRDR offset when the DMAC pump reads the channel. */
  private rxQueues: number[][] = Array.from({ length: CHANNEL_COUNT }, () => [])

  constructor() {
    super()
    this.reset()
  }

  /** Subscribe to FTDR byte transmits. Replaces any previous listener. */
  onTransmit(cb: ScifTxCallback | null): void {
    this.txCallback = cb
  }

  private channelOf(offset: number): { channel: number; localOff: number } {
    const channel = Math.floor(offset / CHANNEL_STRIDE)
    return { channel, localOff: offset - channel * CHANNEL_STRIDE }
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  read8(offset: number): number {
    const { channel, localOff } = this.channelOf(offset)
    if (localOff === OFF_FTDR) return 0 // write-only
    // Reading SCFRDR pops one byte from the per-channel RX FIFO. This is
    // how the DMAC pump picks up simulated PIC responses when the
    // firmware's RX DMA reads from this register.
    if (localOff === OFF_SCFRDR) {
      const q = this.rxQueues[channel]
      if (q.length === 0) return 0
      return q.shift()! & 0xff
    }
    return super.read8(offset)
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  write8(offset: number, value: number): void {
    super.write8(offset, value)
    const { channel, localOff } = this.channelOf(offset)
    if (localOff === OFF_FTDR) {
      this.emitTx(channel, value & 0xff)
    }
  }

  write16(offset: number, value: number): void {
    super.write16(offset, value)
    const { channel, localOff } = this.channelOf(offset)
    // Halfword access to FTDR: lower byte = the TX byte.
    if (localOff === OFF_FTDR) this.emitTx(channel, value & 0xff)
  }

  write32(offset: number, value: number): void {
    super.write32(offset, value)
    const { channel, localOff } = this.channelOf(offset)
    if (localOff === OFF_FTDR) this.emitTx(channel, value & 0xff)
  }

  private emitTx(channel: number, byte: number): void {
    if (channel < 0 || channel >= CHANNEL_COUNT) return
    // Keep TEND+TDFE high so firmware never blocks on "TX FIFO full".
    const fsrOff = channel * CHANNEL_STRIDE + OFF_SCFSR
    const current = super.read16(fsrOff)
    super.write16(fsrOff, (current | SCFSR_TDFE | SCFSR_TEND) & 0xffff)
    if (this.txCallback) this.txCallback(channel, byte)
  }

  /** Push a byte onto the channel's RX FIFO. Pulled out by the DMAC pump
   *  on the next read of SCFRDR. */
  enqueueRx(channel: number, byte: number): void {
    if (channel < 0 || channel >= CHANNEL_COUNT) return
    this.rxQueues[channel].push(byte & 0xff)
  }

  /** How many bytes are waiting in a channel's RX FIFO (test hook). */
  rxQueueLength(channel: number): number {
    return this.rxQueues[channel]?.length ?? 0
  }

  reset(): void {
    super.reset()
    for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
      const base = ch * CHANNEL_STRIDE
      super.write16(base + OFF_SCFSR, SCFSR_TDFE | SCFSR_TEND)
      super.write8(base + OFF_SCBRR, 0xff)
      if (this.rxQueues[ch]) this.rxQueues[ch].length = 0
    }
  }
}

export const SCIF_REG_OFFSETS = {
  SCSMR: OFF_SCSMR,
  SCBRR: OFF_SCBRR,
  SCSCR: OFF_SCSCR,
  FTDR: OFF_FTDR,
  SCFSR: OFF_SCFSR,
  SCFRDR: OFF_SCFRDR,
  SCFCR: OFF_SCFCR,
  SCFDR: OFF_SCFDR,
  SCSPTR: OFF_SCSPTR,
  SCLSR: OFF_SCLSR,
  SCEMR: OFF_SCEMR,
} as const

export const SCIF_STATUS_BITS = {
  TDFE: SCFSR_TDFE,
  TEND: SCFSR_TEND,
} as const

export const SCIF_BASE_ADDR = SCIF_BASE
export const SCIF_CHANNEL_COUNT = CHANNEL_COUNT
export const SCIF_CHANNEL_STRIDE = CHANNEL_STRIDE
