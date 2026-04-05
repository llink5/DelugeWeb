// Verifies the DMA pump drains audio samples at approximately CPU rate.
//
// Seeds the SSI ring buffer with a repeating pattern, runs step() with
// enough instructions that the pump should cycle the ring multiple times,
// and checks that the SSI captured-frame counter advanced proportionally.

import { describe, test, expect } from 'vitest'
import { runWorker } from '@/lib/emulator/EmulatorWorker'
import type { EmulatorRequest, WorkerToMain } from '@/lib/emulator/protocol'

const SSIF0_FTDR = 0xe820b000 + 0x18
const DMAC_CH6 = 0xe8200000 + 6 * 0x40
const RAM = 0x20100000

async function setup() {
  const messages: WorkerToMain[] = []
  const { handle, state } = runWorker({
    post: (msg) => messages.push(msg),
    listen: () => {},
  })
  await handle({ type: 'init', seq: 1 } as EmulatorRequest)
  return { messages, handle, state }
}

describe('Interleaved DMA pump — audio rate', () => {
  test('step drains a 256-element SSI ring many times', async () => {
    const { handle, state } = await setup()
    // Stage 256 Int32 samples (128 stereo frames) in RAM.
    for (let i = 0; i < 256; i++) {
      state.core.memory.write32(RAM + i * 4, (i + 1) << 16)
    }
    // Ring DMA: N0 cycles the same 1024 bytes forever.
    const m = state.core.memory
    m.write32(DMAC_CH6 + 0x00, RAM) // N0SA
    m.write32(DMAC_CH6 + 0x04, SSIF0_FTDR) // N0DA fixed
    m.write32(DMAC_CH6 + 0x08, 1024) // N0TB (256 × 4)
    m.write32(DMAC_CH6 + 0x0c, RAM) // N1SA
    m.write32(DMAC_CH6 + 0x10, SSIF0_FTDR)
    m.write32(DMAC_CH6 + 0x14, 1024)
    m.write32(DMAC_CH6 + 0x2c, (2 << 12) | (2 << 16) | (1 << 21))
    m.write32(DMAC_CH6 + 0x28, 0x1)

    // Run a realistic audio step — 100k instructions. With the
    // interleaved pump calling every 10k instructions and a cap of
    // 4096 elements/call, the SSI channel should drain ~40k elements.
    await handle({
      type: 'step',
      seq: 2,
      instructions: 100_000,
    } as EmulatorRequest)
    // With no firmware actually running, the CPU does 0 real instructions
    // but the pump still runs once per chunk. 100k/10k = 10 chunks → each
    // drains up to 4096 elements from the 256-element ring. We should
    // have accumulated tens of thousands of frames.
    const ssi = state.bus.list().find((s) => s.name === 'SSI') as
      | { capturedFrames: number }
      | undefined
    expect(ssi).toBeDefined()
    expect(ssi!.capturedFrames).toBeGreaterThan(1000)
  })

  test('pump drives enough bytes for 44.1 kHz continuous playback', async () => {
    const { handle, state } = await setup()
    // Minimal ring
    for (let i = 0; i < 256; i++) {
      state.core.memory.write32(RAM + i * 4, 0x00010000)
    }
    const m = state.core.memory
    m.write32(DMAC_CH6 + 0x00, RAM)
    m.write32(DMAC_CH6 + 0x04, SSIF0_FTDR)
    m.write32(DMAC_CH6 + 0x08, 1024)
    m.write32(DMAC_CH6 + 0x0c, RAM)
    m.write32(DMAC_CH6 + 0x10, SSIF0_FTDR)
    m.write32(DMAC_CH6 + 0x14, 1024)
    m.write32(DMAC_CH6 + 0x2c, (2 << 12) | (2 << 16) | (1 << 21))
    m.write32(DMAC_CH6 + 0x28, 0x1)

    // Request a large step; the pump should produce >44100 frames.
    await handle({
      type: 'step',
      seq: 2,
      instructions: 500_000,
    } as EmulatorRequest)
    const ssi = state.bus.list().find((s) => s.name === 'SSI') as
      | { capturedFrames: number }
      | undefined
    expect(ssi!.capturedFrames).toBeGreaterThanOrEqual(44_100)
  })
})
