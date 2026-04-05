import { describe, test, expect, beforeEach } from 'vitest'
import { runWorker } from '@/lib/emulator/EmulatorWorker'
import { DelugeEmulator } from '@/lib/emulator/DelugeEmulator'
import {
  VirtualHID,
  PLACEHOLDER_HID_MAPPING,
} from '@/lib/emulator/VirtualHID'
import { InMemorySnapshotStore } from '@/lib/emulator/snapshot/Snapshot'
import type { EmulatorRequest, WorkerToMain } from '@/lib/emulator/protocol'

interface FakeWorker {
  onmessage: ((evt: MessageEvent) => void) | null
  terminate(): void
  postMessage(msg: unknown, transfer?: Transferable[]): void
}

function setup(): {
  emulator: DelugeEmulator
  hid: VirtualHID
  teardown: () => void
} {
  let handler: ((req: EmulatorRequest) => void) | null = null
  const worker: FakeWorker = {
    onmessage: null,
    terminate() {},
    postMessage() {},
  }
  const { handle } = runWorker(
    {
      post: (msg: WorkerToMain) => {
        worker.onmessage?.(new MessageEvent('message', { data: msg }))
      },
      listen: (h) => {
        handler = h
      },
    },
    { snapshotStore: new InMemorySnapshotStore() },
  )
  worker.postMessage = (msg: unknown) => {
    if (handler) void handle(msg as EmulatorRequest)
  }
  const emulator = new DelugeEmulator()
  emulator.attachWorker(worker as unknown as Worker)
  const hid = new VirtualHID(emulator)
  return { emulator, hid, teardown: () => emulator.dispose() }
}

async function readByte(
  emulator: DelugeEmulator,
  address: number,
): Promise<number> {
  const reply = await emulator.readMem(address, 1)
  if (reply.type === 'memData' && reply.ok) {
    return new Uint8Array(reply.data)[0] ?? 0
  }
  return 0
}

let ctx: ReturnType<typeof setup>
beforeEach(async () => {
  ctx = setup()
  await ctx.emulator.init()
})

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

describe('VirtualHID buttons', () => {
  test('pressButton flips the right bit', async () => {
    await ctx.hid.pressButton('PLAY') // bit 0 at 0x20200000
    expect(await readByte(ctx.emulator, 0x20200000) & 0x1).toBe(1)
    ctx.teardown()
  })

  test('pressing multiple buttons OR-combines the byte', async () => {
    await ctx.hid.pressButton('PLAY') // bit 0
    await ctx.hid.pressButton('RECORD') // bit 1
    await ctx.hid.pressButton('SHIFT') // bit 2
    const b = await readByte(ctx.emulator, 0x20200000)
    expect(b & 0b111).toBe(0b111)
    ctx.teardown()
  })

  test('releaseButton clears the bit without disturbing neighbours', async () => {
    await ctx.hid.pressButton('PLAY')
    await ctx.hid.pressButton('RECORD')
    await ctx.hid.releaseButton('PLAY')
    const b = await readByte(ctx.emulator, 0x20200000)
    expect(b & 0x1).toBe(0) // PLAY cleared
    expect(b & 0x2).toBe(0x2) // RECORD still set
    ctx.teardown()
  })

  test('unknown button throws', async () => {
    await expect(ctx.hid.pressButton('BOGUS')).rejects.toThrow()
    ctx.teardown()
  })

  test('pressing same button twice is idempotent', async () => {
    await ctx.hid.pressButton('PLAY')
    await ctx.hid.pressButton('PLAY')
    expect(await readByte(ctx.emulator, 0x20200000) & 0x1).toBe(1)
    ctx.teardown()
  })
})

// ---------------------------------------------------------------------------
// Pads
// ---------------------------------------------------------------------------

describe('VirtualHID pads', () => {
  const padBase = PLACEHOLDER_HID_MAPPING.pads!.baseAddress

  test('pressPad writes velocity to the target byte', async () => {
    await ctx.hid.pressPad(3, 2, 100)
    const addr = padBase + 2 * 16 + 3
    expect(await readByte(ctx.emulator, addr)).toBe(100)
    ctx.teardown()
  })

  test('releasePad writes zero to the pad byte', async () => {
    await ctx.hid.pressPad(5, 5, 80)
    await ctx.hid.releasePad(5, 5)
    const addr = padBase + 5 * 16 + 5
    expect(await readByte(ctx.emulator, addr)).toBe(0)
    ctx.teardown()
  })

  test('velocity clamps to [1, 127]', async () => {
    await ctx.hid.pressPad(0, 0, 9999)
    expect(await readByte(ctx.emulator, padBase)).toBe(127)
    await ctx.hid.pressPad(0, 1, -5)
    expect(await readByte(ctx.emulator, padBase + 16)).toBe(1)
    ctx.teardown()
  })

  test('pad coordinates map into the 16-column stride', async () => {
    await ctx.hid.pressPad(15, 7, 50)
    const addr = padBase + 7 * 16 + 15
    expect(await readByte(ctx.emulator, addr)).toBe(50)
    ctx.teardown()
  })
})

// ---------------------------------------------------------------------------
// Audition pads
// ---------------------------------------------------------------------------

describe('VirtualHID audition pads', () => {
  const base = PLACEHOLDER_HID_MAPPING.auditionPads!.baseAddress

  test('pressAuditionPad writes to row byte', async () => {
    await ctx.hid.pressAuditionPad(3, 90)
    expect(await readByte(ctx.emulator, base + 3)).toBe(90)
    ctx.teardown()
  })

  test('releaseAuditionPad clears the byte', async () => {
    await ctx.hid.pressAuditionPad(0, 100)
    await ctx.hid.releaseAuditionPad(0)
    expect(await readByte(ctx.emulator, base)).toBe(0)
    ctx.teardown()
  })
})

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

describe('VirtualHID encoders', () => {
  test('turnEncoder writes the signed delta', async () => {
    await ctx.hid.turnEncoder('X_ENC', 3)
    expect(await readByte(ctx.emulator, 0x20200008)).toBe(3)
    ctx.teardown()
  })

  test('successive turns accumulate', async () => {
    await ctx.hid.turnEncoder('X_ENC', 1)
    await ctx.hid.turnEncoder('X_ENC', 1)
    await ctx.hid.turnEncoder('X_ENC', 1)
    expect(await readByte(ctx.emulator, 0x20200008)).toBe(3)
    ctx.teardown()
  })

  test('negative turns produce two-complement bytes', async () => {
    await ctx.hid.turnEncoder('X_ENC', -1)
    expect(await readByte(ctx.emulator, 0x20200008)).toBe(0xff) // -1 as byte
    ctx.teardown()
  })

  test('pressEncoder sets the press bit', async () => {
    await ctx.hid.pressEncoder('X_ENC') // bit 0 at 0x20200004
    expect(await readByte(ctx.emulator, 0x20200004) & 0x1).toBe(1)
    ctx.teardown()
  })

  test('unknown encoder throws', async () => {
    await expect(ctx.hid.turnEncoder('ZZZ', 1)).rejects.toThrow()
    ctx.teardown()
  })
})

// ---------------------------------------------------------------------------
// Custom mapping
// ---------------------------------------------------------------------------

describe('VirtualHID custom mapping', () => {
  test('caller-supplied mapping is respected', async () => {
    // 0x0C000000 is SDRAM which is mapped.
    const custom: typeof PLACEHOLDER_HID_MAPPING = {
      buttons: {
        CUSTOM: { address: 0x0c000000, bit: 3 },
      },
    }
    const localHid = new VirtualHID(ctx.emulator, custom)
    await localHid.pressButton('CUSTOM')
    expect(await readByte(ctx.emulator, 0x0c000000) & 0x8).toBe(0x8)
    ctx.teardown()
  })
})
