// DelugeEmulator (main-thread wrapper) tests.
//
// We inject a fake Worker that records posted messages and lets the test
// script responses. No real ARM emulation runs here.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { DelugeEmulator } from '@/lib/emulator/DelugeEmulator'
import type { EmulatorEvent, EmulatorRequest, EmulatorReply } from '@/lib/emulator/protocol'

class FakeWorker {
  onmessage: ((evt: MessageEvent) => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn<(msg: EmulatorRequest, transfer?: Transferable[]) => void>()

  /** Fire an incoming message from the "worker" side. */
  emit(msg: EmulatorReply | EmulatorEvent) {
    this.onmessage?.(new MessageEvent('message', { data: msg }))
  }
}

describe('DelugeEmulator attach/detach', () => {
  test('attachWorker connects the worker', () => {
    const worker = new FakeWorker()
    const em = new DelugeEmulator()
    em.attachWorker(worker as unknown as Worker)
    expect(worker.onmessage).not.toBeNull()
  })

  test('attachWorker twice throws', () => {
    const worker = new FakeWorker()
    const em = new DelugeEmulator()
    em.attachWorker(worker as unknown as Worker)
    expect(() => em.attachWorker(worker as unknown as Worker)).toThrow()
  })

  test('request without worker rejects', async () => {
    const em = new DelugeEmulator()
    await expect(em.init()).rejects.toThrow(/No worker/)
  })

  test('dispose cancels pending requests', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const em = new DelugeEmulator()
    em.attachWorker(worker as unknown as Worker)
    const p = em.init()
    em.dispose()
    await expect(p).rejects.toThrow(/disposed/)
    vi.useRealTimers()
  })
})

describe('DelugeEmulator request/response correlation', () => {
  let worker: FakeWorker
  let em: DelugeEmulator
  beforeEach(() => {
    worker = new FakeWorker()
    em = new DelugeEmulator()
    em.attachWorker(worker as unknown as Worker)
  })
  afterEach(() => em.dispose())

  test('init round-trip', async () => {
    const p = em.init()
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    const sent = worker.postMessage.mock.calls[0][0]
    expect(sent.type).toBe('init')
    expect(sent.seq).toBeGreaterThan(0)
    worker.emit({ type: 'ready', replyTo: sent.seq, ok: true })
    const reply = await p
    expect(reply.type).toBe('ready')
  })

  test('multiple concurrent requests are correlated by seq', async () => {
    const p1 = em.step(100)
    const p2 = em.getRegisters()
    const seq1 = worker.postMessage.mock.calls[0][0].seq
    const seq2 = worker.postMessage.mock.calls[1][0].seq
    expect(seq1).not.toBe(seq2)

    // Reply to seq2 first
    worker.emit({
      type: 'registers',
      replyTo: seq2,
      ok: true,
      registers: { r0: 1, pc: 0x20000000 },
    })
    worker.emit({
      type: 'stepped',
      replyTo: seq1,
      ok: true,
      executed: 100,
      pc: 0x20000400,
    })

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.type).toBe('stepped')
    expect(r2.type).toBe('registers')
  })

  test('reply with ok=false resolves with the error reply', async () => {
    const p = em.start()
    const sent = worker.postMessage.mock.calls[0][0]
    worker.emit({
      type: 'started',
      replyTo: sent.seq,
      ok: false,
      error: 'ELF not loaded',
    })
    const reply = await p
    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('ELF not loaded')
  })

  test('unmatched replies are ignored', async () => {
    worker.emit({ type: 'started', replyTo: 9999, ok: true })
    // No throw, no crash — just silently ignored
    expect(true).toBe(true)
  })
})

describe('DelugeEmulator events', () => {
  let worker: FakeWorker
  let em: DelugeEmulator
  beforeEach(() => {
    worker = new FakeWorker()
    em = new DelugeEmulator()
    em.attachWorker(worker as unknown as Worker)
  })
  afterEach(() => em.dispose())

  test('log event reaches subscriber', () => {
    const handler = vi.fn()
    em.on('log', handler)
    worker.emit({ type: 'log', level: 'info', message: 'hello' })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toEqual({
      type: 'log',
      level: 'info',
      message: 'hello',
    })
  })

  test('breakpointHit event reaches subscriber', () => {
    const handler = vi.fn()
    em.on('breakpointHit', handler)
    worker.emit({
      type: 'breakpointHit',
      address: 0x20001000,
      registers: { pc: 0x20001000 },
    })
    expect(handler).toHaveBeenCalled()
  })

  test('unsubscribe stops delivery', () => {
    const handler = vi.fn()
    const off = em.on('log', handler)
    worker.emit({ type: 'log', level: 'info', message: 'a' })
    off()
    worker.emit({ type: 'log', level: 'info', message: 'b' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('multiple subscribers all receive events', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    em.on('log', h1)
    em.on('log', h2)
    worker.emit({ type: 'log', level: 'warn', message: 'x' })
    expect(h1).toHaveBeenCalledTimes(1)
    expect(h2).toHaveBeenCalledTimes(1)
  })

  test('handler throwing does not break dispatch', () => {
    const h1 = vi.fn(() => {
      throw new Error('boom')
    })
    const h2 = vi.fn()
    em.on('log', h1)
    em.on('log', h2)
    expect(() => worker.emit({ type: 'log', level: 'info', message: 'x' })).not.toThrow()
    expect(h2).toHaveBeenCalled()
  })
})

describe('DelugeEmulator transferables', () => {
  let worker: FakeWorker
  let em: DelugeEmulator
  beforeEach(() => {
    worker = new FakeWorker()
    em = new DelugeEmulator()
    em.attachWorker(worker as unknown as Worker)
  })
  afterEach(() => em.dispose())

  test('loadElf transfers the buffer', () => {
    const buf = new ArrayBuffer(16)
    // Silence the pending promise — we only care about what was posted.
    em.loadElf(buf).catch(() => {})
    const call = worker.postMessage.mock.calls[0]
    expect(call[1]).toContain(buf)
  })

  test('writeMem transfers the data buffer', () => {
    const buf = new ArrayBuffer(32)
    em.writeMem(0x20000000, buf).catch(() => {})
    const call = worker.postMessage.mock.calls[0]
    expect(call[1]).toContain(buf)
  })
})
