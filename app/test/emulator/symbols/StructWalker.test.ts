import { describe, test, expect } from 'vitest'
import {
  StructWalker,
  type MemoryReader,
  type StructDefinition,
} from '@/lib/emulator/symbols/StructWalker'

/** Trivial memory reader over a Uint8Array, at a fixed base. */
function makeReader(bytes: Uint8Array, base: number): MemoryReader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    read8: (addr) => view.getUint8(addr - base),
    read16: (addr) => view.getUint16(addr - base, true),
    read32: (addr) => view.getUint32(addr - base, true),
  }
}

const SIMPLE_STRUCT: StructDefinition = {
  name: 'Simple',
  size: 0x10,
  fields: [
    { name: 'a', offset: 0x00, type: 'u8' },
    { name: 'b', offset: 0x02, type: 'u16' },
    { name: 'c', offset: 0x04, type: 'u32' },
    { name: 'd', offset: 0x08, type: 'i8' },
    { name: 'e', offset: 0x0a, type: 'i16' },
    { name: 'f', offset: 0x0c, type: 'bool' },
  ],
}

describe('StructWalker field reads', () => {
  test('reads u8 / u16 / u32 fields', () => {
    const bytes = new Uint8Array(16)
    const view = new DataView(bytes.buffer)
    view.setUint8(0, 0x12)
    view.setUint16(2, 0x3456, true)
    view.setUint32(4, 0x789abcde, true)
    const walker = new StructWalker(makeReader(bytes, 0x1000), [SIMPLE_STRUCT])
    const fields = walker.read('Simple', 0x1000)!
    expect(fields.find((f) => f.name === 'a')!.raw).toBe(0x12)
    expect(fields.find((f) => f.name === 'b')!.raw).toBe(0x3456)
    expect(fields.find((f) => f.name === 'c')!.raw).toBe(0x789abcde)
  })

  test('signed fields render as signed decimals', () => {
    const bytes = new Uint8Array(16)
    const view = new DataView(bytes.buffer)
    view.setInt8(8, -42)
    view.setInt16(10, -1000, true)
    const walker = new StructWalker(makeReader(bytes, 0x1000), [SIMPLE_STRUCT])
    const fields = walker.read('Simple', 0x1000)!
    expect(fields.find((f) => f.name === 'd')!.display).toBe('-42')
    expect(fields.find((f) => f.name === 'e')!.display).toBe('-1000')
  })

  test('bool renders as true / false', () => {
    const bytes = new Uint8Array(16)
    bytes[0x0c] = 1
    const walker = new StructWalker(makeReader(bytes, 0x1000), [SIMPLE_STRUCT])
    const fields = walker.read('Simple', 0x1000)!
    expect(fields.find((f) => f.name === 'f')!.display).toBe('true')

    bytes[0x0c] = 0
    const fields2 = walker.read('Simple', 0x1000)!
    expect(fields2.find((f) => f.name === 'f')!.display).toBe('false')
  })

  test('hex32 renders as uppercase zero-padded hex', () => {
    const bytes = new Uint8Array(16)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 0xdeadbeef, true)
    const walker = new StructWalker(makeReader(bytes, 0x1000), [
      {
        name: 'H',
        size: 4,
        fields: [{ name: 'h', offset: 0, type: 'hex32' }],
      },
    ])
    const fields = walker.read('H', 0x1000)!
    expect(fields[0].display).toBe('0xDEADBEEF')
  })

  test('unknown type returns undefined', () => {
    const walker = new StructWalker(makeReader(new Uint8Array(16), 0x1000), [])
    expect(walker.read('Bogus', 0x1000)).toBeUndefined()
  })
})

describe('StructWalker pointer fields', () => {
  const TYPES: StructDefinition[] = [
    {
      name: 'Head',
      size: 0x10,
      fields: [
        { name: 'next', offset: 0, type: 'ptr', pointsTo: 'Node' },
      ],
    },
    {
      name: 'Node',
      size: 0x10,
      fields: [
        { name: 'value', offset: 0, type: 'u32' },
        { name: 'next', offset: 4, type: 'ptr', pointsTo: 'Node' },
      ],
    },
  ]

  test('pointer fields expose pointsTo metadata', () => {
    const bytes = new Uint8Array(16)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 0x20000000, true)
    const walker = new StructWalker(makeReader(bytes, 0x1000), TYPES)
    const fields = walker.read('Head', 0x1000)!
    expect(fields[0].pointsTo).toEqual({ typeName: 'Node', address: 0x20000000 })
  })

  test('walk chains multiple pointer hops', () => {
    // Set up a 2-link list:
    //   Head at 0x1000: next = 0x2000
    //   Node at 0x2000: value=42, next=0x3000
    //   Node at 0x3000: value=99, next=0
    const bytes = new Uint8Array(0x2000)
    const view = new DataView(bytes.buffer)
    const base = 0x1000
    view.setUint32(0x1000 - base, 0x2000 + base, true) // Head.next -> 0x3000
    view.setUint32(0x2000 - base + 0, 42, true)
    view.setUint32(0x2000 - base + 4, 0x3000 + base, true) // Node.next -> 0x4000
    // Wait, I mixed up addressing. Let me restart with clearer math.

    const buf = new Uint8Array(0x100)
    const v = new DataView(buf.buffer)
    // Layout inside buf (offset from buf start):
    //   0x00: Head.next -> 0x40 (absolute address 0x1040)
    //   0x40: Node value=42, next=0x80 (absolute 0x1080)
    //   0x80: Node value=99, next=0
    v.setUint32(0x00, 0x1040, true)
    v.setUint32(0x40, 42, true)
    v.setUint32(0x44, 0x1080, true)
    v.setUint32(0x80, 99, true)
    v.setUint32(0x84, 0, true)
    const walker = new StructWalker(makeReader(buf, 0x1000), TYPES)

    const hop1 = walker.walk('Head', 0x1000, ['next'])
    expect(hop1).toEqual({ type: 'Node', address: 0x1040 })

    const hop2 = walker.walk('Head', 0x1000, ['next', 'next'])
    expect(hop2).toEqual({ type: 'Node', address: 0x1080 })
  })

  test('walk stops on null pointer', () => {
    const buf = new Uint8Array(0x20)
    // Head.next = 0
    const walker = new StructWalker(makeReader(buf, 0x1000), TYPES)
    const r = walker.walk('Head', 0x1000, ['next'])
    expect(r).toBeUndefined()
  })

  test('walk stops on unknown field name', () => {
    const buf = new Uint8Array(0x20)
    new DataView(buf.buffer).setUint32(0, 0x1010, true)
    const walker = new StructWalker(makeReader(buf, 0x1000), TYPES)
    expect(walker.walk('Head', 0x1000, ['nonexistent'])).toBeUndefined()
  })
})

describe('StructWalker registry', () => {
  test('list returns registered struct names sorted', () => {
    const walker = new StructWalker(makeReader(new Uint8Array(1), 0), [])
    walker.register({ name: 'Zeta', size: 0, fields: [] })
    walker.register({ name: 'Alpha', size: 0, fields: [] })
    walker.register({ name: 'Mu', size: 0, fields: [] })
    expect(walker.list()).toEqual(['Alpha', 'Mu', 'Zeta'])
  })

  test('definitionFor returns the matching struct', () => {
    const def: StructDefinition = { name: 'X', size: 0, fields: [] }
    const walker = new StructWalker(makeReader(new Uint8Array(1), 0), [def])
    expect(walker.definitionFor('X')).toBe(def)
  })
})
