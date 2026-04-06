// Main-thread emulator wrapper.
//
// Owns the Web Worker, serialises requests into the protocol defined in
// `protocol.ts`, and tracks pending responses via sequence numbers. Unsolicited
// events (log, displayUpdate, audioBuffer…) are routed to subscriber callbacks.

import type {
  EmulatorEvent,
  EmulatorReply,
  EmulatorRequest,
  WorkerToMain,
  Seq,
} from './protocol'
import { isEvent, isReply } from './protocol'

type EventType = EmulatorEvent['type']
type EventHandler<T extends EventType> = (evt: Extract<EmulatorEvent, { type: T }>) => void

interface PendingRequest {
  resolve: (reply: EmulatorReply) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 30_000

// Distribute Omit over the discriminated union so fields on individual variants
// remain visible after erasure of `seq`. A plain Omit<T, K> on a union
// collapses to just the common fields.
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never
type RequestWithoutSeq = DistributiveOmit<EmulatorRequest, 'seq'>

export class DelugeEmulator {
  private worker: Worker | null = null
  private seq: Seq = 0
  private pending = new Map<Seq, PendingRequest>()
  private listeners = new Map<EventType, Set<(evt: EmulatorEvent) => void>>()

  /**
   * Connect an existing Worker instance. The caller is responsible for
   * constructing the worker with the correct module URL — we keep this
   * decoupled so callers can inject a fake worker in tests.
   */
  attachWorker(worker: Worker): void {
    if (this.worker) throw new Error('Worker already attached')
    this.worker = worker
    worker.onmessage = (evt: MessageEvent<WorkerToMain>) => this.handleMessage(evt.data)
    worker.onerror = (evt: ErrorEvent) => {
      const msg = evt.message ?? 'Worker error (no details — check DevTools → Sources → Worker)'
      console.error('[DelugeEmulator] worker error:', msg)
      // Reject all pending requests so callers don't hang for 30 s.
      for (const p of this.pending.values()) {
        clearTimeout(p.timer)
        p.reject(new Error(msg))
      }
      this.pending.clear()
    }
  }

  /** Release the worker without terminating it (tests only). */
  detachWorker(): void {
    if (!this.worker) return
    this.worker.onmessage = null
    this.worker = null
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('Worker detached'))
    }
    this.pending.clear()
  }

  /** Tear down the worker and cancel all pending requests. */
  dispose(): void {
    if (this.worker) {
      try {
        this.worker.terminate()
      } catch {
        /* ignore */
      }
      this.worker = null
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('Emulator disposed'))
    }
    this.pending.clear()
    this.listeners.clear()
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to a worker-to-main event. Returns an unsubscribe function.
   */
  on<T extends EventType>(type: T, handler: EventHandler<T>): () => void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(handler as (evt: EmulatorEvent) => void)
    return () => set!.delete(handler as (evt: EmulatorEvent) => void)
  }

  // ---------------------------------------------------------------------------
  // Request helpers
  // ---------------------------------------------------------------------------

  async init(): Promise<EmulatorReply> {
    return this.request({ type: 'init' })
  }

  async loadElf(elf: ArrayBuffer): Promise<EmulatorReply> {
    return this.request({ type: 'loadElf', elf }, [elf])
  }

  /**
   * Load an ELF or raw .bin firmware image. Format is detected by magic
   * bytes. For .bin images, `loadAddress` overrides the auto-detected
   * load address derived from the Reset vector's literal-pool target.
   */
  async loadFirmware(
    firmware: ArrayBuffer,
    options: { loadAddress?: number } = {},
  ): Promise<EmulatorReply> {
    return this.request(
      { type: 'loadFirmware', firmware, loadAddress: options.loadAddress },
      [firmware],
    )
  }

  async start(): Promise<EmulatorReply> {
    return this.request({ type: 'start' })
  }

  async stop(): Promise<EmulatorReply> {
    return this.request({ type: 'stop' })
  }

  async step(instructions: number): Promise<EmulatorReply> {
    return this.request({ type: 'step', instructions })
  }

  async reset(): Promise<EmulatorReply> {
    return this.request({ type: 'reset' })
  }

  async readMem(address: number, length: number): Promise<EmulatorReply> {
    return this.request({ type: 'readMem', address, length })
  }

  async writeMem(address: number, data: ArrayBuffer): Promise<EmulatorReply> {
    return this.request({ type: 'writeMem', address, data }, [data])
  }

  async getRegisters(): Promise<EmulatorReply> {
    return this.request({ type: 'getRegisters' })
  }

  async setBreakpoint(
    address: number,
    options: { oneShot?: boolean; label?: string } = {},
  ): Promise<EmulatorReply> {
    return this.request({
      type: 'setBreakpoint',
      address,
      oneShot: options.oneShot,
      label: options.label,
    })
  }

  async clearBreakpoint(id: number): Promise<EmulatorReply> {
    return this.request({ type: 'clearBreakpoint', id })
  }

  async listBreakpoints(): Promise<EmulatorReply> {
    return this.request({ type: 'listBreakpoints' })
  }

  async searchSymbols(
    query: string,
    options: { max?: number; typeFilter?: 'func' | 'object' | 'other' } = {},
  ): Promise<EmulatorReply> {
    return this.request({
      type: 'searchSymbols',
      query,
      max: options.max,
      typeFilter: options.typeFilter,
    })
  }

  async resolveAddress(address: number): Promise<EmulatorReply> {
    return this.request({ type: 'resolveAddress', address })
  }

  async disassemble(address: number, count: number): Promise<EmulatorReply> {
    return this.request({ type: 'disassemble', address, count })
  }

  async readStruct(typeName: string, address: number): Promise<EmulatorReply> {
    return this.request({ type: 'readStruct', typeName, address })
  }

  async listStructs(): Promise<EmulatorReply> {
    return this.request({ type: 'listStructs' })
  }

  async saveSnapshot(name: string): Promise<EmulatorReply> {
    return this.request({ type: 'saveSnapshot', name })
  }

  async loadSnapshot(name: string): Promise<EmulatorReply> {
    return this.request({ type: 'loadSnapshot', name })
  }

  /** Push raw bytes onto the simulated PIC UART RX stream. */
  async injectPicBytes(bytes: number[]): Promise<EmulatorReply> {
    return this.request({ type: 'injectPicBytes', bytes })
  }

  /** Attach a FAT32 image to the simulated SD card. */
  async attachSdImage(image: ArrayBuffer): Promise<EmulatorReply> {
    return this.request({ type: 'attachSdImage', image }, [image])
  }

  // ---------------------------------------------------------------------------
  // Internal dispatcher
  // ---------------------------------------------------------------------------

  private request(
    partial: RequestWithoutSeq,
    transfer: Transferable[] = [],
  ): Promise<EmulatorReply> {
    if (!this.worker) {
      return Promise.reject(new Error('No worker attached'))
    }
    const seq = ++this.seq
    const req = { ...partial, seq } as EmulatorRequest
    return new Promise<EmulatorReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq)
        reject(new Error(`Emulator request timed out (${req.type})`))
      }, DEFAULT_TIMEOUT_MS)
      this.pending.set(seq, { resolve, reject, timer })
      this.worker!.postMessage(req, transfer)
    })
  }

  private handleMessage(msg: WorkerToMain): void {
    if (isReply(msg)) {
      const pending = this.pending.get(msg.replyTo)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(msg.replyTo)
      // Always resolve — callers inspect reply.ok to decide on errors.
      // Rejecting here would skip the callers' structured error handling.
      pending.resolve(msg)
      return
    }
    if (isEvent(msg)) {
      const set = this.listeners.get(msg.type)
      if (!set) return
      for (const handler of set) {
        try {
          handler(msg)
        } catch {
          /* swallow */
        }
      }
    }
  }
}
