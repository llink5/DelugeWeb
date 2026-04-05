// EffectsPanel component tests.
// Mounts the panel against real parsed preset XML — no mocks for the parser,
// formatter, or metadata table. A preset must flow in, render the four FX
// modules, and come back out as a new sound object on every edit.

import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import EffectsPanel from '@/components/sound-editor/EffectsPanel.vue'
import { parsePreset } from '@/lib/xml'
import { hexToDisplayLinear } from '@/lib/values/paramMeta'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '..', 'fixtures')

function loadSound(name: string): Record<string, unknown> {
  const xml = readFileSync(resolve(FIXTURES, name), 'utf-8')
  const { data } = parsePreset(xml)
  return data
}

describe('EffectsPanel rendering', () => {
  test('renders all four FX modules', () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(EffectsPanel, { props: { sound } })
    expect(wrapper.find('[data-testid="effects-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-module="delay"]').exists()).toBe(true)
    expect(wrapper.find('[data-module="reverb"]').exists()).toBe(true)
    expect(wrapper.find('[data-module="mod-fx"]').exists()).toBe(true)
    expect(wrapper.find('[data-module="distortion"]').exists()).toBe(true)
  })

  test('renders knobs for each FX param', () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(EffectsPanel, { props: { sound } })
    const delay = wrapper.find('[data-module="delay"]')
    expect(delay.find('[data-param-path="delayRate"]').exists()).toBe(true)
    expect(delay.find('[data-param-path="delayFeedback"]').exists()).toBe(true)

    const reverb = wrapper.find('[data-module="reverb"]')
    expect(reverb.find('[data-param-path="reverbAmount"]').exists()).toBe(true)

    const modFx = wrapper.find('[data-module="mod-fx"]')
    expect(modFx.find('[data-param-path="modFXRate"]').exists()).toBe(true)
    expect(modFx.find('[data-param-path="modFXDepth"]').exists()).toBe(true)
    expect(modFx.find('[data-param-path="modFXOffset"]').exists()).toBe(true)
    expect(modFx.find('[data-param-path="modFXFeedback"]').exists()).toBe(true)

    const dist = wrapper.find('[data-module="distortion"]')
    expect(dist.find('[data-param-path="bitCrush"]').exists()).toBe(true)
    expect(dist.find('[data-param-path="sampleRateReduction"]').exists()).toBe(true)
  })

  test('modFXType select shows the current value from XML', () => {
    const sound = loadSound('synth-modulated.xml')
    const wrapper = mount(EffectsPanel, { props: { sound } })
    const select = wrapper.find('[data-module="mod-fx"] select')
    expect(select.exists()).toBe(true)
    expect((select.element as HTMLSelectElement).value).toBe('flanger')
  })

  test('modFXType defaults to none when missing from the sound', () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(EffectsPanel, { props: { sound } })
    const select = wrapper.find('[data-module="mod-fx"] select')
    expect((select.element as HTMLSelectElement).value).toBe('none')
  })
})

describe('EffectsPanel parameter editing', () => {
  test('changing an FX knob emits update:sound with new hex in defaultParams', async () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(EffectsPanel, { props: { sound } })

    const reverbKnob = wrapper.find(
      '[data-module="reverb"] [data-param-path="reverbAmount"]',
    )
    expect(reverbKnob.exists()).toBe(true)

    await reverbKnob.find('svg').trigger('click')
    const slider = reverbKnob.find('input[type="range"]')
    await slider.setValue(28)

    const emitted = wrapper.emitted('update:sound')
    expect(emitted).toBeTruthy()
    const [newSound] = emitted![0] as [Record<string, unknown>]
    const newParams = newSound.defaultParams as Record<string, unknown>
    expect(hexToDisplayLinear(newParams.reverbAmount as string, 0, 50)).toBe(28)
  })

  test('changing a Mod FX knob emits update:sound with correct hex', async () => {
    const sound = loadSound('synth-modulated.xml')
    const wrapper = mount(EffectsPanel, { props: { sound } })

    const rateKnob = wrapper.find(
      '[data-module="mod-fx"] [data-param-path="modFXRate"]',
    )
    await rateKnob.find('svg').trigger('click')
    await rateKnob.find('input[type="range"]').setValue(15)

    const [newSound] = wrapper.emitted('update:sound')![0] as [Record<string, unknown>]
    const newParams = newSound.defaultParams as Record<string, unknown>
    expect(hexToDisplayLinear(newParams.modFXRate as string, 0, 50)).toBe(15)
  })

  test('changing modFXType emits update:sound with new sound.modFXType', async () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(EffectsPanel, { props: { sound } })
    const select = wrapper.find('[data-module="mod-fx"] select')
    await select.setValue('chorus')

    const emitted = wrapper.emitted('update:sound')
    expect(emitted).toBeTruthy()
    const [newSound] = emitted![0] as [Record<string, unknown>]
    expect(newSound.modFXType).toBe('chorus')
  })

  test('modFXType change does not touch defaultParams', async () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(EffectsPanel, { props: { sound } })
    const origParams = sound.defaultParams
    const select = wrapper.find('[data-module="mod-fx"] select')
    await select.setValue('phaser')

    const [newSound] = wrapper.emitted('update:sound')![0] as [Record<string, unknown>]
    // defaultParams carried over unchanged (deep equality — Vue wraps props in proxies
    // so reference equality isn't reliable here)
    expect(newSound.defaultParams).toStrictEqual(origParams)
  })

  test('does not mutate the input sound object', async () => {
    const sound = loadSound('synth-basic.xml')
    const origParams = sound.defaultParams as Record<string, unknown>
    const origFeedbackHex = origParams.delayFeedback
    const origParamsRef = sound.defaultParams
    const origModFXType = sound.modFXType

    const wrapper = mount(EffectsPanel, { props: { sound } })
    const feedbackKnob = wrapper.find(
      '[data-module="delay"] [data-param-path="delayFeedback"]',
    )
    await feedbackKnob.find('svg').trigger('click')
    await feedbackKnob.find('input[type="range"]').setValue(20)

    expect(origParams.delayFeedback).toBe(origFeedbackHex)
    expect(sound.defaultParams).toBe(origParamsRef)
    expect(sound.modFXType).toBe(origModFXType)
  })
})

describe('EffectsPanel readonly mode', () => {
  test('blocks knob edits', async () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(EffectsPanel, { props: { sound, readonly: true } })
    const knob = wrapper.find('[data-module="delay"] [data-param-path="delayRate"]')
    await knob.find('svg').trigger('click')
    expect(wrapper.find('.knob-editor').exists()).toBe(false)
    expect(wrapper.emitted('update:sound')).toBeUndefined()
  })

  test('blocks modFXType changes', async () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(EffectsPanel, { props: { sound, readonly: true } })
    const select = wrapper.find('[data-module="mod-fx"] select')
    await select.setValue('chorus')
    expect(wrapper.emitted('update:sound')).toBeUndefined()
  })
})

describe('EffectsPanel mod source indicators', () => {
  test('no mod-source strokes on FX knobs when no cables target them', () => {
    // synth-modulated.xml has no patch cables targeting any FX parameter.
    const sound = loadSound('synth-modulated.xml')
    const wrapper = mount(EffectsPanel, { props: { sound } })

    const fxPaths = ['delayRate', 'delayFeedback', 'reverbAmount', 'modFXRate', 'modFXDepth', 'bitCrush', 'sampleRateReduction']
    for (const key of fxPaths) {
      const knob = wrapper.find(`[data-param-path="${key}"]`)
      expect(knob.exists()).toBe(true)
      const strokes = knob
        .findAll('path')
        .map((p) => p.attributes('stroke'))
        .filter((s) => s && s !== 'currentColor')
      expect(strokes).toHaveLength(0)
    }
  })

  test('renders a mod indicator stroke when a cable targets an FX param', () => {
    // Inject a synthetic patch cable targeting delayFeedback so we can verify
    // that the mod-source arc rendering pipeline engages for this panel.
    const sound = loadSound('synth-basic.xml')
    const defaults = sound.defaultParams as Record<string, unknown>
    const cables = defaults.patchCables as { patchCable: unknown }
    defaults.patchCables = {
      patchCable: [
        cables.patchCable,
        { source: 'lfo1', destination: 'delayFeedback', amount: '0x33333320' },
      ],
    }

    const wrapper = mount(EffectsPanel, { props: { sound } })
    const knob = wrapper.find('[data-module="delay"] [data-param-path="delayFeedback"]')
    const strokes = knob
      .findAll('path')
      .map((p) => p.attributes('stroke'))
      .filter((s) => s && s !== 'currentColor')
    // lfo1 renders with its fixed blue colour
    expect(strokes).toContain('#378ADD')
  })
})
