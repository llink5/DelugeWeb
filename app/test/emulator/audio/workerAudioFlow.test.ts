// End-to-end: SSI peripheral write → audio capture → worker audioBuffer event.

import { describe, test, expect } from 'vitest'
import { runWorker } from '@/lib/emulator/EmulatorWorker'
import type { EmulatorRequest, WorkerToMain } from '@/lib/emulator/protocol'
import { isEvent } from '@/lib/emulator/protocol'

function setup(): {
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

describe('SSI audio capture through the worker', () => {
  test('writes to SSI TX via memory access emit audioBuffer events', async () => {
    const { messages, handle } = await initWorker()
    // SSI is wired into the CPU's peripheral regions during init.
    // Channel 0 TX FIFO register is at 0xE820B000 + 0x18 = 0xE820B018.
    // Deluge DMA writes one Int32 per element alternating L/R, so
    // we need 2 × 128 = 256 writes to produce 128 frames (batch).
    for (let i = 0; i < 256; i++) {
      const buf = new ArrayBuffer(4)
      new DataView(buf).setInt32(0, (i + 1) << 16, true)
      await handle({
        type: 'writeMem',
        seq: 10 + i,
        address: 0xe820b018,
        data: buf,
      })
    }
    const audioEvents = messages.filter(
      (m) => isEvent(m) && m.type === 'audioBuffer',
    ) as Array<Extract<WorkerToMain, { type: 'audioBuffer' }>>
    expect(audioEvents.length).toBeGreaterThanOrEqual(1)
  })

  test('audioBuffer samples are interleaved stereo Int16', async () => {
    const { messages, handle } = await initWorker()
    // Write 256 samples (128 stereo frames), alternating L (positive)
    // and R (negative). Stub scales Int32 → Int16 by >> 16.
    for (let i = 0; i < 128; i++) {
      // Left sample for frame i = 1000 + i (as Int32 scaled << 16)
      const left = new ArrayBuffer(4)
      new DataView(left).setInt32(0, (1000 + i) << 16, true)
      await handle({
        type: 'writeMem',
        seq: 10 + i * 2,
        address: 0xe820b018,
        data: left,
      })
      // Right sample = -(1000 + i)
      const right = new ArrayBuffer(4)
      new DataView(right).setInt32(0, -(1000 + i) << 16, true)
      await handle({
        type: 'writeMem',
        seq: 11 + i * 2,
        address: 0xe820b018,
        data: right,
      })
    }
    const audioEvents = messages.filter(
      (m) => isEvent(m) && m.type === 'audioBuffer',
    ) as Array<Extract<WorkerToMain, { type: 'audioBuffer' }>>
    expect(audioEvents.length).toBeGreaterThan(0)
    const evt = audioEvents[0]
    expect(evt.channels).toBe(2)
    const samples = new Int16Array(evt.samples)
    expect(samples.length % 2).toBe(0)
    expect(samples[0]).toBe(1000)
    expect(samples[1]).toBe(-1000)
  })

  test('step flushes partial audio batch', async () => {
    const { messages, handle } = await initWorker()
    // 10 frames = 20 sample writes (below batch size of 128)
    for (let i = 0; i < 20; i++) {
      const buf = new ArrayBuffer(4)
      new DataView(buf).setInt32(0, 0x01230000, true)
      await handle({
        type: 'writeMem',
        seq: 10 + i,
        address: 0xe820b018,
        data: buf,
      })
    }
    let audioEvents = messages.filter(
      (m) => isEvent(m) && m.type === 'audioBuffer',
    )
    expect(audioEvents.length).toBe(0)
    await handle({ type: 'step', seq: 100, instructions: 1 })
    audioEvents = messages.filter(
      (m) => isEvent(m) && m.type === 'audioBuffer',
    )
    expect(audioEvents.length).toBe(1)
    const evt = audioEvents[0] as Extract<WorkerToMain, { type: 'audioBuffer' }>
    // 10 stereo frames = 20 Int16 samples
    expect(new Int16Array(evt.samples).length).toBe(20)
  })
})

async function initWorker() {
  const ctx = setup()
  await ctx.handle({ type: 'init', seq: 1 })
  return ctx
}
