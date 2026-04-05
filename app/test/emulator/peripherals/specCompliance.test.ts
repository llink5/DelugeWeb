// RZ/A1L peripheral stub spec compliance.
//
// Each entry below is a datum from the hardware manual: register name,
// absolute address, access width, documented reset value, and the chapter
// that backs it. The test reads each register through the PeripheralBus
// at power-on reset and asserts the stub returns the documented value.
//
// This is the canonical "does our stub set match the chip" check.
// Reference: R01UH0437EJ0700, Rev. 7.00, Sept. 2024.

import { describe, test, expect } from 'vitest'
import { createBootPeripheralBus } from '@/lib/emulator/peripherals'

interface RegisterSpec {
  name: string
  address: number
  width: 8 | 16 | 32
  reset: number
  chapter: string
}

// ---------------------------------------------------------------------------
// CPG chapter 6.4 + power-down chapter 42.2
// ---------------------------------------------------------------------------

const CPG_SPEC: RegisterSpec[] = [
  // chapter 6.4.1 — Clock Pulse Generator
  { name: 'FRQCR',   address: 0xfcfe0010, width: 16, reset: 0x0335, chapter: '6.4.1' },
  // chapter 42.2 — Power-Down Modes
  { name: 'CPUSTS',  address: 0xfcfe0018, width: 8,  reset: 0x00,   chapter: '42.2'  },
  { name: 'STBCR1',  address: 0xfcfe0020, width: 8,  reset: 0x00,   chapter: '42.2'  },
  { name: 'STBCR2',  address: 0xfcfe0024, width: 8,  reset: 0x6a,   chapter: '42.2'  },
  { name: 'STBREQ1', address: 0xfcfe0030, width: 8,  reset: 0x00,   chapter: '42.2'  },
  { name: 'STBREQ2', address: 0xfcfe0034, width: 8,  reset: 0x00,   chapter: '42.2'  },
  { name: 'STBACK1', address: 0xfcfe0040, width: 8,  reset: 0x00,   chapter: '42.2'  },
  { name: 'STBACK2', address: 0xfcfe0044, width: 8,  reset: 0x00,   chapter: '42.2'  },
  { name: 'SYSCR1',  address: 0xfcfe0400, width: 8,  reset: 0xff,   chapter: '42.2'  },
  { name: 'SYSCR2',  address: 0xfcfe0404, width: 8,  reset: 0xff,   chapter: '42.2'  },
  { name: 'SYSCR3',  address: 0xfcfe0408, width: 8,  reset: 0x00,   chapter: '42.2'  },
  { name: 'STBCR3',  address: 0xfcfe0420, width: 8,  reset: 0xfd,   chapter: '42.2'  },
  { name: 'STBCR4',  address: 0xfcfe0424, width: 8,  reset: 0xff,   chapter: '42.2'  },
  { name: 'STBCR5',  address: 0xfcfe0428, width: 8,  reset: 0xff,   chapter: '42.2'  },
  { name: 'STBCR6',  address: 0xfcfe042c, width: 8,  reset: 0xfe,   chapter: '42.2'  },
  { name: 'STBCR7',  address: 0xfcfe0430, width: 8,  reset: 0x3f,   chapter: '42.2'  },
  { name: 'STBCR8',  address: 0xfcfe0434, width: 8,  reset: 0xff,   chapter: '42.2'  },
  { name: 'STBCR9',  address: 0xfcfe0438, width: 8,  reset: 0xff,   chapter: '42.2'  },
  { name: 'STBCR10', address: 0xfcfe043c, width: 8,  reset: 0xff,   chapter: '42.2'  },
  { name: 'STBCR11', address: 0xfcfe0440, width: 8,  reset: 0xff,   chapter: '42.2'  },
  { name: 'STBCR12', address: 0xfcfe0444, width: 8,  reset: 0xff,   chapter: '42.2'  },
  { name: 'SWRSTCR1', address: 0xfcfe0460, width: 8, reset: 0x00,   chapter: '42.2'  },
  { name: 'SWRSTCR2', address: 0xfcfe0464, width: 8, reset: 0x00,   chapter: '42.2'  },
]

const DEEP_STANDBY_SPEC: RegisterSpec[] = [
  { name: 'RRAMKP',  address: 0xfcff1800, width: 8,  reset: 0x00,   chapter: '42.2' },
  { name: 'DSCTR',   address: 0xfcff1802, width: 8,  reset: 0x00,   chapter: '42.2' },
  { name: 'DSSSR',   address: 0xfcff1804, width: 16, reset: 0x0000, chapter: '42.2' },
  { name: 'DSESR',   address: 0xfcff1806, width: 16, reset: 0x0000, chapter: '42.2' },
  { name: 'DSFR',    address: 0xfcff1808, width: 16, reset: 0x0000, chapter: '42.2' },
  { name: 'XTALCTR', address: 0xfcff1810, width: 8,  reset: 0x00,   chapter: '42.2' },
]

// ---------------------------------------------------------------------------
// INTC chapter 7.3
// ---------------------------------------------------------------------------

const INTC_ICR_SPEC: RegisterSpec[] = [
  { name: 'ICR0',  address: 0xfcfef800, width: 16, reset: 0x0000, chapter: '7.3.1' },
  { name: 'ICR1',  address: 0xfcfef802, width: 16, reset: 0x0000, chapter: '7.3.2' },
  { name: 'IRQRR', address: 0xfcfef804, width: 16, reset: 0x0000, chapter: '7.3.3' },
]

const INTC_GIC_SPEC: RegisterSpec[] = [
  { name: 'ICDDCR',  address: 0xe8201000, width: 32, reset: 0x00000000, chapter: '7.3'    },
  { name: 'ICDICTR', address: 0xe8201004, width: 32, reset: 0x0000fc31, chapter: '7.3'    },
  { name: 'ICDIIDR', address: 0xe8201008, width: 32, reset: 0x0000043b, chapter: '7.3'    },
]

// ---------------------------------------------------------------------------
// BSC chapter 8.4
// ---------------------------------------------------------------------------

const BSC_SPEC: RegisterSpec[] = [
  { name: 'CMNCR',   address: 0x3fffc000, width: 32, reset: 0x00001018, chapter: '8.4.1' },
  { name: 'CS0BCR',  address: 0x3fffc004, width: 32, reset: 0x36db0c00, chapter: '8.4.2' },
  { name: 'CS1BCR',  address: 0x3fffc008, width: 32, reset: 0x36db0c00, chapter: '8.4.2' },
  { name: 'CS2BCR',  address: 0x3fffc00c, width: 32, reset: 0x36db0c00, chapter: '8.4.2' },
  { name: 'CS3BCR',  address: 0x3fffc010, width: 32, reset: 0x36db0c00, chapter: '8.4.2' },
  { name: 'CS4BCR',  address: 0x3fffc014, width: 32, reset: 0x36db0c00, chapter: '8.4.2' },
  { name: 'CS5BCR',  address: 0x3fffc018, width: 32, reset: 0x36db0c00, chapter: '8.4.2' },
  { name: 'CS0WCR',  address: 0x3fffc028, width: 32, reset: 0x00000500, chapter: '8.4.3' },
  { name: 'CS1WCR',  address: 0x3fffc02c, width: 32, reset: 0x00000500, chapter: '8.4.3' },
  { name: 'CS2WCR',  address: 0x3fffc030, width: 32, reset: 0x00000500, chapter: '8.4.3' },
  { name: 'CS3WCR',  address: 0x3fffc034, width: 32, reset: 0x00000500, chapter: '8.4.3' },
  { name: 'CS4WCR',  address: 0x3fffc038, width: 32, reset: 0x00000500, chapter: '8.4.3' },
  { name: 'CS5WCR',  address: 0x3fffc03c, width: 32, reset: 0x00000500, chapter: '8.4.3' },
  { name: 'SDCR',    address: 0x3fffc04c, width: 32, reset: 0x00000000, chapter: '8.4.4' },
  { name: 'RTCSR',   address: 0x3fffc050, width: 32, reset: 0x00000000, chapter: '8.4.5' },
  { name: 'RTCNT',   address: 0x3fffc054, width: 32, reset: 0x00000000, chapter: '8.4.6' },
  { name: 'RTCOR',   address: 0x3fffc058, width: 32, reset: 0x00000000, chapter: '8.4.7' },
  { name: 'TOSCOR0', address: 0x3fffc060, width: 32, reset: 0x00000000, chapter: '8.4.8' },
  { name: 'TOSCOR1', address: 0x3fffc064, width: 32, reset: 0x00000000, chapter: '8.4.8' },
  { name: 'TOSCOR2', address: 0x3fffc068, width: 32, reset: 0x00000000, chapter: '8.4.8' },
  { name: 'TOSCOR3', address: 0x3fffc06c, width: 32, reset: 0x00000000, chapter: '8.4.8' },
  { name: 'TOSCOR4', address: 0x3fffc070, width: 32, reset: 0x00000000, chapter: '8.4.8' },
  { name: 'TOSCOR5', address: 0x3fffc074, width: 32, reset: 0x00000000, chapter: '8.4.8' },
  { name: 'TOSTR',   address: 0x3fffc080, width: 32, reset: 0x00000000, chapter: '8.4.9' },
  { name: 'TOENR',   address: 0x3fffc084, width: 32, reset: 0x00000000, chapter: '8.4.10' },
]

// ---------------------------------------------------------------------------
// OSTM chapter 11.2
// ---------------------------------------------------------------------------

const OSTM_SPEC: RegisterSpec[] = [
  { name: 'OSTM0CMP', address: 0xfcfec000, width: 32, reset: 0x00000000, chapter: '11.2.2.1' },
  { name: 'OSTM0CNT', address: 0xfcfec004, width: 32, reset: 0xffffffff, chapter: '11.2.2.2' },
  { name: 'OSTM0TE',  address: 0xfcfec010, width: 8,  reset: 0x00,       chapter: '11.2.2.3' },
  { name: 'OSTM0TS',  address: 0xfcfec014, width: 8,  reset: 0x00,       chapter: '11.2.2.4' },
  { name: 'OSTM0TT',  address: 0xfcfec018, width: 8,  reset: 0x00,       chapter: '11.2.2.5' },
  { name: 'OSTM0CTL', address: 0xfcfec020, width: 8,  reset: 0x00,       chapter: '11.2.2.6' },
  { name: 'OSTM1CMP', address: 0xfcfec400, width: 32, reset: 0x00000000, chapter: '11.2.2.1' },
  { name: 'OSTM1CNT', address: 0xfcfec404, width: 32, reset: 0xffffffff, chapter: '11.2.2.2' },
  { name: 'OSTM1TE',  address: 0xfcfec410, width: 8,  reset: 0x00,       chapter: '11.2.2.3' },
  { name: 'OSTM1CTL', address: 0xfcfec420, width: 8,  reset: 0x00,       chapter: '11.2.2.6' },
]

// ---------------------------------------------------------------------------
// Ports chapter 41.3 — PM register resets to 0xFFFF (all inputs)
// ---------------------------------------------------------------------------

const PORTS_SPEC: RegisterSpec[] = [
  // Port 1 PM is at 0xFCFE3304 (base 0xFCFE3000 + block 0x0300 + 1 × 4)
  { name: 'PM1',  address: 0xfcfe3304, width: 16, reset: 0xffff, chapter: '41.3.4' },
  { name: 'PM2',  address: 0xfcfe3308, width: 16, reset: 0xffff, chapter: '41.3.4' },
  { name: 'PMC1', address: 0xfcfe3404, width: 16, reset: 0x0000, chapter: '41.3.5' },
  { name: 'P1',   address: 0xfcfe3004, width: 16, reset: 0x0000, chapter: '41.3.1' },
]

// ---------------------------------------------------------------------------
// Runner — executes each spec group against a freshly-booted PeripheralBus
// ---------------------------------------------------------------------------

function run(group: string, spec: RegisterSpec[]) {
  describe(`${group} reset values`, () => {
    for (const reg of spec) {
      test(`${reg.name} @ 0x${reg.address.toString(16).toUpperCase()} → reset 0x${reg.reset.toString(16)} (ch ${reg.chapter})`, () => {
        const bus = createBootPeripheralBus()
        let value: number
        if (reg.width === 8) value = bus.read8(reg.address)
        else if (reg.width === 16) value = bus.read16(reg.address)
        else value = bus.read32(reg.address)
        expect(value).toBe(reg.reset)
      })
    }
  })
}

run('CPG', CPG_SPEC)
run('Deep-standby', DEEP_STANDBY_SPEC)
run('INTC ICR', INTC_ICR_SPEC)
run('INTC GIC', INTC_GIC_SPEC)
run('BSC', BSC_SPEC)
run('OSTM', OSTM_SPEC)
run('Ports', PORTS_SPEC)
