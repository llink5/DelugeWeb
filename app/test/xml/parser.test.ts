// Round-trip tests for the XML parser.
// Verifies that parsing XML → serializing → parsing again produces identical
// data structures. This is the bedrock guarantee: the editor cannot corrupt
// user presets by passing them through our data model.

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parsePreset, serializePreset } from '@/lib/xml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '..', 'fixtures')

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8')
}

/**
 * Recursively strip DRObject `uniqueId` properties so structural comparisons
 * don't get tripped up by the non-deterministic unique counter.
 */
function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripIds)
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === 'uniqueId') continue
      out[k] = stripIds(v)
    }
    return out
  }
  return value
}

function roundTrip(xml: string): { original: unknown; reparsed: unknown; xmlOut: string } {
  const first = parsePreset(xml)
  const xmlOut = serializePreset(first.rootName, first.data)
  const second = parsePreset(xmlOut)
  return {
    original: stripIds(first.data),
    reparsed: stripIds(second.data),
    xmlOut,
  }
}

describe('parser round-trip', () => {
  const fixtures = [
    'synth-basic.xml',
    'synth-modulated.xml',
    'synth-fm.xml',
    'init-preset.xml',
    'kit-basic.xml',
  ]

  for (const name of fixtures) {
    test(`${name} round-trips without data loss`, () => {
      const xml = loadFixture(name)
      const { original, reparsed } = roundTrip(xml)
      expect(reparsed).toEqual(original)
    })

    test(`${name} serializes to valid XML`, () => {
      const xml = loadFixture(name)
      const { xmlOut } = roundTrip(xml)
      expect(xmlOut).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/)
      // Must re-parse as well-formed XML without DOM parsererror
      const doc = new DOMParser().parseFromString(xmlOut, 'text/xml')
      expect(doc.getElementsByTagName('parsererror').length).toBe(0)
    })
  }
})

describe('parser attribute preservation', () => {
  test('synth-basic preserves all top-level attributes', () => {
    const { data } = parsePreset(loadFixture('synth-basic.xml'))
    expect(data.name).toBe('SYNT001')
    expect(data.polyphonic).toBe('poly')
    expect(data.mode).toBe('subtractive')
    expect(data.lpfMode).toBe('24dB')
    expect(data.modFXType).toBe('none')
  })

  test('synth-basic preserves oscillator settings', () => {
    const { data } = parsePreset(loadFixture('synth-basic.xml'))
    const osc1 = data.osc1 as Record<string, unknown>
    expect(osc1.type).toBe('saw')
    expect(osc1.transpose).toBe('0')
    expect(osc1.cents).toBe('0')
    expect(osc1.retrigPhase).toBe('-1')
  })

  test('synth-basic preserves hex param values exactly', () => {
    const { data } = parsePreset(loadFixture('synth-basic.xml'))
    const params = data.defaultParams as Record<string, unknown>
    expect(params.volume).toBe('0x4CCCCCA8')
    expect(params.lpfFrequency).toBe('0x147AE137')
    expect(params.oscAVolume).toBe('0x7FFFFFFF')
    expect(params.oscBVolume).toBe('0x80000000')
  })

  test('synth-basic preserves envelope values', () => {
    const { data } = parsePreset(loadFixture('synth-basic.xml'))
    const params = data.defaultParams as Record<string, unknown>
    const env1 = params.envelope1 as Record<string, unknown>
    expect(env1.attack).toBe('0x80000000')
    expect(env1.decay).toBe('0xE6666654')
    expect(env1.sustain).toBe('0x7FFFFFFF')
    expect(env1.release).toBe('0x80000000')
  })
})

describe('parser patch cables', () => {
  test('single patchCable is not wrapped into an array', () => {
    const { data } = parsePreset(loadFixture('synth-basic.xml'))
    const params = data.defaultParams as Record<string, unknown>
    const patchCables = params.patchCables as Record<string, unknown>
    // Single child → object, not array
    const pc = patchCables.patchCable
    expect(pc).toBeDefined()
    // Can be either an object or a 1-element array; the parser promotes to
    // array only on the second duplicate. Single entry stays an object.
    expect(Array.isArray(pc)).toBe(false)
    expect((pc as Record<string, unknown>).source).toBe('velocity')
    expect((pc as Record<string, unknown>).destination).toBe('volume')
  })

  test('multiple patchCables become an array', () => {
    const { data } = parsePreset(loadFixture('synth-modulated.xml'))
    const params = data.defaultParams as Record<string, unknown>
    const patchCables = params.patchCables as Record<string, unknown>
    const pc = patchCables.patchCable as unknown[]
    expect(Array.isArray(pc)).toBe(true)
    expect(pc.length).toBe(5)
    expect((pc[0] as Record<string, unknown>).source).toBe('velocity')
    expect((pc[1] as Record<string, unknown>).source).toBe('lfo1')
    expect((pc[4] as Record<string, unknown>).source).toBe('aftertouch')
  })
})

describe('parser kit with hetero soundSources', () => {
  test('kit-basic loads soundSources as an array', () => {
    const { rootName, data } = parsePreset(loadFixture('kit-basic.xml'))
    expect(rootName).toBe('kit')
    const sources = data.soundSources as unknown[]
    expect(Array.isArray(sources)).toBe(true)
    expect(sources.length).toBe(2)
    expect((sources[0] as Record<string, unknown>).name).toBe('KICK')
    expect((sources[1] as Record<string, unknown>).name).toBe('SNARE')
  })

  test('kit soundSource preserves its parameters', () => {
    const { data } = parsePreset(loadFixture('kit-basic.xml'))
    const sources = data.soundSources as Record<string, unknown>[]
    const kick = sources[0]
    const kickParams = kick.defaultParams as Record<string, unknown>
    expect(kickParams.volume).toBe('0x4CCCCCA8')
    expect((kick.osc1 as Record<string, unknown>).type).toBe('sine')
  })
})

describe('parser modKnobs', () => {
  test('modKnobs array is preserved with all 16 entries', () => {
    const { data } = parsePreset(loadFixture('synth-basic.xml'))
    const modKnobs = data.modKnobs as Record<string, unknown>
    const knobs = modKnobs.modKnob as unknown[]
    expect(Array.isArray(knobs)).toBe(true)
    expect(knobs.length).toBe(16)
    expect((knobs[0] as Record<string, unknown>).controlsParam).toBe('pan')
    expect((knobs[10] as Record<string, unknown>).patchAmountFromSource).toBe('lfo1')
  })
})
