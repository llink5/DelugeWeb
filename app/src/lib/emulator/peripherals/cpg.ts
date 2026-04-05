// Clock Pulse Generator and Power-Down Modes.
//
// RZ/A1L Hardware Manual Rev. 7.00 (R01UH0437EJ0700)
//   Chapter 6  Clock Pulse Generator         — FRQCR
//   Chapter 42 Power-Down Modes                — STBCR/SYSCR/DS*/RRAMKP
//
// Registers span two windows in SLV1 I/O area:
//   0xFCFE0000 – 0xFCFE04FF  CPG + standby control
//   0xFCFF1800 – 0xFCFF181F  Deep-standby controls
//
// The registers listed here are the union of chapter 6's table 6.6 and
// chapter 42's table 42.2. Every entry below cites an address and initial
// value from the manual verbatim.
//
// For the emulator we expose every register the manual declares at the
// documented reset value and accept writes. That's enough for firmware to
// finish clock/standby configuration and proceed with boot.

import { RegMapStub } from './RegMapStub'
import type { RegisterDef } from './regs'

// Window that covers FRQCR + STBCR1..12 + STBREQ/ACK + SYSCR1..3 + CPUSTS +
// SWRSTCR1/2. The registers are sparse but this range contains them all.
const CPG_BASE = 0xfcfe0000
const CPG_SIZE = 0x0500

const REGISTERS: RegisterDef[] = [
  // 6.4.1 Frequency Control Register (FRQCR)
  { name: 'FRQCR', address: 0xfcfe0010, width: 16, reset: 0x0335 },

  // 42.2 CPU status register (R only; bit 0 ISBUSY0)
  { name: 'CPUSTS', address: 0xfcfe0018, width: 8, reset: 0x00, readOnly: true },

  // 42.2.1–12 Standby Control Registers
  { name: 'STBCR1', address: 0xfcfe0020, width: 8, reset: 0x00 },
  { name: 'STBCR2', address: 0xfcfe0024, width: 8, reset: 0x6a },
  { name: 'STBREQ1', address: 0xfcfe0030, width: 8, reset: 0x00 },
  { name: 'STBREQ2', address: 0xfcfe0034, width: 8, reset: 0x00 },
  { name: 'STBACK1', address: 0xfcfe0040, width: 8, reset: 0x00, readOnly: true },
  { name: 'STBACK2', address: 0xfcfe0044, width: 8, reset: 0x00, readOnly: true },

  // 42.2 System Control Registers
  { name: 'SYSCR1', address: 0xfcfe0400, width: 8, reset: 0xff },
  { name: 'SYSCR2', address: 0xfcfe0404, width: 8, reset: 0xff },
  { name: 'SYSCR3', address: 0xfcfe0408, width: 8, reset: 0x00 },

  // STBCR3..12 on the 0xFCFE0420 range
  { name: 'STBCR3', address: 0xfcfe0420, width: 8, reset: 0xfd },
  { name: 'STBCR4', address: 0xfcfe0424, width: 8, reset: 0xff },
  { name: 'STBCR5', address: 0xfcfe0428, width: 8, reset: 0xff },
  { name: 'STBCR6', address: 0xfcfe042c, width: 8, reset: 0xfe },
  { name: 'STBCR7', address: 0xfcfe0430, width: 8, reset: 0x3f },
  { name: 'STBCR8', address: 0xfcfe0434, width: 8, reset: 0xff },
  { name: 'STBCR9', address: 0xfcfe0438, width: 8, reset: 0xff },
  { name: 'STBCR10', address: 0xfcfe043c, width: 8, reset: 0xff },
  { name: 'STBCR11', address: 0xfcfe0440, width: 8, reset: 0xff },
  { name: 'STBCR12', address: 0xfcfe0444, width: 8, reset: 0xff },

  // Software reset control
  { name: 'SWRSTCR1', address: 0xfcfe0460, width: 8, reset: 0x00 },
  { name: 'SWRSTCR2', address: 0xfcfe0464, width: 8, reset: 0x00 },
]

export class CpgStub extends RegMapStub {
  readonly name = 'CPG'
  readonly baseAddr = CPG_BASE
  readonly size = CPG_SIZE

  constructor() {
    super()
    this.buildRegisters(REGISTERS)
  }
}

/**
 * Deep-standby and data-retention RAM control registers live in a separate
 * window at 0xFCFF1800. Splitting them into their own stub keeps the
 * address coverage tight and lets callers register only what they need.
 *
 * Addresses and reset values from Hardware Manual chapter 42.
 */
export class DeepStandbyStub extends RegMapStub {
  readonly name = 'DeepStandby'
  readonly baseAddr = 0xfcff1800
  readonly size = 0x0020

  constructor() {
    super()
    this.buildRegisters([
      { name: 'RRAMKP',   address: 0xfcff1800, width: 8,  reset: 0x00 },
      { name: 'DSCTR',    address: 0xfcff1802, width: 8,  reset: 0x00 },
      { name: 'DSSSR',    address: 0xfcff1804, width: 16, reset: 0x0000 },
      { name: 'DSESR',    address: 0xfcff1806, width: 16, reset: 0x0000 },
      { name: 'DSFR',     address: 0xfcff1808, width: 16, reset: 0x0000 },
      { name: 'XTALCTR',  address: 0xfcff1810, width: 8,  reset: 0x00 },
    ])
  }
}
