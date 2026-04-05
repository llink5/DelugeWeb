// MemoryMap tests — RZ/A1L chip spec (chapter 5.4, table 5.5).

import { describe, test, expect } from 'vitest'
import {
  MEMORY_REGIONS,
  regionForAddress,
  backingRegion,
  isPeripheral,
  isMapped,
  offsetInRegion,
  backingRegions,
  totalBackingBytes,
} from '@/lib/emulator/MemoryMap'

describe('RZ/A1L address map coverage', () => {
  test('declares six CS spaces of 64 MB each', () => {
    for (let i = 0; i < 6; i++) {
      const r = MEMORY_REGIONS.find((x) => x.name === `CS${i}`)!
      expect(r).toBeTruthy()
      expect(r.size).toBe(0x04000000)
      expect(r.start).toBe(i * 0x04000000)
    }
  })

  test('SPI flash window at 0x18000000', () => {
    const r = MEMORY_REGIONS.find((x) => x.name === 'SPI_FLASH')!
    expect(r.start).toBe(0x18000000)
    expect(r.size).toBe(0x04000000)
  })

  test('on-chip RAM at 0x20000000 is 3 MB', () => {
    const r = MEMORY_REGIONS.find((x) => x.name === 'OC_RAM')!
    expect(r.start).toBe(0x20000000)
    expect(r.size).toBe(0x00300000)
  })

  test('mirror areas alias their originals', () => {
    const csMirror = MEMORY_REGIONS.find((x) => x.name === 'MIRROR_CS3_C')!
    expect(csMirror.aliasOf).toBe('CS3')
    expect(csMirror.start).toBe(0x4c000000)
    const ocMirror = MEMORY_REGIONS.find((x) => x.name === 'MIRROR_OC_RAM')!
    expect(ocMirror.aliasOf).toBe('OC_RAM')
  })

  test('peripheral I/O windows are flagged', () => {
    expect(MEMORY_REGIONS.find((x) => x.name === 'IO_FCFE')!.peripheral).toBe(true)
    expect(MEMORY_REGIONS.find((x) => x.name === 'IO_E8')!.peripheral).toBe(true)
    expect(MEMORY_REGIONS.find((x) => x.name === 'BSC')!.peripheral).toBe(true)
  })

  test('boot ROM at 0xFFFF0000', () => {
    const r = MEMORY_REGIONS.find((x) => x.name === 'BOOT_ROM')!
    expect(r.start).toBe(0xffff0000)
    expect(r.size).toBe(0x00010000)
    expect(r.perms).toBe('r-x')
  })
})

describe('regionForAddress', () => {
  test('CS0 address', () => {
    expect(regionForAddress(0x00000000)?.name).toBe('CS0')
    expect(regionForAddress(0x03ffffff)?.name).toBe('CS0')
  })

  test('CS3 address', () => {
    expect(regionForAddress(0x0c000000)?.name).toBe('CS3')
  })

  test('SPI flash address', () => {
    expect(regionForAddress(0x18000000)?.name).toBe('SPI_FLASH')
  })

  test('on-chip RAM address', () => {
    expect(regionForAddress(0x20000000)?.name).toBe('OC_RAM')
    expect(regionForAddress(0x202fffff)?.name).toBe('OC_RAM')
  })

  test('I/O window address', () => {
    expect(regionForAddress(0xfcfe0010)?.name).toBe('IO_FCFE')
    expect(regionForAddress(0xe8201000)?.name).toBe('IO_E8')
    expect(regionForAddress(0x3fffc000)?.name).toBe('BSC')
  })

  test('address in no region', () => {
    expect(regionForAddress(0x1c000000)).toBeUndefined() // reserved between 0x1C000000 and 0x1FFFFFFF
  })

  test('boundary: past end of region excluded', () => {
    const sram = MEMORY_REGIONS.find((r) => r.name === 'OC_RAM')!
    expect(regionForAddress(sram.start + sram.size)).not.toBe(sram)
  })
})

describe('backingRegion', () => {
  test('returns self for non-aliased regions', () => {
    const r = MEMORY_REGIONS.find((x) => x.name === 'OC_RAM')!
    expect(backingRegion(r)).toBe(r)
  })

  test('resolves MIRROR_CS3_C → CS3', () => {
    const mirror = MEMORY_REGIONS.find((x) => x.name === 'MIRROR_CS3_C')!
    expect(backingRegion(mirror).name).toBe('CS3')
  })

  test('resolves MIRROR_OC_RAM → OC_RAM', () => {
    const mirror = MEMORY_REGIONS.find((x) => x.name === 'MIRROR_OC_RAM')!
    expect(backingRegion(mirror).name).toBe('OC_RAM')
  })
})

describe('isPeripheral / isMapped', () => {
  test('isPeripheral true for I/O windows', () => {
    expect(isPeripheral(0xfcfe0000)).toBe(true)
    expect(isPeripheral(0xe8201000)).toBe(true)
  })

  test('isPeripheral false for RAM / CS regions', () => {
    expect(isPeripheral(0x20000000)).toBe(false)
    expect(isPeripheral(0x0c000000)).toBe(false)
  })

  test('isMapped true for every declared region', () => {
    expect(isMapped(0x00000000)).toBe(true)
    expect(isMapped(0x0c000000)).toBe(true)
    expect(isMapped(0x20000000)).toBe(true)
    expect(isMapped(0x18000000)).toBe(true)
    expect(isMapped(0xfcfe0000)).toBe(true)
    expect(isMapped(0xffff0000)).toBe(true)
  })

  test('isMapped false for reserved gaps', () => {
    expect(isMapped(0x1c000000)).toBe(false)
    expect(isMapped(0xe0000000)).toBe(false)
  })
})

describe('offsetInRegion', () => {
  test('zero at region start', () => {
    const r = offsetInRegion(0x20000000)
    expect(r?.offset).toBe(0)
    expect(r?.region.name).toBe('OC_RAM')
  })

  test('non-zero within region', () => {
    expect(offsetInRegion(0x0c000100)?.offset).toBe(0x100)
  })

  test('undefined for unmapped', () => {
    expect(offsetInRegion(0x1c000000)).toBeUndefined()
  })
})

describe('backingRegions + totalBackingBytes', () => {
  test('excludes aliases', () => {
    const names = backingRegions().map((r) => r.name)
    expect(names).not.toContain('MIRROR_CS3_C')
    expect(names).not.toContain('MIRROR_OC_RAM')
    expect(names).toContain('OC_RAM')
    expect(names).toContain('CS3')
  })

  test('totalBackingBytes sums RAM + CS + flash + ROM', () => {
    const bytes = totalBackingBytes()
    // 6 CS × 64 MB + 64 MB flash + 3 MB OC RAM + 64 KB ROM = 451 MB + 64 KB
    const expected =
      6 * 0x04000000 + // 6 CS spaces
      0x04000000 +     // SPI_FLASH
      0x00300000 +     // OC_RAM
      0x00010000       // BOOT_ROM
    expect(bytes).toBe(expected)
  })
})
