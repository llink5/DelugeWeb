// Fat32Builder tests — verify BPB fields, FAT chains, and directory
// layout against hand-assembled fixtures.

import { describe, test, expect } from 'vitest'
import { buildFat32Image, type Fat32Entry } from '@/lib/storage/Fat32Builder'

const SECTOR = 512
const RESERVED_SECTORS = 32
const NUM_FATS = 2

function readString(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i])
  return out
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function readU16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

interface BpbInfo {
  sectorsPerCluster: number
  sectorsPerFat: number
  dataStartSector: number
  clusterBytes: number
}

function readBpb(image: Uint8Array): BpbInfo {
  const sectorsPerCluster = image[13]
  const sectorsPerFat = readU32(image, 36)
  const dataStartSector = RESERVED_SECTORS + NUM_FATS * sectorsPerFat
  return {
    sectorsPerCluster,
    sectorsPerFat,
    dataStartSector,
    clusterBytes: sectorsPerCluster * SECTOR,
  }
}

function clusterOffset(info: BpbInfo, cluster: number): number {
  return (info.dataStartSector + (cluster - 2) * info.sectorsPerCluster) * SECTOR
}

function fatEntry(image: Uint8Array, cluster: number): number {
  return readU32(image, RESERVED_SECTORS * SECTOR + cluster * 4)
}

interface DirEntryView {
  name: string
  attr: number
  cluster: number
  size: number
}

function readDirEntries(image: Uint8Array, offset: number, limit: number): DirEntryView[] {
  const out: DirEntryView[] = []
  for (let i = 0; i < limit; i += 32) {
    const first = image[offset + i]
    if (first === 0x00) break
    if (first === 0xe5) continue
    const name = readString(image, offset + i, 11)
    const attr = image[offset + i + 11]
    const hi = readU16(image, offset + i + 20)
    const lo = readU16(image, offset + i + 26)
    const cluster = (hi << 16) | lo
    const size = readU32(image, offset + i + 28)
    out.push({ name, attr, cluster, size })
  }
  return out
}

// ---------------------------------------------------------------------------
// 1. Header / BPB basics
// ---------------------------------------------------------------------------

describe('Fat32Builder header', () => {
  test('produces an image of the requested size', () => {
    const image = buildFat32Image([], { sizeMiB: 33 })
    expect(image.byteLength).toBe(33 * 1024 * 1024)
    const image64 = buildFat32Image([], { sizeMiB: 64 })
    expect(image64.byteLength).toBe(64 * 1024 * 1024)
  })

  test('boot sector signature is 0x55 0xAA', () => {
    const image = buildFat32Image([])
    expect(image[510]).toBe(0x55)
    expect(image[511]).toBe(0xaa)
  })

  test('OEM name is MSDOS5.0', () => {
    const image = buildFat32Image([])
    expect(readString(image, 3, 8)).toBe('MSDOS5.0')
  })

  test('volume label is space-padded to 11 chars', () => {
    const image = buildFat32Image([], { label: 'DELUGE' })
    expect(readString(image, 71, 11)).toBe('DELUGE     ')
    const image2 = buildFat32Image([], { label: 'MYDISK' })
    expect(readString(image2, 71, 11)).toBe('MYDISK     ')
  })

  test('filesystem type is FAT32', () => {
    const image = buildFat32Image([])
    expect(readString(image, 82, 8)).toBe('FAT32   ')
  })

  test('FSInfo and backup boot sector are present', () => {
    const image = buildFat32Image([])
    // FSInfo signatures
    expect(readU32(image, SECTOR + 0)).toBe(0x41615252)
    expect(readU32(image, SECTOR + 484)).toBe(0x61417272)
    expect(image[SECTOR + 510]).toBe(0x55)
    expect(image[SECTOR + 511]).toBe(0xaa)
    // Backup boot sector at sector 6
    expect(image[6 * SECTOR + 510]).toBe(0x55)
    expect(image[6 * SECTOR + 511]).toBe(0xaa)
    expect(readString(image, 6 * SECTOR + 3, 8)).toBe('MSDOS5.0')
  })

  test('rejects images smaller than 33 MiB', () => {
    expect(() => buildFat32Image([], { sizeMiB: 32 })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 2. FAT contents
// ---------------------------------------------------------------------------

describe('Fat32Builder FAT table', () => {
  test('reserved FAT entries are correct for empty volume', () => {
    const image = buildFat32Image([])
    expect(fatEntry(image, 0)).toBe(0x0ffffff8)
    expect(fatEntry(image, 1)).toBe(0x0fffffff)
    expect(fatEntry(image, 2)).toBe(0x0fffffff) // root EOC
  })

  test('both FAT copies match', () => {
    const image = buildFat32Image([
      { path: '/A.TXT', content: new TextEncoder().encode('abc') },
    ])
    const info = readBpb(image)
    const fat0 = RESERVED_SECTORS * SECTOR
    const fat1 = fat0 + info.sectorsPerFat * SECTOR
    // Check the first few dozen entries, where any meaningful data lives.
    for (let i = 0; i < 64; i++) {
      const a = readU32(image, fat0 + i * 4)
      const b = readU32(image, fat1 + i * 4)
      expect(b).toBe(a)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Simple file in root
// ---------------------------------------------------------------------------

describe('Fat32Builder simple file', () => {
  test('TEST.TXT appears in root with expected fields and content', () => {
    const payload = new TextEncoder().encode('hi')
    const image = buildFat32Image([{ path: '/TEST.TXT', content: payload }])
    const info = readBpb(image)
    const rootOffset = clusterOffset(info, 2)
    const entries = readDirEntries(image, rootOffset, info.clusterBytes)

    // Skip the volume label entry (attr 0x08).
    const file = entries.find((e) => e.attr === 0x20)
    expect(file).toBeDefined()
    expect(file!.name).toBe('TEST    TXT')
    expect(file!.attr).toBe(0x20)
    expect(file!.size).toBe(2)

    // Content should appear at the file's cluster.
    const dataOffset = clusterOffset(info, file!.cluster)
    expect(image[dataOffset]).toBe('h'.charCodeAt(0))
    expect(image[dataOffset + 1]).toBe('i'.charCodeAt(0))
  })
})

// ---------------------------------------------------------------------------
// 4. Subdirectory with file
// ---------------------------------------------------------------------------

describe('Fat32Builder subdirectory', () => {
  test('intermediate directories are auto-created with . and ..', () => {
    const payload = new TextEncoder().encode('<xml/>')
    const image = buildFat32Image([
      { path: '/SYNTHS/FOO.XML', content: payload },
    ])
    const info = readBpb(image)
    const rootOffset = clusterOffset(info, 2)
    const rootEntries = readDirEntries(image, rootOffset, info.clusterBytes)

    const synths = rootEntries.find((e) => e.attr === 0x10)
    expect(synths).toBeDefined()
    expect(synths!.name).toBe('SYNTHS     ')
    expect(synths!.size).toBe(0)

    // SYNTHS cluster must contain ., .., and FOO.XML
    const synthsOffset = clusterOffset(info, synths!.cluster)
    const subEntries = readDirEntries(image, synthsOffset, info.clusterBytes)
    const dot = subEntries.find((e) => e.name === '.          ')
    const dotDot = subEntries.find((e) => e.name === '..         ')
    const foo = subEntries.find((e) => e.name === 'FOO     XML')
    expect(dot).toBeDefined()
    expect(dot!.attr).toBe(0x10)
    expect(dot!.cluster).toBe(synths!.cluster)
    expect(dotDot).toBeDefined()
    expect(dotDot!.attr).toBe(0x10)
    expect(dotDot!.cluster).toBe(0) // parent is root
    expect(foo).toBeDefined()
    expect(foo!.attr).toBe(0x20)
    expect(foo!.size).toBe(payload.length)

    // File content should appear at the file's cluster.
    const fileOffset = clusterOffset(info, foo!.cluster)
    for (let i = 0; i < payload.length; i++) {
      expect(image[fileOffset + i]).toBe(payload[i])
    }
  })
})

// ---------------------------------------------------------------------------
// 5. Multi-cluster files
// ---------------------------------------------------------------------------

describe('Fat32Builder multi-cluster files', () => {
  test('10 KiB file spans 3 4-KiB clusters linked in the FAT', () => {
    const payload = new Uint8Array(10 * 1024)
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff
    const image = buildFat32Image([{ path: '/BIG.BIN', content: payload }])
    const info = readBpb(image)
    expect(info.clusterBytes).toBe(4096)
    const rootOffset = clusterOffset(info, 2)
    const entries = readDirEntries(image, rootOffset, info.clusterBytes)
    const file = entries.find((e) => e.name === 'BIG     BIN')
    expect(file).toBeDefined()
    expect(file!.size).toBe(10 * 1024)

    // Walk the FAT chain starting at the file's first cluster.
    const chain: number[] = []
    let c = file!.cluster
    while (c !== 0 && c < 0x0ffffff8) {
      chain.push(c)
      const next = fatEntry(image, c)
      if (next >= 0x0ffffff8) break
      c = next
    }
    expect(chain.length).toBe(3)
    // Clusters should be sequential.
    expect(chain[1]).toBe(chain[0] + 1)
    expect(chain[2]).toBe(chain[0] + 2)
    // EOC marker on the last cluster.
    expect(fatEntry(image, chain[2])).toBe(0x0fffffff)

    // Spot-check content at each cluster.
    for (let i = 0; i < payload.length; i++) {
      const clusterIdx = Math.floor(i / info.clusterBytes)
      const offsetInCluster = i % info.clusterBytes
      const absolute = clusterOffset(info, chain[clusterIdx]) + offsetInCluster
      expect(image[absolute]).toBe(payload[i])
    }
  })
})

// ---------------------------------------------------------------------------
// 6. Validation / error paths
// ---------------------------------------------------------------------------

describe('Fat32Builder validation', () => {
  test('throws on file name that cannot fit 8.3', () => {
    expect(() =>
      buildFat32Image([{ path: '/TOOLONGNAME.TXT', content: new Uint8Array(1) }]),
    ).toThrow()
    expect(() =>
      buildFat32Image([{ path: '/name.toolong', content: new Uint8Array(1) }]),
    ).toThrow()
  })

  test('throws on invalid 8.3 characters', () => {
    expect(() =>
      buildFat32Image([{ path: '/FOO+BAR.TXT', content: new Uint8Array(1) }]),
    ).toThrow()
  })

  test('throws when the image cannot hold the content', () => {
    // 33 MiB image: roughly 33 MiB of data area. Ask for 40 MiB of file.
    const huge = new Uint8Array(40 * 1024 * 1024)
    expect(() =>
      buildFat32Image([{ path: '/HUGE.BIN', content: huge }], { sizeMiB: 33 }),
    ).toThrow()
  })

  test('accepts multiple entries and assigns distinct clusters', () => {
    const entries: Fat32Entry[] = [
      { path: '/A.TXT', content: new TextEncoder().encode('alpha') },
      { path: '/B.TXT', content: new TextEncoder().encode('beta') },
      { path: '/SUB/C.TXT', content: new TextEncoder().encode('gamma') },
    ]
    const image = buildFat32Image(entries)
    const info = readBpb(image)
    const rootEntries = readDirEntries(image, clusterOffset(info, 2), info.clusterBytes)
    const names = rootEntries.map((e) => e.name.trim())
    expect(names).toContain('A       TXT'.trim())
    expect(names).toContain('B       TXT'.trim())
    expect(names).toContain('SUB'.padEnd(11, ' ').trim())
    // Clusters must all differ.
    const clusters = rootEntries.filter((e) => e.attr !== 0x08).map((e) => e.cluster)
    expect(new Set(clusters).size).toBe(clusters.length)
  })
})
