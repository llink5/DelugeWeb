// PatchMorph tests: safety limits, undo, and XML validity.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import PatchMorph from '@/components/sound-editor/PatchMorph.vue'
import { parsePreset, serializePreset } from '@/lib/xml'
import { hexToDisplayLinear, PARAM_META } from '@/lib/values/paramMeta'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '..', 'fixtures')

function loadSound(name: string): Record<string, unknown> {
  const xml = readFileSync(resolve(FIXTURES, name), 'utf-8')
  return parsePreset(xml).data
}

// Use a deterministic Math.random for predictable tests.
let randomIndex = 0
const RANDOM_SEQUENCE = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8, 0.4, 0.6, 0.15, 0.85, 0.35]

beforeEach(() => {
  randomIndex = 0
  vi.spyOn(Math, 'random').mockImplementation(() => {
    const v = RANDOM_SEQUENCE[randomIndex % RANDOM_SEQUENCE.length]
    randomIndex++
    return v
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PatchMorph rendering', () => {
  test('renders section sliders', () => {
    const wrapper = mount(PatchMorph, { props: { sound: loadSound('synth-basic.xml') } })
    expect(wrapper.find('[data-testid="patch-morph"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="morph-master"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="morph-oscillators"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="morph-filters"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="morph-envelopes"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="morph-effects"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="morph-modulation"]').exists()).toBe(true)
  })

  test('apply and undo buttons visible', () => {
    const wrapper = mount(PatchMorph, { props: { sound: loadSound('synth-basic.xml') } })
    expect(wrapper.find('[data-testid="morph-apply"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="morph-undo"]').exists()).toBe(true)
  })

  test('undo is disabled before first apply', () => {
    const wrapper = mount(PatchMorph, { props: { sound: loadSound('synth-basic.xml') } })
    const undoBtn = wrapper.find('[data-testid="morph-undo"]')
    expect(undoBtn.attributes('disabled')).toBeDefined()
  })
})

describe('PatchMorph master slider', () => {
  test('moving master updates all section sliders', async () => {
    const wrapper = mount(PatchMorph, { props: { sound: loadSound('synth-basic.xml') } })
    await wrapper.find('[data-testid="morph-master"]').setValue(60)

    const osc = wrapper.find('[data-testid="morph-oscillators"]').element as HTMLInputElement
    const fil = wrapper.find('[data-testid="morph-filters"]').element as HTMLInputElement
    const env = wrapper.find('[data-testid="morph-envelopes"]').element as HTMLInputElement
    const fx = wrapper.find('[data-testid="morph-effects"]').element as HTMLInputElement
    expect(osc.value).toBe('60')
    expect(fil.value).toBe('60')
    expect(env.value).toBe('60')
    expect(fx.value).toBe('60')
  })

  test('modulation slider is capped at 50 when master goes higher', async () => {
    const wrapper = mount(PatchMorph, { props: { sound: loadSound('synth-basic.xml') } })
    await wrapper.find('[data-testid="morph-master"]').setValue(100)
    const mod = wrapper.find('[data-testid="morph-modulation"]').element as HTMLInputElement
    expect(mod.value).toBe('50')
  })
})

describe('PatchMorph safety limits', () => {
  test('morphed osc volume stays within max bound', async () => {
    const wrapper = mount(PatchMorph, { props: { sound: loadSound('synth-basic.xml') } })
    // Crank oscillators to 100
    await wrapper.find('[data-testid="morph-oscillators"]').setValue(100)
    await wrapper.find('[data-testid="morph-apply"]').trigger('click')

    const emitted = wrapper.emitted('update:sound')!
    const next = emitted[0][0] as Record<string, unknown>
    const defaults = next.defaultParams as Record<string, string>
    const oscAVol = hexToDisplayLinear(
      defaults.oscAVolume,
      PARAM_META.oscAVolume.min,
      PARAM_META.oscAVolume.max,
    )
    expect(oscAVol).toBeGreaterThanOrEqual(0)
    expect(oscAVol).toBeLessThanOrEqual(40) // OSC_VOLUME_MAX
  })

  test('morphed delay feedback stays within max bound', async () => {
    const wrapper = mount(PatchMorph, { props: { sound: loadSound('synth-basic.xml') } })
    await wrapper.find('[data-testid="morph-effects"]').setValue(100)
    await wrapper.find('[data-testid="morph-apply"]').trigger('click')

    const emitted = wrapper.emitted('update:sound')!
    const next = emitted[0][0] as Record<string, unknown>
    const defaults = next.defaultParams as Record<string, string>
    const fb = hexToDisplayLinear(defaults.delayFeedback, 0, 50)
    expect(fb).toBeLessThanOrEqual(25) // DELAY_FB_MAX
  })

  test('generates at most MAX_MORPH_CABLES cables', async () => {
    const wrapper = mount(PatchMorph, { props: { sound: loadSound('synth-basic.xml') } })
    await wrapper.find('[data-testid="morph-modulation"]').setValue(100)
    await wrapper.find('[data-testid="morph-apply"]').trigger('click')

    const emitted = wrapper.emitted('update:sound')!
    const next = emitted[0][0] as Record<string, unknown>
    const defaults = next.defaultParams as Record<string, unknown>
    const cables = (defaults.patchCables as Record<string, unknown>)?.patchCable
    if (cables) {
      const arr = Array.isArray(cables) ? cables : [cables]
      expect(arr.length).toBeLessThanOrEqual(8) // MAX_MORPH_CABLES
    }
  })

  test('modulation=0 generates no new cables', async () => {
    const wrapper = mount(PatchMorph, { props: { sound: loadSound('synth-basic.xml') } })
    // Zero all sections except osc so we have something to emit
    await wrapper.find('[data-testid="morph-oscillators"]').setValue(20)
    await wrapper.find('[data-testid="morph-modulation"]').setValue(0)
    await wrapper.find('[data-testid="morph-apply"]').trigger('click')

    const emitted = wrapper.emitted('update:sound')!
    const next = emitted[0][0] as Record<string, unknown>
    const defaults = next.defaultParams as Record<string, unknown>
    // Existing patchCables from the fixture should be preserved untouched
    const origDefaults = (loadSound('synth-basic.xml').defaultParams ?? {}) as Record<string, unknown>
    expect(defaults.patchCables).toEqual(origDefaults.patchCables)
  })
})

describe('PatchMorph XML validity', () => {
  test('morphed sound serializes to valid XML that reparses', async () => {
    const wrapper = mount(PatchMorph, { props: { sound: loadSound('synth-basic.xml') } })
    await wrapper.find('[data-testid="morph-master"]').setValue(50)
    await wrapper.find('[data-testid="morph-apply"]').trigger('click')

    const emitted = wrapper.emitted('update:sound')!
    const next = emitted[0][0] as Record<string, unknown>
    const xml = serializePreset('sound', next)
    expect(xml).toMatch(/^<\?xml/)
    expect(xml).toContain('<sound')
    // Round-trip
    const { rootName } = parsePreset(xml)
    expect(rootName).toBe('sound')
  })
})

describe('PatchMorph undo', () => {
  test('undo restores the pre-morph sound', async () => {
    const original = loadSound('synth-basic.xml')
    const wrapper = mount(PatchMorph, { props: { sound: original } })
    await wrapper.find('[data-testid="morph-master"]').setValue(60)
    await wrapper.find('[data-testid="morph-apply"]').trigger('click')
    await wrapper.find('[data-testid="morph-undo"]').trigger('click')
    const emitted = wrapper.emitted('update:sound')!
    // Last emission should be structurally equal to the original
    const last = emitted[emitted.length - 1][0] as Record<string, unknown>
    expect(last).toStrictEqual(original)
  })

  test('undo is disabled again after undoing', async () => {
    const wrapper = mount(PatchMorph, { props: { sound: loadSound('synth-basic.xml') } })
    await wrapper.find('[data-testid="morph-apply"]').trigger('click')
    const undoBtn = wrapper.find('[data-testid="morph-undo"]')
    expect(undoBtn.attributes('disabled')).toBeUndefined()
    await undoBtn.trigger('click')
    expect(undoBtn.attributes('disabled')).toBeDefined()
  })

  test('after apply, undo becomes enabled', async () => {
    const wrapper = mount(PatchMorph, { props: { sound: loadSound('synth-basic.xml') } })
    await wrapper.find('[data-testid="morph-apply"]').trigger('click')
    const undoBtn = wrapper.find('[data-testid="morph-undo"]')
    expect(undoBtn.attributes('disabled')).toBeUndefined()
  })

  test('readonly mode disables apply and undo', async () => {
    const wrapper = mount(PatchMorph, {
      props: { sound: loadSound('synth-basic.xml'), readonly: true },
    })
    const applyBtn = wrapper.find('[data-testid="morph-apply"]')
    expect(applyBtn.attributes('disabled')).toBeDefined()
    await applyBtn.trigger('click')
    expect(wrapper.emitted('update:sound')).toBeUndefined()
  })
})

describe('PatchMorph envelope morphing', () => {
  test('low envelope intensity produces short attack/release', async () => {
    const wrapper = mount(PatchMorph, { props: { sound: loadSound('synth-basic.xml') } })
    await wrapper.find('[data-testid="morph-envelopes"]').setValue(10)
    await wrapper.find('[data-testid="morph-apply"]').trigger('click')

    const emitted = wrapper.emitted('update:sound')!
    const next = emitted[0][0] as Record<string, unknown>
    const defaults = next.defaultParams as Record<string, unknown>
    const env1 = defaults.envelope1 as Record<string, string>
    const attack = hexToDisplayLinear(env1.attack, 0, 50)
    const release = hexToDisplayLinear(env1.release, 0, 50)
    // At 10% intensity, attack and release should both be very small (<=5)
    expect(attack).toBeLessThanOrEqual(5)
    expect(release).toBeLessThanOrEqual(5)
  })

  test('high envelope intensity produces long attack/release', async () => {
    const wrapper = mount(PatchMorph, { props: { sound: loadSound('synth-basic.xml') } })
    await wrapper.find('[data-testid="morph-envelopes"]').setValue(100)
    await wrapper.find('[data-testid="morph-apply"]').trigger('click')

    const emitted = wrapper.emitted('update:sound')!
    const next = emitted[0][0] as Record<string, unknown>
    const defaults = next.defaultParams as Record<string, unknown>
    const env1 = defaults.envelope1 as Record<string, string>
    const attack = hexToDisplayLinear(env1.attack, 0, 50)
    // At 100% intensity, attack should be at or near ENVELOPE_MAX (40)
    expect(attack).toBe(40)
  })
})
