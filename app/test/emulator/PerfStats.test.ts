import { describe, test, expect } from 'vitest'
import { PerfStats } from '@/lib/emulator/PerfStats'

function makeClock(initial = 0): { now: () => number; advance: (ms: number) => void } {
  let t = initial
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
}

describe('PerfStats accumulation', () => {
  test('starts with zero counters', () => {
    const s = new PerfStats()
    const snap = s.snapshot()
    expect(snap.totalInstructions).toBe(0)
    expect(snap.totalTimeMs).toBe(0)
    expect(snap.averageMips).toBe(0)
    expect(snap.rollingMips).toBe(0)
  })

  test('record adds to total instructions and time', () => {
    const s = new PerfStats()
    s.record(1000, 10)
    s.record(2000, 20)
    const snap = s.snapshot()
    expect(snap.totalInstructions).toBe(3000)
    expect(snap.totalTimeMs).toBe(30)
    expect(snap.samples).toBe(2)
  })

  test('average MIPS computes correctly', () => {
    const s = new PerfStats()
    // 1 000 000 instructions in 100 ms → 10 MIPS
    s.record(1_000_000, 100)
    expect(s.averageMips()).toBeCloseTo(10, 5)
  })

  test('lastLatencyMs tracks the most recent call', () => {
    const s = new PerfStats()
    s.record(100, 5)
    s.record(200, 10)
    expect(s.snapshot().lastLatencyMs).toBe(10)
  })

  test('reset clears all counters', () => {
    const s = new PerfStats()
    s.record(1000, 10)
    s.reset()
    const snap = s.snapshot()
    expect(snap.totalInstructions).toBe(0)
    expect(snap.totalTimeMs).toBe(0)
    expect(snap.samples).toBe(0)
  })
})

describe('PerfStats rolling window', () => {
  test('rollingMips only counts samples inside the window', () => {
    const clock = makeClock(0)
    const s = new PerfStats(clock.now)

    // At t=0: 1M instructions in 100ms
    s.record(1_000_000, 100)
    clock.advance(500)
    // At t=500: 2M instructions in 200ms
    s.record(2_000_000, 200)
    clock.advance(500)
    // At t=1000: 1M instructions in 50ms
    s.record(1_000_000, 50)

    // At t=1000, 3s window. All samples within window → 4M instr / 350 ms
    const rolling = s.rollingMips(3000)
    expect(rolling).toBeCloseTo(4_000_000 / 350 / 1000, 3)

    // At t=4000: cutoff = 1000. Only sample at t=1000 is inside (1M instr / 50ms).
    clock.advance(3000)
    const rolling2 = s.rollingMips(3000)
    expect(rolling2).toBeCloseTo(1_000_000 / 50 / 1000, 3)

    // At t=5000: cutoff = 2000. No samples inside.
    clock.advance(1000)
    const rolling3 = s.rollingMips(3000)
    expect(rolling3).toBe(0)
  })

  test('rollingMips returns 0 with no samples', () => {
    const s = new PerfStats()
    expect(s.rollingMips(1000)).toBe(0)
  })
})

describe('PerfStats sample cap', () => {
  test('drops oldest samples past the buffer limit', () => {
    const clock = makeClock(0)
    const s = new PerfStats(clock.now)
    for (let i = 0; i < 2000; i++) {
      s.record(100, 1)
      clock.advance(1)
    }
    expect(s.snapshot().samples).toBeLessThanOrEqual(1024)
  })
})

describe('PerfStats snapshot', () => {
  test('snapshot contains all fields', () => {
    const s = new PerfStats()
    s.record(500, 5)
    const snap = s.snapshot(2000)
    expect(snap.rollingWindowMs).toBe(2000)
    expect(snap.totalInstructions).toBe(500)
    expect(snap.samples).toBe(1)
  })
})
