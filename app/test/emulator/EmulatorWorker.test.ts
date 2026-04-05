// EmulatorWorker tests — exercises the worker handler logic with a fake
// transport, no real Worker required.

import { describe, test, expect } from 'vitest'
import { runWorker } from '@/lib/emulator/EmulatorWorker'
import type { EmulatorRequest, WorkerToMain } from '@/lib/emulator/protocol'
import { isReply, isEvent } from '@/lib/emulator/protocol'

interface Captured {
  messages: WorkerToMain[]
  handle: (req: EmulatorRequest) => Promise<void>
}

function setupWorker(): Captured {
  const messages: WorkerToMain[] = []
  const transport = {
    post: (msg: WorkerToMain) => messages.push(msg),
    listen: () => {
      /* tests call handle() directly instead */
    },
  }
  const { handle } = runWorker(transport)
  return { messages, handle }
}

// Minimal ARM32 LE ELF with one PT_LOAD segment
function buildMinimalElf(): ArrayBuffer {
  const EH_SIZE = 52
  const PH_SIZE = 32
  const SH_SIZE = 40
  const segData = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])
  const shstr = new Uint8Array([0, ...'.text\0'.split('').map((c) => c.charCodeAt(0))])
  const segOffset = EH_SIZE + PH_SIZE
  const shstrOffset = segOffset + segData.length
  const shOffset = shstrOffset + shstr.length
  const total = shOffset + SH_SIZE * 3 // null + .text + .shstrtab

  const out = new ArrayBuffer(total)
  const view = new DataView(out)
  const bytes = new Uint8Array(out)

  // ELF header
  bytes[0] = 0x7f
  bytes[1] = 0x45
  bytes[2] = 0x4c
  bytes[3] = 0x46
  bytes[4] = 1
  bytes[5] = 1
  bytes[6] = 1
  view.setUint16(0x10, 2, true) // ET_EXEC
  view.setUint16(0x12, 0x28, true) // EM_ARM
  view.setUint32(0x14, 1, true)
  view.setUint32(0x18, 0x20000000, true) // e_entry
  view.setUint32(0x1c, EH_SIZE, true) // e_phoff
  view.setUint32(0x20, shOffset, true) // e_shoff
  view.setUint16(0x28, EH_SIZE, true)
  view.setUint16(0x2a, PH_SIZE, true)
  view.setUint16(0x2c, 1, true)
  view.setUint16(0x2e, SH_SIZE, true)
  view.setUint16(0x30, 3, true)
  view.setUint16(0x32, 2, true) // shstrndx

  // Program header
  view.setUint32(EH_SIZE + 0, 1, true) // PT_LOAD
  view.setUint32(EH_SIZE + 4, segOffset, true)
  view.setUint32(EH_SIZE + 8, 0x20000000, true) // vaddr
  view.setUint32(EH_SIZE + 12, 0x20000000, true)
  view.setUint32(EH_SIZE + 16, segData.length, true)
  view.setUint32(EH_SIZE + 20, segData.length, true)
  view.setUint32(EH_SIZE + 24, 0x5, true) // r-x
  view.setUint32(EH_SIZE + 28, 0x1000, true)

  // Segment data
  bytes.set(segData, segOffset)
  bytes.set(shstr, shstrOffset)

  // Section headers: null + .text + .shstrtab
  // Null section
  // (all zero by default)

  // .text
  view.setUint32(shOffset + SH_SIZE + 0, 1, true) // name offset "text"
  view.setUint32(shOffset + SH_SIZE + 4, 1, true) // SHT_PROGBITS
  view.setUint32(shOffset + SH_SIZE + 8, 0x6, true) // ALLOC+EXEC
  view.setUint32(shOffset + SH_SIZE + 12, 0x20000000, true)
  view.setUint32(shOffset + SH_SIZE + 16, segOffset, true)
  view.setUint32(shOffset + SH_SIZE + 20, segData.length, true)

  // .shstrtab
  view.setUint32(shOffset + SH_SIZE * 2 + 4, 3, true) // SHT_STRTAB
  view.setUint32(shOffset + SH_SIZE * 2 + 16, shstrOffset, true)
  view.setUint32(shOffset + SH_SIZE * 2 + 20, shstr.length, true)

  return out
}

describe('EmulatorWorker init', () => {
  test('init replies with ready', async () => {
    const { messages, handle } = setupWorker()
    await handle({ type: 'init', seq: 1 })
    const reply = messages.find((m) => isReply(m) && m.replyTo === 1)
    expect(reply).toBeTruthy()
    expect(reply!.type).toBe('ready')
    expect((reply as { ok: boolean }).ok).toBe(true)
  })

  test('init emits a log event', async () => {
    const { messages, handle } = setupWorker()
    await handle({ type: 'init', seq: 1 })
    const log = messages.find((m) => isEvent(m) && m.type === 'log')
    expect(log).toBeTruthy()
  })
})

describe('EmulatorWorker loadElf', () => {
  test('loads a valid ELF', async () => {
    const { messages, handle } = setupWorker()
    await handle({ type: 'init', seq: 1 })
    await handle({ type: 'loadElf', seq: 2, elf: buildMinimalElf() })
    const reply = messages.find(
      (m) => isReply(m) && m.replyTo === 2,
    ) as Extract<WorkerToMain, { type: 'elfLoaded' }> | undefined
    expect(reply).toBeTruthy()
    expect(reply!.ok).toBe(true)
    expect(reply!.entry).toBe(0x20000000)
  })

  test('ELF segment data is copied to memory', async () => {
    const { messages, handle } = setupWorker()
    await handle({ type: 'init', seq: 1 })
    await handle({ type: 'loadElf', seq: 2, elf: buildMinimalElf() })
    await handle({ type: 'readMem', seq: 3, address: 0x20000000, length: 8 })
    const memReply = messages.find(
      (m) => isReply(m) && m.replyTo === 3,
    ) as Extract<WorkerToMain, { type: 'memData' }> | undefined
    expect(memReply).toBeTruthy()
    const bytes = new Uint8Array(memReply!.data)
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  test('rejects invalid ELF with error reply', async () => {
    const { messages, handle } = setupWorker()
    await handle({ type: 'init', seq: 1 })
    const bad = new ArrayBuffer(100) // no magic
    await handle({ type: 'loadElf', seq: 2, elf: bad })
    const reply = messages.find(
      (m) => isReply(m) && m.replyTo === 2,
    ) as Extract<WorkerToMain, { type: 'ready' }> | undefined
    expect(reply).toBeTruthy()
    expect(reply!.ok).toBe(false)
  })
})

describe('EmulatorWorker start/stop/step', () => {
  test('start fails without loaded ELF', async () => {
    const { messages, handle } = setupWorker()
    await handle({ type: 'init', seq: 1 })
    await handle({ type: 'start', seq: 2 })
    const reply = messages.find(
      (m) => isReply(m) && m.replyTo === 2,
    )! as Extract<WorkerToMain, { type: 'started' }>
    expect(reply.ok).toBe(false)
    expect(reply.error).toMatch(/ELF not loaded/)
  })

  test('start succeeds after loadElf', async () => {
    const { messages, handle } = setupWorker()
    await handle({ type: 'init', seq: 1 })
    await handle({ type: 'loadElf', seq: 2, elf: buildMinimalElf() })
    await handle({ type: 'start', seq: 3 })
    const reply = messages.find(
      (m) => isReply(m) && m.replyTo === 3,
    )! as Extract<WorkerToMain, { type: 'started' }>
    expect(reply.ok).toBe(true)
  })

  test('step returns executed count and pc', async () => {
    const { messages, handle } = setupWorker()
    await handle({ type: 'init', seq: 1 })
    await handle({ type: 'loadElf', seq: 2, elf: buildMinimalElf() })
    await handle({ type: 'step', seq: 3, instructions: 10 })
    const reply = messages.find(
      (m) => isReply(m) && m.replyTo === 3,
    )! as Extract<WorkerToMain, { type: 'stepped' }>
    expect(reply.type).toBe('stepped')
    // ArmCpu executes instructions (the synthetic ELF is mostly condition-EQ
    // NOPs but each one still consumes an instruction slot).
    expect(reply.executed).toBe(10)
    // PC should have advanced by 10 * 4 bytes.
    expect(reply.pc).toBe(0x20000000 + 40)
  })

  test('stop returns last pc', async () => {
    const { messages, handle } = setupWorker()
    await handle({ type: 'init', seq: 1 })
    await handle({ type: 'loadElf', seq: 2, elf: buildMinimalElf() })
    await handle({ type: 'stop', seq: 3 })
    const reply = messages.find(
      (m) => isReply(m) && m.replyTo === 3,
    )! as Extract<WorkerToMain, { type: 'stopped' }>
    expect(reply.ok).toBe(true)
    expect(reply.pc).toBe(0x20000000)
  })
})

describe('EmulatorWorker memory & registers', () => {
  test('writeMem then readMem round-trip', async () => {
    const { messages, handle } = setupWorker()
    await handle({ type: 'init', seq: 1 })
    const payload = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]).buffer
    await handle({ type: 'writeMem', seq: 2, address: 0x20001000, data: payload })
    await handle({ type: 'readMem', seq: 3, address: 0x20001000, length: 4 })
    const memReply = messages.find(
      (m) => isReply(m) && m.replyTo === 3,
    ) as Extract<WorkerToMain, { type: 'memData' }>
    expect(Array.from(new Uint8Array(memReply.data))).toEqual([0xca, 0xfe, 0xba, 0xbe])
  })

  test('getRegisters returns register snapshot', async () => {
    const { messages, handle } = setupWorker()
    await handle({ type: 'init', seq: 1 })
    await handle({ type: 'loadElf', seq: 2, elf: buildMinimalElf() })
    await handle({ type: 'getRegisters', seq: 3 })
    const reply = messages.find(
      (m) => isReply(m) && m.replyTo === 3,
    )! as Extract<WorkerToMain, { type: 'registers' }>
    expect(reply.registers.pc).toBe(0x20000000)
  })
})

describe('EmulatorWorker reset', () => {
  test('reset clears loaded state', async () => {
    const { messages, handle } = setupWorker()
    await handle({ type: 'init', seq: 1 })
    await handle({ type: 'loadElf', seq: 2, elf: buildMinimalElf() })
    await handle({ type: 'reset', seq: 3 })
    // After reset, start should fail with "ELF not loaded"
    await handle({ type: 'start', seq: 4 })
    const startReply = messages.find(
      (m) => isReply(m) && m.replyTo === 4,
    )! as Extract<WorkerToMain, { type: 'started' }>
    expect(startReply.ok).toBe(false)
  })
})
