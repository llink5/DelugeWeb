// DelugeSource tests.
//
// The source relies on MidiConnection for SysEx transport; we inject a fake
// MidiConnection instead of mocking the singleton. All file I/O is exercised
// through the PresetSource contract.

import { describe, test, expect, vi } from 'vitest'
import type { DirEntry } from '@/lib/types'
import type { MidiConnection } from '@/lib/midi/connection'
import { DelugeSource } from '@/lib/source/DelugeSource'

const ATTR_DIRECTORY = 0x10

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

interface FakeMidi {
  isConnected: boolean
  files: Map<string, Uint8Array>
  listDir: (path: string) => Promise<DirEntry[]>
  readFile: (path: string) => Promise<Uint8Array>
  writeFile: (path: string, data: Uint8Array) => Promise<void>
  deleteItem: (path: string) => Promise<void>
}

function fakeMidi(
  listing: Record<string, DirEntry[]>,
  initial: Record<string, string> = {},
): FakeMidi {
  const files = new Map<string, Uint8Array>()
  for (const [k, v] of Object.entries(initial)) {
    files.set(k, utf8Bytes(v))
  }
  return {
    isConnected: true,
    files,
    listDir: vi.fn(async (path: string) => listing[path] ?? []),
    readFile: vi.fn(async (path: string) => {
      const b = files.get(path)
      if (!b) throw new Error(`No such file: ${path}`)
      return b
    }),
    writeFile: vi.fn(async (path: string, data: Uint8Array) => {
      files.set(path, data)
    }),
    deleteItem: vi.fn(async (path: string) => {
      files.delete(path)
    }),
  }
}

function makeSource(fake: FakeMidi): DelugeSource {
  // Cast: we pass a structural subset of MidiConnection that satisfies the
  // methods DelugeSource actually calls.
  return new DelugeSource(fake as unknown as MidiConnection)
}

const INIT_SYNTH_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sound name="INIT"/>
`
const KIT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<kit/>
`
const SONG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<song/>
`

describe('DelugeSource.connected', () => {
  test('mirrors MidiConnection.isConnected', () => {
    const fake = fakeMidi({})
    const src = makeSource(fake)
    expect(src.connected).toBe(true)
    fake.isConnected = false
    expect(src.connected).toBe(false)
  })
})

describe('DelugeSource.listFolder', () => {
  test('returns files and directories separated', async () => {
    const fake = fakeMidi({
      '/SYNTHS': [
        { name: 'BASS.XML', attr: 0x20, size: 1234 },
        { name: 'SUBFOLDER', attr: 0x10, size: 0 },
        { name: 'LEAD.XML', attr: 0x20, size: 987 },
      ],
    })
    const src = makeSource(fake)
    const out = await src.listFolder('/SYNTHS')
    expect(out).toHaveLength(3)
    // Directories come first
    expect(out[0].isDirectory).toBe(true)
    expect(out[0].name).toBe('SUBFOLDER')
    // Files sorted alphabetically
    expect(out[1].name).toBe('BASS.XML')
    expect(out[2].name).toBe('LEAD.XML')
    expect(out[1].path).toBe('/SYNTHS/BASS.XML')
  })

  test('skips . and .. entries', async () => {
    const fake = fakeMidi({
      '/SYNTHS': [
        { name: '.', attr: 0x10 },
        { name: '..', attr: 0x10 },
        { name: 'TEST.XML', attr: 0x20, size: 1 },
      ],
    })
    const src = makeSource(fake)
    const out = await src.listFolder('/SYNTHS')
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('TEST.XML')
  })
})

describe('DelugeSource.listPresets', () => {
  test('lists SYNTHS folder for kind="synth"', async () => {
    const fake = fakeMidi({
      '/SYNTHS': [
        { name: 'BASS.XML', attr: 0x20, size: 100 },
        { name: 'LEAD.XML', attr: 0x20, size: 200 },
      ],
    })
    const src = makeSource(fake)
    const presets = await src.listPresets('synth')
    expect(presets).toHaveLength(2)
    expect(presets[0].type).toBe('synth')
    expect(presets[0].name).toBe('BASS')
    expect(presets[0].path).toBe('/SYNTHS/BASS.XML')
    expect(presets[0].size).toBe(100)
  })

  test('lists KITS folder for kind="kit"', async () => {
    const fake = fakeMidi({
      '/KITS': [{ name: 'DRUMS.XML', attr: 0x20, size: 5000 }],
    })
    const src = makeSource(fake)
    const presets = await src.listPresets('kit')
    expect(presets).toHaveLength(1)
    expect(presets[0].type).toBe('kit')
    expect(presets[0].name).toBe('DRUMS')
  })

  test('lists SONGS folder for kind="song"', async () => {
    const fake = fakeMidi({
      '/SONGS': [{ name: 'TRACK.XML', attr: 0x20, size: 50000 }],
    })
    const src = makeSource(fake)
    const presets = await src.listPresets('song')
    expect(presets).toHaveLength(1)
    expect(presets[0].type).toBe('song')
  })

  test('ignores non-XML files', async () => {
    const fake = fakeMidi({
      '/SYNTHS': [
        { name: 'BASS.XML', attr: 0x20, size: 100 },
        { name: 'README.TXT', attr: 0x20, size: 50 },
        { name: 'NOTES.MD', attr: 0x20, size: 10 },
      ],
    })
    const src = makeSource(fake)
    const presets = await src.listPresets('synth')
    expect(presets).toHaveLength(1)
    expect(presets[0].name).toBe('BASS')
  })

  test('ignores subdirectories', async () => {
    const fake = fakeMidi({
      '/SYNTHS': [
        { name: 'BASS.XML', attr: 0x20, size: 100 },
        { name: 'SUBFOLDER', attr: ATTR_DIRECTORY, size: 0 },
      ],
    })
    const src = makeSource(fake)
    const presets = await src.listPresets('synth')
    expect(presets).toHaveLength(1)
    expect(presets[0].name).toBe('BASS')
  })

  test('returns empty list when folder missing', async () => {
    const fake = fakeMidi({})
    fake.listDir = vi.fn(async () => {
      throw new Error('Directory not found')
    })
    const src = makeSource(fake)
    const presets = await src.listPresets('synth')
    expect(presets).toEqual([])
  })
})

describe('DelugeSource.loadXml', () => {
  test('decodes bytes as UTF-8', async () => {
    const fake = fakeMidi({}, { '/SYNTHS/BASS.XML': INIT_SYNTH_XML })
    const src = makeSource(fake)
    const xml = await src.loadXml('/SYNTHS/BASS.XML')
    expect(xml).toBe(INIT_SYNTH_XML)
  })
})

describe('DelugeSource.saveXml', () => {
  test('encodes and writes bytes', async () => {
    const fake = fakeMidi({})
    const src = makeSource(fake)
    await src.saveXml('/SYNTHS/NEW.XML', INIT_SYNTH_XML)
    expect(fake.writeFile).toHaveBeenCalledTimes(1)
    const stored = fake.files.get('/SYNTHS/NEW.XML')!
    expect(new TextDecoder().decode(stored)).toBe(INIT_SYNTH_XML)
  })

  test('saveAs writes to new path', async () => {
    const fake = fakeMidi({})
    const src = makeSource(fake)
    await src.saveAs('/SYNTHS/OTHER.XML', INIT_SYNTH_XML)
    expect(fake.files.has('/SYNTHS/OTHER.XML')).toBe(true)
  })
})

describe('DelugeSource.deleteFile', () => {
  test('delegates to MidiConnection.deleteItem', async () => {
    const fake = fakeMidi({}, { '/SYNTHS/OLD.XML': INIT_SYNTH_XML })
    const src = makeSource(fake)
    await src.deleteFile('/SYNTHS/OLD.XML')
    expect(fake.deleteItem).toHaveBeenCalledWith('/SYNTHS/OLD.XML')
    expect(fake.files.has('/SYNTHS/OLD.XML')).toBe(false)
  })
})

describe('DelugeSource.loadEntry', () => {
  test('returns entry with detected kind', async () => {
    const fake = fakeMidi({}, { '/KITS/DRUMS.XML': KIT_XML })
    const src = makeSource(fake)
    const result = await src.loadEntry('/KITS/DRUMS.XML')
    expect(result).not.toBeNull()
    expect(result!.entry.type).toBe('kit')
    expect(result!.entry.name).toBe('DRUMS')
    expect(result!.xml).toBe(KIT_XML)
  })

  test('detects song root element', async () => {
    const fake = fakeMidi({}, { '/SONGS/A.XML': SONG_XML })
    const src = makeSource(fake)
    const result = await src.loadEntry('/SONGS/A.XML')
    expect(result!.entry.type).toBe('song')
  })

  test('returns null for unknown root element', async () => {
    const fake = fakeMidi({}, { '/SOMETHING.XML': '<?xml version="1.0"?><unknown/>' })
    const src = makeSource(fake)
    const result = await src.loadEntry('/SOMETHING.XML')
    expect(result).toBeNull()
  })
})
