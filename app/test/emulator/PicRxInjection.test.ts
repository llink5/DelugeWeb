// End-to-end PIC RX injection test.
//
// Simulates the PIC microcontroller sending response bytes into the
// firmware's picRxBuffer. The firmware ring-buffer read path polls
// DMACn(12).CRDA_n for the current write pointer, so the DMAC stub's
// ch12 must advance CRDA as bytes land in RAM.

import { describe, test, expect } from 'vitest'
import { runWorker } from '@/lib/emulator/EmulatorWorker'
import type { EmulatorRequest, WorkerToMain } from '@/lib/emulator/protocol'
import {
  encodePadPress,
  encodePadRelease,
  encodeButtonPress,
  encodeButtonRelease,
  DELUGE_BUTTONS,
} from '@/lib/emulator/peripherals/PicInput'

// DMAC channel 12 = PIC_RX_DMA_CHANNEL
const DMAC_CH12 = 0xe8200000 + 12 * 0x40
// SCIF1 SCFRDR absolute address
const SCIF1_SCFRDR = 0xe8007800 + 0x14
// Fake picRxBuffer lives in on-chip RAM
const PIC_RX_BUFFER = 0x20100000
const PIC_RX_BUFFER_SIZE = 64

async function setup() {
  const messages: WorkerToMain[] = []
  const transport = {
    post: (msg: WorkerToMain) => messages.push(msg),
    listen: () => {},
  }
  const { handle, state } = runWorker(transport)
  await handle({ type: 'init', seq: 1 } as EmulatorRequest)
  return { messages, handle, state }
}

function setupPicRxDma(state: {
  core: { memory: { write32: (a: number, v: number) => void } }
}): void {
  const m = state.core.memory
  // SCFRDR → picRxBuffer, 64-byte ring, SAD=1 (src fixed), DAD=0 (dst inc).
  // SDS=0, DDS=0 (8-bit transfers).
  m.write32(DMAC_CH12 + 0x00, SCIF1_SCFRDR) // N0SA
  m.write32(DMAC_CH12 + 0x04, PIC_RX_BUFFER) // N0DA
  m.write32(DMAC_CH12 + 0x08, PIC_RX_BUFFER_SIZE) // N0TB
  m.write32(DMAC_CH12 + 0x0c, SCIF1_SCFRDR) // N1SA
  m.write32(DMAC_CH12 + 0x10, PIC_RX_BUFFER) // N1DA
  m.write32(DMAC_CH12 + 0x14, PIC_RX_BUFFER_SIZE) // N1TB (ring)
  m.write32(DMAC_CH12 + 0x2c, 1 << 20) // CHCFG: SAD=1 (src fixed)
  m.write32(DMAC_CH12 + 0x28, 0x1) // CHCTRL SETEN
}

describe('PIC RX injection via SCIF1 → DMA ch12 → picRxBuffer', () => {
  test('a single byte lands at the DMA destination', async () => {
    const { handle, state } = await setup()
    setupPicRxDma(state)
    await handle({
      type: 'injectPicBytes',
      seq: 2,
      bytes: [0xab],
    } as EmulatorRequest)
    expect(state.core.memory.read8(PIC_RX_BUFFER)).toBe(0xab)
    // CRDA advanced by 1 byte
    expect(state.core.memory.read32(DMAC_CH12 + 0x1c)).toBe(PIC_RX_BUFFER + 1)
  })

  test('multiple bytes fill the ring sequentially', async () => {
    const { handle, state } = await setup()
    setupPicRxDma(state)
    const bytes = [0x10, 0x20, 0x30, 0x40]
    await handle({
      type: 'injectPicBytes',
      seq: 2,
      bytes,
    } as EmulatorRequest)
    for (let i = 0; i < bytes.length; i++) {
      expect(state.core.memory.read8(PIC_RX_BUFFER + i)).toBe(bytes[i])
    }
  })

  test('pad press encodes correctly and reaches the buffer', async () => {
    const { handle, state } = await setup()
    setupPicRxDma(state)
    await handle({
      type: 'injectPicBytes',
      seq: 2,
      bytes: encodePadPress(3, 4), // pad (3, 4) → byte = 9*4 + 1 + 72 = 109
    } as EmulatorRequest)
    expect(state.core.memory.read8(PIC_RX_BUFFER)).toBe(109)
  })

  test('pad release injects NEXT_PAD_OFF + pad byte', async () => {
    const { handle, state } = await setup()
    setupPicRxDma(state)
    await handle({
      type: 'injectPicBytes',
      seq: 2,
      bytes: encodePadRelease(0, 0),
    } as EmulatorRequest)
    expect(state.core.memory.read8(PIC_RX_BUFFER)).toBe(252) // NEXT_PAD_OFF
    expect(state.core.memory.read8(PIC_RX_BUFFER + 1)).toBe(0)
  })

  test('delivered count reflects successful transfers', async () => {
    const { messages, handle, state } = await setup()
    setupPicRxDma(state)
    await handle({
      type: 'injectPicBytes',
      seq: 2,
      bytes: [1, 2, 3, 4, 5],
    } as EmulatorRequest)
    const reply = messages.find((m) => m.type === 'picBytesInjected')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'picBytesInjected') {
      expect(reply.delivered).toBe(5)
    }
  })

  test('button press → PIC byte → picRxBuffer', async () => {
    const { handle, state } = await setup()
    setupPicRxDma(state)
    await handle({
      type: 'injectPicBytes',
      seq: 2,
      bytes: encodeButtonPress('PLAY'),
    } as EmulatorRequest)
    expect(state.core.memory.read8(PIC_RX_BUFFER)).toBe(DELUGE_BUTTONS.PLAY)
    expect(DELUGE_BUTTONS.PLAY).toBe(179)
  })

  test('button release (NEXT_PAD_OFF + byte) lands in buffer', async () => {
    const { handle, state } = await setup()
    setupPicRxDma(state)
    await handle({
      type: 'injectPicBytes',
      seq: 2,
      bytes: encodeButtonRelease('SHIFT'),
    } as EmulatorRequest)
    expect(state.core.memory.read8(PIC_RX_BUFFER)).toBe(252) // NEXT_PAD_OFF
    expect(state.core.memory.read8(PIC_RX_BUFFER + 1)).toBe(DELUGE_BUTTONS.SHIFT)
  })

  test('DMA ring wraps around the buffer end', async () => {
    const { handle, state } = await setup()
    setupPicRxDma(state)
    // Fill the whole 64-byte ring
    const fullRing = Array.from({ length: 64 }, (_, i) => 0x30 + (i & 0x0f))
    await handle({
      type: 'injectPicBytes',
      seq: 2,
      bytes: fullRing,
    } as EmulatorRequest)
    // Next byte triggers a ring-chain: CRDA reloads from N1DA = PIC_RX_BUFFER
    await handle({
      type: 'injectPicBytes',
      seq: 3,
      bytes: [0xff],
    } as EmulatorRequest)
    // First byte of the ring was overwritten
    expect(state.core.memory.read8(PIC_RX_BUFFER)).toBe(0xff)
  })
})
