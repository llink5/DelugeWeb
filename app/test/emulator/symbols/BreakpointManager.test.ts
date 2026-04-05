import { describe, test, expect, vi } from 'vitest'
import { BreakpointManager } from '@/lib/emulator/symbols/BreakpointManager'
import { SymbolMap } from '@/lib/emulator/symbols/SymbolMap'
import { ArmCpu } from '@/lib/emulator/cpu/ArmCpu'
import { mov, packProgram } from '../cpu/assembler'

const CODE_BASE = 0x20000000

function setupCpu(): ArmCpu {
  const cpu = new ArmCpu()
  cpu.mapRegion({
    start: CODE_BASE,
    size: 0x1000,
    perms: 'rwx',
    buffer: new Uint8Array(0x1000),
  })
  cpu.writeMemory(
    CODE_BASE,
    packProgram([mov(0, 1), mov(0, 2), mov(0, 3), mov(0, 4)]),
  )
  cpu.setPC(CODE_BASE)
  return cpu
}

describe('BreakpointManager.addByAddress', () => {
  test('fires when PC reaches the address', () => {
    const cpu = setupCpu()
    const bm = new BreakpointManager(cpu)
    const listener = vi.fn()
    bm.onHit(listener)
    bm.addByAddress(CODE_BASE + 4)
    cpu.run(10)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('increments hits counter', () => {
    const cpu = setupCpu()
    const bm = new BreakpointManager(cpu)
    const bp = bm.addByAddress(CODE_BASE + 4)
    cpu.run(4)
    const snapshot = bm.list().find((b) => b.id === bp.id)!
    expect(snapshot.hits).toBe(1)
  })

  test('does not fire for addresses no instruction hits', () => {
    const cpu = setupCpu()
    const bm = new BreakpointManager(cpu)
    const listener = vi.fn()
    bm.onHit(listener)
    bm.addByAddress(CODE_BASE + 0xf00)
    cpu.run(4)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('BreakpointManager.addByName', () => {
  test('resolves symbol to address', () => {
    const cpu = setupCpu()
    const syms = new SymbolMap([
      {
        name: 'target',
        address: CODE_BASE + 4,
        size: 4,
        type: 2,
        sectionIndex: 1,
      },
    ])
    const bm = new BreakpointManager(cpu, syms)
    const bp = bm.addByName('target')
    expect(bp).toBeDefined()
    expect(bp!.label).toBe('target')
    expect(bp!.address).toBe(CODE_BASE + 4)
    const listener = vi.fn()
    bm.onHit(listener)
    cpu.run(4)
    expect(listener).toHaveBeenCalled()
  })

  test('returns undefined for unknown symbol', () => {
    const cpu = setupCpu()
    const syms = new SymbolMap()
    const bm = new BreakpointManager(cpu, syms)
    expect(bm.addByName('nope')).toBeUndefined()
  })
})

describe('BreakpointManager lifecycle', () => {
  test('remove() uninstalls the hook', () => {
    const cpu = setupCpu()
    const bm = new BreakpointManager(cpu)
    const listener = vi.fn()
    bm.onHit(listener)
    const bp = bm.addByAddress(CODE_BASE + 4)
    bm.remove(bp.id)
    cpu.run(4)
    expect(listener).not.toHaveBeenCalled()
  })

  test('disable() suppresses firing but keeps the hook', () => {
    const cpu = setupCpu()
    const bm = new BreakpointManager(cpu)
    const listener = vi.fn()
    bm.onHit(listener)
    const bp = bm.addByAddress(CODE_BASE + 4)
    bm.disable(bp.id)
    cpu.run(4)
    expect(listener).not.toHaveBeenCalled()
    bm.enable(bp.id)
    cpu.setPC(CODE_BASE)
    cpu.run(4)
    expect(listener).toHaveBeenCalled()
  })

  test('oneShot breakpoint auto-removes after first hit', () => {
    const cpu = setupCpu()
    const bm = new BreakpointManager(cpu)
    bm.addByAddress(CODE_BASE + 4, { oneShot: true })
    cpu.run(4)
    cpu.setPC(CODE_BASE)
    cpu.run(4)
    expect(bm.list()).toHaveLength(0)
  })

  test('clear() drops all breakpoints', () => {
    const cpu = setupCpu()
    const bm = new BreakpointManager(cpu)
    bm.addByAddress(CODE_BASE + 0)
    bm.addByAddress(CODE_BASE + 4)
    bm.addByAddress(CODE_BASE + 8)
    bm.clear()
    expect(bm.list()).toHaveLength(0)
    const listener = vi.fn()
    bm.onHit(listener)
    cpu.run(4)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('BreakpointManager listener management', () => {
  test('multiple listeners each get notified', () => {
    const cpu = setupCpu()
    const bm = new BreakpointManager(cpu)
    const a = vi.fn()
    const b = vi.fn()
    bm.onHit(a)
    bm.onHit(b)
    bm.addByAddress(CODE_BASE + 4)
    cpu.run(4)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  test('unsubscribe stops delivery', () => {
    const cpu = setupCpu()
    const bm = new BreakpointManager(cpu)
    const a = vi.fn()
    const off = bm.onHit(a) as () => void
    bm.addByAddress(CODE_BASE + 4)
    cpu.run(4)
    off()
    cpu.setPC(CODE_BASE)
    cpu.run(4)
    expect(a).toHaveBeenCalledTimes(1)
  })
})
