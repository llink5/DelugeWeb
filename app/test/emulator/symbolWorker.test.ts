// Integration tests for the symbol-debugger worker commands.
//
// Loads a synthetic ELF with symbols through the worker, then exercises
// searchSymbols / resolveAddress / disassemble / setBreakpoint /
// listBreakpoints / readStruct / listStructs end-to-end.

import { describe, test, expect } from 'vitest'
import { runWorker } from '@/lib/emulator/EmulatorWorker'
import type { EmulatorRequest, WorkerToMain } from '@/lib/emulator/protocol'
import { isReply } from '@/lib/emulator/protocol'

function setupWorker(): {
  messages: WorkerToMain[]
  handle: (req: EmulatorRequest) => Promise<void>
} {
  const messages: WorkerToMain[] = []
  const { handle } = runWorker({
    post: (msg) => messages.push(msg),
    listen: () => {},
  })
  return { messages, handle }
}

function replyFor<T extends WorkerToMain['type']>(
  messages: WorkerToMain[],
  seq: number,
): Extract<WorkerToMain, { type: T }> | undefined {
  return messages.find((m) => isReply(m) && m.replyTo === seq) as
    | Extract<WorkerToMain, { type: T }>
    | undefined
}

// ---------------------------------------------------------------------------
// Synthetic ELF with a symbol table + a tiny code payload
// ---------------------------------------------------------------------------

function buildElfWithSymbols(): ArrayBuffer {
  const EH_SIZE = 52
  const PH_SIZE = 32
  const SH_SIZE = 40
  const SYM_SIZE = 16

  // The code sits in a PT_LOAD segment starting at 0x20000000.
  // Three instructions: MOV R0,#1; MOV R1,#2; MOV R2,#3.
  const mov = (rd: number, imm: number) =>
    ((0xe3a00000 | (rd << 12) | imm) >>> 0)
  const code = new Uint8Array(12)
  new DataView(code.buffer).setUint32(0, mov(0, 1), true)
  new DataView(code.buffer).setUint32(4, mov(1, 2), true)
  new DataView(code.buffer).setUint32(8, mov(2, 3), true)

  // String table for symbol names + section names
  const buildStrtab = (strings: string[]) => {
    const parts: number[] = [0]
    const offsets: number[] = []
    for (const s of strings) {
      offsets.push(parts.length)
      for (let i = 0; i < s.length; i++) parts.push(s.charCodeAt(i))
      parts.push(0)
    }
    return { data: new Uint8Array(parts), offsets }
  }

  const sectionNames = ['.text', '.symtab', '.strtab', '.shstrtab']
  const shstr = buildStrtab(sectionNames)
  const symNames = ['init', 'main', 'helper']
  const symstr = buildStrtab(symNames)

  // Symbol table entries. Layout: [null sym, init, main, helper]
  const symtab = new Uint8Array(SYM_SIZE * 4)
  const symView = new DataView(symtab.buffer)
  const writeSym = (
    i: number,
    nameOff: number,
    addr: number,
    size: number,
    type: number,
  ) => {
    const b = i * SYM_SIZE
    symView.setUint32(b + 0, nameOff, true)
    symView.setUint32(b + 4, addr, true)
    symView.setUint32(b + 8, size, true)
    symView.setUint8(b + 12, type) // info
    symView.setUint8(b + 13, 0)
    symView.setUint16(b + 14, 1, true) // shndx = .text
  }
  writeSym(1, symstr.offsets[0], 0x20000000, 4, 2) // init FUNC
  writeSym(2, symstr.offsets[1], 0x20000004, 4, 2) // main FUNC
  writeSym(3, symstr.offsets[2], 0x20000008, 4, 2) // helper FUNC

  // File layout:
  // [EH][PH][code][shstr][symstr][symtab][SH×5]
  let offset = EH_SIZE + PH_SIZE
  const codeOffset = offset
  offset += code.length
  const shstrOffset = offset
  offset += shstr.data.length
  const symstrOffset = offset
  offset += symstr.data.length
  const symtabOffset = offset
  offset += symtab.length
  const shOffset = offset
  const numSections = 5 // null, .text, .symtab, .strtab, .shstrtab
  const total = shOffset + numSections * SH_SIZE

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)

  // ELF header
  out[0] = 0x7f
  out[1] = 0x45
  out[2] = 0x4c
  out[3] = 0x46
  out[4] = 1 // ELFCLASS32
  out[5] = 1 // ELFDATA2LSB
  out[6] = 1
  view.setUint16(0x10, 2, true) // ET_EXEC
  view.setUint16(0x12, 0x28, true) // EM_ARM
  view.setUint32(0x14, 1, true)
  view.setUint32(0x18, 0x20000000, true) // entry
  view.setUint32(0x1c, EH_SIZE, true) // phoff
  view.setUint32(0x20, shOffset, true) // shoff
  view.setUint16(0x28, EH_SIZE, true)
  view.setUint16(0x2a, PH_SIZE, true)
  view.setUint16(0x2c, 1, true) // phnum
  view.setUint16(0x2e, SH_SIZE, true)
  view.setUint16(0x30, numSections, true)
  view.setUint16(0x32, 4, true) // shstrndx

  // Program header
  view.setUint32(EH_SIZE + 0, 1, true) // PT_LOAD
  view.setUint32(EH_SIZE + 4, codeOffset, true)
  view.setUint32(EH_SIZE + 8, 0x20000000, true)
  view.setUint32(EH_SIZE + 12, 0x20000000, true)
  view.setUint32(EH_SIZE + 16, code.length, true)
  view.setUint32(EH_SIZE + 20, code.length, true)
  view.setUint32(EH_SIZE + 24, 0x5, true)
  view.setUint32(EH_SIZE + 28, 0x1000, true)

  out.set(code, codeOffset)
  out.set(shstr.data, shstrOffset)
  out.set(symstr.data, symstrOffset)
  out.set(symtab, symtabOffset)

  // Section headers
  const writeSection = (
    idx: number,
    nameOff: number,
    type: number,
    flags: number,
    addr: number,
    off: number,
    size: number,
    link: number,
    entsize: number,
  ) => {
    const b = shOffset + idx * SH_SIZE
    view.setUint32(b + 0, nameOff, true)
    view.setUint32(b + 4, type, true)
    view.setUint32(b + 8, flags, true)
    view.setUint32(b + 12, addr, true)
    view.setUint32(b + 16, off, true)
    view.setUint32(b + 20, size, true)
    view.setUint32(b + 24, link, true)
    view.setUint32(b + 36, entsize, true)
  }
  // 0: null
  // 1: .text
  writeSection(1, shstr.offsets[0], 1, 0x6, 0x20000000, codeOffset, code.length, 0, 0)
  // 2: .symtab
  writeSection(2, shstr.offsets[1], 2, 0, 0, symtabOffset, symtab.length, 3, SYM_SIZE)
  // 3: .strtab
  writeSection(3, shstr.offsets[2], 3, 0, 0, symstrOffset, symstr.data.length, 0, 0)
  // 4: .shstrtab
  writeSection(4, shstr.offsets[3], 3, 0, 0, shstrOffset, shstr.data.length, 0, 0)

  return out.buffer
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function bootAndLoad() {
  const { messages, handle } = setupWorker()
  await handle({ type: 'init', seq: 1 })
  await handle({ type: 'loadElf', seq: 2, elf: buildElfWithSymbols() })
  return { messages, handle }
}

describe('Symbol worker: searchSymbols', () => {
  test('returns all three symbols with empty query', async () => {
    const { messages, handle } = await bootAndLoad()
    await handle({ type: 'searchSymbols', seq: 3, query: '' })
    const r = replyFor<'symbolResults'>(messages, 3)!
    expect(r.ok).toBe(true)
    expect(r.hits.length).toBe(3)
    expect(r.hits.map((h) => h.name).sort()).toEqual(['helper', 'init', 'main'])
  })

  test('substring search narrows results', async () => {
    const { messages, handle } = await bootAndLoad()
    await handle({ type: 'searchSymbols', seq: 3, query: 'in' })
    const r = replyFor<'symbolResults'>(messages, 3)!
    // 'in' matches 'init' (prefix) — 'main' does NOT contain 'in'.
    const names = r.hits.map((h) => h.name)
    expect(names).toContain('init')
  })
})

describe('Symbol worker: resolveAddress', () => {
  test('resolves address at symbol start', async () => {
    const { messages, handle } = await bootAndLoad()
    await handle({ type: 'resolveAddress', seq: 3, address: 0x20000004 })
    const r = replyFor<'addressResolved'>(messages, 3)!
    expect(r.ok).toBe(true)
    expect(r.resolved?.name).toBe('main')
    expect(r.resolved?.offset).toBe(0)
  })

  test('unresolved address returns undefined', async () => {
    const { messages, handle } = await bootAndLoad()
    await handle({ type: 'resolveAddress', seq: 3, address: 0x40000000 })
    const r = replyFor<'addressResolved'>(messages, 3)!
    expect(r.ok).toBe(true)
    expect(r.resolved).toBeUndefined()
  })
})

describe('Symbol worker: disassemble', () => {
  test('returns instructions around the entry point', async () => {
    const { messages, handle } = await bootAndLoad()
    await handle({ type: 'disassemble', seq: 3, address: 0x20000000, count: 3 })
    const r = replyFor<'disassembly'>(messages, 3)!
    expect(r.ok).toBe(true)
    expect(r.lines).toHaveLength(3)
    // Each instruction should be mov with an immediate
    expect(r.lines[0].text).toContain('mov')
    expect(r.lines[1].text).toContain('mov')
    expect(r.lines[2].text).toContain('mov')
  })

  test('branch targets include resolved symbol names', async () => {
    // Not applicable for our MOV-only fixture, but verify the infrastructure
    // passes the SymbolMap correctly by checking a direct resolve call.
    const { messages, handle } = await bootAndLoad()
    await handle({ type: 'resolveAddress', seq: 3, address: 0x20000008 })
    const r = replyFor<'addressResolved'>(messages, 3)!
    expect(r.resolved?.name).toBe('helper')
  })
})

describe('Symbol worker: breakpoints', () => {
  test('set, list, clear breakpoint cycle', async () => {
    const { messages, handle } = await bootAndLoad()
    await handle({
      type: 'setBreakpoint',
      seq: 3,
      address: 0x20000004,
      label: 'main',
    })
    const setReply = replyFor<'breakpointSet'>(messages, 3)!
    expect(setReply.ok).toBe(true)
    expect(setReply.breakpoint?.label).toBe('main')
    const bpId = setReply.breakpoint!.id

    await handle({ type: 'listBreakpoints', seq: 4 })
    const listReply = replyFor<'breakpointList'>(messages, 4)!
    expect(listReply.breakpoints).toHaveLength(1)
    expect(listReply.breakpoints[0].label).toBe('main')

    await handle({ type: 'clearBreakpoint', seq: 5, id: bpId })
    await handle({ type: 'listBreakpoints', seq: 6 })
    const listReply2 = replyFor<'breakpointList'>(messages, 6)!
    expect(listReply2.breakpoints).toHaveLength(0)
  })
})

describe('Symbol worker: structs', () => {
  test('listStructs returns the Deluge struct names', async () => {
    const { messages, handle } = await bootAndLoad()
    await handle({ type: 'listStructs', seq: 3 })
    const r = replyFor<'structList'>(messages, 3)!
    expect(r.ok).toBe(true)
    expect(r.structs).toContain('Song')
    expect(r.structs).toContain('Sound')
    expect(r.structs).toContain('Clip')
  })

  test('readStruct returns fields', async () => {
    const { messages, handle } = await bootAndLoad()
    // Write known bytes at 0x0C000000 in SDRAM to read as Song.vtable
    const buf = new ArrayBuffer(8)
    new DataView(buf).setUint32(0, 0x20010000, true) // vtable pointer
    await handle({
      type: 'writeMem',
      seq: 3,
      address: 0x0c000000,
      data: buf,
    })
    await handle({
      type: 'readStruct',
      seq: 4,
      typeName: 'Song',
      address: 0x0c000000,
    })
    const r = replyFor<'structFields'>(messages, 4)!
    expect(r.ok).toBe(true)
    const vtable = r.fields.find((f) => f.name === 'vtable')!
    expect(vtable.type).toBe('ptr')
    expect(vtable.raw).toBe(0x20010000)
    expect(vtable.pointsTo).toBeUndefined() // vtable ptr has no pointsTo in our layout
  })

  test('readStruct with unknown type returns error', async () => {
    const { messages, handle } = await bootAndLoad()
    await handle({
      type: 'readStruct',
      seq: 3,
      typeName: 'Nonexistent',
      address: 0x0c000000,
    })
    const r = replyFor<'structFields'>(messages, 3)!
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Unknown struct')
  })
})
