// Interrupt Controller.
//
// RZ/A1L Hardware Manual Rev. 7.00 (R01UH0437EJ0700)
//   Chapter 7 Interrupt Controller — table 7.2 register configuration
//
// Two windows:
//   0xFCFEF800 – 0xFCFEF805  Renesas custom registers (ICR0/ICR1/IRQRR)
//   0xE8201000 – 0xE8201FFF  ARM GIC distributor (PL390) register set
//
// The GIC registers follow Arm's Generic Interrupt Controller PL390 spec;
// the manual defers to "Arm Generic Interrupt Controller Architecture
// Specification and PL390 Technical Reference Manual". For the emulator
// we implement enough of the distributor to reflect writes and return
// deterministic reset values.

import { RegMapStub } from './RegMapStub'
import type { RegisterDef } from './regs'

const INTC_ICR_BASE = 0xfcfef800
const INTC_ICR_SIZE = 0x10

// Renesas-custom IRQ control registers (chapter 7.3.1–7.3.3).
const ICR_REGISTERS: RegisterDef[] = [
  {
    name: 'ICR0',
    address: 0xfcfef800,
    width: 16,
    reset: 0x0000,
    // Bit 15 (NMIL) is read-only and reflects the NMI pin level; with no
    // external NMI in the emulator we default to 0 (low). Writes to the
    // control bits below still land, hence writeMask excluding bit 15.
    writeMask: 0x7fff,
  },
  { name: 'ICR1', address: 0xfcfef802, width: 16, reset: 0x0000 },
  {
    name: 'IRQRR',
    address: 0xfcfef804,
    width: 16,
    reset: 0x0000,
    // Bits 15:8 are read-only 0. Lower 8 bits are R/W-clear: writing 0
    // clears, writing 1 has no effect (rc_w0 semantics). For the emulator
    // we let any write through since no IRQ pins generate input here.
    writeMask: 0x00ff,
  },
]

export class IntcIcrStub extends RegMapStub {
  readonly name = 'INTC_ICR'
  readonly baseAddr = INTC_ICR_BASE
  readonly size = INTC_ICR_SIZE

  constructor() {
    super()
    this.buildRegisters(ICR_REGISTERS)
  }
}

// ---------------------------------------------------------------------------
// GIC distributor (PL390)
//
// The distributor supports 192 interrupt lines on the RZ/A1L. Register
// layout follows Arm GIC v1 (PL390). We declare the control/type/ident
// registers explicitly and cover the rest of the window as zero-initialised
// backing store via a catch-all RegisterMap entry is not possible, so we
// use a scratch-byte approach: the RegMapStub above always falls back to 0
// for unmapped addresses in the window, and the firmware can still "write
// and read back" through the PeripheralBus fallback path if needed.
// ---------------------------------------------------------------------------

const GIC_DIST_BASE = 0xe8201000
const GIC_DIST_SIZE = 0x1000

// Interrupt controller type register reset value for RZ/A1L: 0xFC31.
// (ITLinesNumber = 0x0011 → 0x20 × (0x11+1) = 544 lines; 5 CPU interfaces;
// security extensions enabled, lockable SPIs)
// The value 0xFC31 is documented in table 7.2.
const ICDICTR_RESET = 0x0000fc31

const GIC_REGISTERS: RegisterDef[] = [
  // 7.3: Distributor Control Register (ICDDCR)
  { name: 'ICDDCR', address: 0xe8201000, width: 32, reset: 0x00000000 },
  { name: 'ICDICTR', address: 0xe8201004, width: 32, reset: ICDICTR_RESET, readOnly: true },
  { name: 'ICDIIDR', address: 0xe8201008, width: 32, reset: 0x0000043b, readOnly: true },
]

// Every GIC register bank (Set-Enable, Clear-Enable, Priority, Targets, …)
// occupies a contiguous block. To avoid tediously declaring every
// 32-bit slot, we instantiate a scratch-backed RegisterMap that covers
// the GIC window and let tests verify the specific offsets we care about.
// This is the same pattern the GIC uses — banks of identical 32-bit words.
function buildGicBanks(): RegisterDef[] {
  const defs: RegisterDef[] = [...GIC_REGISTERS]
  // Set-Enable registers ICDISER0..6 (7 registers × 4 bytes)
  for (let i = 0; i < 7; i++) {
    defs.push({
      name: `ICDISER${i}`,
      address: 0xe8201100 + i * 4,
      width: 32,
      reset: 0x00000000,
    })
    defs.push({
      name: `ICDICER${i}`,
      address: 0xe8201180 + i * 4,
      width: 32,
      reset: 0x00000000,
    })
    defs.push({
      name: `ICDISPR${i}`,
      address: 0xe8201200 + i * 4,
      width: 32,
      reset: 0x00000000,
    })
    defs.push({
      name: `ICDICPR${i}`,
      address: 0xe8201280 + i * 4,
      width: 32,
      reset: 0x00000000,
    })
  }
  // Priority registers ICDIPR0..55 (56 × 4 bytes), each register packs four
  // 8-bit priorities.
  for (let i = 0; i < 56; i++) {
    defs.push({
      name: `ICDIPR${i}`,
      address: 0xe8201400 + i * 4,
      width: 32,
      reset: 0x00000000,
    })
  }
  // Target registers ICDIPTR0..55
  for (let i = 0; i < 56; i++) {
    defs.push({
      name: `ICDIPTR${i}`,
      address: 0xe8201800 + i * 4,
      width: 32,
      reset: 0x00000000,
    })
  }
  // Configuration registers ICDICFR0..13
  for (let i = 0; i < 14; i++) {
    defs.push({
      name: `ICDICFR${i}`,
      address: 0xe8201c00 + i * 4,
      width: 32,
      reset: 0x00000000,
    })
  }
  return defs
}

export class IntcGicStub extends RegMapStub {
  readonly name: string = 'INTC_GIC'
  readonly baseAddr = GIC_DIST_BASE
  readonly size = GIC_DIST_SIZE

  constructor() {
    super()
    this.buildRegisters(buildGicBanks())
  }
}

/**
 * Combined convenience export: instantiate both INTC halves together.
 * Callers that only need one half can instantiate it directly.
 */
export function createIntcStubs(): [IntcIcrStub, IntcGicStub] {
  return [new IntcIcrStub(), new IntcGicStub()]
}

// Back-compat alias — the original codebase exported a single `IntcStub`.
export class IntcStub extends IntcGicStub {
  override readonly name = 'INTC'
}
