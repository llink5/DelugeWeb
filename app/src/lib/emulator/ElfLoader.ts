// ELF32 little-endian ARM loader.
//
// Parses the subset of the ELF format needed to host the Deluge firmware in
// the browser emulator: the header, the program headers (for loading), the
// section headers (for debugging), and the .symtab/.strtab tables (for
// name→address resolution).
//
// The loader does NOT perform any linking or relocation — the firmware ELF is
// already fully linked by `arm-none-eabi-ld`. We only copy loadable segments
// into the emulator's address space and surface metadata for the symbol map.

// ---------------------------------------------------------------------------
// ELF constants
// ---------------------------------------------------------------------------

const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46] // 0x7F 'E' 'L' 'F'
const ELFCLASS32 = 1
const ELFDATA2LSB = 1
const EM_ARM = 0x28

/** Program-header type — loadable segment. */
const PT_LOAD = 1

/** Section-header types we care about. */
const SHT_PROGBITS = 1
const SHT_SYMTAB = 2
const SHT_STRTAB = 3
const SHT_NOBITS = 8

/** Section-header flag — allocated in memory. */
const SHF_ALLOC = 0x2
/** Section-header flag — executable. */
const SHF_EXECINSTR = 0x4

/** Symbol table info: bind (upper 4 bits), type (lower 4 bits). */
const STT_FUNC = 2
const STT_OBJECT = 1
const STT_NOTYPE = 0

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ElfHeader {
  entry: number
  /** Virtual address of the start of the program. */
  machine: number
  /** ELF type: 2 = executable. */
  type: number
  programHeaderOffset: number
  programHeaderCount: number
  sectionHeaderOffset: number
  sectionHeaderCount: number
  sectionHeaderStringTableIndex: number
}

export interface ElfProgramHeader {
  type: number
  offset: number
  /** Virtual address where the segment is loaded. */
  vaddr: number
  /** Physical address (usually same as vaddr on bare metal). */
  paddr: number
  /** Bytes present in the file. */
  fileSize: number
  /** Bytes allocated at runtime (can exceed fileSize for .bss). */
  memSize: number
  flags: number
}

export interface ElfSection {
  name: string
  type: number
  flags: number
  addr: number
  offset: number
  size: number
  link: number
  /** True when the section has allocation flag set (loadable). */
  alloc: boolean
  /** True when the section is executable. */
  exec: boolean
}

export interface ElfSymbol {
  name: string
  address: number
  size: number
  /** Symbol type: FUNC, OBJECT, NOTYPE, etc. */
  type: number
  /** Section index the symbol is defined in. */
  sectionIndex: number
}

export interface ElfLoadableSegment {
  /** Virtual load address. */
  vaddr: number
  /** Bytes to copy from the ELF into emulator memory. */
  data: Uint8Array
  /** Total memory footprint (>= data.length — extra bytes are zero-initialised). */
  memSize: number
  /** Segment is executable. */
  executable: boolean
  /** Segment is writable. */
  writable: boolean
}

export interface ParsedElf {
  header: ElfHeader
  programHeaders: ElfProgramHeader[]
  sections: ElfSection[]
  symbols: ElfSymbol[]
  /** Ready-to-load segments derived from PT_LOAD program headers. */
  loadable: ElfLoadableSegment[]
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function readCString(buf: Uint8Array, offset: number): string {
  if (offset >= buf.length) return ''
  let end = offset
  while (end < buf.length && buf[end] !== 0) end++
  return new TextDecoder('utf-8').decode(buf.subarray(offset, end))
}

function assertElfMagic(view: DataView): void {
  for (let i = 0; i < 4; i++) {
    if (view.getUint8(i) !== ELF_MAGIC[i]) {
      throw new Error('Not an ELF file (magic number mismatch)')
    }
  }
}

function assertArm32Le(view: DataView): void {
  const elfClass = view.getUint8(4)
  const elfData = view.getUint8(5)
  if (elfClass !== ELFCLASS32) {
    throw new Error(`Expected ELFCLASS32, got ${elfClass}`)
  }
  if (elfData !== ELFDATA2LSB) {
    throw new Error(`Expected little-endian ELF, got data=${elfData}`)
  }
  const machine = view.getUint16(0x12, true)
  if (machine !== EM_ARM) {
    throw new Error(`Expected ARM (0x28), got machine=0x${machine.toString(16)}`)
  }
}

function parseHeader(view: DataView): ElfHeader {
  return {
    type: view.getUint16(0x10, true),
    machine: view.getUint16(0x12, true),
    entry: view.getUint32(0x18, true),
    programHeaderOffset: view.getUint32(0x1c, true),
    sectionHeaderOffset: view.getUint32(0x20, true),
    programHeaderCount: view.getUint16(0x2c, true),
    sectionHeaderCount: view.getUint16(0x30, true),
    sectionHeaderStringTableIndex: view.getUint16(0x32, true),
  }
}

function parseProgramHeaders(
  view: DataView,
  offset: number,
  count: number,
): ElfProgramHeader[] {
  const PH_SIZE = 32
  const out: ElfProgramHeader[] = []
  for (let i = 0; i < count; i++) {
    const base = offset + i * PH_SIZE
    out.push({
      type: view.getUint32(base + 0, true),
      offset: view.getUint32(base + 4, true),
      vaddr: view.getUint32(base + 8, true),
      paddr: view.getUint32(base + 12, true),
      fileSize: view.getUint32(base + 16, true),
      memSize: view.getUint32(base + 20, true),
      flags: view.getUint32(base + 24, true),
    })
  }
  return out
}

interface RawSection {
  nameOffset: number
  type: number
  flags: number
  addr: number
  offset: number
  size: number
  link: number
  info: number
  addralign: number
  entsize: number
}

function parseRawSections(
  view: DataView,
  offset: number,
  count: number,
): RawSection[] {
  const SH_SIZE = 40
  const out: RawSection[] = []
  for (let i = 0; i < count; i++) {
    const base = offset + i * SH_SIZE
    out.push({
      nameOffset: view.getUint32(base + 0, true),
      type: view.getUint32(base + 4, true),
      flags: view.getUint32(base + 8, true),
      addr: view.getUint32(base + 12, true),
      offset: view.getUint32(base + 16, true),
      size: view.getUint32(base + 20, true),
      link: view.getUint32(base + 24, true),
      info: view.getUint32(base + 28, true),
      addralign: view.getUint32(base + 32, true),
      entsize: view.getUint32(base + 36, true),
    })
  }
  return out
}

function parseSymbols(
  view: DataView,
  symtab: RawSection,
  stringTable: Uint8Array,
): ElfSymbol[] {
  const SYM_SIZE = 16
  const count = Math.floor(symtab.size / SYM_SIZE)
  const out: ElfSymbol[] = []
  for (let i = 0; i < count; i++) {
    const base = symtab.offset + i * SYM_SIZE
    const nameOffset = view.getUint32(base + 0, true)
    const address = view.getUint32(base + 4, true)
    const size = view.getUint32(base + 8, true)
    const info = view.getUint8(base + 12)
    const shndx = view.getUint16(base + 14, true)
    const name = readCString(stringTable, nameOffset)
    if (name === '') continue // Skip unnamed symbols (section symbols)
    out.push({
      name,
      address,
      size,
      type: info & 0xf,
      sectionIndex: shndx,
    })
  }
  return out
}

function buildLoadableSegments(
  bytes: Uint8Array,
  programHeaders: ElfProgramHeader[],
): ElfLoadableSegment[] {
  const out: ElfLoadableSegment[] = []
  for (const ph of programHeaders) {
    if (ph.type !== PT_LOAD) continue
    if (ph.memSize === 0) continue
    const slice = bytes.subarray(ph.offset, ph.offset + ph.fileSize)
    out.push({
      vaddr: ph.vaddr,
      data: slice,
      memSize: ph.memSize,
      executable: (ph.flags & 0x1) !== 0,
      writable: (ph.flags & 0x2) !== 0,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an ARM32 little-endian ELF binary. Throws on invalid input.
 */
export function parseElf(bytes: Uint8Array): ParsedElf {
  if (bytes.length < 52) {
    throw new Error('ELF too small — header incomplete')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  assertElfMagic(view)
  assertArm32Le(view)

  const header = parseHeader(view)
  const programHeaders = parseProgramHeaders(
    view,
    header.programHeaderOffset,
    header.programHeaderCount,
  )

  const rawSections = parseRawSections(
    view,
    header.sectionHeaderOffset,
    header.sectionHeaderCount,
  )

  // Look up section names via the section header string table.
  let shStringTable: Uint8Array = new Uint8Array()
  if (header.sectionHeaderStringTableIndex < rawSections.length) {
    const shstr = rawSections[header.sectionHeaderStringTableIndex]
    shStringTable = bytes.subarray(shstr.offset, shstr.offset + shstr.size)
  }

  const sections: ElfSection[] = rawSections.map((s) => ({
    name: readCString(shStringTable, s.nameOffset),
    type: s.type,
    flags: s.flags,
    addr: s.addr,
    offset: s.offset,
    size: s.size,
    link: s.link,
    alloc: (s.flags & SHF_ALLOC) !== 0,
    exec: (s.flags & SHF_EXECINSTR) !== 0,
  }))

  // Extract symbols from .symtab + its .strtab.
  let symbols: ElfSymbol[] = []
  const symtabIdx = rawSections.findIndex((s) => s.type === SHT_SYMTAB)
  if (symtabIdx !== -1) {
    const symtab = rawSections[symtabIdx]
    const strtabIdx = symtab.link
    if (strtabIdx < rawSections.length) {
      const strtab = rawSections[strtabIdx]
      const strings = bytes.subarray(strtab.offset, strtab.offset + strtab.size)
      symbols = parseSymbols(view, symtab, strings)
    }
  }

  const loadable = buildLoadableSegments(bytes, programHeaders)

  return {
    header,
    programHeaders,
    sections,
    symbols,
    loadable,
  }
}

/**
 * Filter symbols by type. Useful for UIs that want to browse functions and
 * globals separately.
 */
export function symbolsOfType(symbols: ElfSymbol[], type: 'func' | 'object' | 'any'): ElfSymbol[] {
  if (type === 'any') return symbols.filter((s) => s.type !== STT_NOTYPE || s.name !== '')
  const target = type === 'func' ? STT_FUNC : STT_OBJECT
  return symbols.filter((s) => s.type === target)
}
