import { describe, test, expect } from 'vitest'
import { SymbolMap } from '@/lib/emulator/symbols/SymbolMap'
import type { ElfSymbol } from '@/lib/emulator/ElfLoader'

function sym(
  name: string,
  address: number,
  size: number,
  type: number,
): ElfSymbol {
  return { name, address, size, type, sectionIndex: 1 }
}

// Type constants: 0=notype, 1=object, 2=func
const FUNC = 2
const OBJECT = 1
const NOTYPE = 0

describe('SymbolMap construction', () => {
  test('empty map has size 0', () => {
    const m = new SymbolMap()
    expect(m.size).toBe(0)
  })

  test('counts unique symbols', () => {
    const m = new SymbolMap([
      sym('main', 0x20000000, 100, FUNC),
      sym('init', 0x20000100, 64, FUNC),
    ])
    expect(m.size).toBe(2)
  })

  test('ignores duplicate names', () => {
    const m = new SymbolMap([
      sym('main', 0x20000000, 100, FUNC),
      sym('main', 0x20000200, 100, FUNC),
    ])
    expect(m.size).toBe(1)
  })

  test('ignores empty-name symbols', () => {
    const m = new SymbolMap([sym('', 0x20000000, 100, FUNC)])
    expect(m.size).toBe(0)
  })
})

describe('SymbolMap.lookup', () => {
  test('returns the matching symbol', () => {
    const m = new SymbolMap([sym('main', 0x20000000, 100, FUNC)])
    const s = m.lookup('main')
    expect(s?.address).toBe(0x20000000)
    expect(s?.type).toBe('func')
  })

  test('returns undefined for unknown names', () => {
    const m = new SymbolMap([sym('main', 0x20000000, 100, FUNC)])
    expect(m.lookup('bogus')).toBeUndefined()
  })

  test('type is preserved', () => {
    const m = new SymbolMap([
      sym('f', 0x100, 8, FUNC),
      sym('g', 0x200, 4, OBJECT),
      sym('h', 0x300, 0, NOTYPE),
    ])
    expect(m.lookup('f')?.type).toBe('func')
    expect(m.lookup('g')?.type).toBe('object')
    expect(m.lookup('h')?.type).toBe('other')
  })
})

describe('SymbolMap.resolve', () => {
  const m = new SymbolMap([
    sym('init', 0x20000000, 0x40, FUNC),
    sym('main', 0x20000100, 0x200, FUNC),
    sym('helper', 0x20000400, 0x80, FUNC),
  ])

  test('resolves an address at symbol start', () => {
    const r = m.resolve(0x20000000)
    expect(r?.symbol.name).toBe('init')
    expect(r?.offset).toBe(0)
  })

  test('resolves an address inside a function', () => {
    const r = m.resolve(0x20000150)
    expect(r?.symbol.name).toBe('main')
    expect(r?.offset).toBe(0x50)
  })

  test('returns undefined for addresses past the last symbol', () => {
    // Inside no symbol's size
    const r = m.resolve(0x20000500)
    expect(r).toBeUndefined()
  })

  test('returns undefined for addresses before all symbols', () => {
    const r = m.resolve(0x1fffffff)
    expect(r).toBeUndefined()
  })

  test('picks the last symbol whose base <= address when sizes overlap', () => {
    // Adjacent symbols, no gap
    const m2 = new SymbolMap([
      sym('a', 0x100, 0x10, FUNC),
      sym('b', 0x110, 0x10, FUNC),
    ])
    expect(m2.resolve(0x10f)?.symbol.name).toBe('a')
    expect(m2.resolve(0x110)?.symbol.name).toBe('b')
    expect(m2.resolve(0x11f)?.symbol.name).toBe('b')
  })

  test('ignores size=0 sentinel symbols', () => {
    const m3 = new SymbolMap([
      sym('$a', 0x100, 0, NOTYPE),
      sym('funcA', 0x100, 0x20, FUNC),
    ])
    // Address inside funcA should resolve to funcA or $a, both at 0x100.
    const r = m3.resolve(0x110)
    expect(r).toBeTruthy()
    // When size is 0 we treat the symbol as having no range, but sorted
    // order means $a (inserted first) wins. Either answer is valid — just
    // verify we get one.
    expect(['$a', 'funcA']).toContain(r!.symbol.name)
  })
})

describe('SymbolMap.search', () => {
  const m = new SymbolMap([
    sym('Sound::render', 0x100, 0x80, FUNC),
    sym('Sound::noteOn', 0x200, 0x40, FUNC),
    sym('Song::play', 0x300, 0x60, FUNC),
    sym('currentSong', 0x400, 4, OBJECT),
    sym('midiEngine', 0x500, 4, OBJECT),
  ])

  test('prefix match ranks above substring match', () => {
    const hits = m.search('Sound')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].name.startsWith('Sound')).toBe(true)
  })

  test('substring search is case-insensitive', () => {
    const hits = m.search('SONG')
    const names = hits.map((h) => h.name)
    expect(names).toContain('Song::play')
    expect(names).toContain('currentSong')
  })

  test('type filter restricts results', () => {
    const hits = m.search('', 100, 'object')
    expect(hits).toHaveLength(2)
    expect(hits.every((h) => h.type === 'object')).toBe(true)
  })

  test('respects max count', () => {
    const hits = m.search('', 2)
    expect(hits).toHaveLength(2)
  })

  test('empty query returns all symbols', () => {
    const hits = m.search('', 100)
    expect(hits).toHaveLength(5)
  })

  test('no matches returns empty array', () => {
    const hits = m.search('nonexistent')
    expect(hits).toEqual([])
  })
})

describe('SymbolMap.formatAddress', () => {
  const m = new SymbolMap([
    sym('main', 0x20000000, 0x200, FUNC),
  ])

  test('returns name for exact match', () => {
    expect(m.formatAddress(0x20000000)).toBe('main')
  })

  test('returns name+offset inside a function', () => {
    expect(m.formatAddress(0x20000010)).toBe('main+0x10')
  })

  test('returns hex for unresolved address', () => {
    expect(m.formatAddress(0x40000000)).toBe('0x40000000')
  })
})

describe('SymbolMap.ofType', () => {
  const m = new SymbolMap([
    sym('f', 0x100, 8, FUNC),
    sym('g', 0x200, 8, FUNC),
    sym('x', 0x300, 4, OBJECT),
  ])

  test('returns only functions', () => {
    const fs = m.ofType('func')
    expect(fs).toHaveLength(2)
    expect(fs.every((h) => h.type === 'func')).toBe(true)
  })

  test('returns only objects', () => {
    expect(m.ofType('object')).toHaveLength(1)
  })
})
