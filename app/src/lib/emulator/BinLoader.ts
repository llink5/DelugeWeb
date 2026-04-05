// Raw-binary firmware loader.
//
// A .bin firmware is an image of the first code the CPU executes, usually
// starting with the ARM exception vector table. Unlike ELF, there is no
// header, no section metadata, and no symbol table — just machine code
// and data as it appears in memory.
//
// The loader:
//   1. Decodes the Reset vector (first 32-bit word) to figure out where
//      the firmware expects its handler to live.
//   2. Derives a load address from that target so the .bin lands at a
//      location the reset vector is happy with.
//   3. Returns the entry point the CPU should jump to — the PC value
//      that results from executing the reset vector.
//
// Two vector forms are supported:
//   - `B <offset>`          (0xEA??????)  — direct PC-relative branch
//   - `LDR PC, [PC, #off]`  (0xE59FF???)  — load PC from nearby literal
//
// Other vector forms (indirect through a table, SVC-to-handler) exist but
// are rare; we fall back to a caller-specified load address when the first
// vector can't be decoded.

export interface VectorTable {
  reset: number
  undefined: number
  softwareInterrupt: number
  prefetchAbort: number
  dataAbort: number
  reserved: number
  irq: number
  fiq: number
}

export interface BinFirmware {
  /** The loaded image bytes. */
  data: Uint8Array
  /** Where the image should be copied into memory. */
  loadAddress: number
  /** PC value after executing the Reset vector. */
  entryPoint: number
  /** Decoded exception vectors. */
  vectors: VectorTable
  /**
   * How the Reset vector encodes its target:
   *   'ldr-literal' — LDR PC, [PC, #offset] reading from the literal pool
   *   'branch'      — B <offset> direct branch
   *   'unknown'     — first word doesn't match either pattern
   */
  vectorForm: 'ldr-literal' | 'branch' | 'unknown'
}

// ---------------------------------------------------------------------------
// Instruction decoding
// ---------------------------------------------------------------------------

const VECTOR_NAMES: readonly (keyof VectorTable)[] = [
  'reset',
  'undefined',
  'softwareInterrupt',
  'prefetchAbort',
  'dataAbort',
  'reserved',
  'irq',
  'fiq',
]

/**
 * Decode an ARM Reset-vector instruction and compute where execution
 * will continue. `pcOfInstruction` is the runtime address of the 32-bit
 * word being decoded; `relativeRead(offset)` gives the byte offset inside
 * the .bin so we can read the literal pool when the instruction is
 * LDR-literal form.
 */
function decodeVector(
  instruction: number,
  pcOfInstruction: number,
  relativeRead: (byteOffset: number) => number,
  vectorByteOffset: number,
): { target: number; form: 'ldr-literal' | 'branch' | 'unknown' } {
  const instr = instruction >>> 0
  // Condition = AL (1110) is required for unconditional execution of vectors.
  // We accept any condition and assume AL; firmware never uses conditional
  // vectors.
  const body = instr & 0x0fffffff

  // LDR PC, [PC, #offset]
  //   cond 01 I=0 P=1 U=? B=0 W=0 L=1 Rn=1111 Rd=1111 offset12
  //   body fingerprint: 0x?5?FF??? where the middle ?s hold the U bit and
  //   the offset. Mask bits 27:20 to 0101_U001 (U wildcard) and require
  //   Rn = Rd = 1111.
  if ((body & 0x0f7ff000) === 0x051ff000) {
    const offset = instr & 0xfff
    const upBit = (instr >>> 23) & 1
    // PC on ARM reads as "address of instruction + 8" (prefetch offset).
    const readAddress = upBit ? pcOfInstruction + 8 + offset : pcOfInstruction + 8 - offset
    // readAddress is an absolute address. Turn it into a byte offset into
    // the bin (relative to the first vector).
    const delta = readAddress - (pcOfInstruction - vectorByteOffset)
    // Read little-endian 32-bit word
    const b0 = relativeRead(delta)
    const b1 = relativeRead(delta + 1)
    const b2 = relativeRead(delta + 2)
    const b3 = relativeRead(delta + 3)
    const target = ((b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0)
    return { target, form: 'ldr-literal' }
  }

  // B <offset>    — 0xEA??????  (cond 101 0 offset24)
  if ((body & 0x0f000000) === 0x0a000000) {
    let off = instr & 0x00ffffff
    if (off & 0x00800000) off -= 0x01000000
    // Target = PC + 8 + (off × 4)
    const target = (pcOfInstruction + 8 + off * 4) >>> 0
    return { target, form: 'branch' }
  }

  return { target: 0, form: 'unknown' }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BinLoadOptions {
  /**
   * Explicit load address. When omitted, the loader derives one from the
   * Reset vector: it aligns the reset-handler target down to a 4 KB
   * boundary and uses that as the load address. That works because
   * compilers and linkers almost always place .text on a page boundary
   * and the reset handler lives close to the top of .text.
   */
  loadAddress?: number
  /**
   * Fallback load address used when no vector table is present (first
   * word is neither B nor LDR-literal). Defaults to 0x18000000 — the
   * RZ/A1L's SPI flash mapping.
   */
  fallbackLoadAddress?: number
}

export function parseBin(
  bytes: Uint8Array,
  options: BinLoadOptions = {},
): BinFirmware {
  if (bytes.length < 0x20) {
    throw new Error('Firmware too small to contain an ARM vector table')
  }
  const fallback = options.fallbackLoadAddress ?? 0x18000000

  // Read all 8 vectors at byte offsets 0x00..0x1C. We start by assuming the
  // bin is loaded at `fallback` so the arithmetic for LDR-literal reads
  // into the right byte offsets; the resulting handler addresses are
  // absolute and don't depend on the load address assumption.
  const assumedBase = options.loadAddress ?? fallback
  const relRead = (off: number): number => {
    if (off < 0 || off >= bytes.length) return 0
    return bytes[off]
  }

  const firstWord =
    (relRead(0) | (relRead(1) << 8) | (relRead(2) << 16) | (relRead(3) << 24)) >>>
    0
  const firstDecoded = decodeVector(firstWord, assumedBase, relRead, 0)

  // Figure out the load address when not explicitly provided.
  let loadAddress: number
  if (options.loadAddress !== undefined) {
    loadAddress = options.loadAddress >>> 0
  } else if (firstDecoded.form === 'ldr-literal') {
    const resetTarget = firstDecoded.target >>> 0
    // Many firmware images embed a bootloader header right after the
    // vector table (offsets 0x20..0x3F) that begins with the load
    // address. If the word at 0x20 looks like a plausible base — it's
    // word-aligned and satisfies base ≤ reset_target < base + binary_size
    // — we trust it. Otherwise we fall back to the 4-KB-align heuristic.
    const candidateHeader =
      (relRead(0x20) |
        (relRead(0x21) << 8) |
        (relRead(0x22) << 16) |
        (relRead(0x23) << 24)) >>>
      0
    const headerValid =
      (candidateHeader & 0x3) === 0 &&
      candidateHeader <= resetTarget &&
      resetTarget < candidateHeader + bytes.length
    if (headerValid) {
      loadAddress = candidateHeader
    } else {
      // Align the reset-handler target down to a 4 KB boundary. That's the
      // typical linker / MMU page boundary and works for firmware whose
      // reset handler lives in the first 4 KB of code.
      loadAddress = resetTarget & ~0xfff
    }
  } else if (firstDecoded.form === 'branch') {
    // B offset is PC-relative; the target's absolute position is only
    // known once we fix the base. Just use `fallback`.
    loadAddress = fallback
  } else {
    loadAddress = fallback
  }

  // Re-decode every vector with the final load address so the LDR-literal
  // reads are correct.
  const vectors: Partial<VectorTable> = {}
  let vectorForm: BinFirmware['vectorForm'] = 'unknown'
  for (let i = 0; i < 8; i++) {
    const off = i * 4
    const w =
      (relRead(off) |
        (relRead(off + 1) << 8) |
        (relRead(off + 2) << 16) |
        (relRead(off + 3) << 24)) >>>
      0
    const { target, form } = decodeVector(w, loadAddress + off, relRead, off)
    if (i === 0) vectorForm = form
    vectors[VECTOR_NAMES[i]] = target >>> 0
  }

  const entryPoint = vectors.reset ?? loadAddress

  return {
    data: bytes,
    loadAddress,
    entryPoint: entryPoint >>> 0,
    vectors: vectors as VectorTable,
    vectorForm,
  }
}

// ---------------------------------------------------------------------------
// Firmware-format detection
// ---------------------------------------------------------------------------

export type FirmwareFormat = 'elf' | 'bin'

/**
 * Decide whether an arbitrary buffer is an ELF or a raw .bin. Detection
 * is by magic bytes only; an empty buffer or short file without ELF magic
 * is reported as 'bin'.
 */
export function detectFirmwareFormat(bytes: Uint8Array): FirmwareFormat {
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    return 'elf'
  }
  return 'bin'
}
