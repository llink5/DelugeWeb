import { describe, test, expect, vi } from 'vitest'
import { NullArmCore } from '@/lib/emulator/NullArmCore'

describe('NullArmCore memory', () => {
  test('maps a region and reads back written bytes', () => {
    const core = new NullArmCore()
    core.mapRegion({ start: 0x20000000, size: 0x1000, perms: 'rwx' })
    const data = new Uint8Array([1, 2, 3, 4])
    core.writeMemory(0x20000000, data)
    const read = core.readMemory(0x20000000, 4)
    expect(Array.from(read)).toEqual([1, 2, 3, 4])
  })

  test('reads from unmapped memory return zeros', () => {
    const core = new NullArmCore()
    const read = core.readMemory(0xdeadbeef, 4)
    expect(Array.from(read)).toEqual([0, 0, 0, 0])
  })

  test('writes to unmapped memory are no-ops', () => {
    const core = new NullArmCore()
    core.writeMemory(0xdeadbeef, new Uint8Array([1, 2, 3, 4]))
    expect(core.readMemory(0xdeadbeef, 4)).toEqual(new Uint8Array([0, 0, 0, 0]))
  })
})

describe('NullArmCore registers', () => {
  test('initial registers are zero', () => {
    const core = new NullArmCore()
    const regs = core.getRegisters()
    expect(regs.pc).toBe(0)
    expect(regs.sp).toBe(0)
    expect(regs.r0).toBe(0)
  })

  test('setPC updates pc', () => {
    const core = new NullArmCore()
    core.setPC(0x20000000)
    expect(core.getRegisters().pc).toBe(0x20000000)
  })

  test('setRegister updates the named register', () => {
    const core = new NullArmCore()
    core.setRegister('r0', 0xdeadbeef)
    core.setRegister('sp', 0x20300000)
    const regs = core.getRegisters()
    expect(regs.r0).toBe(0xdeadbeef)
    expect(regs.sp).toBe(0x20300000)
  })
})

describe('NullArmCore run', () => {
  test('run executes zero instructions', () => {
    const core = new NullArmCore()
    const n = core.run(1000)
    expect(n).toBe(0)
  })

  test('run does not advance PC', () => {
    const core = new NullArmCore()
    core.setPC(0x20000000)
    core.run(1000)
    expect(core.getRegisters().pc).toBe(0x20000000)
  })
})

describe('NullArmCore hooks', () => {
  test('memory hook fires on write', () => {
    const core = new NullArmCore()
    core.mapRegion({ start: 0x20000000, size: 0x1000, perms: 'rwx' })
    const cb = vi.fn()
    core.addMemoryHook(0x20000000, 0x100, cb)
    core.writeMemory(0x20000000, new Uint8Array([1, 2, 3, 4]))
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0]).toBe('write')
  })

  test('memory hook fires on read', () => {
    const core = new NullArmCore()
    core.mapRegion({ start: 0x20000000, size: 0x1000, perms: 'rwx' })
    const cb = vi.fn()
    core.addMemoryHook(0x20000000, 0x100, cb)
    core.readMemory(0x20000000, 4)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0]).toBe('read')
  })

  test('hook outside range does not fire', () => {
    const core = new NullArmCore()
    core.mapRegion({ start: 0x20000000, size: 0x1000, perms: 'rwx' })
    const cb = vi.fn()
    core.addMemoryHook(0x20000000, 0x100, cb)
    core.writeMemory(0x20000200, new Uint8Array([1, 2, 3, 4]))
    expect(cb).not.toHaveBeenCalled()
  })

  test('removeHook unsubscribes', () => {
    const core = new NullArmCore()
    core.mapRegion({ start: 0x20000000, size: 0x1000, perms: 'rwx' })
    const cb = vi.fn()
    const id = core.addMemoryHook(0x20000000, 0x100, cb)
    core.removeHook(id)
    core.writeMemory(0x20000000, new Uint8Array([1, 2, 3, 4]))
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('NullArmCore close', () => {
  test('close clears hooks and regions', () => {
    const core = new NullArmCore()
    core.mapRegion({ start: 0x20000000, size: 0x1000, perms: 'rwx' })
    const cb = vi.fn()
    core.addMemoryHook(0x20000000, 0x100, cb)
    core.close()
    // Subsequent accesses do nothing
    core.writeMemory(0x20000000, new Uint8Array([1, 2, 3, 4]))
    expect(cb).not.toHaveBeenCalled()
  })
})
