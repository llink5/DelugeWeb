// LocalSource unit tests. These exercise the in-memory registry and detection
// logic without requiring a real File object.

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { LocalSource } from '@/lib/source/LocalSource'
import { detectPresetKind, stripXmlExtension } from '@/lib/source/PresetSource'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '..', 'fixtures')

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8')
}

describe('detectPresetKind', () => {
  test('recognises sound presets', () => {
    expect(detectPresetKind(loadFixture('synth-basic.xml'))).toBe('synth')
    expect(detectPresetKind(loadFixture('synth-fm.xml'))).toBe('synth')
  })

  test('recognises kit presets', () => {
    expect(detectPresetKind(loadFixture('kit-basic.xml'))).toBe('kit')
  })

  test('returns null for unrelated XML', () => {
    expect(detectPresetKind('<?xml version="1.0"?><rootElement/>')).toBe(null)
  })

  test('ignores leading whitespace and XML declarations', () => {
    const xml = '<?xml version="1.0"?>\n\n   <sound name="X"/>'
    expect(detectPresetKind(xml)).toBe('synth')
  })
})

describe('stripXmlExtension', () => {
  test('strips .xml and .XML', () => {
    expect(stripXmlExtension('BASS001.xml')).toBe('BASS001')
    expect(stripXmlExtension('BASS001.XML')).toBe('BASS001')
  })

  test('leaves unrelated filenames alone', () => {
    expect(stripXmlExtension('README')).toBe('README')
    expect(stripXmlExtension('file.txt')).toBe('file.txt')
  })
})

describe('LocalSource registry', () => {
  let source: LocalSource

  beforeEach(() => {
    source = new LocalSource()
  })

  test('registers a synth preset and surfaces it in listPresets', async () => {
    const xml = loadFixture('synth-basic.xml')
    const entry = source.registerXml('SYNT001.xml', xml)
    expect(entry.type).toBe('synth')
    expect(entry.name).toBe('SYNT001')

    const list = await source.listPresets('synth')
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('SYNT001')
    expect(list[0].size).toBeGreaterThan(0)
  })

  test('kit presets are filtered by kind', async () => {
    source.registerXml('S.xml', loadFixture('synth-basic.xml'))
    source.registerXml('K.xml', loadFixture('kit-basic.xml'))

    expect((await source.listPresets('synth'))).toHaveLength(1)
    expect((await source.listPresets('kit'))).toHaveLength(1)
    expect((await source.listPresets('song'))).toHaveLength(0)
  })

  test('loadXml returns the stored XML verbatim', async () => {
    const xml = loadFixture('synth-basic.xml')
    const entry = source.registerXml('SYNT001.xml', xml)
    const loaded = await source.loadXml(entry.path)
    expect(loaded).toBe(xml)
  })

  test('loadXml throws for unknown paths', async () => {
    await expect(source.loadXml('missing.xml')).rejects.toThrow(/No preset loaded/)
  })

  test('registerXml rejects non-preset XML', () => {
    expect(() => source.registerXml('bogus.xml', '<?xml version="1.0"?><root/>'))
      .toThrow(/not a recognized Deluge preset/)
  })

  test('listFolder returns empty array (not supported)', async () => {
    expect(await source.listFolder('/SYNTHS')).toEqual([])
  })

  test('unregister removes a preset', async () => {
    const entry = source.registerXml('X.xml', loadFixture('synth-basic.xml'))
    expect(source.size).toBe(1)
    source.unregister(entry.path)
    expect(source.size).toBe(0)
  })

  test('clear empties the registry', () => {
    source.registerXml('A.xml', loadFixture('synth-basic.xml'))
    source.registerXml('B.xml', loadFixture('synth-fm.xml'))
    expect(source.size).toBe(2)
    source.clear()
    expect(source.size).toBe(0)
  })

  test('registering the same filename twice produces distinct paths', () => {
    const xml = loadFixture('synth-basic.xml')
    const a = source.registerXml('DUP.xml', xml)
    const b = source.registerXml('DUP.xml', xml)
    expect(a.path).not.toBe(b.path)
    expect(source.size).toBe(2)
  })

  test('basename handling strips leading path segments', () => {
    const entry = source.registerXml('/SYNTHS/FOLDER/BASS.xml', loadFixture('synth-basic.xml'))
    expect(entry.name).toBe('BASS')
  })

  test('connected is always true', () => {
    expect(source.connected).toBe(true)
    expect(source.type).toBe('local')
  })
})

describe('LocalSource downloadAsFile', () => {
  let source: LocalSource

  beforeEach(() => {
    source = new LocalSource()
  })

  test('triggers an anchor click with a blob URL', () => {
    const clickSpy = vi.fn()
    const originalCreate = document.createElement.bind(document)
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag)
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: clickSpy, configurable: true })
      }
      return el
    })

    // jsdom doesn't implement URL.createObjectURL out of the box
    const createURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    source.downloadAsFile('test.xml', '<sound/>')

    expect(createSpy).toHaveBeenCalledWith('a')
    expect(clickSpy).toHaveBeenCalled()
    expect(createURLSpy).toHaveBeenCalled()

    createSpy.mockRestore()
    createURLSpy.mockRestore()
    revokeSpy.mockRestore()
  })

  test('ensures .xml suffix', () => {
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      return { href: '', download: '', click: () => {} } as unknown as HTMLElement
    })
    const createURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:url')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    // Stub body appendChild/removeChild since our fake anchor isn't a real Node
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n)
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((n) => n)

    const captured: Record<string, unknown>[] = []
    createSpy.mockImplementation(() => {
      const el = { href: '', download: '', click: () => {} }
      captured.push(el)
      return el as unknown as HTMLElement
    })

    source.downloadAsFile('BASS', '<sound/>')
    source.downloadAsFile('TREBLE.xml', '<sound/>')

    expect(captured[0].download).toBe('BASS.xml')
    expect(captured[1].download).toBe('TREBLE.xml')

    createSpy.mockRestore()
    createURLSpy.mockRestore()
    appendSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
