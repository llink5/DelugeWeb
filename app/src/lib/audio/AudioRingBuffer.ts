// Lock-free single-producer single-consumer ring buffer for audio samples.
//
// Backed by a SharedArrayBuffer when available, falling back to a plain
// ArrayBuffer otherwise. The SharedArrayBuffer path lets the emulator
// worker (producer) and the AudioWorklet thread (consumer) touch the same
// memory without postMessage traffic. The fallback path serves single-
// threaded hosts and test environments.
//
// Layout:
//   header (8 bytes): 4-byte write index | 4-byte read index (Int32 atomics)
//   data   (capacity * 4 bytes): interleaved stereo Float32 samples
//
// Capacities are rounded up to a power of two so write/read offsets can
// wrap via `& (capacity - 1)` instead of modulo.
//
// Producer: call `write(samples)` from whichever thread fills the buffer.
// Consumer: call `read(output)` from the audio thread; underruns fill the
// tail of the output with zeros.

const HEADER_BYTES = 8
const WRITE_IDX = 0
const READ_IDX = 1

function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0
}

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

export interface AudioRingBufferInit {
  /** Capacity in Float32 samples (interleaved). Rounded up to a power of two. */
  capacity: number
  /** Pre-allocated buffer (e.g. received from Worker). Capacity must match. */
  buffer?: ArrayBufferLike
}

export class AudioRingBuffer {
  readonly capacity: number
  readonly mask: number
  /** Underlying buffer (may be SharedArrayBuffer on capable hosts). */
  readonly buffer: ArrayBufferLike
  private readonly header: Int32Array
  private readonly data: Float32Array
  /**
   * When the backing store is not a SharedArrayBuffer, we can't use
   * Atomics.load/store. Fall back to plain load/store with the same API.
   */
  private readonly shared: boolean

  constructor(init: AudioRingBufferInit) {
    this.capacity = isPow2(init.capacity)
      ? init.capacity
      : nextPow2(init.capacity)
    this.mask = this.capacity - 1

    const byteLength = HEADER_BYTES + this.capacity * 4
    if (init.buffer) {
      if (init.buffer.byteLength !== byteLength) {
        throw new Error(
          `AudioRingBuffer: buffer byteLength ${init.buffer.byteLength} != expected ${byteLength}`,
        )
      }
      this.buffer = init.buffer
    } else {
      this.buffer = AudioRingBuffer.allocateBuffer(byteLength)
    }

    this.shared = isSharedArrayBuffer(this.buffer)
    this.header = new Int32Array(this.buffer, 0, 2)
    this.data = new Float32Array(this.buffer, HEADER_BYTES, this.capacity)
  }

  /** Create a SharedArrayBuffer when possible, otherwise a plain ArrayBuffer. */
  static allocateBuffer(byteLength: number): ArrayBufferLike {
    if (typeof SharedArrayBuffer !== 'undefined') {
      try {
        return new SharedArrayBuffer(byteLength)
      } catch {
        // Some environments expose SharedArrayBuffer as undefined behaviour
        // when COOP/COEP headers are missing.
      }
    }
    return new ArrayBuffer(byteLength)
  }

  /** True when the ring uses a SharedArrayBuffer (producer/consumer visible). */
  get isShared(): boolean {
    return this.shared
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private getIdx(slot: number): number {
    return this.shared
      ? Atomics.load(this.header, slot)
      : this.header[slot]
  }

  private setIdx(slot: number, value: number): void {
    if (this.shared) Atomics.store(this.header, slot, value)
    else this.header[slot] = value
  }

  /** Number of samples the producer can write before wrapping into reader space. */
  availableWrite(): number {
    const w = this.getIdx(WRITE_IDX)
    const r = this.getIdx(READ_IDX)
    return this.capacity - ((w - r) & 0x7fffffff)
  }

  /** Number of samples available for the consumer. */
  availableRead(): number {
    const w = this.getIdx(WRITE_IDX)
    const r = this.getIdx(READ_IDX)
    return (w - r) & 0x7fffffff
  }

  /** Occupancy as a 0..1 fill factor (consumer view). */
  fillFactor(): number {
    return this.availableRead() / this.capacity
  }

  /** Reset read/write pointers. Only safe when no one else is touching them. */
  reset(): void {
    this.setIdx(WRITE_IDX, 0)
    this.setIdx(READ_IDX, 0)
  }

  // ---------------------------------------------------------------------------
  // Producer API
  // ---------------------------------------------------------------------------

  /**
   * Write up to `samples.length` floats. Returns the number actually written —
   * which may be less than the input if the consumer is behind.
   */
  write(samples: Float32Array): number {
    const writeIdx = this.getIdx(WRITE_IDX)
    const readIdx = this.getIdx(READ_IDX)
    const free = this.capacity - ((writeIdx - readIdx) & 0x7fffffff)
    const toWrite = Math.min(samples.length, free)
    if (toWrite === 0) return 0

    const start = writeIdx & this.mask
    const end = start + toWrite
    if (end <= this.capacity) {
      this.data.set(samples.subarray(0, toWrite), start)
    } else {
      const firstChunk = this.capacity - start
      this.data.set(samples.subarray(0, firstChunk), start)
      this.data.set(samples.subarray(firstChunk, toWrite), 0)
    }

    this.setIdx(WRITE_IDX, (writeIdx + toWrite) >>> 0)
    return toWrite
  }

  // ---------------------------------------------------------------------------
  // Consumer API
  // ---------------------------------------------------------------------------

  /**
   * Fill `output` from the ring. Trailing samples are zero-filled on
   * underrun so the consumer always produces `output.length` floats.
   * Returns the number of samples read from the buffer.
   */
  read(output: Float32Array): number {
    const writeIdx = this.getIdx(WRITE_IDX)
    const readIdx = this.getIdx(READ_IDX)
    const available = (writeIdx - readIdx) & 0x7fffffff
    const toRead = Math.min(output.length, available)

    if (toRead === 0) {
      output.fill(0)
      return 0
    }

    const start = readIdx & this.mask
    const end = start + toRead
    if (end <= this.capacity) {
      output.set(this.data.subarray(start, end), 0)
    } else {
      const firstChunk = this.capacity - start
      output.set(this.data.subarray(start, this.capacity), 0)
      output.set(this.data.subarray(0, toRead - firstChunk), firstChunk)
    }
    if (toRead < output.length) {
      output.fill(0, toRead)
    }

    this.setIdx(READ_IDX, (readIdx + toRead) >>> 0)
    return toRead
  }
}

function isSharedArrayBuffer(buf: ArrayBufferLike): boolean {
  return (
    typeof SharedArrayBuffer !== 'undefined' && buf instanceof SharedArrayBuffer
  )
}

/** Detect whether SharedArrayBuffer is usable in this context. */
export function sharedArrayBufferAvailable(): boolean {
  if (typeof SharedArrayBuffer === 'undefined') return false
  try {
    // Accessing the constructor is enough in most browsers; allocate a tiny
    // buffer to confirm the page is actually cross-origin-isolated.
    new SharedArrayBuffer(8)
    return true
  } catch {
    return false
  }
}
