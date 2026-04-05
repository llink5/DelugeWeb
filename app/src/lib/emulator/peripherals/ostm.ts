// OS Timer (OSTM).
//
// RZ/A1L Hardware Manual Rev. 7.00 (R01UH0437EJ0700)
//   Chapter 11 OS Timer — tables 11.2–11.10
//
// Two channels:
//   OSTM0_base = 0xFCFEC000
//   OSTM1_base = 0xFCFEC400
//
// Per-channel register layout (manual table 11.2.1):
//   offset  name      width  R/W   reset        notes
//   0x00    OSTMnCMP  32     R/W   0x00000000
//   0x04    OSTMnCNT  32     R     depends on mode — 0xFFFFFFFF in interval
//                                   mode, 0x00000000 in free-running mode
//   0x10    OSTMnTE   8      R     0x00
//   0x14    OSTMnTS   8      W     0x00 — reads as 0
//   0x18    OSTMnTT   8      W     0x00 — reads as 0
//   0x20    OSTMnCTL  8      R/W   0x00 — bit0=MD0, bit1=MD1
//
// Operating modes (OSTMnCTL.OSTMnMD1):
//   0 = interval timer mode: counter loads CMP and counts DOWN to 0
//   1 = free-running compare mode: counter starts at 0 and counts UP, fires
//       when CNT matches CMP

import { BasePeripheralStub } from './PeripheralStub'

const CHANNEL_STRIDE = 0x400

const OFF_CMP = 0x00
const OFF_CNT = 0x04
const OFF_TE = 0x10
const OFF_TS = 0x14
const OFF_TT = 0x18
const OFF_CTL = 0x20

interface ChannelState {
  compare: number
  counter: number
  enabled: boolean
  mode: number // bit 0 = MD0 (interrupt at start), bit 1 = MD1 (mode select)
}

export class OstmStub extends BasePeripheralStub {
  readonly name = 'OSTM'
  readonly baseAddr = 0xfcfec000
  readonly size = 0x00000800 // covers OSTM0 + OSTM1 (two × 0x400)

  private readonly timers: ChannelState[] = [
    { compare: 0, counter: 0xffffffff, enabled: false, mode: 0 },
    { compare: 0, counter: 0xffffffff, enabled: false, mode: 0 },
  ]

  constructor() {
    super()
    this.reset()
  }

  reset(): void {
    super.reset()
    for (const t of this.timers) {
      t.compare = 0
      t.counter = 0xffffffff // interval timer default, per table 11.6
      t.enabled = false
      t.mode = 0
    }
  }

  private channelFor(offset: number): { timer: ChannelState; local: number } | undefined {
    const idx = Math.floor(offset / CHANNEL_STRIDE)
    if (idx < 0 || idx >= this.timers.length) return undefined
    return { timer: this.timers[idx], local: offset % CHANNEL_STRIDE }
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  read32(offset: number): number {
    const c = this.channelFor(offset)
    if (!c) return 0
    switch (c.local) {
      case OFF_CMP: return c.timer.compare >>> 0
      case OFF_CNT: return c.timer.counter >>> 0
      default: return 0
    }
  }

  read16(offset: number): number {
    return this.read32(offset) & 0xffff
  }

  read8(offset: number): number {
    const c = this.channelFor(offset)
    if (!c) return 0
    switch (c.local) {
      case OFF_TE:
        return c.timer.enabled ? 0x01 : 0x00
      case OFF_TS: // write-only, reads as 0
      case OFF_TT:
        return 0
      case OFF_CTL:
        return c.timer.mode & 0x03
      default:
        // Partial-byte read into a wider register
        if (c.local < OFF_TE) {
          return (this.read32(offset & ~3) >>> ((offset & 3) * 8)) & 0xff
        }
        return 0
    }
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  write32(offset: number, value: number): void {
    const c = this.channelFor(offset)
    if (!c) return
    switch (c.local) {
      case OFF_CMP: c.timer.compare = value >>> 0; break
      // OSTMnCNT is documented as read-only from software. Silently ignore.
      case OFF_CNT: break
    }
  }

  write16(offset: number, value: number): void {
    // Lower half of CMP / CNT
    const c = this.channelFor(offset)
    if (!c) return
    if (c.local === OFF_CMP) {
      c.timer.compare = ((c.timer.compare & 0xffff0000) | (value & 0xffff)) >>> 0
    } else if (c.local === OFF_CMP + 2) {
      c.timer.compare =
        ((c.timer.compare & 0x0000ffff) | ((value & 0xffff) << 16)) >>> 0
    }
  }

  write8(offset: number, value: number): void {
    const c = this.channelFor(offset)
    if (!c) return
    const v = value & 0xff
    switch (c.local) {
      case OFF_TS:
        // Writing 1 starts the counter. Interval mode reloads CMP; free-run
        // mode starts from 0. Writing while enabled in interval mode forces
        // restart; in free-run mode the write is ignored.
        if ((v & 0x01) === 0) return
        if ((c.timer.mode & 0x02) === 0) {
          // interval timer mode
          c.timer.counter = c.timer.compare
          c.timer.enabled = true
        } else {
          // free-running mode
          if (!c.timer.enabled) {
            c.timer.counter = 0
            c.timer.enabled = true
          }
        }
        break
      case OFF_TT:
        if ((v & 0x01) !== 0) {
          c.timer.enabled = false
        }
        break
      case OFF_CTL:
        // Per manual: "Writing to this register is only possible if the
        // counter is disabled". We honor the restriction.
        if (!c.timer.enabled) {
          c.timer.mode = v & 0x03
        }
        break
      // Partial write into CMP (4 bytes) or CNT (read-only)
      default:
        if (c.local < OFF_TE) {
          // Merge byte into CMP at the right offset
          const shift = (c.local - OFF_CMP) * 8
          if (c.local >= OFF_CMP && c.local < OFF_CMP + 4) {
            const mask = 0xff << shift
            c.timer.compare =
              ((c.timer.compare & ~mask) | ((v << shift) & mask)) >>> 0
          }
        }
    }
  }

  // ---------------------------------------------------------------------------
  // Tick — advances running timers by the given cycle count.
  //
  // Interval mode: counts DOWN from CMP to 0, reloads CMP at underflow.
  // Free-running mode: counts UP from 0 to 0xFFFFFFFF, no reload on match.
  // Real hardware fires OSTMTINT on underflow/match; we do not yet surface
  // interrupts to the emulator's INTC bus.
  // ---------------------------------------------------------------------------

  tick(cycles: number): void {
    if (cycles <= 0) return
    for (const t of this.timers) {
      if (!t.enabled) continue
      if ((t.mode & 0x02) === 0) {
        // Interval mode — count down
        while (cycles > 0) {
          if (t.counter >= cycles) {
            t.counter = (t.counter - cycles) >>> 0
            cycles = 0
          } else {
            cycles -= t.counter + 1
            t.counter = t.compare >>> 0
          }
        }
      } else {
        // Free-running mode — count up
        t.counter = (t.counter + cycles) >>> 0
      }
    }
  }

  /** Test hook: peek at a timer's state. */
  getTimer(index: number): ChannelState | undefined {
    return this.timers[index]
  }
}
