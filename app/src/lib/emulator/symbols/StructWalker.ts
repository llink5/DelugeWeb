// StructWalker — navigate C++ structs through live emulator memory.
//
// Given a struct definition (field name + byte offset + C-style primitive
// type) and a base address, read the fields out of the attached memory
// reader. Pointer fields can be walked by chaining another struct
// definition against the dereferenced address.
//
// Layouts here are approximations of the Deluge firmware's C++ classes.
// Real offsets depend on the compiler — updating them from the ELF's DWARF
// info is a Phase E+ upgrade. For now these are useful examples showing
// the walker's shape; developers will tune them against their own builds.

export type FieldType =
  | 'u8'
  | 'i8'
  | 'u16'
  | 'i16'
  | 'u32'
  | 'i32'
  | 'ptr'
  | 'bool'
  | 'hex32'

export interface StructField {
  name: string
  offset: number
  type: FieldType
  /** For pointer fields, the type name that describes what it points to. */
  pointsTo?: string
}

export interface StructDefinition {
  name: string
  size: number
  fields: StructField[]
}

export interface MemoryReader {
  read8(addr: number): number
  read16(addr: number): number
  read32(addr: number): number
}

export interface FieldValue {
  name: string
  offset: number
  type: FieldType
  raw: number
  display: string
  /** Address for pointer fields; undefined otherwise. */
  pointsTo?: { typeName: string; address: number }
}

export class StructWalker {
  private registry = new Map<string, StructDefinition>()

  constructor(
    private readonly memory: MemoryReader,
    definitions: StructDefinition[] = [],
  ) {
    for (const d of definitions) this.registry.set(d.name, d)
  }

  register(def: StructDefinition): void {
    this.registry.set(def.name, def)
  }

  definitionFor(name: string): StructDefinition | undefined {
    return this.registry.get(name)
  }

  /** List all registered struct names (stable-sorted). */
  list(): string[] {
    return Array.from(this.registry.keys()).sort()
  }

  /**
   * Read a struct at `address`, returning every field with its raw value,
   * a pretty display string, and (for pointers) the target address.
   * Returns undefined if the struct is unknown.
   */
  read(typeName: string, address: number): FieldValue[] | undefined {
    const def = this.registry.get(typeName)
    if (!def) return undefined
    const out: FieldValue[] = []
    for (const f of def.fields) {
      const addr = (address + f.offset) >>> 0
      const { raw, display } = this.readField(addr, f.type)
      const fv: FieldValue = {
        name: f.name,
        offset: f.offset,
        type: f.type,
        raw,
        display,
      }
      if (f.type === 'ptr' && f.pointsTo) {
        fv.pointsTo = { typeName: f.pointsTo, address: raw >>> 0 }
      }
      out.push(fv)
    }
    return out
  }

  /**
   * Walk a pointer chain. Each step reads a pointer-typed field and returns
   * the address it points at. Stops and returns undefined if a step points
   * to NULL.
   */
  walk(
    typeName: string,
    address: number,
    path: string[],
  ): { type: string; address: number } | undefined {
    let currentType = typeName
    let currentAddr = address >>> 0
    for (const step of path) {
      const fields = this.read(currentType, currentAddr)
      if (!fields) return undefined
      const f = fields.find((x) => x.name === step)
      if (!f || !f.pointsTo) return undefined
      const target = f.raw >>> 0
      if (target === 0) return undefined
      currentType = f.pointsTo.typeName
      currentAddr = target
    }
    return { type: currentType, address: currentAddr }
  }

  // ---------------------------------------------------------------------------
  // Field reader
  // ---------------------------------------------------------------------------

  private readField(
    addr: number,
    type: FieldType,
  ): { raw: number; display: string } {
    switch (type) {
      case 'u8': {
        const v = this.memory.read8(addr)
        return { raw: v, display: String(v) }
      }
      case 'i8': {
        const v = this.memory.read8(addr)
        const signed = v & 0x80 ? v - 0x100 : v
        return { raw: signed, display: String(signed) }
      }
      case 'u16': {
        const v = this.memory.read16(addr)
        return { raw: v, display: String(v) }
      }
      case 'i16': {
        const v = this.memory.read16(addr)
        const signed = v & 0x8000 ? v - 0x10000 : v
        return { raw: signed, display: String(signed) }
      }
      case 'u32': {
        const v = this.memory.read32(addr)
        return { raw: v >>> 0, display: String(v >>> 0) }
      }
      case 'i32': {
        const v = this.memory.read32(addr) | 0
        return { raw: v, display: String(v) }
      }
      case 'bool': {
        const v = this.memory.read8(addr)
        return { raw: v, display: v === 0 ? 'false' : 'true' }
      }
      case 'hex32': {
        const v = this.memory.read32(addr) >>> 0
        return { raw: v, display: '0x' + v.toString(16).toUpperCase().padStart(8, '0') }
      }
      case 'ptr': {
        const v = this.memory.read32(addr) >>> 0
        return { raw: v, display: '0x' + v.toString(16).toUpperCase().padStart(8, '0') }
      }
    }
  }
}
