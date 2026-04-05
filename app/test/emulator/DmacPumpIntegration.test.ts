// End-to-end DMAC pump integration.
//
// Exercises the full firmware-style DMA path:
//   1. Place PIC message bytes in on-chip RAM
//   2. Program DMAC channel 10 to read from RAM → SCIF1.FTDR
//   3. Enable the channel via CHCTRL.SETEN
//   4. Run a step so the pump executes
//   5. Confirm the bytes reached the PicUartDecoder and an ledUpdate
//      event was posted to the transport.

import { describe, test, expect } from 'vitest'
import { runWorker } from '@/lib/emulator/EmulatorWorker'
import type { EmulatorRequest, WorkerToMain } from '@/lib/emulator/protocol'

// DMAC channel 10 is PIC_TX_DMA_CHANNEL per cpu_specific.h
const DMAC_CH10 = 0xe8200000 + 10 * 0x40
const N0SA = DMAC_CH10 + 0x00
const N0DA = DMAC_CH10 + 0x04
const N0TB = DMAC_CH10 + 0x08
const CHCTRL = DMAC_CH10 + 0x28
const CHCFG = DMAC_CH10 + 0x2c

// SCIF1.FTDR absolute address
const SCIF1_FTDR = 0xe8007800 + 0x0c

// On-chip RAM (OC_RAM base)
const RAM_ADDR = 0x20100000

async function setup() {
  const messages: WorkerToMain[] = []
  const transport = {
    post: (msg: WorkerToMain) => messages.push(msg),
    listen: () => {
      /* tests use handle() directly */
    },
  }
  const { handle, state } = runWorker(transport)
  await handle({ type: 'init', seq: 1 } as EmulatorRequest)
  return { messages, handle, state }
}

function programChannel10(
  state: { core: { memory: { write32: (a: number, v: number) => void } } },
  sourceAddr: number,
  bytes: number,
): void {
  const m = state.core.memory
  m.write32(N0SA, sourceAddr)
  m.write32(N0DA, SCIF1_FTDR)
  m.write32(N0TB, bytes)
  // SDS=0 (8-bit src), DDS=0 (8-bit dst), SAD=0 (inc), DAD=1 (fixed)
  m.write32(CHCFG, 1 << 21)
  // SETEN
  m.write32(CHCTRL, 0x1)
}

describe('DMAC pump drives PIC UART → LED decoder', () => {
  test('SET_LED_ON message flows from RAM through DMA to decoder', async () => {
    const { handle, state } = await setup()
    // Pad RAM with a PIC SET_LED_ON command at index 0 (byte = 188).
    state.core.memory.write8(RAM_ADDR, 188)
    programChannel10(state, RAM_ADDR, 1)
    // A single step triggers pumpDma.
    await handle({ type: 'step', seq: 2, instructions: 0 } as EmulatorRequest)
    expect(state.picDecoder.state.indicatorLeds[0]).toBe(true)
    expect(state.ledDirty).toBe(false) // flushed by step
  })

  test('SET_COLOUR_FOR_TWO_COLUMNS drives a 49-byte DMA burst', async () => {
    const { handle, state } = await setup()
    // Header + 48 RGB payload bytes for column pair idx=0 (cols 0,1).
    const payload: number[] = [1]
    for (let i = 0; i < 48; i++) payload.push(i)
    for (let i = 0; i < payload.length; i++) {
      state.core.memory.write8(RAM_ADDR + i, payload[i])
    }
    programChannel10(state, RAM_ADDR, payload.length)
    await handle({ type: 'step', seq: 2, instructions: 0 } as EmulatorRequest)
    // Left col (0), row 0: bytes 0,1,2
    expect(state.picDecoder.state.pads[0][0]).toEqual({ r: 0, g: 1, b: 2 })
    // Right col (1), row 7: bytes 24+21..23 = 45, 46, 47
    expect(state.picDecoder.state.pads[1][7]).toEqual({ r: 45, g: 46, b: 47 })
  })

  test('emits ledUpdate event after DMA transfer', async () => {
    const { messages, handle, state } = await setup()
    // Send an SET_LED_ON via DMA
    state.core.memory.write8(RAM_ADDR, 188 + 2)
    programChannel10(state, RAM_ADDR, 1)
    await handle({ type: 'step', seq: 2, instructions: 0 } as EmulatorRequest)
    const ledEvent = messages.find((m) => m.type === 'ledUpdate')
    expect(ledEvent).toBeDefined()
  })

  test('ledUpdate buffer is row-major 18×8 with device-row flip', async () => {
    const { messages, handle, state } = await setup()
    // SET_COLOUR_FOR_TWO_COLUMNS idx=0, payload = distinct markers
    const payload: number[] = [1]
    for (let i = 0; i < 48; i++) payload.push(i)
    for (let i = 0; i < payload.length; i++) {
      state.core.memory.write8(RAM_ADDR + i, payload[i])
    }
    programChannel10(state, RAM_ADDR, payload.length)
    await handle({ type: 'step', seq: 2, instructions: 0 } as EmulatorRequest)
    const ledEvent = messages.find((m) => m.type === 'ledUpdate')
    expect(ledEvent).toBeDefined()
    if (ledEvent && ledEvent.type === 'ledUpdate') {
      const buf = new Uint8Array(ledEvent.colors)
      expect(buf.byteLength).toBe(18 * 8 * 3)
      // Device row 0 for col 0 = {r:0,g:1,b:2} → UI row 7
      const uiRow7Col0 = (7 * 18 + 0) * 3
      expect(buf[uiRow7Col0]).toBe(0)
      expect(buf[uiRow7Col0 + 1]).toBe(1)
      expect(buf[uiRow7Col0 + 2]).toBe(2)
      // Device row 7 for col 1 = bytes 45,46,47 → UI row 0
      const uiRow0Col1 = (0 * 18 + 1) * 3
      expect(buf[uiRow0Col1]).toBe(45)
      expect(buf[uiRow0Col1 + 1]).toBe(46)
      expect(buf[uiRow0Col1 + 2]).toBe(47)
    }
  })

  test('DMA to OLED SPI channel drives the framebuffer', async () => {
    // Channel 4 = OLED_SPI_DMA_CHANNEL; dest = RSPI0.SPDR.BYTE.LL
    const { handle, state } = await setup()
    const CH4 = 0xe8200000 + 4 * 0x40
    const RSPI0_SPDR = 0xe800c804

    // Drive the OLED bridge into data mode by simulating the 27-byte init
    // sequence directly (skip command-level testing, just set it manually).
    state.oledBridge?.setDataMode(true)

    // Place 4 data bytes in RAM, program DMA
    for (let i = 0; i < 4; i++) state.core.memory.write8(RAM_ADDR + i, 0x90 + i)
    const m = state.core.memory
    m.write32(CH4 + 0x00, RAM_ADDR)
    m.write32(CH4 + 0x04, RSPI0_SPDR)
    m.write32(CH4 + 0x08, 4)
    m.write32(CH4 + 0x2c, 1 << 21) // dst fixed
    m.write32(CH4 + 0x28, 0x1)

    await handle({ type: 'step', seq: 2, instructions: 0 } as EmulatorRequest)
    expect(state.oled.framebuffer[0]).toBe(0x90)
    expect(state.oled.framebuffer[1]).toBe(0x91)
    expect(state.oled.framebuffer[2]).toBe(0x92)
    expect(state.oled.framebuffer[3]).toBe(0x93)
  })
})
