// Emulator performance statistics.
//
// Tracks instructions-executed and wall-time across step calls, then exposes
// rolling MIPS (million instructions per second) over configurable windows.
// Designed to be fed by calling `record(executed, elapsedMs)` after every
// step, so it stays decoupled from the worker and testable on its own.

export interface PerfSample {
  timestamp: number
  executed: number
  elapsedMs: number
}

export interface PerfSnapshot {
  totalInstructions: number
  totalTimeMs: number
  averageMips: number
  rollingMips: number
  rollingWindowMs: number
  samples: number
  lastLatencyMs: number
}

const DEFAULT_WINDOW_MS = 3000
const MAX_SAMPLES = 1024

export class PerfStats {
  private totalInstructions = 0
  private totalTimeMs = 0
  private samples: PerfSample[] = []
  private lastLatencyMs = 0

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Reset all counters. */
  reset(): void {
    this.totalInstructions = 0
    this.totalTimeMs = 0
    this.samples = []
    this.lastLatencyMs = 0
  }

  /**
   * Record one stepping result. `executed` is the instruction count the CPU
   * returned, `elapsedMs` is the wall time the call took.
   */
  record(executed: number, elapsedMs: number): void {
    const t = this.now()
    this.totalInstructions += executed
    this.totalTimeMs += elapsedMs
    this.lastLatencyMs = elapsedMs
    this.samples.push({ timestamp: t, executed, elapsedMs })
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES)
    }
  }

  /** Rolling MIPS across the last `windowMs` milliseconds (default 3s). */
  rollingMips(windowMs = DEFAULT_WINDOW_MS): number {
    const cutoff = this.now() - windowMs
    let instructions = 0
    let ms = 0
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const s = this.samples[i]
      if (s.timestamp < cutoff) break
      instructions += s.executed
      ms += s.elapsedMs
    }
    if (ms === 0) return 0
    return instructions / ms / 1000 // MIPS = Minstr/sec → instr/ms / 1000
  }

  /** Long-run average MIPS since creation / last reset. */
  averageMips(): number {
    if (this.totalTimeMs === 0) return 0
    return this.totalInstructions / this.totalTimeMs / 1000
  }

  snapshot(windowMs = DEFAULT_WINDOW_MS): PerfSnapshot {
    return {
      totalInstructions: this.totalInstructions,
      totalTimeMs: this.totalTimeMs,
      averageMips: this.averageMips(),
      rollingMips: this.rollingMips(windowMs),
      rollingWindowMs: windowMs,
      samples: this.samples.length,
      lastLatencyMs: this.lastLatencyMs,
    }
  }
}
