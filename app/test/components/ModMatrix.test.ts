// Component tests for ModMatrix.
// Exercises rendering, add/remove/edit interactions, and hex round-tripping.

import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ModMatrix from '@/components/sound-editor/ModMatrix.vue'
import type { PatchCable } from '@/lib/values/patchCables'
import { hexToDisplayLinear, displayToHexLinear } from '@/lib/values/paramMeta'

function depthHex(depth: number): string {
  return displayToHexLinear(depth, -50, 50)
}

function cable(source: string, destination: string, depth: number): PatchCable {
  return { source, destination, amount: depthHex(depth) }
}

function mountMatrix(overrides: Record<string, unknown> = {}) {
  return mount(ModMatrix, {
    props: {
      cables: [] as PatchCable[],
      ...overrides,
    },
  })
}

describe('ModMatrix rendering', () => {
  test('renders root data-testid', () => {
    const wrapper = mountMatrix()
    expect(wrapper.find('[data-testid="mod-matrix"]').exists()).toBe(true)
  })

  test('empty cables shows hint and no rows', () => {
    const wrapper = mountMatrix({ cables: [] })
    expect(wrapper.text()).toContain('No modulation cables')
    expect(wrapper.findAll('[data-cable-index]')).toHaveLength(0)
  })

  test('renders n rows for n cables', () => {
    const cables = [
      cable('envelope1', 'volume', 20),
      cable('lfo1', 'lpfFrequency', -15),
      cable('velocity', 'pan', 10),
    ]
    const wrapper = mountMatrix({ cables })
    const rows = wrapper.findAll('[data-cable-index]')
    expect(rows).toHaveLength(3)
    expect(rows[0].attributes('data-cable-index')).toBe('0')
    expect(rows[1].attributes('data-cable-index')).toBe('1')
    expect(rows[2].attributes('data-cable-index')).toBe('2')
  })

  test('empty hint disappears when cables present', () => {
    const wrapper = mountMatrix({ cables: [cable('envelope1', 'volume', 5)] })
    expect(wrapper.text()).not.toContain('No modulation cables')
  })

  test('add button has the expected data-testid', () => {
    const wrapper = mountMatrix()
    expect(wrapper.find('[data-testid="add-cable"]').exists()).toBe(true)
  })
})

describe('ModMatrix add/remove', () => {
  test('add button emits update:cables with n+1 entries', async () => {
    const initial = [cable('envelope1', 'volume', 10)]
    const wrapper = mountMatrix({ cables: initial })
    await wrapper.find('[data-testid="add-cable"]').trigger('click')

    const emitted = wrapper.emitted('update:cables')
    expect(emitted).toBeTruthy()
    const next = emitted![0][0] as PatchCable[]
    expect(next).toHaveLength(2)
    // Original cable preserved
    expect(next[0]).toEqual(initial[0])
    // New cable has default amount (0 depth) and non-empty source/destination
    expect(next[1].amount).toBe('0x00000000')
    expect(next[1].source).toBeTruthy()
    expect(next[1].destination).toBeTruthy()
  })

  test('add button picks first custom source and destination', async () => {
    const wrapper = mountMatrix({
      cables: [],
      availableSources: ['lfo2', 'velocity'],
      availableDestinations: ['lpfFrequency', 'pan'],
    })
    await wrapper.find('[data-testid="add-cable"]').trigger('click')
    const emitted = wrapper.emitted('update:cables')!
    const next = emitted[0][0] as PatchCable[]
    expect(next[0].source).toBe('lfo2')
    expect(next[0].destination).toBe('lpfFrequency')
  })

  test('add from empty creates the first cable', async () => {
    const wrapper = mountMatrix({ cables: [] })
    await wrapper.find('[data-testid="add-cable"]').trigger('click')
    const emitted = wrapper.emitted('update:cables')!
    const next = emitted[0][0] as PatchCable[]
    expect(next).toHaveLength(1)
  })

  test('remove button emits update:cables without the removed cable', async () => {
    const initial = [
      cable('envelope1', 'volume', 10),
      cable('lfo1', 'pan', -5),
      cable('velocity', 'lpfFrequency', 20),
    ]
    const wrapper = mountMatrix({ cables: initial })
    const removes = wrapper.findAll('[data-testid="remove-cable"]')
    expect(removes).toHaveLength(3)
    await removes[1].trigger('click')

    const emitted = wrapper.emitted('update:cables')!
    const next = emitted[0][0] as PatchCable[]
    expect(next).toHaveLength(2)
    expect(next[0]).toEqual(initial[0])
    expect(next[1]).toEqual(initial[2])
  })

  test('remove does not mutate original cables array', async () => {
    const initial = [cable('envelope1', 'volume', 10), cable('lfo1', 'pan', -5)]
    const wrapper = mountMatrix({ cables: initial })
    await wrapper.findAll('[data-testid="remove-cable"]')[0].trigger('click')
    expect(initial).toHaveLength(2)
  })
})

describe('ModMatrix depth editing', () => {
  test('depth slider emits update:cables with changed hex amount', async () => {
    const initial = [cable('envelope1', 'volume', 0)]
    const wrapper = mountMatrix({ cables: initial })
    const slider = wrapper.find('input[type="range"]')
    expect(slider.exists()).toBe(true)
    await slider.setValue(23)

    const emitted = wrapper.emitted('update:cables')!
    const next = emitted[0][0] as PatchCable[]
    expect(next).toHaveLength(1)
    expect(next[0].source).toBe('envelope1')
    expect(next[0].destination).toBe('volume')
    expect(next[0].amount).toMatch(/^0x[0-9A-F]{8}$/)
    expect(hexToDisplayLinear(next[0].amount!, -50, 50)).toBe(23)
  })

  test('depth number input emits update:cables with new hex amount', async () => {
    const initial = [cable('lfo1', 'pan', 0)]
    const wrapper = mountMatrix({ cables: initial })
    const numeric = wrapper.find('input[type="number"]')
    await numeric.setValue(-30)
    await numeric.trigger('change')

    const emitted = wrapper.emitted('update:cables')!
    const next = emitted[0][0] as PatchCable[]
    expect(hexToDisplayLinear(next[0].amount!, -50, 50)).toBe(-30)
  })

  test('depth input clamps out-of-range values', async () => {
    const initial = [cable('envelope1', 'volume', 0)]
    const wrapper = mountMatrix({ cables: initial })
    const numeric = wrapper.find('input[type="number"]')
    await numeric.setValue(9999)
    await numeric.trigger('change')

    const emitted = wrapper.emitted('update:cables')!
    const next = emitted[0][0] as PatchCable[]
    expect(hexToDisplayLinear(next[0].amount!, -50, 50)).toBe(50)
  })

  test('round-trip: depth 23 emitted hex decodes back to 23', async () => {
    const initial = [cable('envelope1', 'volume', 0)]
    const wrapper = mountMatrix({ cables: initial })
    const numeric = wrapper.find('input[type="number"]')
    await numeric.setValue(23)
    await numeric.trigger('change')

    const emitted = wrapper.emitted('update:cables')!
    const next = emitted[0][0] as PatchCable[]
    expect(next[0].amount).toMatch(/^0x[0-9A-F]{8}$/)
    expect(hexToDisplayLinear(next[0].amount!, -50, 50)).toBe(23)
  })
})

describe('ModMatrix source/destination editing', () => {
  test('source select emits update:cables with new source', async () => {
    const initial = [cable('envelope1', 'volume', 15)]
    const wrapper = mountMatrix({ cables: initial })
    const selects = wrapper.findAll('select')
    expect(selects.length).toBeGreaterThanOrEqual(1)
    await selects[0].setValue('lfo1')

    const emitted = wrapper.emitted('update:cables')!
    const next = emitted[0][0] as PatchCable[]
    expect(next[0].source).toBe('lfo1')
    // Destination and amount preserved
    expect(next[0].destination).toBe('volume')
    expect(next[0].amount).toBe(initial[0].amount)
  })

  test('destination select emits update:cables with new destination', async () => {
    const initial = [cable('envelope1', 'volume', 15)]
    const wrapper = mountMatrix({ cables: initial })
    const selects = wrapper.findAll('select')
    expect(selects.length).toBeGreaterThanOrEqual(2)
    await selects[1].setValue('pan')

    const emitted = wrapper.emitted('update:cables')!
    const next = emitted[0][0] as PatchCable[]
    expect(next[0].destination).toBe('pan')
    expect(next[0].source).toBe('envelope1')
  })
})

describe('ModMatrix depth bar rendering', () => {
  test('positive depth renders positive fill with proportional width', () => {
    const wrapper = mountMatrix({ cables: [cable('envelope1', 'volume', 25)] })
    const pos = wrapper.find('[data-testid="depth-bar-pos"]')
    expect(pos.exists()).toBe(true)
    const style = pos.attributes('style') ?? ''
    // 25 / 50 = 50%
    expect(style).toContain('width: 50%')
    expect(wrapper.find('[data-testid="depth-bar-neg"]').exists()).toBe(false)
  })

  test('negative depth renders negative fill with proportional width', () => {
    const wrapper = mountMatrix({ cables: [cable('lfo1', 'pan', -40)] })
    const neg = wrapper.find('[data-testid="depth-bar-neg"]')
    expect(neg.exists()).toBe(true)
    const style = neg.attributes('style') ?? ''
    // 40 / 50 = 80%
    expect(style).toContain('width: 80%')
    expect(wrapper.find('[data-testid="depth-bar-pos"]').exists()).toBe(false)
  })

  test('zero depth renders neither positive nor negative fill', () => {
    const wrapper = mountMatrix({ cables: [cable('envelope1', 'volume', 0)] })
    expect(wrapper.find('[data-testid="depth-bar-pos"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="depth-bar-neg"]').exists()).toBe(false)
  })

  test('max depth renders 100% wide bar', () => {
    const wrapper = mountMatrix({ cables: [cable('velocity', 'volume', 50)] })
    const pos = wrapper.find('[data-testid="depth-bar-pos"]')
    const style = pos.attributes('style') ?? ''
    expect(style).toContain('width: 100%')
  })
})

describe('ModMatrix readonly mode', () => {
  test('readonly hides add button', () => {
    const wrapper = mountMatrix({ cables: [], readonly: true })
    expect(wrapper.find('[data-testid="add-cable"]').exists()).toBe(false)
  })

  test('readonly hides remove buttons', () => {
    const wrapper = mountMatrix({
      cables: [cable('envelope1', 'volume', 10)],
      readonly: true,
    })
    expect(wrapper.find('[data-testid="remove-cable"]').exists()).toBe(false)
  })

  test('readonly removes all editable inputs and emits nothing', () => {
    const wrapper = mountMatrix({
      cables: [cable('envelope1', 'volume', 10)],
      readonly: true,
    })
    expect(wrapper.findAll('select')).toHaveLength(0)
    expect(wrapper.findAll('input')).toHaveLength(0)
    expect(wrapper.emitted('update:cables')).toBeUndefined()
  })
})
