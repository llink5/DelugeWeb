// End-to-end SDHI + DMAC integration.
//
// Exercises the firmware-style block read path:
//   1. Attach a disk image
//   2. Issue CMD17 + argument via SDHI registers
//   3. Program DMAC channel 2 to read from SD_BUF0 → RAM buffer
//   4. Run one step — pump transfers the sector
//   5. Verify bytes match the source image

import { describe, test, expect } from 'vitest'
import { runWorker } from '@/lib/emulator/EmulatorWorker'
import type { EmulatorRequest, WorkerToMain } from '@/lib/emulator/protocol'

const SDHI_BASE = 0xe804e800
const SDHI_SD_ARG0 = SDHI_BASE + 0x04
const SDHI_SD_ARG1 = SDHI_BASE + 0x06
const SDHI_SD_CMD = SDHI_BASE + 0x00
const SDHI_SD_BUF0 = SDHI_BASE + 0x30

// DMAC channel 2 = SD DMA channel per cpu_specific.h
const DMAC_CH2 = 0xe8200000 + 2 * 0x40
const RAM_BUFFER = 0x20100000

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

function makeTestImage(sectors: number): ArrayBuffer {
  const img = new ArrayBuffer(sectors * 512)
  const view = new Uint8Array(img)
  for (let s = 0; s < sectors; s++) {
    for (let b = 0; b < 512; b++) {
      view[s * 512 + b] = (s * 17 + b) & 0xff
    }
  }
  return img
}

describe('SDHI block read via DMAC pump', () => {
  test('CMD17 sector 0 data flows to RAM via DMA ch2', async () => {
    const { handle, state } = await setup()
    // Attach a 4-sector image
    await handle({
      type: 'attachSdImage',
      seq: 2,
      image: makeTestImage(4),
    } as EmulatorRequest)

    // Issue CMD17 for sector 1
    const m = state.core.memory
    m.write16(SDHI_SD_ARG0, 1)
    m.write16(SDHI_SD_ARG1, 0)
    m.write16(SDHI_SD_CMD, 17)

    // Program DMAC ch2: src=SD_BUF0 (fixed), dst=RAM (inc), 32-bit, 512 bytes
    m.write32(DMAC_CH2 + 0x00, SDHI_SD_BUF0) // N0SA
    m.write32(DMAC_CH2 + 0x04, RAM_BUFFER) // N0DA
    m.write32(DMAC_CH2 + 0x08, 512) // N0TB
    // SDS=2 (32-bit src), DDS=2 (32-bit dst), SAD=1 (fixed), DAD=0 (inc)
    m.write32(DMAC_CH2 + 0x2c, (2 << 12) | (2 << 16) | (1 << 20))
    m.write32(DMAC_CH2 + 0x28, 0x1) // SETEN

    // Pump via step
    await handle({ type: 'step', seq: 3, instructions: 0 } as EmulatorRequest)

    // Verify 512 bytes of sector 1 landed in RAM
    for (let b = 0; b < 512; b++) {
      expect(m.read8(RAM_BUFFER + b)).toBe((1 * 17 + b) & 0xff)
    }
  })

  test('CMD18 multi-block read drains 2 sectors', async () => {
    const { handle, state } = await setup()
    await handle({
      type: 'attachSdImage',
      seq: 2,
      image: makeTestImage(4),
    } as EmulatorRequest)

    const m = state.core.memory
    // CMD18 sector 0, 2 blocks
    m.write16(SDHI_SD_ARG0, 0)
    m.write16(0xe804e800 + 0x0a, 2) // SD_SECCNT
    m.write16(SDHI_SD_CMD, 18)

    m.write32(DMAC_CH2 + 0x00, SDHI_SD_BUF0)
    m.write32(DMAC_CH2 + 0x04, RAM_BUFFER)
    m.write32(DMAC_CH2 + 0x08, 1024) // 2 sectors × 512
    m.write32(DMAC_CH2 + 0x2c, (2 << 12) | (2 << 16) | (1 << 20))
    m.write32(DMAC_CH2 + 0x28, 0x1)

    await handle({ type: 'step', seq: 3, instructions: 0 } as EmulatorRequest)

    // Sector 0 byte 0 = 0, sector 1 byte 0 = 17
    expect(m.read8(RAM_BUFFER)).toBe(0)
    expect(m.read8(RAM_BUFFER + 512)).toBe(17)
  })

  test('CMD24 block write commits bytes from RAM to image', async () => {
    const { handle, state } = await setup()
    await handle({
      type: 'attachSdImage',
      seq: 2,
      image: makeTestImage(4),
    } as EmulatorRequest)

    const m = state.core.memory
    // Fill RAM with a recognizable pattern
    for (let i = 0; i < 512; i++) m.write8(RAM_BUFFER + i, 0x5a)

    // Issue CMD24 for sector 2
    m.write16(SDHI_SD_ARG0, 2)
    m.write16(SDHI_SD_CMD, 24)

    // Program DMAC ch2 for write: src=RAM (inc), dst=SD_BUF0 (fixed)
    m.write32(DMAC_CH2 + 0x00, RAM_BUFFER)
    m.write32(DMAC_CH2 + 0x04, SDHI_SD_BUF0)
    m.write32(DMAC_CH2 + 0x08, 512)
    // SDS=2, DDS=2, SAD=0 (inc), DAD=1 (fixed)
    m.write32(DMAC_CH2 + 0x2c, (2 << 12) | (2 << 16) | (1 << 21))
    m.write32(DMAC_CH2 + 0x28, 0x1)

    await handle({ type: 'step', seq: 3, instructions: 0 } as EmulatorRequest)

    // After the DMA, reading sector 2 back should return 0x5A everywhere
    m.write16(SDHI_SD_ARG0, 2)
    m.write16(SDHI_SD_CMD, 17) // CMD17 to verify
    for (let i = 0; i < 128; i++) {
      const w = m.read32(SDHI_SD_BUF0)
      expect(w >>> 0).toBe(0x5a5a5a5a)
    }
  })
})
