// Component tests for KnobRing.
// Exercises rendering, interaction, and hex emission.

import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import KnobRing from '@/components/sound-editor/KnobRing.vue'
import { hexToDisplayLinear } from '@/lib/values/paramMeta'

function mountKnob(overrides: Record<string, unknown> = {}) {
  return mount(KnobRing, {
    props: {
      label: 'Cutoff',
      value: 25,
      rawValue: '0x00000000',
      min: 0,
      max: 50,
      bipolar: false,
      paramPath: 'lpf.frequency',
      ...overrides,
    },
  })
}

describe('KnobRing rendering', () => {
  test('renders label and value', () => {
    const wrapper = mountKnob({ label: 'Cutoff', value: 25 })
    expect(wrapper.text()).toContain('Cutoff')
    expect(wrapper.text()).toContain('25')
  })

  test('formats bipolar values with sign', () => {
    const wrapperPos = mountKnob({ bipolar: true, min: -50, max: 50, value: 12 })
    expect(wrapperPos.text()).toContain('+12')
    const wrapperNeg = mountKnob({ bipolar: true, min: -50, max: 50, value: -20 })
    expect(wrapperNeg.text()).toContain('-20')
    const wrapperZero = mountKnob({ bipolar: true, min: -50, max: 50, value: 0 })
    expect(wrapperZero.text()).toContain('0')
    expect(wrapperZero.text()).not.toContain('+0')
  })

  test('renders the parameter path as a data attribute', () => {
    const wrapper = mountKnob({ paramPath: 'osc1.volume' })
    expect(wrapper.attributes('data-param-path')).toBe('osc1.volume')
  })

  test('exposes ARIA slider attributes', () => {
    const wrapper = mountKnob({ value: 30, min: 0, max: 50 })
    const svg = wrapper.find('svg')
    expect(svg.attributes('role')).toBe('slider')
    expect(svg.attributes('aria-valuemin')).toBe('0')
    expect(svg.attributes('aria-valuemax')).toBe('50')
    expect(svg.attributes('aria-valuenow')).toBe('30')
    expect(svg.attributes('aria-label')).toBe('Cutoff')
  })

  test('editor stays hidden until the knob is clicked', async () => {
    const wrapper = mountKnob()
    expect(wrapper.find('.knob-editor').exists()).toBe(false)
    await wrapper.find('svg').trigger('click')
    expect(wrapper.find('.knob-editor').exists()).toBe(true)
  })

  test('readonly prop disables click-to-edit', async () => {
    const wrapper = mountKnob({ readonly: true })
    await wrapper.find('svg').trigger('click')
    expect(wrapper.find('.knob-editor').exists()).toBe(false)
  })
})

describe('KnobRing mod source indicators', () => {
  test('renders a circle per mod source when depth is zero', () => {
    const wrapper = mountKnob({
      value: 25,
      modSources: [{ sourceId: 'env1', color: '#D85A30', depth: 0 }],
    })
    // depth 0 → dot, not an arc
    const circles = wrapper.findAll('circle')
    expect(circles.length).toBeGreaterThanOrEqual(1)
    expect(circles.some((c) => c.attributes('fill') === '#D85A30')).toBe(true)
  })

  test('renders an arc when depth is non-zero', () => {
    const wrapper = mountKnob({
      value: 25,
      modSources: [{ sourceId: 'lfo1', color: '#378ADD', depth: 20 }],
    })
    const paths = wrapper.findAll('path')
    // track + value + mod = at least 3 paths
    expect(paths.length).toBeGreaterThanOrEqual(3)
    expect(paths.some((p) => p.attributes('stroke') === '#378ADD')).toBe(true)
  })

  test('renders multiple mod sources each with their own colour', () => {
    const wrapper = mountKnob({
      value: 25,
      modSources: [
        { sourceId: 'env1', color: '#D85A30', depth: 15 },
        { sourceId: 'lfo1', color: '#378ADD', depth: -10 },
        { sourceId: 'velocity', color: '#BA7517', depth: 5 },
      ],
    })
    const colouredStrokes = wrapper
      .findAll('path')
      .map((p) => p.attributes('stroke'))
      .filter((s) => s !== 'currentColor' && s !== undefined)
    expect(colouredStrokes).toEqual(expect.arrayContaining(['#D85A30', '#378ADD', '#BA7517']))
  })
})

describe('KnobRing interaction and emission', () => {
  test('slider change emits hex value and path', async () => {
    const wrapper = mountKnob({ value: 10, min: 0, max: 50, paramPath: 'lpf.frequency' })
    await wrapper.find('svg').trigger('click')
    const slider = wrapper.find('input[type="range"]')
    await slider.setValue(35)

    const emitted = wrapper.emitted('update:value')
    expect(emitted).toBeTruthy()
    const [hex, path] = emitted![0] as [string, string]
    expect(hex).toMatch(/^0x[0-9A-F]{8}$/)
    expect(path).toBe('lpf.frequency')
    // The emitted hex round-trips back to display value 35
    expect(hexToDisplayLinear(hex, 0, 50)).toBe(35)
  })

  test('numeric input emits hex value', async () => {
    const wrapper = mountKnob({ value: 10, min: 0, max: 50 })
    await wrapper.find('svg').trigger('click')
    const numeric = wrapper.find('input[type="number"]')
    await numeric.setValue(42)
    await numeric.trigger('change')

    const emitted = wrapper.emitted('update:value')
    expect(emitted).toBeTruthy()
    const [hex] = emitted![0] as [string, string]
    expect(hexToDisplayLinear(hex, 0, 50)).toBe(42)
  })

  test('clamps out-of-range slider input', async () => {
    const wrapper = mountKnob({ value: 10, min: 0, max: 50 })
    await wrapper.find('svg').trigger('click')
    const numeric = wrapper.find('input[type="number"]')
    await numeric.setValue(9999)
    await numeric.trigger('change')

    const emitted = wrapper.emitted('update:value')!
    const [hex] = emitted[0] as [string, string]
    expect(hexToDisplayLinear(hex, 0, 50)).toBe(50)
  })

  test('does not re-emit for identical values', async () => {
    const wrapper = mountKnob({ value: 25, min: 0, max: 50 })
    await wrapper.find('svg').trigger('click')
    const slider = wrapper.find('input[type="range"]')
    await slider.setValue(25)
    expect(wrapper.emitted('update:value')).toBeUndefined()
  })

  test('bipolar knob emits correctly-scaled hex', async () => {
    const wrapper = mountKnob({
      value: 0,
      min: -50,
      max: 50,
      bipolar: true,
      paramPath: 'modulator1.amount',
    })
    await wrapper.find('svg').trigger('click')
    const slider = wrapper.find('input[type="range"]')
    await slider.setValue(-30)

    const emitted = wrapper.emitted('update:value')!
    const [hex] = emitted[0] as [string, string]
    expect(hexToDisplayLinear(hex, -50, 50)).toBe(-30)
  })

  test('close button hides the editor', async () => {
    const wrapper = mountKnob()
    await wrapper.find('svg').trigger('click')
    expect(wrapper.find('.knob-editor').exists()).toBe(true)
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('.knob-editor').exists()).toBe(false)
  })
})
