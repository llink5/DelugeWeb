// CPU memory controller.
//
// Owns the set of mapped RAM regions plus a parallel list of peripheral
// windows. Reads/writes consult peripherals first (they overlay RAM), then
// fall back to the mapped region list, then return 0 / no-op for unmapped
// addresses.
//
// All reads are little-endian; addresses do not need to be aligned (the ARM
// Cortex-A9 supports unaligned access at this width, and this simplification
// lets us skip alignment faults for the boot subset).

export type MemoryPerms = 'r--' | 'r-x' | 'rw-' | 'rwx'

export interface MappedRegion {
  start: number
  size: number
  perms: MemoryPerms
  buffer: Uint8Array
}

export interface PeripheralWindow {
  start: number
  size: number
  read: (offset: number, width: 1 | 2 | 4) => number
  write: (offset: number, width: 1 | 2 | 4, value: number) => void
}

export class CpuMemoryController {
  private regions: MappedRegion[] = []
  private peripherals: PeripheralWindow[] = []

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  mapRegion(r: MappedRegion): void {
    this.regions.push(r)
  }

  addPeripheral(p: PeripheralWindow): void {
    this.peripherals.push(p)
  }

  clear(): void {
    this.regions = []
    this.peripherals = []
  }

  /** Enumerate every mapped RAM region (snapshots iterate these). */
  listRegions(): readonly MappedRegion[] {
    return this.regions
  }

  // ---------------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------------

  private peripheralFor(addr: number): PeripheralWindow | undefined {
    for (const p of this.peripherals) {
      if (addr >= p.start && addr < p.start + p.size) return p
    }
    return undefined
  }

  private regionFor(addr: number): MappedRegion | undefined {
    for (const r of this.regions) {
      if (addr >= r.start && addr < r.start + r.size) return r
    }
    return undefined
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  read8(addr: number): number {
    const p = this.peripheralFor(addr)
    if (p) return p.read(addr - p.start, 1) & 0xff
    const r = this.regionFor(addr)
    if (!r) return 0
    return r.buffer[addr - r.start] & 0xff
  }

  read16(addr: number): number {
    const p = this.peripheralFor(addr)
    if (p) return p.read(addr - p.start, 2) & 0xffff
    const r = this.regionFor(addr)
    if (!r || addr - r.start + 2 > r.size) return 0
    const o = addr - r.start
    return (r.buffer[o] | (r.buffer[o + 1] << 8)) & 0xffff
  }

  read32(addr: number): number {
    const p = this.peripheralFor(addr)
    if (p) return p.read(addr - p.start, 4) >>> 0
    const r = this.regionFor(addr)
    if (!r || addr - r.start + 4 > r.size) return 0
    const o = addr - r.start
    return (
      (r.buffer[o] |
        (r.buffer[o + 1] << 8) |
        (r.buffer[o + 2] << 16) |
        (r.buffer[o + 3] << 24)) >>>
      0
    )
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  write8(addr: number, value: number): void {
    const p = this.peripheralFor(addr)
    if (p) {
      p.write(addr - p.start, 1, value & 0xff)
      return
    }
    const r = this.regionFor(addr)
    if (!r) return
    r.buffer[addr - r.start] = value & 0xff
  }

  write16(addr: number, value: number): void {
    const p = this.peripheralFor(addr)
    if (p) {
      p.write(addr - p.start, 2, value & 0xffff)
      return
    }
    const r = this.regionFor(addr)
    if (!r || addr - r.start + 2 > r.size) return
    const o = addr - r.start
    r.buffer[o] = value & 0xff
    r.buffer[o + 1] = (value >>> 8) & 0xff
  }

  write32(addr: number, value: number): void {
    const p = this.peripheralFor(addr)
    if (p) {
      p.write(addr - p.start, 4, value >>> 0)
      return
    }
    const r = this.regionFor(addr)
    if (!r || addr - r.start + 4 > r.size) return
    const o = addr - r.start
    r.buffer[o] = value & 0xff
    r.buffer[o + 1] = (value >>> 8) & 0xff
    r.buffer[o + 2] = (value >>> 16) & 0xff
    r.buffer[o + 3] = (value >>> 24) & 0xff
  }

  // ---------------------------------------------------------------------------
  // Bulk helpers (for ArmCore readMemory/writeMemory and ELF loading)
  // ---------------------------------------------------------------------------

  readBytes(addr: number, length: number): Uint8Array {
    const out = new Uint8Array(length)
    // Prefer a single direct-region slice when the request is entirely inside
    // one region — much faster for ELF loads and dumps.
    const r = this.regionFor(addr)
    if (r && addr - r.start + length <= r.size) {
      const o = addr - r.start
      out.set(r.buffer.subarray(o, o + length))
      return out
    }
    for (let i = 0; i < length; i++) out[i] = this.read8(addr + i)
    return out
  }

  writeBytes(addr: number, data: Uint8Array): void {
    const r = this.regionFor(addr)
    if (r && addr - r.start + data.length <= r.size) {
      const o = addr - r.start
      r.buffer.set(data, o)
      return
    }
    // Peripheral window: prefer the widest access the data alignment permits,
    // so peripheral stubs see a single write32 (or write16) instead of four
    // scattered byte writes that most audio / SSI stubs ignore.
    let i = 0
    while (i < data.length) {
      const rem = data.length - i
      if ((addr + i) % 4 === 0 && rem >= 4) {
        const v =
          (data[i] |
            (data[i + 1] << 8) |
            (data[i + 2] << 16) |
            (data[i + 3] << 24)) >>> 0
        this.write32(addr + i, v)
        i += 4
      } else if ((addr + i) % 2 === 0 && rem >= 2) {
        const v = (data[i] | (data[i + 1] << 8)) & 0xffff
        this.write16(addr + i, v)
        i += 2
      } else {
        this.write8(addr + i, data[i])
        i++
      }
    }
  }
}
