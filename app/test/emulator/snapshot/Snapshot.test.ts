import { describe, test, expect } from 'vitest'
import {
  captureSnapshot,
  restoreSnapshot,
  serializeSnapshot,
  deserializeSnapshot,
  InMemorySnapshotStore,
  hashElf,
} from '@/lib/emulator/snapshot/Snapshot'
import { ArmCpu } from '@/lib/emulator/cpu/ArmCpu'

function setupCpu(): ArmCpu {
  const cpu = new ArmCpu()
  cpu.mapRegion({
    start: 0x20000000,
    size: 0x1000,
    perms: 'rwx',
    buffer: new Uint8Array(0x1000),
  })
  cpu.mapRegion({
    start: 0x0c000000,
    size: 0x1000,
    perms: 'rwx',
    buffer: new Uint8Array(0x1000),
  })
  return cpu
}

describe('captureSnapshot / restoreSnapshot', () => {
  test('round-trips register state', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0xdeadbeef)
    cpu.setRegister('r5', 0xcafebabe)
    cpu.setRegister('sp', 0x20000100)
    cpu.setRegister('pc', 0x20000004)
    cpu.setRegister('cpsr', 0x8000001f)

    const snap = captureSnapshot(cpu)
    // Now clobber state
    cpu.setRegister('r0', 0)
    cpu.setRegister('r5', 0)
    cpu.setRegister('sp', 0)
    cpu.setRegister('pc', 0)
    cpu.setRegister('cpsr', 0x0000001f)

    restoreSnapshot(cpu, snap)
    const regs = cpu.getRegisters()
    expect(regs.r0).toBe(0xdeadbeef)
    expect(regs.r5).toBe(0xcafebabe)
    expect(regs.sp).toBe(0x20000100)
    expect(regs.pc).toBe(0x20000004)
    expect(regs.cpsr).toBe(0x8000001f)
  })

  test('round-trips memory regions', () => {
    const cpu = setupCpu()
    cpu.writeMemory(0x20000000, new Uint8Array([1, 2, 3, 4, 5]))
    cpu.writeMemory(0x0c000000, new Uint8Array([0xaa, 0xbb, 0xcc]))
    const snap = captureSnapshot(cpu)
    // Trash memory
    cpu.writeMemory(0x20000000, new Uint8Array(10))
    cpu.writeMemory(0x0c000000, new Uint8Array(10))
    restoreSnapshot(cpu, snap)
    expect(Array.from(cpu.readMemory(0x20000000, 5))).toEqual([1, 2, 3, 4, 5])
    expect(Array.from(cpu.readMemory(0x0c000000, 3))).toEqual([0xaa, 0xbb, 0xcc])
  })

  test('snapshots are isolated from subsequent mutations', () => {
    const cpu = setupCpu()
    cpu.writeMemory(0x20000000, new Uint8Array([1, 2, 3, 4]))
    const snap = captureSnapshot(cpu)
    cpu.writeMemory(0x20000000, new Uint8Array([99, 99, 99, 99]))
    // Snapshot still has the original bytes
    expect(Array.from(snap.regions[0].data.subarray(0, 4))).toEqual([1, 2, 3, 4])
  })
})

describe('serializeSnapshot / deserializeSnapshot', () => {
  test('binary round-trip reproduces the snapshot', () => {
    const cpu = setupCpu()
    cpu.setRegister('r0', 0xabcd)
    cpu.writeMemory(0x20000000, new Uint8Array([10, 20, 30, 40]))
    const original = captureSnapshot(cpu)
    const buf = serializeSnapshot(original)
    const restored = deserializeSnapshot(buf)
    expect(restored.registers.r0).toBe(0xabcd)
    expect(restored.regions).toHaveLength(original.regions.length)
    expect(restored.regions[0].base).toBe(original.regions[0].base)
    expect(Array.from(restored.regions[0].data.subarray(0, 4))).toEqual([10, 20, 30, 40])
  })

  test('bad magic throws', () => {
    const buf = new ArrayBuffer(16)
    expect(() => deserializeSnapshot(buf)).toThrow(/magic/i)
  })

  test('unsupported version throws', () => {
    const buf = new ArrayBuffer(16)
    const view = new DataView(buf)
    view.setUint32(0, 0x45474c44, true) // magic
    view.setUint16(4, 999, true) // version
    expect(() => deserializeSnapshot(buf)).toThrow(/version/i)
  })

  test('full cycle: capture → serialise → deserialise → restore', () => {
    const cpu = setupCpu()
    cpu.setRegister('r7', 0x12345678)
    cpu.writeMemory(0x20000100, new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    const buf = serializeSnapshot(captureSnapshot(cpu))
    // Simulate loading into a fresh CPU
    const cpu2 = setupCpu()
    restoreSnapshot(cpu2, deserializeSnapshot(buf))
    expect(cpu2.getRegisters().r7).toBe(0x12345678)
    expect(Array.from(cpu2.readMemory(0x20000100, 4))).toEqual([0xde, 0xad, 0xbe, 0xef])
  })
})

describe('InMemorySnapshotStore', () => {
  test('save then load round-trips', async () => {
    const store = new InMemorySnapshotStore()
    const data = new Uint8Array([1, 2, 3, 4]).buffer
    await store.save('test', data)
    const loaded = await store.load('test')
    expect(loaded).toBeTruthy()
    expect(loaded!.name).toBe('test')
    expect(loaded!.size).toBe(4)
    expect(Array.from(new Uint8Array(loaded!.data))).toEqual([1, 2, 3, 4])
  })

  test('list returns metadata sorted newest first', async () => {
    const store = new InMemorySnapshotStore()
    await store.save('a', new Uint8Array([1]).buffer, { timestamp: 1000 })
    await store.save('b', new Uint8Array([1]).buffer, { timestamp: 3000 })
    await store.save('c', new Uint8Array([1]).buffer, { timestamp: 2000 })
    const list = await store.list()
    expect(list.map((e) => e.name)).toEqual(['b', 'c', 'a'])
  })

  test('delete removes an entry', async () => {
    const store = new InMemorySnapshotStore()
    await store.save('x', new Uint8Array([1]).buffer)
    await store.delete('x')
    expect(await store.load('x')).toBeUndefined()
  })

  test('store does not share buffer with caller', async () => {
    const store = new InMemorySnapshotStore()
    const src = new Uint8Array([1, 2, 3, 4])
    await store.save('t', src.buffer)
    src[0] = 99
    const loaded = await store.load('t')
    expect(new Uint8Array(loaded!.data)[0]).toBe(1)
  })

  test('elfHash is preserved in metadata', async () => {
    const store = new InMemorySnapshotStore()
    await store.save('t', new Uint8Array([1]).buffer, { elfHash: 'abc123' })
    const list = await store.list()
    expect(list[0].elfHash).toBe('abc123')
  })
})

describe('hashElf', () => {
  test('returns a 64-char hex string', async () => {
    const data = new Uint8Array([1, 2, 3, 4]).buffer
    const hash = await hashElf(data)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('same input yields same hash', async () => {
    const data = new Uint8Array([1, 2, 3, 4]).buffer
    const a = await hashElf(data)
    const b = await hashElf(data)
    expect(a).toBe(b)
  })

  test('different inputs yield different hashes', async () => {
    const a = await hashElf(new Uint8Array([1]).buffer)
    const b = await hashElf(new Uint8Array([2]).buffer)
    expect(a).not.toBe(b)
  })
})
