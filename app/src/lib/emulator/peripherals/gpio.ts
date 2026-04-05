// General-Purpose I/O Ports.
//
// RZ/A1L Hardware Manual Rev. 7.00 (R01UH0437EJ0700)
//   Chapter 41 Ports — table 41.5 register configuration
//
// Base: 0xFCFE3000. Each port register is addressed as
//   <base> + <register block offset> + <port index> × 4
// e.g. P1 at 0xFCFE3004, P2 at 0xFCFE3008, PM1 at 0xFCFE3304, etc.
//
// The RZ/A1L has 10 port groups (P0..P9). P0 is input-only (4 bits), P1
// is input/open-drain (16 bits), P2..P9 are general I/O. Register block
// offsets from table 41.5:
//
//   Pn      +0x0000
//   PSRn    +0x0100
//   PPRn    +0x0200
//   PMn     +0x0300   initial 0xFFFF (all inputs)
//   PMCn    +0x0400   initial 0x0000 (all port mode)
//   PFCn    +0x0500
//   PFCEn   +0x0600
//   PNOTn   +0x0700   (write-only)
//   PMSRn   +0x0800   (32-bit access)
//   PMCSRn  +0x0900   (32-bit access)
//   PFCAEn  +0x0A00
//   SNCRn   +0x0C00   (32-bit access)
//   PIBCn   +0x4000
//   PBDCn   +0x4100
//   PIPCn   +0x4200
//
// Port mode register (PMn) resets to 0xFFFF because the spec says every
// pin starts as input. Pn, PMCn, and others reset to 0.

import { BasePeripheralStub } from './PeripheralStub'

const NUM_PORTS = 10

// Block offsets from table 41.5.
const BLOCK_P = 0x0000
const BLOCK_PSR = 0x0100
const BLOCK_PPR = 0x0200
const BLOCK_PM = 0x0300
const BLOCK_PMC = 0x0400
const BLOCK_PFC = 0x0500
const BLOCK_PFCE = 0x0600
const BLOCK_PNOT = 0x0700
const BLOCK_PMSR = 0x0800
const BLOCK_PMCSR = 0x0900
const BLOCK_PFCAE = 0x0a00
const BLOCK_PIBC = 0x4000
const BLOCK_PBDC = 0x4100
const BLOCK_PIPC = 0x4200

interface PortState {
  p: number        // Pn
  ppr: number      // PPRn (input pin levels)
  pm: number       // PMn (0=output, 1=input)
  pmc: number      // PMCn (0=port, 1=alt)
  pfc: number
  pfce: number
  pfcae: number
  pibc: number
  pbdc: number
  pipc: number
}

function emptyPort(): PortState {
  return {
    p: 0,
    ppr: 0,
    pm: 0xffff, // all pins input after reset (chapter 41)
    pmc: 0,
    pfc: 0,
    pfce: 0,
    pfcae: 0,
    pibc: 0,
    pbdc: 0,
    pipc: 0,
  }
}

export class GpioStub extends BasePeripheralStub {
  readonly name = 'GPIO'
  readonly baseAddr = 0xfcfe3000
  readonly size = 0x5000

  private readonly ports: PortState[] = []

  constructor() {
    super()
    for (let i = 0; i < NUM_PORTS; i++) this.ports.push(emptyPort())
  }

  reset(): void {
    super.reset()
    for (let i = 0; i < NUM_PORTS; i++) {
      this.ports[i] = emptyPort()
    }
  }

  /**
   * Decode an offset into (port index, block offset, byte-within-register).
   * Returns undefined if the offset isn't a recognised register.
   */
  private decode(offset: number):
    | { port: number; block: number; sub: number; width: 16 | 32 }
    | undefined {
    const byteIndex = offset & 0x3
    const wordOffset = offset & ~0x3
    // Registers using 32-bit access: PMSR, PMCSR, SNCR
    if (wordOffset >= BLOCK_PMSR && wordOffset < BLOCK_PMSR + NUM_PORTS * 4) {
      const port = (wordOffset - BLOCK_PMSR) >> 2
      return { port, block: BLOCK_PMSR, sub: byteIndex, width: 32 }
    }
    if (wordOffset >= BLOCK_PMCSR && wordOffset < BLOCK_PMCSR + NUM_PORTS * 4) {
      const port = (wordOffset - BLOCK_PMCSR) >> 2
      return { port, block: BLOCK_PMCSR, sub: byteIndex, width: 32 }
    }
    // 16-bit registers — there are many blocks at 0x0100 stride.
    const blocks16 = [
      BLOCK_P, BLOCK_PSR, BLOCK_PPR, BLOCK_PM, BLOCK_PMC,
      BLOCK_PFC, BLOCK_PFCE, BLOCK_PNOT, BLOCK_PFCAE,
      BLOCK_PIBC, BLOCK_PBDC, BLOCK_PIPC,
    ]
    for (const block of blocks16) {
      if (wordOffset >= block && wordOffset < block + NUM_PORTS * 4) {
        const port = (wordOffset - block) >> 2
        return { port, block, sub: byteIndex, width: 16 }
      }
    }
    return undefined
  }

  private regValue(port: PortState, block: number): number {
    switch (block) {
      case BLOCK_P: return port.p
      case BLOCK_PSR: return port.p // reads as Pn value per 41.3.2
      case BLOCK_PPR: return port.ppr
      case BLOCK_PM: return port.pm
      case BLOCK_PMC: return port.pmc
      case BLOCK_PFC: return port.pfc
      case BLOCK_PFCE: return port.pfce
      case BLOCK_PFCAE: return port.pfcae
      case BLOCK_PNOT: return 0 // write-only
      case BLOCK_PMSR: return port.pm // reads as PM value
      case BLOCK_PMCSR: return port.pmc
      case BLOCK_PIBC: return port.pibc
      case BLOCK_PBDC: return port.pbdc
      case BLOCK_PIPC: return port.pipc
      default: return 0
    }
  }

  private applyBlockWrite(port: PortState, block: number, value: number): void {
    const v16 = value & 0xffff
    switch (block) {
      case BLOCK_P: port.p = v16; break
      case BLOCK_PM: port.pm = v16; break
      case BLOCK_PMC: port.pmc = v16; break
      case BLOCK_PFC: port.pfc = v16; break
      case BLOCK_PFCE: port.pfce = v16; break
      case BLOCK_PFCAE: port.pfcae = v16; break
      case BLOCK_PIBC: port.pibc = v16; break
      case BLOCK_PBDC: port.pbdc = v16; break
      case BLOCK_PIPC: port.pipc = v16; break
      case BLOCK_PNOT: port.p = (port.p ^ v16) & 0xffff; break
      case BLOCK_PSR: {
        // 32-bit register but listed under 16-bit. Lower 16 = data, higher 16 = enable mask.
        // Handled in the 32-bit path.
        const enable = (value >>> 16) & 0xffff
        const data = value & 0xffff
        port.p = ((port.p & ~enable) | (data & enable)) & 0xffff
        break
      }
      case BLOCK_PMSR: {
        const enable = (value >>> 16) & 0xffff
        const data = value & 0xffff
        port.pm = ((port.pm & ~enable) | (data & enable)) & 0xffff
        break
      }
      case BLOCK_PMCSR: {
        const enable = (value >>> 16) & 0xffff
        const data = value & 0xffff
        port.pmc = ((port.pmc & ~enable) | (data & enable)) & 0xffff
        break
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Access methods
  // ---------------------------------------------------------------------------

  read16(offset: number): number {
    const d = this.decode(offset)
    if (!d || d.port >= NUM_PORTS) return 0
    return this.regValue(this.ports[d.port], d.block) & 0xffff
  }

  read32(offset: number): number {
    const d = this.decode(offset)
    if (!d || d.port >= NUM_PORTS) return 0
    // For 32-bit set/reset registers we expose the underlying 16-bit value
    // in bits 15:0 and leave bits 31:16 as 0 per chapter 41.3.2–41.3.10.
    return this.regValue(this.ports[d.port], d.block) >>> 0
  }

  read8(offset: number): number {
    const d = this.decode(offset)
    if (!d || d.port >= NUM_PORTS) return 0
    const v = this.regValue(this.ports[d.port], d.block)
    return (v >>> (d.sub * 8)) & 0xff
  }

  write16(offset: number, value: number): void {
    const d = this.decode(offset)
    if (!d || d.port >= NUM_PORTS) return
    this.applyBlockWrite(this.ports[d.port], d.block, value & 0xffff)
  }

  write32(offset: number, value: number): void {
    const d = this.decode(offset)
    if (!d || d.port >= NUM_PORTS) return
    this.applyBlockWrite(this.ports[d.port], d.block, value >>> 0)
  }

  write8(offset: number, value: number): void {
    const d = this.decode(offset)
    if (!d || d.port >= NUM_PORTS) return
    const current = this.regValue(this.ports[d.port], d.block)
    const shift = d.sub * 8
    const mask = 0xff << shift
    const merged = (current & ~mask) | ((value & 0xff) << shift)
    this.applyBlockWrite(this.ports[d.port], d.block, merged & 0xffff)
  }

  /** Test hook: read a port's current state by index. */
  getPort(index: number): Readonly<PortState> | undefined {
    return this.ports[index]
  }
}
