// HotReloader integration tests.
//
// Exercises the full worker round-trip: boot the worker, load ELF A, save
// a snapshot keyed by ELF A's hash, reset, warm-reload ELF A → snapshot
// auto-restores; warm-reload a different ELF B → no snapshot to restore.

import { describe, test, expect, beforeEach } from 'vitest'
import { runWorker } from '@/lib/emulator/EmulatorWorker'
import { DelugeEmulator } from '@/lib/emulator/DelugeEmulator'
import { HotReloader } from '@/lib/emulator/HotReload'
import {
  InMemorySnapshotStore,
} from '@/lib/emulator/snapshot/Snapshot'
import type { EmulatorRequest, WorkerToMain } from '@/lib/emulator/protocol'

// ---------------------------------------------------------------------------
// Synthetic ELF builder (copied from existing EmulatorWorker tests, trimmed)
// ---------------------------------------------------------------------------

function buildElf(entry: number, data: Uint8Array): ArrayBuffer {
  const EH_SIZE = 52
  const PH_SIZE = 32
  const SH_SIZE = 40
  const segOffset = EH_SIZE + PH_SIZE
  const shOffset = segOffset + data.length
  const out = new Uint8Array(shOffset + SH_SIZE)

  // ELF header
  out.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1])
  const v = new DataView(out.buffer)
  v.setUint16(0x10, 2, true) // ET_EXEC
  v.setUint16(0x12, 0x28, true) // EM_ARM
  v.setUint32(0x14, 1, true)
  v.setUint32(0x18, entry, true)
  v.setUint32(0x1c, EH_SIZE, true)
  v.setUint32(0x20, shOffset, true)
  v.setUint16(0x28, EH_SIZE, true)
  v.setUint16(0x2a, PH_SIZE, true)
  v.setUint16(0x2c, 1, true)
  v.setUint16(0x2e, SH_SIZE, true)
  v.setUint16(0x30, 1, true)
  v.setUint16(0x32, 0, true)

  // Program header
  v.setUint32(EH_SIZE + 0, 1, true)
  v.setUint32(EH_SIZE + 4, segOffset, true)
  v.setUint32(EH_SIZE + 8, entry, true)
  v.setUint32(EH_SIZE + 12, entry, true)
  v.setUint32(EH_SIZE + 16, data.length, true)
  v.setUint32(EH_SIZE + 20, data.length, true)
  v.setUint32(EH_SIZE + 24, 0x5, true)
  v.setUint32(EH_SIZE + 28, 0x1000, true)

  out.set(data, segOffset)
  return out.buffer
}

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values)
}

// ---------------------------------------------------------------------------
// Test harness: wrap a DelugeEmulator around an in-process worker
// ---------------------------------------------------------------------------

interface FakeWorker {
  onmessage: ((evt: MessageEvent) => void) | null
  terminate(): void
  postMessage(msg: unknown, transfer?: Transferable[]): void
}

function pairedEmulator(store: InMemorySnapshotStore): {
  emulator: DelugeEmulator
  teardown: () => void
} {
  // "Worker" side: we wire runWorker into a fake transport that delivers
  // messages back to the main-thread DelugeEmulator via a fake worker.
  let workerMessageHandler: ((req: EmulatorRequest) => void) | null = null
  const worker: FakeWorker = {
    onmessage: null,
    terminate() {},
    postMessage(msg: unknown) {
      if (workerMessageHandler) workerMessageHandler(msg as EmulatorRequest)
    },
  }
  const { handle } = runWorker(
    {
      post: (msg: WorkerToMain) => {
        if (worker.onmessage) {
          worker.onmessage(new MessageEvent('message', { data: msg }))
        }
      },
      listen: (h) => {
        workerMessageHandler = h
      },
    },
    { snapshotStore: store },
  )

  // Override postMessage so we route to handle() too
  worker.postMessage = (msg: unknown) => {
    if (workerMessageHandler) {
      void handle(msg as EmulatorRequest)
    }
  }

  const emulator = new DelugeEmulator()
  emulator.attachWorker(worker as unknown as Worker)
  return { emulator, teardown: () => emulator.dispose() }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HotReloader cold reload', () => {
  let store: InMemorySnapshotStore
  let emulator: DelugeEmulator
  let teardown: () => void
  beforeEach(() => {
    store = new InMemorySnapshotStore()
    const p = pairedEmulator(store)
    emulator = p.emulator
    teardown = p.teardown
  })

  test('loads a fresh ELF without restoring a snapshot', async () => {
    await emulator.init()
    const reloader = new HotReloader(emulator)
    const elf = buildElf(0x20000000, bytes([1, 2, 3, 4]))
    const result = await reloader.reload(elf, { mode: 'cold' })
    expect(result.entry).toBe(0x20000000)
    expect(result.snapshotRestored).toBe(false)
    expect(result.elfHash).toMatch(/^[0-9a-f]{64}$/)
    teardown()
  })

  test('reload copies segment data into memory', async () => {
    await emulator.init()
    const reloader = new HotReloader(emulator)
    const elf = buildElf(0x20000000, bytes([0xde, 0xad, 0xbe, 0xef]))
    await reloader.reload(elf, { mode: 'cold' })
    const read = await emulator.readMem(0x20000000, 4)
    if (read.type === 'memData') {
      expect(Array.from(new Uint8Array(read.data))).toEqual([0xde, 0xad, 0xbe, 0xef])
    }
    teardown()
  })
})

describe('HotReloader warm reload', () => {
  let store: InMemorySnapshotStore
  let emulator: DelugeEmulator
  let teardown: () => void
  beforeEach(() => {
    store = new InMemorySnapshotStore()
    const p = pairedEmulator(store)
    emulator = p.emulator
    teardown = p.teardown
  })

  test('first load has no snapshot to restore', async () => {
    await emulator.init()
    const reloader = new HotReloader(emulator)
    const elf = buildElf(0x20000000, bytes([0x10, 0x20]))
    const result = await reloader.reload(elf, { mode: 'warm' })
    expect(result.snapshotRestored).toBe(false)
    teardown()
  })

  test('saveCurrentAsSnapshotFor + reload restores the saved state', async () => {
    await emulator.init()
    const reloader = new HotReloader(emulator)
    const elf = buildElf(0x20000000, bytes([0xaa, 0xbb]))
    await reloader.reload(elf, { mode: 'cold' })

    // Mutate memory to make the snapshot observable
    const mutated = new Uint8Array([0x42, 0x42, 0x42, 0x42]).buffer
    await emulator.writeMem(0x0c000000, mutated)
    // Save snapshot keyed to this ELF
    const hash = await reloader.saveCurrentAsSnapshotFor(elf)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(store.count).toBe(1)

    // Reload warmly — snapshot should restore, memory should be 0x42×4
    // Use a fresh ArrayBuffer since the original was transferred.
    const elf2 = buildElf(0x20000000, bytes([0xaa, 0xbb]))
    const result = await reloader.reload(elf2, { mode: 'warm' })
    expect(result.snapshotRestored).toBe(true)
    const read = await emulator.readMem(0x0c000000, 4)
    if (read.type === 'memData') {
      expect(Array.from(new Uint8Array(read.data))).toEqual([0x42, 0x42, 0x42, 0x42])
    }
    teardown()
  })

  test('warm reload with wrong ELF does not restore', async () => {
    await emulator.init()
    const reloader = new HotReloader(emulator)

    const elfA = buildElf(0x20000000, bytes([1]))
    const elfB = buildElf(0x20000000, bytes([2]))
    // Save snapshot tied to elfA
    await reloader.reload(elfA, { mode: 'cold' })
    await reloader.saveCurrentAsSnapshotFor(elfA)

    // Warm-load elfB — different hash, no snapshot for it
    const result = await reloader.reload(elfB, { mode: 'warm' })
    expect(result.snapshotRestored).toBe(false)
    teardown()
  })

  test('elfHash is stable across reloads', async () => {
    await emulator.init()
    const reloader = new HotReloader(emulator)
    const elf1 = buildElf(0x20000000, bytes([0xff, 0xee]))
    const r1 = await reloader.reload(elf1, { mode: 'cold' })
    const elf2 = buildElf(0x20000000, bytes([0xff, 0xee]))
    const r2 = await reloader.reload(elf2, { mode: 'cold' })
    expect(r1.elfHash).toBe(r2.elfHash)
    teardown()
  })
})
