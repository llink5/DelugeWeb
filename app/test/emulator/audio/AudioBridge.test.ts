import { describe, test, expect, vi } from 'vitest'
import { AudioBridge, type AudioContextHook } from '@/lib/audio/AudioBridge'

interface FakeHook extends AudioContextHook {
  startCalls: number
  underrunValue: number
}

function fakeHook(): FakeHook {
  const hook: FakeHook = {
    startCalls: 0,
    underrunValue: 0,
    async start() {
      hook.startCalls++
    },
    async suspend() {},
    async resume() {},
    async close() {},
    underruns() {
      return hook.underrunValue
    },
  }
  return hook
}

describe('AudioBridge construction', () => {
  test('default sample rate 44100, default 2 channels', () => {
    const b = new AudioBridge()
    expect(b.sampleRate).toBe(44100)
    expect(b.channels).toBe(2)
  })

  test('custom sample rate and channels', () => {
    const b = new AudioBridge({ sampleRate: 48000, channels: 1 })
    expect(b.sampleRate).toBe(48000)
    expect(b.channels).toBe(1)
  })

  test('capacity is scaled by channels in the ring', () => {
    const b = new AudioBridge({ capacity: 100, channels: 2 })
    // capacity × channels = 200, next power-of-two is 256
    expect(b.ringBuffer.capacity).toBe(256)
  })
})

describe('AudioBridge lifecycle', () => {
  test('start is idempotent', async () => {
    const b = new AudioBridge()
    const hook = fakeHook()
    b.attachContext(hook)
    await b.start()
    await b.start()
    expect(hook.startCalls).toBe(1)
  })

  test('start without hook is a no-op', async () => {
    const b = new AudioBridge()
    await b.start()
    // No throw, no state change
    expect(b.stats().framesWritten).toBe(0)
  })

  test('stop releases the hook', async () => {
    const b = new AudioBridge()
    const hook = fakeHook()
    const closeSpy = vi.spyOn(hook, 'close')
    b.attachContext(hook)
    await b.start()
    await b.stop()
    expect(closeSpy).toHaveBeenCalled()
  })
})

describe('AudioBridge feed', () => {
  test('feedSamples converts Int16 and writes to ring', () => {
    const b = new AudioBridge({ capacity: 16 })
    const int16 = new Int16Array([16384, -16384, 32767, -32768])
    const written = b.feedSamples(int16)
    expect(written).toBe(4)
    expect(b.stats().framesWritten).toBe(4)
  })

  test('feedSamples reports drops when ring is full', () => {
    const b = new AudioBridge({ capacity: 4, channels: 1 })
    // Ring capacity rounded to next pow2 × channels = 4 × 1 = 4
    b.feedSamples(new Int16Array(4))
    const dropped = b.feedSamples(new Int16Array(3))
    expect(dropped).toBe(0)
    expect(b.stats().framesDropped).toBe(3)
  })

  test('feedFloat32 bypasses conversion', () => {
    const b = new AudioBridge({ capacity: 16 })
    const floats = new Float32Array([0.1, -0.1, 0.5, -0.5])
    expect(b.feedFloat32(floats)).toBe(4)
    const out = new Float32Array(4)
    b.ringBuffer.read(out)
    expect(Array.from(out)).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(-0.1, 5),
      0.5,
      -0.5,
    ])
  })

  test('converts Int16 correctly', () => {
    const b = new AudioBridge({ capacity: 16 })
    b.feedSamples(new Int16Array([32767, -32768, 16384]))
    const out = new Float32Array(3)
    b.ringBuffer.read(out)
    expect(out[0]).toBeCloseTo(32767 / 32768, 5)
    expect(out[1]).toBeCloseTo(-1.0, 5)
    expect(out[2]).toBeCloseTo(0.5, 5)
  })
})

describe('AudioBridge stats', () => {
  test('stats reflects underrun count from hook', () => {
    const b = new AudioBridge({ capacity: 16 })
    const hook = fakeHook()
    b.attachContext(hook)
    hook.underrunValue = 7
    expect(b.stats().underruns).toBe(7)
  })

  test('resetStats clears counters', () => {
    const b = new AudioBridge({ capacity: 16 })
    b.feedSamples(new Int16Array(4))
    b.resetStats()
    expect(b.stats().framesWritten).toBe(0)
    expect(b.stats().framesDropped).toBe(0)
  })

  test('fillFactor reflects ring occupancy', () => {
    const b = new AudioBridge({ capacity: 8, channels: 1 })
    expect(b.stats().fillFactor).toBe(0)
    b.feedSamples(new Int16Array(4))
    expect(b.stats().fillFactor).toBe(0.5)
  })
})
