// End-to-end OLED wiring test.
//
// Verifies that writes to the RSPI0 SPDR register (via the main CPU bus,
// the path the Deluge firmware uses) land in the OLED framebuffer and
// produce a displayUpdate event on the worker transport.

import { describe, test, expect } from 'vitest'
import { runWorker } from '@/lib/emulator/EmulatorWorker'
import type { EmulatorRequest, WorkerToMain } from '@/lib/emulator/protocol'

// RSPI channel 0 SPDR.BYTE.LL absolute address (iodefine.h RSPI0 + 0x04)
const RSPI0_SPDR = 0xe800c804

async function setup() {
  const messages: WorkerToMain[] = []
  const transport = {
    post: (msg: WorkerToMain) => messages.push(msg),
    listen: () => {
      /* tests use handle() directly */
    },
  }
  const { handle, state } = runWorker(transport)
  // Bring the worker online: maps memory, registers peripherals, wires OLED.
  await handle({ type: 'init', seq: 1 } as EmulatorRequest)
  return { messages, handle, state }
}

function writeSpdrByte(
  state: { core: { memory: { write8: (a: number, v: number) => void } } },
  byte: number,
): void {
  state.core.memory.write8(RSPI0_SPDR, byte)
}

describe('OLED framebuffer wiring through peripheral bus', () => {
  test('Deluge init sequence turns the emulator OLED on', async () => {
    const { state } = await setup()
    const initSequence = [
      0xfd, 0x12, 0xae, 0x81, 0xff, 0xa4, 0xa6, 0x00, 0x10, 0x20, 0x00,
      0x40, 0xa0, 0xa8, 0x3f, 0xc0, 0xd3, 0x00, 0xda, 0x12, 0xd5, 0xf0,
      0xd9, 0xa2, 0xdb, 0x34, 0xaf,
    ]
    for (const b of initSequence) writeSpdrByte(state, b)
    expect(state.oled.on).toBe(true)
    expect(state.oledBridge?.isDataMode()).toBe(true)
  })

  test('framebuffer data write after init lands in oled.framebuffer', async () => {
    const { state } = await setup()
    // Run the init sequence so bridge flips to data mode
    for (const b of [
      0xfd, 0x12, 0xae, 0x81, 0xff, 0xa4, 0xa6, 0x00, 0x10, 0x20, 0x00,
      0x40, 0xa0, 0xa8, 0x3f, 0xc0, 0xd3, 0x00, 0xda, 0x12, 0xd5, 0xf0,
      0xd9, 0xa2, 0xdb, 0x34, 0xaf,
    ]) {
      writeSpdrByte(state, b)
    }
    writeSpdrByte(state, 0x42)
    expect(state.oled.framebuffer[0]).toBe(0x42)
    expect(state.oledDirty).toBe(true)
  })

  test('step flushes displayUpdate event with framebuffer', async () => {
    const { messages, handle, state } = await setup()
    // Mark the framebuffer dirty by writing a data byte
    for (const b of [
      0xfd, 0x12, 0xae, 0x81, 0xff, 0xa4, 0xa6, 0x00, 0x10, 0x20, 0x00,
      0x40, 0xa0, 0xa8, 0x3f, 0xc0, 0xd3, 0x00, 0xda, 0x12, 0xd5, 0xf0,
      0xd9, 0xa2, 0xdb, 0x34, 0xaf,
    ]) {
      writeSpdrByte(state, b)
    }
    writeSpdrByte(state, 0xcc)
    // Run step so flushDisplay posts the event
    await handle({ type: 'step', seq: 2, instructions: 0 } as EmulatorRequest)
    const displayEvent = messages.find((m) => m.type === 'displayUpdate')
    expect(displayEvent).toBeDefined()
    if (displayEvent && displayEvent.type === 'displayUpdate') {
      const fb = new Uint8Array(displayEvent.framebuffer)
      expect(fb.length).toBe(128 * 8)
      expect(fb[0]).toBe(0xcc)
    }
    // Dirty flag cleared after flush
    expect(state.oledDirty).toBe(false)
  })

  test('reset wipes the OLED state', async () => {
    const { handle, state } = await setup()
    writeSpdrByte(state, 0xaf) // display on
    expect(state.oled.on).toBe(true)
    await handle({ type: 'reset', seq: 3 } as EmulatorRequest)
    expect(state.oled.on).toBe(false)
    expect(state.oled.framebuffer.every((b) => b === 0)).toBe(true)
  })
})
