// Main-thread audio bridge.
//
// Owns the Web AudioContext, loads the AudioWorkletProcessor, creates the
// shared ring buffer, and exposes `feedSamples()` for producers (the
// emulator's SSI capture) to push PCM into the pipeline.
//
// The AudioContext part is kept behind a thin hook so the core logic
// (ring feeding, sample conversion, stats) can be tested without a real
// browser audio pipeline.

import { AudioRingBuffer, sharedArrayBufferAvailable } from './AudioRingBuffer'
import { int16ToFloat32 } from './conversion'

export interface AudioBridgeStats {
  framesWritten: number
  framesDropped: number
  underruns: number
  fillFactor: number
  isShared: boolean
}

export interface AudioBridgeOptions {
  /** Target sample rate. Deluge runs at 44100. */
  sampleRate?: number
  /** Ring buffer capacity in stereo samples (i.e. frames × 2). */
  capacity?: number
  /** Number of channels, either 1 or 2. */
  channels?: 1 | 2
}

/**
 * Context hook — tests and SSR provide a stub; production provides a
 * real AudioContext wrapper that wires the worklet.
 */
export interface AudioContextHook {
  /** Called when the bridge wants to (re-)start the audio graph. */
  start(params: {
    sampleRate: number
    channels: 1 | 2
    buffer: ArrayBufferLike
    capacity: number
  }): Promise<void>
  suspend(): Promise<void>
  resume(): Promise<void>
  close(): Promise<void>
  /** Report how many audio-thread underruns have been seen so far. */
  underruns(): number
}

/** The core AudioBridge, independent of the real AudioContext. */
export class AudioBridge {
  private readonly ring: AudioRingBuffer
  readonly sampleRate: number
  readonly channels: 1 | 2
  private hook: AudioContextHook | null = null
  private _framesWritten = 0
  private _framesDropped = 0
  private started = false
  /** Reused Float32 scratch for Int16 conversion to avoid allocation. */
  private convertScratch: Float32Array

  constructor(options: AudioBridgeOptions = {}) {
    this.sampleRate = options.sampleRate ?? 44100
    this.channels = options.channels ?? 2
    const capacity = options.capacity ?? 8192
    this.ring = new AudioRingBuffer({ capacity: capacity * this.channels })
    this.convertScratch = new Float32Array(4096)
  }

  get isShared(): boolean {
    return this.ring.isShared
  }

  /** Underlying ring buffer — exposed for worklet-side init. */
  get ringBuffer(): AudioRingBuffer {
    return this.ring
  }

  /** Plug in the audio-context side of the bridge. */
  attachContext(hook: AudioContextHook): void {
    this.hook = hook
  }

  /** Boot the audio graph. Idempotent. */
  async start(): Promise<void> {
    if (this.started || !this.hook) return
    await this.hook.start({
      sampleRate: this.sampleRate,
      channels: this.channels,
      buffer: this.ring.buffer,
      capacity: this.ring.capacity,
    })
    this.started = true
  }

  async suspend(): Promise<void> {
    if (!this.hook || !this.started) return
    await this.hook.suspend()
  }

  async resume(): Promise<void> {
    if (!this.hook || !this.started) return
    await this.hook.resume()
  }

  async stop(): Promise<void> {
    if (!this.hook || !this.started) return
    await this.hook.close()
    this.started = false
  }

  // ---------------------------------------------------------------------------
  // Producer API
  // ---------------------------------------------------------------------------

  /**
   * Push interleaved Int16 PCM samples into the ring. Returns the number of
   * samples accepted — samples past the ring's capacity are dropped and
   * counted as underruns-in-reverse (over-run) at the producer side.
   */
  feedSamples(samples: Int16Array): number {
    if (samples.length > this.convertScratch.length) {
      this.convertScratch = new Float32Array(samples.length)
    }
    const floats = int16ToFloat32(
      samples,
      this.convertScratch.subarray(0, samples.length),
    )
    const written = this.ring.write(floats)
    this._framesWritten += written
    this._framesDropped += samples.length - written
    return written
  }

  /** Already-converted float samples — skip the Int16 conversion. */
  feedFloat32(samples: Float32Array): number {
    const written = this.ring.write(samples)
    this._framesWritten += written
    this._framesDropped += samples.length - written
    return written
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  stats(): AudioBridgeStats {
    return {
      framesWritten: this._framesWritten,
      framesDropped: this._framesDropped,
      underruns: this.hook?.underruns() ?? 0,
      fillFactor: this.ring.fillFactor(),
      isShared: this.ring.isShared,
    }
  }

  resetStats(): void {
    this._framesWritten = 0
    this._framesDropped = 0
  }
}

// ---------------------------------------------------------------------------
// Real AudioContext hook
// ---------------------------------------------------------------------------

/**
 * Live AudioContext implementation. Loads the AudioWorkletProcessor module
 * and wires it to the destination. The worklet receives the ring buffer
 * via `port.postMessage({ buffer, capacity, channels })` at start.
 *
 * `workletUrl` must resolve to an ES module that registers a processor
 * named `'deluge-ring-reader'`. In production, that's
 * `src/lib/audio/workletProcessor.ts` passed through Vite's asset pipeline.
 */
export function createAudioContextHook(
  workletUrl: string | URL,
): AudioContextHook {
  let ctx: AudioContext | null = null
  let node: AudioWorkletNode | null = null
  let underrunCount = 0

  return {
    async start({ sampleRate, channels, buffer, capacity }) {
      ctx = new AudioContext({ sampleRate })
      await ctx.audioWorklet.addModule(workletUrl.toString())
      node = new AudioWorkletNode(ctx, 'deluge-ring-reader', {
        numberOfOutputs: 1,
        outputChannelCount: [channels],
      })
      node.port.onmessage = (evt) => {
        if (evt.data?.type === 'underrun') underrunCount++
      }
      node.port.postMessage({ type: 'init', buffer, capacity, channels })
      node.connect(ctx.destination)
    },
    async suspend() {
      await ctx?.suspend()
    },
    async resume() {
      await ctx?.resume()
    },
    async close() {
      node?.disconnect()
      node = null
      await ctx?.close()
      ctx = null
    },
    underruns() {
      return underrunCount
    },
  }
}

export { sharedArrayBufferAvailable }
