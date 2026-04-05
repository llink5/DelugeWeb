// ElfLoader tests.
//
// The loader is exercised against a synthetic ARM32 LE ELF binary we build in
// memory per-test. That avoids checking in a compiled artefact and lets us
// cover error paths precisely.

import { describe, test, expect } from 'vitest'
import {
  parseElf,
  symbolsOfType,
  type ParsedElf,
} from '@/lib/emulator/ElfLoader'

// ---------------------------------------------------------------------------
// Synthetic ELF builder
// ---------------------------------------------------------------------------

const EH_SIZE = 52
const PH_SIZE = 32
const SH_SIZE = 40
const SYM_SIZE = 16

interface SynthSymbol {
  name: string
  address: number
  size: number
  type: 'func' | 'object' | 'notype'
  sectionIndex?: number
}

interface SynthSection {
  name: string
  type: 'progbits' | 'symtab' | 'strtab'
  flags: number
  addr: number
  data: Uint8Array
  link?: number
}

interface SynthSegment {
  vaddr: number
  data: Uint8Array
  memSize?: number
  flags?: number
}

interface SynthElfSpec {
  entry: number
  segments: SynthSegment[]
  symbols?: SynthSymbol[]
}

function u32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true)
}
function u16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value & 0xffff, true)
}
function u8(view: DataView, offset: number, value: number) {
  view.setUint8(offset, value & 0xff)
}

function buildStringTable(names: string[]): { data: Uint8Array; offsets: number[] } {
  const parts: number[] = [0] // leading null
  const offsets: number[] = []
  for (const name of names) {
    offsets.push(parts.length)
    for (let i = 0; i < name.length; i++) parts.push(name.charCodeAt(i))
    parts.push(0)
  }
  return { data: new Uint8Array(parts), offsets }
}

function buildElf(spec: SynthElfSpec): Uint8Array {
  const symbols = spec.symbols ?? []

  // Section name string table entries
  const sectionNames = ['.text', '.data', '.symtab', '.strtab', '.shstrtab']
  const shstr = buildStringTable(sectionNames)

  // Symbol name string table
  const symNames = symbols.map((s) => s.name)
  const symstr = buildStringTable(symNames)

  // Assemble segment data (laid out contiguously for simplicity)
  const ph0 = spec.segments[0] ?? {
    vaddr: 0x20000000,
    data: new Uint8Array(0),
    memSize: 0,
    flags: 0,
  }

  // Layout:
  // [ELF header][program headers][segment data...][shstrtab][symstr][symtab][section headers]
  let offset = EH_SIZE + PH_SIZE * spec.segments.length

  const segmentFileOffsets: number[] = []
  for (const seg of spec.segments) {
    segmentFileOffsets.push(offset)
    offset += seg.data.length
  }

  const shstrOffset = offset
  offset += shstr.data.length

  const symstrOffset = offset
  offset += symstr.data.length

  // Build symtab entries
  const symtabData = new Uint8Array(SYM_SIZE * (symbols.length + 1)) // +1 for null symbol
  const symtabView = new DataView(symtabData.buffer)
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i]
    const base = (i + 1) * SYM_SIZE
    u32(symtabView, base + 0, symstr.offsets[i])
    u32(symtabView, base + 4, s.address)
    u32(symtabView, base + 8, s.size)
    const type =
      s.type === 'func' ? 2 : s.type === 'object' ? 1 : 0
    u8(symtabView, base + 12, type) // info: bind=0, type
    u8(symtabView, base + 13, 0) // other
    u16(symtabView, base + 14, s.sectionIndex ?? 1)
  }
  const symtabOffset = offset
  offset += symtabData.length

  const shOffset = offset
  // 6 sections: null, .text, .data, .symtab, .strtab (for symbols), .shstrtab
  const numSections = 6
  const totalSize = shOffset + numSections * SH_SIZE

  const out = new Uint8Array(totalSize)
  const view = new DataView(out.buffer)

  // --- ELF header ---
  out[0] = 0x7f
  out[1] = 0x45
  out[2] = 0x4c
  out[3] = 0x46
  u8(view, 4, 1) // ELFCLASS32
  u8(view, 5, 1) // ELFDATA2LSB
  u8(view, 6, 1) // EV_CURRENT
  u16(view, 0x10, 2) // ET_EXEC
  u16(view, 0x12, 0x28) // EM_ARM
  u32(view, 0x14, 1) // e_version
  u32(view, 0x18, spec.entry) // e_entry
  u32(view, 0x1c, EH_SIZE) // e_phoff
  u32(view, 0x20, shOffset) // e_shoff
  u32(view, 0x24, 0) // e_flags
  u16(view, 0x28, EH_SIZE)
  u16(view, 0x2a, PH_SIZE)
  u16(view, 0x2c, spec.segments.length)
  u16(view, 0x2e, SH_SIZE)
  u16(view, 0x30, numSections)
  u16(view, 0x32, 5) // e_shstrndx → .shstrtab (index 5)

  // --- Program headers ---
  for (let i = 0; i < spec.segments.length; i++) {
    const seg = spec.segments[i]
    const base = EH_SIZE + i * PH_SIZE
    u32(view, base + 0, 1) // PT_LOAD
    u32(view, base + 4, segmentFileOffsets[i]) // p_offset
    u32(view, base + 8, seg.vaddr) // p_vaddr
    u32(view, base + 12, seg.vaddr) // p_paddr
    u32(view, base + 16, seg.data.length) // p_filesz
    u32(view, base + 20, seg.memSize ?? seg.data.length) // p_memsz
    u32(view, base + 24, seg.flags ?? 0x5) // p_flags (r-x default)
    u32(view, base + 28, 0x1000) // p_align
  }

  // --- Segment data ---
  for (let i = 0; i < spec.segments.length; i++) {
    out.set(spec.segments[i].data, segmentFileOffsets[i])
  }

  // --- String tables ---
  out.set(shstr.data, shstrOffset)
  out.set(symstr.data, symstrOffset)
  out.set(symtabData, symtabOffset)

  // --- Section headers ---
  const sections = [
    // 0: null
    { nameOffset: 0, type: 0, flags: 0, addr: 0, offset: 0, size: 0, link: 0 },
    // 1: .text
    {
      nameOffset: shstr.offsets[0],
      type: 1, // SHT_PROGBITS
      flags: 0x6, // ALLOC+EXEC
      addr: ph0.vaddr,
      offset: segmentFileOffsets[0] ?? 0,
      size: ph0.data.length,
      link: 0,
    },
    // 2: .data
    {
      nameOffset: shstr.offsets[1],
      type: 1,
      flags: 0x3, // ALLOC+WRITE
      addr: 0x20100000,
      offset: 0,
      size: 0,
      link: 0,
    },
    // 3: .symtab
    {
      nameOffset: shstr.offsets[2],
      type: 2, // SHT_SYMTAB
      flags: 0,
      addr: 0,
      offset: symtabOffset,
      size: symtabData.length,
      link: 4, // link to .strtab (section 4)
    },
    // 4: .strtab (for symbols)
    {
      nameOffset: shstr.offsets[3],
      type: 3, // SHT_STRTAB
      flags: 0,
      addr: 0,
      offset: symstrOffset,
      size: symstr.data.length,
      link: 0,
    },
    // 5: .shstrtab
    {
      nameOffset: shstr.offsets[4],
      type: 3,
      flags: 0,
      addr: 0,
      offset: shstrOffset,
      size: shstr.data.length,
      link: 0,
    },
  ]
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    const base = shOffset + i * SH_SIZE
    u32(view, base + 0, s.nameOffset)
    u32(view, base + 4, s.type)
    u32(view, base + 8, s.flags)
    u32(view, base + 12, s.addr)
    u32(view, base + 16, s.offset)
    u32(view, base + 20, s.size)
    u32(view, base + 24, s.link)
    u32(view, base + 28, 0) // info
    u32(view, base + 32, 4) // addralign
    u32(view, base + 36, s.type === 2 ? SYM_SIZE : 0) // entsize
  }

  return out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseElf — header & magic', () => {
  test('throws on too-short input', () => {
    expect(() => parseElf(new Uint8Array(10))).toThrow(/too small/i)
  })

  test('throws on bad magic', () => {
    const bytes = new Uint8Array(64)
    bytes[0] = 0x00
    expect(() => parseElf(bytes)).toThrow(/magic/i)
  })

  test('throws on ELFCLASS64', () => {
    const bytes = new Uint8Array(64)
    bytes.set([0x7f, 0x45, 0x4c, 0x46])
    bytes[4] = 2 // ELFCLASS64
    bytes[5] = 1
    expect(() => parseElf(bytes)).toThrow(/ELFCLASS32/)
  })

  test('throws on big-endian data', () => {
    const bytes = new Uint8Array(64)
    bytes.set([0x7f, 0x45, 0x4c, 0x46])
    bytes[4] = 1
    bytes[5] = 2 // big-endian
    expect(() => parseElf(bytes)).toThrow(/little-endian/)
  })

  test('throws on non-ARM machine', () => {
    const bytes = new Uint8Array(64)
    bytes.set([0x7f, 0x45, 0x4c, 0x46])
    bytes[4] = 1
    bytes[5] = 1
    // leave machine as zero (EM_NONE)
    expect(() => parseElf(bytes)).toThrow(/ARM/)
  })

  test('accepts a well-formed minimal ELF', () => {
    const elf = buildElf({
      entry: 0x20000000,
      segments: [{ vaddr: 0x20000000, data: new Uint8Array([0, 0, 0, 0]) }],
    })
    const parsed = parseElf(elf)
    expect(parsed.header.entry).toBe(0x20000000)
    expect(parsed.header.machine).toBe(0x28)
  })
})

describe('parseElf — program headers', () => {
  test('extracts PT_LOAD segments', () => {
    const elf = buildElf({
      entry: 0x20000100,
      segments: [
        { vaddr: 0x20000000, data: new Uint8Array([1, 2, 3, 4]) },
      ],
    })
    const parsed = parseElf(elf)
    expect(parsed.programHeaders).toHaveLength(1)
    expect(parsed.programHeaders[0].type).toBe(1)
    expect(parsed.programHeaders[0].vaddr).toBe(0x20000000)
    expect(parsed.programHeaders[0].fileSize).toBe(4)
  })

  test('builds loadable segments with correct data', () => {
    const data = new Uint8Array([0xca, 0xfe, 0xba, 0xbe])
    const elf = buildElf({
      entry: 0x20000000,
      segments: [{ vaddr: 0x20000000, data, memSize: 8 }],
    })
    const parsed = parseElf(elf)
    expect(parsed.loadable).toHaveLength(1)
    expect(parsed.loadable[0].vaddr).toBe(0x20000000)
    expect(Array.from(parsed.loadable[0].data)).toEqual([0xca, 0xfe, 0xba, 0xbe])
    expect(parsed.loadable[0].memSize).toBe(8)
  })

  test('preserves executable + writable flags', () => {
    const elf = buildElf({
      entry: 0x20000000,
      segments: [
        { vaddr: 0x20000000, data: new Uint8Array(4), flags: 0x5 }, // r-x
        { vaddr: 0x20100000, data: new Uint8Array(4), flags: 0x6 }, // rw-
      ],
    })
    const parsed = parseElf(elf)
    expect(parsed.loadable[0].executable).toBe(true)
    expect(parsed.loadable[0].writable).toBe(false)
    expect(parsed.loadable[1].executable).toBe(false)
    expect(parsed.loadable[1].writable).toBe(true)
  })

  test('zero-sized segments are skipped', () => {
    const elf = buildElf({
      entry: 0x20000000,
      segments: [
        { vaddr: 0x20000000, data: new Uint8Array(4) },
        { vaddr: 0x20001000, data: new Uint8Array(0), memSize: 0 },
      ],
    })
    const parsed = parseElf(elf)
    // The zero-memsize segment is dropped from loadable
    expect(parsed.loadable).toHaveLength(1)
  })
})

describe('parseElf — sections', () => {
  test('extracts section names', () => {
    const elf = buildElf({
      entry: 0x20000000,
      segments: [{ vaddr: 0x20000000, data: new Uint8Array(4) }],
    })
    const parsed = parseElf(elf)
    const names = parsed.sections.map((s) => s.name)
    expect(names).toContain('.text')
    expect(names).toContain('.data')
    expect(names).toContain('.symtab')
  })

  test('.text is marked alloc + exec', () => {
    const elf = buildElf({
      entry: 0x20000000,
      segments: [{ vaddr: 0x20000000, data: new Uint8Array(4) }],
    })
    const parsed = parseElf(elf)
    const text = parsed.sections.find((s) => s.name === '.text')!
    expect(text.alloc).toBe(true)
    expect(text.exec).toBe(true)
  })
})

describe('parseElf — symbols', () => {
  test('extracts function and object symbols', () => {
    const elf = buildElf({
      entry: 0x20000000,
      segments: [{ vaddr: 0x20000000, data: new Uint8Array(4) }],
      symbols: [
        { name: 'main', address: 0x20000100, size: 32, type: 'func' },
        { name: 'currentSong', address: 0x20100000, size: 4, type: 'object' },
        { name: 'init', address: 0x20000000, size: 16, type: 'func' },
      ],
    })
    const parsed = parseElf(elf)
    expect(parsed.symbols).toHaveLength(3)
    const names = parsed.symbols.map((s) => s.name).sort()
    expect(names).toEqual(['currentSong', 'init', 'main'])
  })

  test('symbol addresses and sizes are preserved', () => {
    const elf = buildElf({
      entry: 0x20000000,
      segments: [{ vaddr: 0x20000000, data: new Uint8Array(4) }],
      symbols: [{ name: 'main', address: 0x20000100, size: 64, type: 'func' }],
    })
    const parsed = parseElf(elf)
    const main = parsed.symbols.find((s) => s.name === 'main')!
    expect(main.address).toBe(0x20000100)
    expect(main.size).toBe(64)
    expect(main.type).toBe(2) // STT_FUNC
  })

  test('unnamed symbols are skipped', () => {
    const elf = buildElf({
      entry: 0x20000000,
      segments: [{ vaddr: 0x20000000, data: new Uint8Array(4) }],
      symbols: [
        { name: '', address: 0, size: 0, type: 'notype' },
        { name: 'main', address: 0x20000100, size: 16, type: 'func' },
      ],
    })
    const parsed = parseElf(elf)
    // The empty-name symbol is filtered out
    expect(parsed.symbols.every((s) => s.name !== '')).toBe(true)
  })
})

describe('symbolsOfType', () => {
  let parsed: ParsedElf
  test('filters by FUNC / OBJECT', () => {
    const elf = buildElf({
      entry: 0x20000000,
      segments: [{ vaddr: 0x20000000, data: new Uint8Array(4) }],
      symbols: [
        { name: 'main', address: 0x20000100, size: 32, type: 'func' },
        { name: 'currentSong', address: 0x20100000, size: 4, type: 'object' },
      ],
    })
    parsed = parseElf(elf)
    const funcs = symbolsOfType(parsed.symbols, 'func')
    expect(funcs).toHaveLength(1)
    expect(funcs[0].name).toBe('main')
    const objs = symbolsOfType(parsed.symbols, 'object')
    expect(objs).toHaveLength(1)
    expect(objs[0].name).toBe('currentSong')
  })
})
