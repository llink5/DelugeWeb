import { describe, test, expect } from 'vitest'
import {
  parseUrlHash,
  configToQuery,
  buildShareableUrl,
  normalize,
  EMPTY_CONFIG,
} from '@/lib/emulator/ShareableUrl'

describe('parseUrlHash', () => {
  test('empty hash returns empty config', () => {
    expect(parseUrlHash('')).toEqual(EMPTY_CONFIG)
    expect(parseUrlHash('#/emulator')).toEqual(EMPTY_CONFIG)
  })

  test('parses elf, breakpoints, watches, start', () => {
    const r = parseUrlHash(
      '#/emulator?elf=https://x.com/a.elf&bp=main,foo&watch=currentSong&start=1',
    )
    expect(r.elf).toBe('https://x.com/a.elf')
    expect(r.breakpoints).toEqual(['main', 'foo'])
    expect(r.watches).toEqual(['currentSong'])
    expect(r.start).toBe(true)
  })

  test('start=true is also accepted', () => {
    expect(parseUrlHash('#?start=true').start).toBe(true)
  })

  test('start missing defaults to false', () => {
    expect(parseUrlHash('#?elf=x').start).toBe(false)
  })

  test('URL-encoded values are decoded', () => {
    const r = parseUrlHash('#?elf=' + encodeURIComponent('https://x.com/a b.elf'))
    expect(r.elf).toBe('https://x.com/a b.elf')
  })

  test('comma-separated lists with encoded entries', () => {
    const r = parseUrlHash('#?bp=Sound%3A%3Arender,foo')
    expect(r.breakpoints).toEqual(['Sound::render', 'foo'])
  })

  test('hex-address breakpoint is preserved as string', () => {
    const r = parseUrlHash('#?bp=0x20000100')
    expect(r.breakpoints).toEqual(['0x20000100'])
  })

  test('at= is parsed', () => {
    expect(parseUrlHash('#?at=main').at).toBe('main')
  })
})

describe('configToQuery', () => {
  test('empty config serialises to empty string', () => {
    expect(configToQuery(EMPTY_CONFIG)).toBe('')
  })

  test('omits empty lists and false start', () => {
    expect(
      configToQuery({
        elf: 'x.elf',
        breakpoints: [],
        watches: [],
        start: false,
      }),
    ).toBe('elf=x.elf')
  })

  test('encodes special characters', () => {
    const q = configToQuery({
      elf: 'https://x.com/a b.elf',
      breakpoints: [],
      watches: [],
      start: false,
    })
    expect(q).toContain('%20')
  })

  test('serialises breakpoints and watches', () => {
    const q = configToQuery({
      elf: 'x.elf',
      breakpoints: ['main', '0x20000100'],
      watches: ['currentSong'],
      start: true,
      at: 'init',
    })
    expect(q).toContain('elf=x.elf')
    expect(q).toContain('bp=main,0x20000100')
    expect(q).toContain('watch=currentSong')
    expect(q).toContain('start=1')
    expect(q).toContain('at=init')
  })
})

describe('round-trip', () => {
  test('parse(encode(x)) equals x', () => {
    const original = {
      elf: 'https://x.com/a.elf',
      breakpoints: ['main', 'Song::render', '0x20000100'],
      watches: ['currentSong', 'midiEngine'],
      start: true,
      at: '0x20001000',
    }
    const query = configToQuery(original)
    const parsed = parseUrlHash('?' + query)
    expect(parsed).toEqual(original)
  })

  test('normalize filters out empty/default values', () => {
    const n = normalize({
      elf: 'x.elf',
      breakpoints: [],
      watches: [],
      start: false,
    })
    expect(n).toEqual({
      elf: 'x.elf',
      breakpoints: [],
      watches: [],
      start: false,
    })
  })
})

describe('buildShareableUrl', () => {
  test('builds URL with hash route', () => {
    const url = buildShareableUrl('https://app.example.com/', {
      elf: 'x.elf',
      breakpoints: ['main'],
      watches: [],
      start: true,
    })
    expect(url).toBe(
      'https://app.example.com/#/emulator?elf=x.elf&bp=main&start=1',
    )
  })

  test('empty config yields bare route', () => {
    const url = buildShareableUrl('https://app.example.com', EMPTY_CONFIG)
    expect(url).toBe('https://app.example.com/#/emulator')
  })

  test('strips existing hash/query from base', () => {
    const url = buildShareableUrl(
      'https://app.example.com/?foo=bar#/other',
      EMPTY_CONFIG,
    )
    expect(url).toBe('https://app.example.com/#/emulator')
  })
})
