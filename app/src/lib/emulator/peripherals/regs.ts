// Register-level infrastructure for RZ/A1L peripheral stubs.
//
// Each peripheral declares its registers with exact address, width, reset
// value, and (optionally) read/write side-effect hooks. The runtime
// dispatches chip-style byte/halfword/word accesses through the declared
// register set, enforcing the documented access widths.
//
// Register specifications follow the Renesas RZ/A1L Hardware Manual
// (R01UH0437EJ). Each peripheral file references the specific chapter.

export type RegisterWidth = 8 | 16 | 32

export interface RegisterDef {
  /** Short register name as printed in the manual (e.g. "FRQCR", "CMNCR"). */
  name: string
  /** Absolute byte address on the chip's memory map. */
  address: number
  /** Native access width in bits. */
  width: RegisterWidth
  /** Power-on reset value. */
  reset: number
  /** Bit mask of writable bits (default: all 1s within the width). */
  writeMask?: number
  /**
   * Bits that are always 0 in the reported value regardless of writes.
   * Bits not in writeMask are also forced to their reset state — `writeMask`
   * alone is enough to model most registers.
   */
  /** Called BEFORE returning the value on a read. Returns possibly-modified value. */
  onRead?: (current: number, def: RegisterDef) => number
  /**
   * Called AFTER a write has updated the backing store. Useful for status-
   * bit reactions (e.g. setting PLL_LOCK when FRQCR is written).
   */
  onWrite?: (newValue: number, oldValue: number, def: RegisterDef) => void
  /** Writes to this register are ignored. Reads still return the reset. */
  readOnly?: boolean
  /** True when this register is write-only (reads return 0). */
  writeOnly?: boolean
}

/** Compute the default writable mask for a given width. */
function fullMask(width: RegisterWidth): number {
  if (width === 8) return 0xff
  if (width === 16) return 0xffff
  return 0xffffffff
}

/** A declarative, spec-compliant register map. */
export class RegisterMap {
  private readonly byAddress = new Map<number, RegisterDef>()
  private values = new Map<number, number>()

  constructor(defs: RegisterDef[]) {
    for (const def of defs) {
      this.byAddress.set(def.address, def)
      this.values.set(def.address, def.reset >>> 0)
    }
  }

  /** Restore every register to its documented reset value. */
  reset(): void {
    for (const [addr, def] of this.byAddress) {
      this.values.set(addr, def.reset >>> 0)
    }
  }

  /** Access the raw stored value without invoking hooks. */
  peek(address: number): number | undefined {
    return this.values.get(address)
  }

  /** Overwrite a register value without invoking hooks. */
  poke(address: number, value: number): void {
    const def = this.byAddress.get(address)
    if (!def) return
    this.values.set(address, (value & fullMask(def.width)) >>> 0)
  }

  /** Get the definition at an address (for introspection / tests). */
  definitionAt(address: number): RegisterDef | undefined {
    return this.byAddress.get(address)
  }

  /** Enumerate every register declared on this map. */
  entries(): Iterable<RegisterDef> {
    return this.byAddress.values()
  }

  // ---------------------------------------------------------------------------
  // Bus-width accesses
  // ---------------------------------------------------------------------------

  read32(address: number): number {
    return this.readAs(address, 32)
  }
  read16(address: number): number {
    return this.readAs(address, 16)
  }
  read8(address: number): number {
    return this.readAs(address, 8)
  }
  write32(address: number, value: number): void {
    this.writeAs(address, value, 32)
  }
  write16(address: number, value: number): void {
    this.writeAs(address, value, 16)
  }
  write8(address: number, value: number): void {
    this.writeAs(address, value, 8)
  }

  /** Called by the PeripheralBus with the full absolute address. */
  private readAs(address: number, accessWidth: RegisterWidth): number {
    const def = this.findCovering(address, accessWidth)
    if (!def) return 0
    if (def.writeOnly) return 0
    let raw = this.values.get(def.address) ?? def.reset
    if (def.onRead) raw = def.onRead(raw, def)
    raw = (raw & fullMask(def.width)) >>> 0
    // If the access straddles a sub-width slice of a wider register, extract
    // the matching byte/halfword.
    if (def.width === accessWidth) return raw
    const byteOffset = address - def.address
    if (accessWidth === 8) {
      return (raw >>> (byteOffset * 8)) & 0xff
    }
    if (accessWidth === 16) {
      return (raw >>> (byteOffset * 8)) & 0xffff
    }
    // accessWidth === 32 but def is narrower → just return raw zero-extended
    return raw
  }

  private writeAs(address: number, value: number, accessWidth: RegisterWidth): void {
    const def = this.findCovering(address, accessWidth)
    if (!def) return
    if (def.readOnly) return
    const mask = def.writeMask ?? fullMask(def.width)
    const current = this.values.get(def.address) ?? def.reset
    let incoming: number
    if (def.width === accessWidth) {
      incoming = value & fullMask(def.width)
    } else if (accessWidth < def.width) {
      // Partial-width write into a wider register: merge the byte/halfword
      // into the existing wider value.
      const byteOffset = address - def.address
      const shift = byteOffset * 8
      const partialMask = fullMask(accessWidth) << shift
      incoming =
        (((current & ~partialMask) | ((value & fullMask(accessWidth)) << shift)) >>>
          0) &
        fullMask(def.width)
    } else {
      // Wider access than the register — truncate.
      incoming = value & fullMask(def.width)
    }
    const merged = ((current & ~mask) | (incoming & mask)) >>> 0
    this.values.set(def.address, merged)
    if (def.onWrite) def.onWrite(merged, current, def)
  }

  private findCovering(
    address: number,
    accessWidth: RegisterWidth,
  ): RegisterDef | undefined {
    const accessBytes = accessWidth / 8
    // Exact hit
    const direct = this.byAddress.get(address)
    if (direct) return direct
    // Sub-access into a wider register: check for a register whose range
    // covers [address, address+accessBytes).
    for (const def of this.byAddress.values()) {
      const defBytes = def.width / 8
      if (
        address >= def.address &&
        address + accessBytes <= def.address + defBytes
      ) {
        return def
      }
    }
    return undefined
  }
}
