// RZ/A1L memory map.
//
// RZ/A1L Hardware Manual Rev. 7.00 (R01UH0437EJ0700)
//   Chapter 5.4 Address Map — table 5.5
//
// The chip presents a 4 GB 32-bit address space where external-memory CS
// spaces, on-chip RAM, peripheral I/O windows, and ROM are all fixed at
// documented bases. This table captures every region mapped on a
// bare-metal RZ/A1L.
//
// Memory regions the emulator needs to honour:
//   - CS0..CS5 external memory spaces (64 MB each, 0x00000000..0x17FFFFFF)
//   - SPI multi-I/O bus (64 MB, 0x18000000..0x1BFFFFFF)
//   - On-chip large-capacity RAM: five 512 KB pages at 0x20000000..0x202FFFFF
//   - Cached mirror @ 0x4xxxxxxx, uncached mirror @ 0x6xxxxxxx
//   - I/O areas at 0xE8000000..0xE822FFFF, 0xFCFE0000..0xFCFFFFFF, 0x3FFFC000
//   - ROM at 0xFFFF0000..0xFFFFFFFF
//
// The peripheral stubs in `peripherals/` register specific subranges of the
// I/O windows; addresses that fall inside a peripheral window but are not
// claimed by any stub return zero and accept writes silently.

export type MemoryPermissions = 'r--' | 'r-x' | 'rw-' | 'rwx'

export interface MemoryRegion {
  name: string
  start: number
  size: number
  perms: MemoryPermissions
  peripheral?: boolean
  aliasOf?: string
  description?: string
}

export const MEMORY_REGIONS: MemoryRegion[] = [
  // External bus CS spaces (64 MB each)
  {
    name: 'CS0',
    start: 0x00000000,
    size: 0x04000000,
    perms: 'rwx',
    description: 'CS0 external memory space (boot ROM / NOR)',
  },
  {
    name: 'CS1',
    start: 0x04000000,
    size: 0x04000000,
    perms: 'rwx',
    description: 'CS1 external memory space',
  },
  {
    name: 'CS2',
    start: 0x08000000,
    size: 0x04000000,
    perms: 'rwx',
    description: 'CS2 external memory space',
  },
  {
    name: 'CS3',
    start: 0x0c000000,
    size: 0x04000000,
    perms: 'rwx',
    description: 'CS3 external memory space (commonly SDRAM)',
  },
  {
    name: 'CS4',
    start: 0x10000000,
    size: 0x04000000,
    perms: 'rwx',
    description: 'CS4 external memory space',
  },
  {
    name: 'CS5',
    start: 0x14000000,
    size: 0x04000000,
    perms: 'rwx',
    description: 'CS5 external memory space',
  },
  // SPI multi-I/O bus
  {
    name: 'SPI_FLASH',
    start: 0x18000000,
    size: 0x04000000,
    perms: 'r-x',
    description: 'SPI multi-I/O bus / serial flash window (64 MB)',
  },
  // On-chip large-capacity RAM (3 MB total, 5 pages of 512 KB)
  {
    name: 'OC_RAM',
    start: 0x20000000,
    size: 0x00300000,
    perms: 'rwx',
    description: 'On-chip large-capacity RAM pages 0..4 (3 MB)',
  },
  // Cached mirror area (CS0..CS5 + SPI + OC RAM)
  {
    name: 'MIRROR_CS0_C',
    start: 0x40000000,
    size: 0x04000000,
    perms: 'rwx',
    aliasOf: 'CS0',
    description: 'Cached CS0 mirror',
  },
  {
    name: 'MIRROR_CS3_C',
    start: 0x4c000000,
    size: 0x04000000,
    perms: 'rwx',
    aliasOf: 'CS3',
    description: 'Cached CS3 mirror (SDRAM mirror)',
  },
  {
    name: 'MIRROR_OC_RAM',
    start: 0x60000000,
    size: 0x00300000,
    perms: 'rwx',
    aliasOf: 'OC_RAM',
    description: 'Uncached on-chip RAM mirror',
  },
  // I/O areas
  {
    name: 'IO_E8',
    start: 0xe8000000,
    size: 0x00230000,
    perms: 'rw-',
    peripheral: true,
    description: 'I/O area SLV2/SLV3/SLV4 (GIC, Ethernet, CoreSight)',
  },
  {
    name: 'IO_FC_LOW',
    start: 0xfc000000,
    size: 0x00080000,
    perms: 'rw-',
    peripheral: true,
    description: 'I/O area SLV6',
  },
  {
    name: 'IO_FCFE',
    start: 0xfcfe0000,
    size: 0x00010000,
    perms: 'rw-',
    peripheral: true,
    description: 'I/O area SLV1 — CPG, BSC, INTC ICR, OSTM, GPIO, ports',
  },
  {
    name: 'IO_FCFF',
    start: 0xfcff0000,
    size: 0x00010000,
    perms: 'rw-',
    peripheral: true,
    description: 'I/O area SLV0 — deep-standby, RCAN, watchdog, etc.',
  },
  {
    name: 'BSC',
    start: 0x3fffc000,
    size: 0x00004000,
    perms: 'rw-',
    peripheral: true,
    description: 'Bus State Controller registers',
  },
  // Cortex-A9 private area (SCU, global timer, private peripherals)
  {
    name: 'A9_PRIVATE',
    start: 0xf0000000,
    size: 0x00002000,
    perms: 'rw-',
    peripheral: true,
    description: 'Cortex-A9 private peripheral area (SCU, global timer)',
  },
  // Boot ROM
  {
    name: 'BOOT_ROM',
    start: 0xffff0000,
    size: 0x00010000,
    perms: 'r-x',
    description: 'On-chip boot ROM (SLV4)',
  },
]

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function regionForAddress(addr: number): MemoryRegion | undefined {
  for (const r of MEMORY_REGIONS) {
    if (addr >= r.start && addr < r.start + r.size) return r
  }
  return undefined
}

export function backingRegion(region: MemoryRegion): MemoryRegion {
  if (!region.aliasOf) return region
  const target = MEMORY_REGIONS.find((r) => r.name === region.aliasOf)
  if (!target) return region
  return backingRegion(target)
}

export function isPeripheral(addr: number): boolean {
  const r = regionForAddress(addr)
  return r?.peripheral === true
}

export function isMapped(addr: number): boolean {
  return regionForAddress(addr) !== undefined
}

export function offsetInRegion(
  addr: number,
): { region: MemoryRegion; offset: number } | undefined {
  const r = regionForAddress(addr)
  if (!r) return undefined
  return { region: r, offset: addr - r.start }
}

export function backingRegions(): MemoryRegion[] {
  return MEMORY_REGIONS.filter((r) => r.aliasOf === undefined)
}

export function totalBackingBytes(): number {
  let bytes = 0
  for (const r of backingRegions()) {
    if (r.peripheral) continue
    bytes += r.size
  }
  return bytes
}
