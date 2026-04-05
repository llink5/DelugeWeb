// SoundEditor integration tests.
// These mount the editor against real parsed preset XML — no mocks for the
// parser, formatter, or metadata table. A preset must flow in, render, be
// editable, and come back out as a new sound object.

import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import SoundEditor from '@/components/sound-editor/SoundEditor.vue'
import { parsePreset, serializePreset } from '@/lib/xml'
import { hexToDisplayLinear } from '@/lib/values/paramMeta'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '..', 'fixtures')

function loadSound(name: string): Record<string, unknown> {
  const xml = readFileSync(resolve(FIXTURES, name), 'utf-8')
  const { data } = parsePreset(xml)
  return data
}

describe('SoundEditor rendering', () => {
  test('renders all engine modules for a subtractive preset', () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(SoundEditor, {
      props: { sound, context: 'synth' },
    })
    expect(wrapper.find('[data-module="osc-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-module="osc-2"]').exists()).toBe(true)
    expect(wrapper.find('[data-module="lpf"]').exists()).toBe(true)
    expect(wrapper.find('[data-module="hpf"]').exists()).toBe(true)
    expect(wrapper.find('[data-module="amp"]').exists()).toBe(true)
  })

  test('swaps OSC labels to Carrier 1/2 in FM mode', () => {
    const sound = loadSound('synth-fm.xml')
    const wrapper = mount(SoundEditor, { props: { sound } })
    expect(wrapper.find('[data-module="carrier-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-module="carrier-2"]').exists()).toBe(true)
    expect(wrapper.find('[data-module="osc-1"]').exists()).toBe(false)
  })

  test('exposes FM module only in FM mode', () => {
    const subtractive = mount(SoundEditor, { props: { sound: loadSound('synth-basic.xml') } })
    expect(subtractive.find('[data-module="fm"]').exists()).toBe(false)
    const fm = mount(SoundEditor, { props: { sound: loadSound('synth-fm.xml') } })
    expect(fm.find('[data-module="fm"]').exists()).toBe(true)
  })

  test('renders knobs with display values taken from hex', () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(SoundEditor, { props: { sound } })
    // synth-basic has volume=0x4CCCCCA8 → display 40, pan=0x00000000 → 0
    const ampModule = wrapper.find('[data-module="amp"]')
    expect(ampModule.text()).toContain('40')
  })

  test('sets the context data attribute', () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(SoundEditor, { props: { sound, context: 'kit-row' } })
    expect(wrapper.find('.sound-editor').attributes('data-context')).toBe('kit-row')
  })
})

describe('SoundEditor parameter editing', () => {
  test('emits update:sound with changed hex value', async () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(SoundEditor, { props: { sound } })

    // Find the LPF Frequency knob by walking the LPF module
    const lpf = wrapper.find('[data-module="lpf"]')
    const freqKnob = lpf.find('[data-param-path="lpfFrequency"]')
    expect(freqKnob.exists()).toBe(true)

    await freqKnob.find('svg').trigger('click')
    const slider = freqKnob.find('input[type="range"]')
    await slider.setValue(30)

    const emitted = wrapper.emitted('update:sound')
    expect(emitted).toBeTruthy()
    const [newSound] = emitted![0] as [Record<string, unknown>]
    const newParams = newSound.defaultParams as Record<string, unknown>
    expect(hexToDisplayLinear(newParams.lpfFrequency as string, 0, 50)).toBe(30)
  })

  test('does not mutate the input sound object', async () => {
    const sound = loadSound('synth-basic.xml')
    const origParams = sound.defaultParams as Record<string, unknown>
    const origVolumeHex = origParams.volume
    const origParamsRef = sound.defaultParams

    const wrapper = mount(SoundEditor, { props: { sound } })
    const amp = wrapper.find('[data-module="amp"]')
    const volKnob = amp.find('[data-param-path="volume"]')
    await volKnob.find('svg').trigger('click')
    await volKnob.find('input[type="range"]').setValue(10)

    // Original sound should be untouched
    expect(origParams.volume).toBe(origVolumeHex)
    expect(sound.defaultParams).toBe(origParamsRef)
  })

  test('emitted sound passes parser round-trip', async () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(SoundEditor, { props: { sound } })
    const volKnob = wrapper.find('[data-module="amp"] [data-param-path="volume"]')
    await volKnob.find('svg').trigger('click')
    await volKnob.find('input[type="range"]').setValue(30)

    const [newSound] = wrapper.emitted('update:sound')![0] as [Record<string, unknown>]

    // Serialise and re-parse to confirm the structure survives
    const xml = serializePreset('sound', newSound)
    const { data } = parsePreset(xml)
    const newParams = data.defaultParams as Record<string, unknown>
    expect(hexToDisplayLinear(newParams.volume as string, 0, 50)).toBe(30)
  })

  test('readonly mode blocks edits', async () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(SoundEditor, { props: { sound, readonly: true } })
    const volKnob = wrapper.find('[data-module="amp"] [data-param-path="volume"]')
    await volKnob.find('svg').trigger('click')
    // Editor should not open in readonly mode
    expect(wrapper.find('.knob-editor').exists()).toBe(false)
    expect(wrapper.emitted('update:sound')).toBeUndefined()
  })
})

describe('SoundEditor mod source indicators', () => {
  test('renders mod indicators for parameters with patch cables', () => {
    const sound = loadSound('synth-modulated.xml')
    const wrapper = mount(SoundEditor, { props: { sound } })

    // synth-modulated routes envelope2 → lpfFrequency and note → lpfFrequency
    const freqKnob = wrapper.find('[data-module="lpf"] [data-param-path="lpfFrequency"]')
    const strokes = freqKnob
      .findAll('path')
      .map((p) => p.attributes('stroke'))
      .filter((s) => s && s !== 'currentColor')
    // envelope2 pink + note purple
    expect(strokes).toContain('#D4537E')
    expect(strokes).toContain('#7F77DD')
  })

  test('no mod indicators when no cable targets the parameter', () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(SoundEditor, { props: { sound } })
    // synth-basic only has velocity→volume. hpfFrequency has no cable.
    const hpfKnob = wrapper.find('[data-module="hpf"] [data-param-path="hpfFrequency"]')
    const strokes = hpfKnob
      .findAll('path')
      .map((p) => p.attributes('stroke'))
      .filter((s) => s && s !== 'currentColor')
    expect(strokes).toHaveLength(0)
  })
})

describe('SoundEditor OSC type editing', () => {
  test('emits new sound when oscillator type changes', async () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(SoundEditor, { props: { sound } })
    const osc1 = wrapper.find('[data-module="osc-1"]')
    const select = osc1.find('select')
    expect((select.element as HTMLSelectElement).value).toBe('saw')
    await select.setValue('sine')

    const emitted = wrapper.emitted('update:sound')
    expect(emitted).toBeTruthy()
    const [newSound] = emitted![0] as [Record<string, unknown>]
    const newOsc1 = newSound.osc1 as Record<string, unknown>
    expect(newOsc1.type).toBe('sine')
  })

  test('OSC type change preserves other osc attributes', async () => {
    const sound = loadSound('synth-modulated.xml')
    const wrapper = mount(SoundEditor, { props: { sound } })
    const osc2Select = wrapper.find('[data-module="osc-2"] select')
    await osc2Select.setValue('triangle')

    const [newSound] = wrapper.emitted('update:sound')![0] as [Record<string, unknown>]
    const newOsc2 = newSound.osc2 as Record<string, unknown>
    expect(newOsc2.type).toBe('triangle')
    // Transpose and cents carried over
    expect(newOsc2.transpose).toBe('-7')
    expect(newOsc2.cents).toBe('5')
  })

  test('LPF mode selector updates the sound', async () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(SoundEditor, { props: { sound } })
    const select = wrapper.find('[data-module="lpf"] select')
    expect((select.element as HTMLSelectElement).value).toBe('24dB')
    await select.setValue('12dB')

    const [newSound] = wrapper.emitted('update:sound')![0] as [Record<string, unknown>]
    expect(newSound.lpfMode).toBe('12dB')
  })
})
