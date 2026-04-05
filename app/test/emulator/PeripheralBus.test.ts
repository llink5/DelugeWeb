import { describe, test, expect, vi } from 'vitest'
import {
  PeripheralBus,
  BasePeripheralStub,
  GpioStub,
  CpgStub,
  OstmStub,
  IntcStub,
  BscStub,
  createBootPeripheralBus,
  type PeripheralAccess,
} from '@/lib/emulator/peripherals'

class TestStub extends BasePeripheralStub {
  readonly name: string
  readonly baseAddr: number
  readonly size: number
  constructor(name: string, baseAddr: number, size: number) {
    super()
    this.name = name
    this.baseAddr = baseAddr
    this.size = size
    this.reset()
  }
}

describe('PeripheralBus registration', () => {
  test('registers a single stub', () => {
    const bus = new PeripheralBus()
    const stub = new TestStub('A', 0xe8000000, 0x1000)
    bus.register(stub)
    expect(bus.list()).toHaveLength(1)
  })

  test('registers multiple non-overlapping stubs', () => {
    const bus = new PeripheralBus()
    bus.register(new TestStub('A', 0xe8000000, 0x1000))
    bus.register(new TestStub('B', 0xe8001000, 0x1000))
    bus.register(new TestStub('C', 0xe8003000, 0x1000))
    expect(bus.list()).toHaveLength(3)
  })

  test('throws on overlap', () => {
    const bus = new PeripheralBus()
    bus.register(new TestStub('A', 0xe8000000, 0x1000))
    expect(() => bus.register(new TestStub('B', 0xe8000800, 0x1000))).toThrow(/overlap/i)
  })

  test('throws on exact duplicate range', () => {
    const bus = new PeripheralBus()
    bus.register(new TestStub('A', 0xe8000000, 0x1000))
    expect(() => bus.register(new TestStub('B', 0xe8000000, 0x1000))).toThrow()
  })
})

describe('PeripheralBus dispatch', () => {
  test('read32 routes to correct stub', () => {
    const bus = new PeripheralBus()
    const a = new TestStub('A', 0xe8000000, 0x1000)
    bus.register(a)
    a.write32(0x10, 0xdeadbeef)
    expect(bus.read32(0xe8000010)).toBe(0xdeadbeef)
  })

  test('write32 updates backing register', () => {
    const bus = new PeripheralBus()
    const a = new TestStub('A', 0xe8000000, 0x1000)
    bus.register(a)
    bus.write32(0xe8000020, 0xcafebabe)
    expect(a.read32(0x20)).toBe(0xcafebabe)
  })

  test('read8/write8 width-specific', () => {
    const bus = new PeripheralBus()
    bus.register(new TestStub('A', 0xe8000000, 0x1000))
    bus.write8(0xe8000000, 0x42)
    expect(bus.read8(0xe8000000)).toBe(0x42)
  })

  test('read16/write16 width-specific', () => {
    const bus = new PeripheralBus()
    bus.register(new TestStub('A', 0xe8000000, 0x1000))
    bus.write16(0xe8000004, 0xabcd)
    expect(bus.read16(0xe8000004)).toBe(0xabcd)
  })

  test('reads from unmapped address return 0', () => {
    const bus = new PeripheralBus()
    bus.register(new TestStub('A', 0xe8000000, 0x1000))
    expect(bus.read32(0xffffffff)).toBe(0)
    expect(bus.read16(0xffffffff)).toBe(0)
    expect(bus.read8(0xffffffff)).toBe(0)
  })

  test('writes to unmapped address do not throw', () => {
    const bus = new PeripheralBus()
    bus.register(new TestStub('A', 0xe8000000, 0x1000))
    expect(() => bus.write32(0xffffffff, 0xdeadbeef)).not.toThrow()
  })
})

describe('PeripheralBus logging', () => {
  test('logger receives every access', () => {
    const bus = new PeripheralBus()
    bus.register(new TestStub('A', 0xe8000000, 0x1000))
    const accesses: PeripheralAccess[] = []
    bus.setLogger((a) => accesses.push(a))
    bus.write32(0xe8000000, 42)
    bus.read32(0xe8000000)
    expect(accesses).toHaveLength(2)
    expect(accesses[0].op).toBe('write')
    expect(accesses[0].stub).toBe('A')
    expect(accesses[0].value).toBe(42)
    expect(accesses[1].op).toBe('read')
  })

  test('logger can be detached', () => {
    const bus = new PeripheralBus()
    bus.register(new TestStub('A', 0xe8000000, 0x1000))
    const fn = vi.fn()
    bus.setLogger(fn)
    bus.read32(0xe8000000)
    bus.setLogger(null)
    bus.read32(0xe8000000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('unmapped accesses are still logged', () => {
    const bus = new PeripheralBus()
    const accesses: PeripheralAccess[] = []
    bus.setLogger((a) => accesses.push(a))
    bus.read32(0xdeadbeef)
    expect(accesses).toHaveLength(1)
    expect(accesses[0].stub).toBe('')
  })
})

describe('PeripheralBus reset + tick', () => {
  test('reset zeroes all registered stubs', () => {
    const bus = new PeripheralBus()
    const a = new TestStub('A', 0xe8000000, 0x1000)
    bus.register(a)
    bus.write32(0xe8000000, 0xffffffff)
    expect(a.read32(0)).toBe(0xffffffff)
    bus.reset()
    expect(a.read32(0)).toBe(0)
  })

  test('tick propagates to stubs that implement it', () => {
    const ostm = new OstmStub()
    const bus = new PeripheralBus()
    bus.register(ostm)
    // Start timer 0
    bus.write32(0xfcfec000 + 0x00, 1000) // CMP = 1000
    bus.write8(0xfcfec000 + 0x14, 1) // TS = 1 → start
    bus.tick(100)
    // Counter should have advanced
    expect(bus.read32(0xfcfec000 + 0x04)).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Individual stubs
// ---------------------------------------------------------------------------

describe('GpioStub', () => {
  test('is registered at the correct base', () => {
    const gpio = new GpioStub()
    expect(gpio.baseAddr).toBe(0xfcfe3000)
  })

  test('PM register resets to 0xFFFF (all inputs)', () => {
    const gpio = new GpioStub()
    // PM1 is at base + 0x0304 (block 0x0300 + port 1 × 4)
    expect(gpio.read16(0x0304)).toBe(0xffff)
  })

  test('writing to Pn stores the value', () => {
    const gpio = new GpioStub()
    // P2 at block 0x0000 + port 2 × 4 = 0x0008
    gpio.write16(0x0008, 0x1234)
    expect(gpio.read16(0x0008)).toBe(0x1234)
  })

  test('PMC resets to 0 (all port mode)', () => {
    const gpio = new GpioStub()
    expect(gpio.read16(0x0404)).toBe(0x0000)
  })
})

describe('CpgStub', () => {
  test('FRQCR resets to 0x0335 per chapter 6.4.1', () => {
    const cpg = new CpgStub()
    // FRQCR absolute 0xFCFE0010, stub base 0xFCFE0000 → offset 0x10
    expect(cpg.read16(0x10)).toBe(0x0335)
  })

  test('STBCR2 resets to 0x6A per chapter 42.2', () => {
    const cpg = new CpgStub()
    expect(cpg.read8(0x24)).toBe(0x6a)
  })

  test('STBCR3 resets to 0xFD per chapter 42.2', () => {
    const cpg = new CpgStub()
    expect(cpg.read8(0x420)).toBe(0xfd)
  })

  test('SYSCR1 resets to 0xFF', () => {
    const cpg = new CpgStub()
    expect(cpg.read8(0x400)).toBe(0xff)
  })

  test('writes to FRQCR are preserved', () => {
    const cpg = new CpgStub()
    cpg.write16(0x10, 0x0035)
    expect(cpg.read16(0x10)).toBe(0x0035)
  })

  test('CPUSTS is read-only', () => {
    const cpg = new CpgStub()
    cpg.write8(0x18, 0xff)
    expect(cpg.read8(0x18)).toBe(0x00)
  })
})

describe('OstmStub', () => {
  test('compare register round-trips', () => {
    const ostm = new OstmStub()
    ostm.write32(0x00, 12345)
    expect(ostm.read32(0x00)).toBe(12345)
  })

  test('CNT reset is 0xFFFFFFFF (interval mode default) per table 11.6', () => {
    const ostm = new OstmStub()
    expect(ostm.read32(0x04)).toBe(0xffffffff)
  })

  test('TE bit reads 0 before start, 1 after TS write', () => {
    const ostm = new OstmStub()
    expect(ostm.read8(0x10)).toBe(0)
    ostm.write8(0x14, 1) // TS
    expect(ostm.read8(0x10)).toBe(1)
  })

  test('tick decrements counter in interval mode', () => {
    const ostm = new OstmStub()
    ostm.write32(0x00, 1000) // CMP
    ostm.write8(0x14, 1)     // start — counter loads from CMP
    expect(ostm.read32(0x04)).toBe(1000)
    ostm.tick(400)
    expect(ostm.read32(0x04)).toBe(600)
  })

  test('counter reloads CMP after underflow', () => {
    const ostm = new OstmStub()
    ostm.write32(0x00, 100)
    ostm.write8(0x14, 1)
    ostm.tick(150)
    // Tick through 100+1=101 → counter = 100 (reloaded) then another 49
    expect(ostm.read32(0x04)).toBe(51)
  })

  test('free-running mode counts up from 0', () => {
    const ostm = new OstmStub()
    ostm.write8(0x20, 0b10) // MD1=1 (free-running), counter disabled
    ostm.write8(0x14, 1)    // start
    expect(ostm.read32(0x04)).toBe(0)
    ostm.tick(500)
    expect(ostm.read32(0x04)).toBe(500)
  })

  test('TT stops the counter', () => {
    const ostm = new OstmStub()
    ostm.write32(0x00, 1000)
    ostm.write8(0x14, 1)
    ostm.write8(0x18, 1) // TT
    expect(ostm.read8(0x10)).toBe(0)
  })

  test('two independent timers at 0x000 and 0x400', () => {
    const ostm = new OstmStub()
    ostm.write32(0x00, 1000)
    ostm.write32(0x400, 2000)
    expect(ostm.read32(0x00)).toBe(1000)
    expect(ostm.read32(0x400)).toBe(2000)
  })
})

describe('IntcStub', () => {
  test('GIC distributor base matches chapter 7.3', () => {
    const intc = new IntcStub()
    expect(intc.baseAddr).toBe(0xe8201000)
  })

  test('ICDICTR is read-only with spec reset value', () => {
    const intc = new IntcStub()
    expect(intc.read32(0x04)).toBe(0x0000fc31)
    intc.write32(0x04, 0xffffffff)
    expect(intc.read32(0x04)).toBe(0x0000fc31)
  })

  test('ICDDCR is R/W with reset 0', () => {
    const intc = new IntcStub()
    expect(intc.read32(0x00)).toBe(0)
    intc.write32(0x00, 0x3)
    expect(intc.read32(0x00)).toBe(0x3)
  })
})

describe('BscStub', () => {
  test('base address matches BSC', () => {
    const bsc = new BscStub()
    expect(bsc.baseAddr).toBe(0x3fffc000)
  })

  test('CMNCR resets to 0x00001018 per chapter 8.4.1', () => {
    const bsc = new BscStub()
    expect(bsc.read32(0x00)).toBe(0x00001018)
  })

  test('CSnBCR resets to boot-mode-0 value 0x36DB0C00', () => {
    const bsc = new BscStub()
    for (let i = 0; i < 6; i++) {
      expect(bsc.read32(0x04 + i * 4)).toBe(0x36db0c00)
    }
  })

  test('CSnWCR resets to 0x00000500', () => {
    const bsc = new BscStub()
    for (let i = 0; i < 6; i++) {
      expect(bsc.read32(0x28 + i * 4)).toBe(0x00000500)
    }
  })

  test('SDCR resets to 0x00000000', () => {
    const bsc = new BscStub()
    expect(bsc.read32(0x4c)).toBe(0x00000000)
  })
})

describe('createBootPeripheralBus', () => {
  test('wires the full RZ/A1L boot stub set', () => {
    const bus = createBootPeripheralBus()
    const names = bus.list().map((s) => s.name).sort()
    expect(names).toEqual([
      'BSC',
      'CPG',
      'DMAC',
      'DeepStandby',
      'GPIO',
      'INTC_GIC',
      'INTC_ICR',
      'OSTM',
      'RSPI',
      'SCIF',
      'SDHI',
      'SSI',
    ])
  })

  test('bus dispatches GPIO P1 register write', () => {
    const bus = createBootPeripheralBus()
    // P1 at 0xFCFE3004 (port 1 of Pn block at offset 0x0000, × 4)
    bus.write16(0xfcfe3004, 0xabcd)
    expect(bus.read16(0xfcfe3004)).toBe(0xabcd)
  })

  test('bus dispatches CPG FRQCR read with spec reset value', () => {
    const bus = createBootPeripheralBus()
    expect(bus.read16(0xfcfe0010)).toBe(0x0335)
  })

  test('bus dispatches BSC CMNCR read', () => {
    const bus = createBootPeripheralBus()
    expect(bus.read32(0x3fffc000)).toBe(0x00001018)
  })

  test('bus dispatches INTC ICR0 read', () => {
    const bus = createBootPeripheralBus()
    expect(bus.read16(0xfcfef800)).toBe(0x0000)
  })

  test('no registration overlaps', () => {
    // Reaches this line only if no throw happened in setup
    expect(() => createBootPeripheralBus()).not.toThrow()
  })
})
