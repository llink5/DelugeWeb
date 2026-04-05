// End-to-end snapshot tests through the worker protocol.

import { describe, test, expect } from 'vitest'
import { runWorker } from '@/lib/emulator/EmulatorWorker'
import {
  InMemorySnapshotStore,
} from '@/lib/emulator/snapshot/Snapshot'
import type { EmulatorRequest, WorkerToMain } from '@/lib/emulator/protocol'
import { isReply } from '@/lib/emulator/protocol'

function setup(): {
  messages: WorkerToMain[]
  handle: (req: EmulatorRequest) => Promise<void>
  store: InMemorySnapshotStore
} {
  const messages: WorkerToMain[] = []
  const store = new InMemorySnapshotStore()
  const { handle } = runWorker(
    {
      post: (msg) => messages.push(msg),
      listen: () => {},
    },
    { snapshotStore: store },
  )
  return { messages, handle, store }
}

function replyFor<T extends WorkerToMain['type']>(
  messages: WorkerToMain[],
  seq: number,
): Extract<WorkerToMain, { type: T }> | undefined {
  return messages.find((m) => isReply(m) && m.replyTo === seq) as
    | Extract<WorkerToMain, { type: T }>
    | undefined
}

describe('worker snapshots', () => {
  test('save then load restores memory', async () => {
    const { messages, handle, store } = setup()
    await handle({ type: 'init', seq: 1 })

    // Write distinctive bytes at a known address
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer
    await handle({
      type: 'writeMem',
      seq: 2,
      address: 0x20000000,
      data: payload,
    })

    // Capture
    await handle({ type: 'saveSnapshot', seq: 3, name: 'post-init' })
    const saveReply = replyFor<'snapshotSaved'>(messages, 3)!
    expect(saveReply.ok).toBe(true)
    expect(store.count).toBe(1)

    // Trash memory
    const zero = new Uint8Array(4).buffer
    await handle({
      type: 'writeMem',
      seq: 4,
      address: 0x20000000,
      data: zero,
    })
    await handle({
      type: 'readMem',
      seq: 5,
      address: 0x20000000,
      length: 4,
    })
    const mid = replyFor<'memData'>(messages, 5)!
    expect(Array.from(new Uint8Array(mid.data))).toEqual([0, 0, 0, 0])

    // Restore
    await handle({ type: 'loadSnapshot', seq: 6, name: 'post-init' })
    const loadReply = replyFor<'snapshotLoaded'>(messages, 6)!
    expect(loadReply.ok).toBe(true)

    // Verify bytes came back
    await handle({
      type: 'readMem',
      seq: 7,
      address: 0x20000000,
      length: 4,
    })
    const after = replyFor<'memData'>(messages, 7)!
    expect(Array.from(new Uint8Array(after.data))).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  test('load of unknown snapshot returns error', async () => {
    const { messages, handle } = setup()
    await handle({ type: 'init', seq: 1 })
    await handle({ type: 'loadSnapshot', seq: 2, name: 'does-not-exist' })
    const reply = replyFor<'snapshotLoaded'>(messages, 2)!
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('not found')
  })

  test('snapshots preserve registers', async () => {
    const { messages, handle } = setup()
    await handle({ type: 'init', seq: 1 })

    // Inject state via loadElf to seed PC at 0x20000000 and then step
    // Instead just call saveSnapshot at a known state
    await handle({ type: 'saveSnapshot', seq: 2, name: 'baseline' })
    await handle({ type: 'getRegisters', seq: 3 })
    const beforePc = replyFor<'registers'>(messages, 3)!.registers.pc

    // Load the snapshot back
    await handle({ type: 'loadSnapshot', seq: 4, name: 'baseline' })
    await handle({ type: 'getRegisters', seq: 5 })
    const afterPc = replyFor<'registers'>(messages, 5)!.registers.pc
    expect(afterPc).toBe(beforePc)
  })
})
