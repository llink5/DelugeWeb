// End-to-end integration test for the preset editor.
//
// Flow: load XML via LocalSource → parse → mount SynthView → edit a knob →
// serialize the current sound back to XML → save via LocalSource → reload via
// LocalSource → reparse → confirm the edit survived the round-trip.
//
// This covers the full Phase A stack (parser, paramMeta, KnobRing, SoundEditor,
// SynthView, LocalSource) and is the canonical proof that the editor produces
// XML the device would accept.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import SynthView from '@/modules/preset-editor/SynthView.vue'
import { parsePreset, serializePreset } from '@/lib/xml'
import { LocalSource } from '@/lib/source/LocalSource'
import {
  hexToDisplayLinear,
  hexToDisplay,
  PARAM_META,
  ENVELOPE_PARAM_META,
} from '@/lib/values/paramMeta'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '..', 'fixtures')

function fixtureText(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8')
}

async function changeKnob(
  wrapper: ReturnType<typeof mount>,
  paramPath: string,
  value: number,
) {
  const knob = wrapper.find(`[data-param-path="${paramPath}"]`)
  if (!knob.find('input[type="range"]').exists()) {
    await knob.find('svg').trigger('click')
  }
  await knob.find('input[type="range"]').setValue(value)
}

// Prevent LocalSource.saveXml from actually triggering a browser download.
// jsdom has no real anchor click mechanism; we stub createObjectURL and
// silence the click on the generated <a>.
beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('preset-editor round-trip', () => {
  test('load → edit volume → save → reload preserves the edit', async () => {
    const xml = fixtureText('synth-basic.xml')
    const source = new LocalSource()
    // 1. Load the XML into the source (simulates drag-and-drop)
    const entry = source.registerXml('synth-basic.xml', xml)
    expect(entry.type).toBe('synth')

    // 2. Parse it
    const loaded = await source.loadXml(entry.path)
    const { data: sound, rootName } = parsePreset(loaded)
    expect(rootName).toBe('sound')

    // 3. Mount the editor
    const wrapper = mount(SynthView, {
      props: { sound, name: entry.name, path: entry.path },
    })

    // 4. Edit a knob — volume display value 20
    await changeKnob(wrapper, 'volume', 20)

    // 5. Capture the emitted sound from the change event
    const changes = wrapper.emitted('sound-changed')
    expect(changes).toBeTruthy()
    const edited = changes![changes!.length - 1][0] as Record<string, unknown>

    // 6. Serialize it back to XML
    const newXml = serializePreset('sound', edited)
    expect(newXml).toMatch(/^<\?xml/)
    expect(newXml).toContain('<sound')

    // 7. Save through the source (stubbed download, actual in-memory store)
    await source.saveXml(entry.path, newXml)

    // 8. Reload and reparse
    const reloaded = await source.loadXml(entry.path)
    const reparsed = parsePreset(reloaded).data
    const defaults = reparsed.defaultParams as Record<string, string>

    // 9. Volume round-trip: display 20 should decode back to ~20
    const volDisplay = hexToDisplayLinear(
      defaults.volume,
      PARAM_META.volume.min,
      PARAM_META.volume.max,
    )
    expect(volDisplay).toBe(20)
  })

  test('load → edit LPF frequency → save → reload preserves the edit', async () => {
    const xml = fixtureText('synth-basic.xml')
    const source = new LocalSource()
    const entry = source.registerXml('synth-basic.xml', xml)

    const loaded = await source.loadXml(entry.path)
    const { data: sound } = parsePreset(loaded)

    const wrapper = mount(SynthView, {
      props: { sound, name: entry.name, path: entry.path },
    })
    await changeKnob(wrapper, 'lpfFrequency', 35)

    const edited = (wrapper.emitted('sound-changed')!.pop()![0]) as Record<string, unknown>
    const newXml = serializePreset('sound', edited)
    await source.saveXml(entry.path, newXml)

    const reloaded = await source.loadXml(entry.path)
    const defaults = parsePreset(reloaded).data.defaultParams as Record<string, string>
    const freq = hexToDisplayLinear(
      defaults.lpfFrequency,
      PARAM_META.lpfFrequency.min,
      PARAM_META.lpfFrequency.max,
    )
    expect(freq).toBe(35)
  })

  test('load → edit envelope attack → save → reload preserves the edit', async () => {
    const xml = fixtureText('synth-basic.xml')
    const source = new LocalSource()
    const entry = source.registerXml('synth-basic.xml', xml)

    const loaded = await source.loadXml(entry.path)
    const { data: sound } = parsePreset(loaded)

    const wrapper = mount(SynthView, {
      props: { sound, name: entry.name, path: entry.path },
    })

    // Simulate an edit directly on the envelope. SynthView forwards emit
    // events through SoundEditor; the slider for envelope stages lives
    // inside EnvelopeCurve, which emits update:attack etc.
    // For the integration path we inject a sound mutation directly:
    const defaults = (sound.defaultParams ?? {}) as Record<string, unknown>
    const env1 = (defaults.envelope1 ?? {}) as Record<string, string>
    const newEnv1 = { ...env1, attack: '0x33333320' } // ~display 35
    const newDefaults = { ...defaults, envelope1: newEnv1 }
    const edited = { ...sound, defaultParams: newDefaults }
    const newXml = serializePreset('sound', edited)
    await source.saveXml(entry.path, newXml)
    wrapper.unmount()

    const reloaded = await source.loadXml(entry.path)
    const reparsed = parsePreset(reloaded).data.defaultParams as Record<string, unknown>
    const env1Parsed = reparsed.envelope1 as Record<string, string>
    expect(env1Parsed.attack).toBe('0x33333320')
    // The display value survives the round-trip
    const attackDisplay = hexToDisplay(env1Parsed.attack, ENVELOPE_PARAM_META.attack)
    expect(attackDisplay).toBe(35)
  })

  test('multi-edit batch survives a full round-trip', async () => {
    const xml = fixtureText('synth-basic.xml')
    const source = new LocalSource()
    const entry = source.registerXml('synth-basic.xml', xml)

    const { data: sound } = parsePreset(await source.loadXml(entry.path))
    const wrapper = mount(SynthView, {
      props: { sound, name: entry.name, path: entry.path },
    })

    // Apply a batch of edits
    await changeKnob(wrapper, 'volume', 15)
    await changeKnob(wrapper, 'lpfFrequency', 30)
    await changeKnob(wrapper, 'lpfResonance', 20)
    await changeKnob(wrapper, 'reverbAmount', 10)

    const edited = (wrapper.emitted('sound-changed')!.pop()![0]) as Record<string, unknown>
    const newXml = serializePreset('sound', edited)
    await source.saveXml(entry.path, newXml)

    const reloaded = await source.loadXml(entry.path)
    const defaults = parsePreset(reloaded).data.defaultParams as Record<string, string>
    expect(hexToDisplayLinear(defaults.volume, 0, 50)).toBe(15)
    expect(hexToDisplayLinear(defaults.lpfFrequency, 0, 50)).toBe(30)
    expect(hexToDisplayLinear(defaults.lpfResonance, 0, 50)).toBe(20)
    expect(hexToDisplayLinear(defaults.reverbAmount, 0, 50)).toBe(10)
  })

  test('unknown XML attributes are preserved across round-trip', async () => {
    // Inject a hypothetical future attribute into the fixture
    const xml = fixtureText('synth-basic.xml').replace(
      '<sound',
      '<sound futureFlag="1234"',
    )
    const source = new LocalSource()
    const entry = source.registerXml('synth-modified.xml', xml)

    const { data: sound } = parsePreset(await source.loadXml(entry.path))
    const wrapper = mount(SynthView, {
      props: { sound, name: entry.name, path: entry.path },
    })
    await changeKnob(wrapper, 'volume', 25)

    const edited = (wrapper.emitted('sound-changed')!.pop()![0]) as Record<string, unknown>
    const newXml = serializePreset('sound', edited)
    await source.saveXml(entry.path, newXml)

    const reloaded = await source.loadXml(entry.path)
    expect(reloaded).toContain('futureFlag="1234"')
  })
})
