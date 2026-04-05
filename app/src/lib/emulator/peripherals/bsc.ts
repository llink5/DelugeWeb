// Bus State Controller.
//
// RZ/A1L Hardware Manual Rev. 7.00 (R01UH0437EJ0700)
//   Chapter 8 Bus State Controller — table 8.4 register configuration
//
// Base: 0x3FFFC000. All registers are 32-bit. The BSC configures the six
// CS spaces (CS0..CS5), SDRAM refresh, and timeout detection. Firmware
// typically programs these during early boot to enable SDRAM and set
// memory timings before the heap comes online.
//
// Initial values follow table 8.4. CSnBCR initial values differ between
// boot modes (H'36DB0C00 in boot mode 0, H'36DB0E00 in boot modes 1–3).
// We follow boot mode 0 semantics here — that matches a typical SPI-boot
// scenario and matches H'36DB0E00 for non-mode-0 only in bit 1 of BSZ,
// which the firmware overwrites anyway when it configures memory.

import { RegMapStub } from './RegMapStub'
import type { RegisterDef } from './regs'

const BSC_BASE = 0x3fffc000
const BSC_SIZE = 0x0100

// CSnBCR initial value, boot mode 0. See chapter 8 note *1 on table 8.4.
const CSnBCR_RESET = 0x36db0c00

const REGISTERS: RegisterDef[] = [
  // 8.4.1 Common Control Register
  { name: 'CMNCR', address: 0x3fffc000, width: 32, reset: 0x00001018 },
  // 8.4.2 CSn space Bus Control Registers
  { name: 'CS0BCR', address: 0x3fffc004, width: 32, reset: CSnBCR_RESET },
  { name: 'CS1BCR', address: 0x3fffc008, width: 32, reset: CSnBCR_RESET },
  { name: 'CS2BCR', address: 0x3fffc00c, width: 32, reset: CSnBCR_RESET },
  { name: 'CS3BCR', address: 0x3fffc010, width: 32, reset: CSnBCR_RESET },
  { name: 'CS4BCR', address: 0x3fffc014, width: 32, reset: CSnBCR_RESET },
  { name: 'CS5BCR', address: 0x3fffc018, width: 32, reset: CSnBCR_RESET },
  // 8.4.3 CSn space Wait Control Registers
  { name: 'CS0WCR', address: 0x3fffc028, width: 32, reset: 0x00000500 },
  { name: 'CS1WCR', address: 0x3fffc02c, width: 32, reset: 0x00000500 },
  { name: 'CS2WCR', address: 0x3fffc030, width: 32, reset: 0x00000500 },
  { name: 'CS3WCR', address: 0x3fffc034, width: 32, reset: 0x00000500 },
  { name: 'CS4WCR', address: 0x3fffc038, width: 32, reset: 0x00000500 },
  { name: 'CS5WCR', address: 0x3fffc03c, width: 32, reset: 0x00000500 },
  // 8.4.4 SDRAM Control Register
  { name: 'SDCR', address: 0x3fffc04c, width: 32, reset: 0x00000000 },
  // 8.4.5–7 Refresh Timer registers
  { name: 'RTCSR', address: 0x3fffc050, width: 32, reset: 0x00000000 },
  { name: 'RTCNT', address: 0x3fffc054, width: 32, reset: 0x00000000 },
  { name: 'RTCOR', address: 0x3fffc058, width: 32, reset: 0x00000000 },
  // 8.4.8 Timeout Cycle Constant Registers
  { name: 'TOSCOR0', address: 0x3fffc060, width: 32, reset: 0x00000000 },
  { name: 'TOSCOR1', address: 0x3fffc064, width: 32, reset: 0x00000000 },
  { name: 'TOSCOR2', address: 0x3fffc068, width: 32, reset: 0x00000000 },
  { name: 'TOSCOR3', address: 0x3fffc06c, width: 32, reset: 0x00000000 },
  { name: 'TOSCOR4', address: 0x3fffc070, width: 32, reset: 0x00000000 },
  { name: 'TOSCOR5', address: 0x3fffc074, width: 32, reset: 0x00000000 },
  // 8.4.9/10 Timeout Status / Enable Registers
  { name: 'TOSTR', address: 0x3fffc080, width: 32, reset: 0x00000000 },
  { name: 'TOENR', address: 0x3fffc084, width: 32, reset: 0x00000000 },
]

export class BscStub extends RegMapStub {
  readonly name = 'BSC'
  readonly baseAddr = BSC_BASE
  readonly size = BSC_SIZE

  constructor() {
    super()
    this.buildRegisters(REGISTERS)
  }
}
