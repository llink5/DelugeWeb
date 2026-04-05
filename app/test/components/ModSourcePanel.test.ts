// Component tests for ModSourcePanel.
// Verifies route pill rendering, depth display, and navigate emissions.

import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ModSourcePanel from '@/components/sound-editor/ModSourcePanel.vue'
import type { PatchCable } from '@/lib/values/patchCables'
import { displayToHexLinear } from '@/lib/values/paramMeta'

function depthHex(depth: number): string {
  return displayToHexLinear(depth, -50, 50)
}

function cable(source: string, destination: string, depth: number): PatchCable {
  return { source, destination, amount: depthHex(depth) }
}

describe('ModSourcePanel rendering', () => {
  test('renders source label and colour dot in header', () => {
    const wrapper = mount(ModSourcePanel, {
      props: { sourceId: 'envelope1', cables: [] },
    })
    expect(wrapper.text()).toContain('Env 1')
    expect(wrapper.attributes('data-source')).toBe('envelope1')
  })

  test('shows "unused" when source has no routes', () => {
    const wrapper = mount(ModSourcePanel, {
      props: {
        sourceId: 'envelope1',
        cables: [cable('lfo1', 'volume', 10)],
      },
    })
    expect(wrapper.find('[data-testid="no-routes"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('unused')
  })

  test('renders one pill per matching route', () => {
    const cables = [
      cable('envelope1', 'volume', 20),
      cable('envelope1', 'lpfFrequency', -10),
      cable('lfo1', 'pan', 5), // different source — should not appear
    ]
    const wrapper = mount(ModSourcePanel, {
      props: { sourceId: 'envelope1', cables },
    })
    const pills = wrapper.findAll('[data-destination]')
    expect(pills).toHaveLength(2)
    expect(pills[0].attributes('data-destination')).toBe('volume')
    expect(pills[1].attributes('data-destination')).toBe('lpfFrequency')
  })

  test('signed depth displayed with leading + for positive', () => {
    const wrapper = mount(ModSourcePanel, {
      props: {
        sourceId: 'envelope1',
        cables: [cable('envelope1', 'volume', 23)],
      },
    })
    expect(wrapper.text()).toContain('+23')
  })

  test('signed depth displayed with leading - for negative', () => {
    const wrapper = mount(ModSourcePanel, {
      props: {
        sourceId: 'lfo1',
        cables: [cable('lfo1', 'lpfFrequency', -17)],
      },
    })
    expect(wrapper.text()).toContain('-17')
  })

  test('pill label is humanized destination name', () => {
    const wrapper = mount(ModSourcePanel, {
      props: {
        sourceId: 'envelope1',
        cables: [cable('envelope1', 'lpfFrequency', 10)],
      },
    })
    expect(wrapper.text()).toContain('LPF Cut')
  })

  test('unknown destinations fall back to raw name', () => {
    const wrapper = mount(ModSourcePanel, {
      props: {
        sourceId: 'envelope1',
        cables: [cable('envelope1', 'someFutureParam', 10)],
      },
    })
    expect(wrapper.text()).toContain('someFutureParam')
  })
})

describe('ModSourcePanel compact mode', () => {
  test('compact hides header', () => {
    const wrapper = mount(ModSourcePanel, {
      props: {
        sourceId: 'envelope1',
        cables: [cable('envelope1', 'volume', 10)],
        compact: true,
      },
    })
    // No source label in the compact layout
    expect(wrapper.text()).not.toContain('Env 1')
    // Still shows the route pill
    expect(wrapper.text()).toContain('AMP Vol')
  })
})

describe('ModSourcePanel navigation', () => {
  test('clicking a pill emits navigate with destination and paramKey', async () => {
    const wrapper = mount(ModSourcePanel, {
      props: {
        sourceId: 'envelope1',
        cables: [cable('envelope1', 'volume', 10)],
      },
    })
    await wrapper.find('[data-destination="volume"]').trigger('click')
    const emitted = wrapper.emitted('navigate')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toBe('volume')
    expect(emitted![0][1]).toBe('volume')
  })

  test('navigate paramKey is resolved through destination mapping', async () => {
    // 'pitch' destination maps to 'pitchAdjust' param key
    const wrapper = mount(ModSourcePanel, {
      props: {
        sourceId: 'envelope2',
        cables: [cable('envelope2', 'pitch', 15)],
      },
    })
    await wrapper.find('[data-destination="pitch"]').trigger('click')
    const emitted = wrapper.emitted('navigate')!
    expect(emitted[0][0]).toBe('pitch')
    expect(emitted[0][1]).toBe('pitchAdjust')
  })
})
