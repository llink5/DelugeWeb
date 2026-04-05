// SSI (Serial Sound Interface) peripheral with audio capture.
//
// The RZ/A1L has 10 SSI peripherals. The Deluge firmware feeds PCM samples
// into one of them — the physical wiring selects a specific channel at boot,
// but since we only need to observe what the firmware writes, we can pool
// all SSI register blocks into one stub that covers the full SSI window.
//
// Register layout (per-channel, 0x40 stride):
//   0x00 SSICR   — control
//   0x04 SSISR   — status (reports TX FIFO ready)
//   0x08 SSITDR  — transmit data (16-bit PCM sample)
//   0x0C SSIRDR  — receive data
//   0x10 SSIFCR  — FIFO control
//   0x14 SSIFSR  — FIFO status
//   0x18 SSIFTDR — FIFO transmit data (equivalent to SSITDR for audio out)
//   0x1C SSIFRDR — FIFO receive data
//
// SSI base: 0xE820B000 (SSIF0). Ten channels × 0x800 stride ends at
// 0xE820F000. We cover the whole 0x4000 window so every SSI write is seen.

import { BasePeripheralStub } from './PeripheralStub'

const TX_FULL = 1 << 0
const TX_EMPTY = 1 << 1
const RX_FULL = 1 << 4

/** Callback invoked with one 16-bit stereo frame (2 samples). */
export type SsiSampleCallback = (leftSample: number, rightSample: number) => void

export class SsiStub extends BasePeripheralStub {
  readonly name = 'SSI'
  readonly baseAddr = 0xe820b000
  readonly size = 0x4000 // 10 channels × 0x800 bytes = 0x5000, but actual HW reserves 0x4000

  private sampleCallback: SsiSampleCallback | null = null
  private pendingLeft: number | null = null
  /** Count of frames (L+R pairs) captured since reset. */
  private framesCaptured = 0

  constructor() {
    super()
    this.reset()
  }

  /** Subscribe to audio frames. Replaces any previous listener. */
  onSamples(callback: SsiSampleCallback | null): void {
    this.sampleCallback = callback
  }

  get capturedFrames(): number {
    return this.framesCaptured
  }

  reset(): void {
    super.reset()
    this.pendingLeft = null
    this.framesCaptured = 0
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  private offsetWithinChannel(offset: number): number {
    return offset & 0x3f
  }

  read32(offset: number): number {
    const local = this.offsetWithinChannel(offset)
    // Status regs should indicate "TX FIFO empty, ready to receive"
    if (local === 0x04 || local === 0x14) {
      return TX_EMPTY // FIFO empty → firmware knows it can write more
    }
    // All other reads return whatever was written (or 0)
    return super.read32(offset)
  }

  read16(offset: number): number {
    const local = this.offsetWithinChannel(offset)
    if (local === 0x04 || local === 0x14) return TX_EMPTY
    return super.read16(offset)
  }

  read8(offset: number): number {
    const local = this.offsetWithinChannel(offset)
    if (local === 0x04 || local === 0x14) return TX_EMPTY
    return super.read8(offset)
  }

  // ---------------------------------------------------------------------------
  // Writes — capture audio samples
  // ---------------------------------------------------------------------------

  write32(offset: number, value: number): void {
    const local = this.offsetWithinChannel(offset)
    super.write32(offset, value)
    // Deluge firmware writes one Int32 sample per DMA element, alternating
    // L then R (ssiTxBuffer = int32_t[N*2] with layout L0,R0,L1,R1,…).
    // Scale Int32 → Int16 by arithmetic shift right 16 for the AudioBridge.
    if (local === 0x08 || local === 0x18) {
      const s32 = (value | 0) >> 16 // arithmetic shift, Int16 range
      if (this.pendingLeft === null) {
        this.pendingLeft = s32
      } else {
        this.emitFrame(this.pendingLeft, s32)
        this.pendingLeft = null
      }
    }
  }

  write16(offset: number, value: number): void {
    const local = this.offsetWithinChannel(offset)
    super.write16(offset, value)
    // 16-bit TX write: successive L, R, L, R values. Pair them.
    if (local === 0x08 || local === 0x18) {
      const signed = signExtend16(value & 0xffff)
      if (this.pendingLeft === null) {
        this.pendingLeft = signed
      } else {
        this.emitFrame(this.pendingLeft, signed)
        this.pendingLeft = null
      }
    }
  }

  write8(offset: number, value: number): void {
    super.write8(offset, value)
    // Byte-level audio writes aren't expected — ignore.
    void offset
  }

  private emitFrame(left: number, right: number): void {
    this.framesCaptured++
    if (this.sampleCallback) {
      this.sampleCallback(left, right)
    }
  }
}

function signExtend16(v: number): number {
  return v & 0x8000 ? v - 0x10000 : v
}
