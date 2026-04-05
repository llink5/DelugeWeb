// AudioWorklet processor — runs in the audio thread.
//
// Lives in its own module because audioWorklet.addModule() loads it as a
// separate bundle at runtime. The processor waits for an `init` message
// carrying the ring buffer, then on every process() call reads one quantum
// (normally 128 frames) out of the buffer.
//
// This file is the AudioWorklet runtime environment — it uses the globals
// `registerProcessor`, `AudioWorkletProcessor`, and `currentTime`. TypeScript
// doesn't ship lib types for that environment; we declare the minimum we need.

declare const registerProcessor: (
  name: string,
  processor: unknown,
) => void
declare class AudioWorkletProcessor {
  port: MessagePort
  constructor()
}

const HEADER_BYTES = 8

class DelugeRingReader extends AudioWorkletProcessor {
  private data: Float32Array | null = null
  private header: Int32Array | null = null
  private capacity = 0
  private mask = 0
  private channels = 2
  private shared = false

  constructor() {
    super()
    this.port.onmessage = (evt: MessageEvent) => {
      const data = evt.data as {
        type: 'init'
        buffer: ArrayBufferLike
        capacity: number
        channels: number
      }
      if (data?.type === 'init') {
        this.header = new Int32Array(data.buffer, 0, 2)
        this.data = new Float32Array(data.buffer, HEADER_BYTES, data.capacity)
        this.capacity = data.capacity
        this.mask = data.capacity - 1
        this.channels = data.channels as 1 | 2
        this.shared =
          typeof SharedArrayBuffer !== 'undefined' &&
          data.buffer instanceof SharedArrayBuffer
      }
    }
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
  ): boolean {
    const output = outputs[0]
    if (!output || !this.data || !this.header) return true

    const frames = output[0]?.length ?? 0
    const ch = Math.min(this.channels, output.length)
    const needed = frames * this.channels

    const writeIdx = this.shared
      ? Atomics.load(this.header, 0)
      : this.header[0]
    const readIdx = this.shared
      ? Atomics.load(this.header, 1)
      : this.header[1]
    const available = (writeIdx - readIdx) & 0x7fffffff
    const toRead = Math.min(needed, available)
    const scratchStart = readIdx & this.mask

    // De-interleave into the two output channel buffers.
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < ch; c++) {
        const sampleIdx = f * this.channels + c
        if (sampleIdx < toRead) {
          const ringIdx = (scratchStart + sampleIdx) & this.mask
          output[c][f] = this.data[ringIdx]
        } else {
          output[c][f] = 0
        }
      }
    }

    if (toRead < needed) {
      // Underrun — notify the main thread once per quantum.
      this.port.postMessage({ type: 'underrun', missing: needed - toRead })
    }

    const newReadIdx = (readIdx + toRead) >>> 0
    if (this.shared) Atomics.store(this.header, 1, newReadIdx)
    else this.header[1] = newReadIdx

    return true
  }
}

registerProcessor('deluge-ring-reader', DelugeRingReader)
