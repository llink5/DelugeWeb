// Direct Memory Access Controller.
//
// RZ/A1L Hardware Manual Rev. 7.00 (R01UH0437EJ0700)
//   Chapter 9 Direct Memory Access Controller — tables 9.2 and 9.4
//
// Base: 0xE8200000. Sixteen channels of 0x40 bytes each, for a 0x400 window.
// Each channel has:
//
//   offset  name     width  R/W  description
//   0x00    N0SA     32     RW   Next0 source address
//   0x04    N0DA     32     RW   Next0 destination address
//   0x08    N0TB     32     RW   Next0 transaction byte count
//   0x0C    N1SA     32     RW   Next1 source address
//   0x10    N1DA     32     RW   Next1 destination address
//   0x14    N1TB     32     RW   Next1 transaction byte count
//   0x18    CRSA     32     R    Current source address
//   0x1C    CRDA     32     R    Current destination address
//   0x20    CRTB     32     R    Current transaction byte count
//   0x24    CHSTAT   32     R    Channel status
//   0x28    CHCTRL   32     RW   Channel control
//   0x2C    CHCFG    32     RW   Channel configuration
//   0x30    CHITVL   32     RW   Channel interval
//   0x34    CHEXT    32     RW   Channel extension
//   0x38    NXLA     32     RW   Next link address
//   0x3C    CRLA     32     R    Current link address
//
// CHCTRL bit layout (table 9.3):
//   bit 0 SETEN       set channel-enabled
//   bit 1 CLREN       clear channel-enabled
//   bit 2 STG         start
//   bit 3 SWRST       software reset
//   bit 4 CLRRQ       clear request
//   bit 5 CLREND      clear end flag
//   bit 6 CLRTC       clear terminal count
//   bit 16 SETSUS     set suspend
//   bit 17 CLRSUS     clear suspend
//
// CHSTAT bit layout (table 9.3):
//   bit 0 EN          enabled
//   bit 1 RQST        request pending
//   bit 2 TACT        transaction active
//   bit 3 SUS         suspended
//   bit 4 ER          error
//   bit 5 END         transfer complete
//   bit 6 TC          terminal count
//   bit 7..15 reserved
//   bit 16 DER        descriptor error
//   bit 17..23 reserved
//   bit 24..31 DNUM   descriptor number

import { BasePeripheralStub } from './PeripheralStub'

/** Memory interface the DMAC pump uses to move bytes. */
export interface DmacMemoryAccessor {
  read8(addr: number): number
  read16(addr: number): number
  read32(addr: number): number
  write8(addr: number, value: number): void
  write16(addr: number, value: number): void
  write32(addr: number, value: number): void
}

/** Callback fired when a channel completes a transaction (CRTB → 0). */
export type DmacChannelEndCallback = (channel: number) => void

function readElement(
  mem: DmacMemoryAccessor,
  addr: number,
  widthBytes: number,
): number {
  if (widthBytes === 1) return mem.read8(addr) & 0xff
  if (widthBytes === 2) return mem.read16(addr) & 0xffff
  if (widthBytes === 4) return mem.read32(addr) >>> 0
  // 8-byte and wider: fall back to two 32-bit reads, take the low word.
  return mem.read32(addr) >>> 0
}

function writeElement(
  mem: DmacMemoryAccessor,
  addr: number,
  widthBytes: number,
  value: number,
): void {
  if (widthBytes === 1) {
    mem.write8(addr, value & 0xff)
    return
  }
  if (widthBytes === 2) {
    mem.write16(addr, value & 0xffff)
    return
  }
  if (widthBytes === 4) {
    mem.write32(addr, value >>> 0)
    return
  }
  mem.write32(addr, value >>> 0)
}

const DMAC_BASE = 0xe8200000
const DMAC_SIZE = 0x1000 // 0x400 for channels + 0x80 common + 0xB8 extension selectors
const NUM_CHANNELS = 16
const CHANNEL_STRIDE = 0x40

// Per-channel register offsets
const OFF_N0SA = 0x00
const OFF_N0DA = 0x04
const OFF_N0TB = 0x08
const OFF_N1SA = 0x0c
const OFF_N1DA = 0x10
const OFF_N1TB = 0x14
const OFF_CRSA = 0x18
const OFF_CRDA = 0x1c
const OFF_CRTB = 0x20
const OFF_CHSTAT = 0x24
const OFF_CHCTRL = 0x28
const OFF_CHCFG = 0x2c
const OFF_CHITVL = 0x30
const OFF_CHEXT = 0x34
const OFF_NXLA = 0x38
const OFF_CRLA = 0x3c

// CHCTRL bits
const CHCTRL_SETEN = 1 << 0
const CHCTRL_CLREN = 1 << 1
const CHCTRL_STG = 1 << 2
const CHCTRL_SWRST = 1 << 3
const CHCTRL_CLRRQ = 1 << 4
const CHCTRL_CLREND = 1 << 5
const CHCTRL_CLRTC = 1 << 6

// CHSTAT bits
const CHSTAT_EN = 1 << 0
const CHSTAT_TACT = 1 << 2
const CHSTAT_END = 1 << 5
const CHSTAT_TC = 1 << 6

interface ChannelState {
  // Current (read-only from software) registers
  crsa: number
  crda: number
  crtb: number
  chstat: number
  crla: number
  // Next-pair registers (software-programmable)
  n0sa: number
  n0da: number
  n0tb: number
  n1sa: number
  n1da: number
  n1tb: number
  // Configuration
  chcfg: number
  chitvl: number
  chext: number
  nxla: number
  // Internal: which next-pair is "current" — toggles after each transaction
  useN1: boolean
  // Internal: whether transfer is running
  running: boolean
}

function emptyChannel(): ChannelState {
  return {
    crsa: 0, crda: 0, crtb: 0, chstat: 0, crla: 0,
    n0sa: 0, n0da: 0, n0tb: 0, n1sa: 0, n1da: 0, n1tb: 0,
    chcfg: 0, chitvl: 0, chext: 0, nxla: 0,
    useN1: false, running: false,
  }
}

export class DmacStub extends BasePeripheralStub {
  readonly name = 'DMAC'
  readonly baseAddr = DMAC_BASE
  readonly size = DMAC_SIZE

  private readonly channels: ChannelState[] = []
  private endCallback: DmacChannelEndCallback | null = null

  constructor() {
    super()
    for (let i = 0; i < NUM_CHANNELS; i++) this.channels.push(emptyChannel())
  }

  /** Subscribe to transaction-end events. Fires when CRTB hits 0. */
  onChannelEnd(cb: DmacChannelEndCallback | null): void {
    this.endCallback = cb
  }

  reset(): void {
    super.reset()
    for (let i = 0; i < NUM_CHANNELS; i++) this.channels[i] = emptyChannel()
  }

  /** Test hook: inspect a channel's state. */
  getChannel(index: number): Readonly<ChannelState> | undefined {
    return this.channels[index]
  }

  /** True when the channel has been started and has transferable data. */
  isChannelRunning(index: number): boolean {
    const c = this.channels[index]
    return !!c && c.running
  }

  // ---------------------------------------------------------------------------
  // Channel address decoding
  // ---------------------------------------------------------------------------

  private channelForOffset(
    offset: number,
  ): { ch: ChannelState; local: number } | undefined {
    if (offset >= NUM_CHANNELS * CHANNEL_STRIDE) return undefined
    const idx = Math.floor(offset / CHANNEL_STRIDE)
    return { ch: this.channels[idx], local: offset % CHANNEL_STRIDE }
  }

  // ---------------------------------------------------------------------------
  // Reads — return the register's stored value
  // ---------------------------------------------------------------------------

  read32(offset: number): number {
    const c = this.channelForOffset(offset)
    if (!c) return 0
    switch (c.local) {
      case OFF_N0SA: return c.ch.n0sa >>> 0
      case OFF_N0DA: return c.ch.n0da >>> 0
      case OFF_N0TB: return c.ch.n0tb >>> 0
      case OFF_N1SA: return c.ch.n1sa >>> 0
      case OFF_N1DA: return c.ch.n1da >>> 0
      case OFF_N1TB: return c.ch.n1tb >>> 0
      case OFF_CRSA: return c.ch.crsa >>> 0
      case OFF_CRDA: return c.ch.crda >>> 0
      case OFF_CRTB: return c.ch.crtb >>> 0
      case OFF_CHSTAT: return c.ch.chstat >>> 0
      case OFF_CHCTRL: return 0 // CHCTRL is always read as 0 per manual
      case OFF_CHCFG: return c.ch.chcfg >>> 0
      case OFF_CHITVL: return c.ch.chitvl >>> 0
      case OFF_CHEXT: return c.ch.chext >>> 0
      case OFF_NXLA: return c.ch.nxla >>> 0
      case OFF_CRLA: return c.ch.crla >>> 0
      default: return 0
    }
  }

  read16(offset: number): number { return this.read32(offset) & 0xffff }
  read8(offset: number): number {
    const v = this.read32(offset & ~3)
    return (v >>> ((offset & 3) * 8)) & 0xff
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  write32(offset: number, value: number): void {
    const c = this.channelForOffset(offset)
    if (!c) return
    const v = value >>> 0
    switch (c.local) {
      case OFF_N0SA: c.ch.n0sa = v; break
      case OFF_N0DA: c.ch.n0da = v; break
      case OFF_N0TB: c.ch.n0tb = v; break
      case OFF_N1SA: c.ch.n1sa = v; break
      case OFF_N1DA: c.ch.n1da = v; break
      case OFF_N1TB: c.ch.n1tb = v; break
      case OFF_CHCTRL: this.applyChannelControl(c.ch, v); break
      case OFF_CHCFG: c.ch.chcfg = v; break
      case OFF_CHITVL: c.ch.chitvl = v; break
      case OFF_CHEXT: c.ch.chext = v; break
      case OFF_NXLA: c.ch.nxla = v; break
      // CRSA/CRDA/CRTB/CHSTAT/CRLA are read-only
    }
  }

  write16(offset: number, value: number): void { this.write32(offset, value) }
  write8(offset: number, value: number): void {
    const word = offset & ~3
    const shift = (offset & 3) * 8
    const current = this.read32(word)
    const mask = 0xff << shift
    const merged = (current & ~mask) | ((value & 0xff) << shift)
    this.write32(word, merged)
  }

  // ---------------------------------------------------------------------------
  // CHCTRL side effects
  // ---------------------------------------------------------------------------

  private applyChannelControl(ch: ChannelState, value: number): void {
    if (value & CHCTRL_SWRST) {
      // Software reset — clear all per-channel state.
      const idx = this.channels.indexOf(ch)
      if (idx >= 0) this.channels[idx] = emptyChannel()
      return
    }
    if (value & CHCTRL_CLREN) {
      ch.chstat &= ~CHSTAT_EN
      ch.running = false
    }
    if (value & CHCTRL_SETEN) {
      ch.chstat |= CHSTAT_EN
      // Load the current transfer descriptor from N0 (first use) or N1.
      if (ch.useN1) {
        ch.crsa = ch.n1sa; ch.crda = ch.n1da; ch.crtb = ch.n1tb
      } else {
        ch.crsa = ch.n0sa; ch.crda = ch.n0da; ch.crtb = ch.n0tb
      }
      ch.running = ch.crtb > 0
      if (ch.running) ch.chstat |= CHSTAT_TACT
    }
    if (value & CHCTRL_STG) {
      // Software trigger — treat the same as SETEN when the channel is
      // configured for software-triggered transfers.
      if (!(ch.chstat & CHSTAT_EN)) {
        ch.chstat |= CHSTAT_EN
        ch.crsa = ch.n0sa; ch.crda = ch.n0da; ch.crtb = ch.n0tb
        ch.running = ch.crtb > 0
        if (ch.running) ch.chstat |= CHSTAT_TACT
      }
    }
    if (value & CHCTRL_CLRRQ) { /* request flag cleared — no-op */ }
    if (value & CHCTRL_CLREND) ch.chstat &= ~CHSTAT_END
    if (value & CHCTRL_CLRTC) ch.chstat &= ~CHSTAT_TC
  }

  // ---------------------------------------------------------------------------
  // Public transfer-advance API used by the emulator worker
  // ---------------------------------------------------------------------------

  /**
   * Run one pump tick: for each running channel, transfer up to
   * `maxElementsPerChannel` elements from CRSA → CRDA via the supplied
   * memory accessor, respecting the documented CHCFG bits:
   *
   *   bits 12..15 SDS — source data size (0=8b, 1=16b, 2=32b, 3=64b, ...)
   *   bits 16..19 DDS — dest data size (same encoding)
   *   bit 20      SAD — source address mode (0=increment, 1=fixed)
   *   bit 21      DAD — destination address mode (0=increment, 1=fixed)
   *
   * When CRTB reaches 0 the channel chains to the other N-pair
   * (N0 ↔ N1 ping-pong); if neither pair has a non-zero byte count, the
   * channel halts and TC/END flags are set in CHSTAT.
   *
   * Returns the total number of bytes transferred across all channels.
   */
  /** Pump a single channel by up to `maxElements` elements. Useful for
   *  targeted synthetic injections (e.g. PIC RX bytes) without running
   *  the whole DMA engine. Returns bytes moved. */
  pumpChannel(
    index: number,
    maxElements: number,
    mem: DmacMemoryAccessor,
  ): number {
    return this.pumpOne(index, maxElements, mem)
  }

  pump(mem: DmacMemoryAccessor, maxElementsPerChannel: number): number {
    let bytesMoved = 0
    for (let i = 0; i < NUM_CHANNELS; i++) {
      bytesMoved += this.pumpOne(i, maxElementsPerChannel, mem)
    }
    return bytesMoved
  }

  private pumpOne(
    index: number,
    maxElements: number,
    mem: DmacMemoryAccessor,
  ): number {
    const ch = this.channels[index]
    if (!ch || !ch.running || ch.crtb === 0) return 0
    const sds = (ch.chcfg >>> 12) & 0xf
    const dds = (ch.chcfg >>> 16) & 0xf
    const sadFixed = !!(ch.chcfg & (1 << 20))
    const dadFixed = !!(ch.chcfg & (1 << 21))
    const srcBytes = 1 << sds
    const dstBytes = 1 << dds
    const step = Math.max(srcBytes, dstBytes)
    let bytesMoved = 0
    for (let e = 0; e < maxElements; e++) {
      if (!ch.running || ch.crtb < step) break
      const value = readElement(mem, ch.crsa, srcBytes)
      writeElement(mem, ch.crda, dstBytes, value)
      if (!sadFixed) ch.crsa = (ch.crsa + srcBytes) >>> 0
      if (!dadFixed) ch.crda = (ch.crda + dstBytes) >>> 0
      ch.crtb -= step
      bytesMoved += step
      if (ch.crtb === 0) {
        ch.chstat |= CHSTAT_TC | CHSTAT_END
        ch.chstat &= ~CHSTAT_TACT
        if (this.endCallback) this.endCallback(index)
        ch.useN1 = !ch.useN1
        if (ch.useN1 && ch.n1tb > 0) {
          ch.crsa = ch.n1sa
          ch.crda = ch.n1da
          ch.crtb = ch.n1tb
          ch.chstat |= CHSTAT_TACT
        } else if (!ch.useN1 && ch.n0tb > 0) {
          ch.crsa = ch.n0sa
          ch.crda = ch.n0da
          ch.crtb = ch.n0tb
          ch.chstat |= CHSTAT_TACT
        } else {
          ch.running = false
          ch.chstat &= ~CHSTAT_EN
          break
        }
      }
    }
    return bytesMoved
  }

  /**
   * Advance the given channel by `bytes`, moving CRSA forward and
   * decrementing CRTB. Returns the pair of (sourceAddrBefore, bytesRead)
   * so the caller can read those bytes from memory and dispatch them
   * (e.g. to the audio bridge).
   */
  advanceChannel(
    index: number,
    bytes: number,
  ): { sourceAddr: number; destAddr: number; bytes: number } | null {
    const ch = this.channels[index]
    if (!ch || !ch.running || ch.crtb === 0) return null
    const take = Math.min(bytes, ch.crtb)
    const sourceAddr = ch.crsa
    const destAddr = ch.crda
    ch.crsa = (ch.crsa + take) >>> 0
    ch.crtb = ch.crtb - take
    if (ch.crtb === 0) {
      // Transfer complete. Mark TC/END and either chain to the other
      // next-pair or halt.
      ch.chstat |= CHSTAT_TC | CHSTAT_END
      ch.chstat &= ~CHSTAT_TACT
      ch.useN1 = !ch.useN1
      // Reload from the other pair
      if (ch.useN1 && ch.n1tb > 0) {
        ch.crsa = ch.n1sa; ch.crda = ch.n1da; ch.crtb = ch.n1tb
        ch.chstat |= CHSTAT_TACT
      } else if (!ch.useN1 && ch.n0tb > 0) {
        ch.crsa = ch.n0sa; ch.crda = ch.n0da; ch.crtb = ch.n0tb
        ch.chstat |= CHSTAT_TACT
      } else {
        ch.running = false
        ch.chstat &= ~CHSTAT_EN
      }
    }
    return { sourceAddr, destAddr, bytes: take }
  }
}
