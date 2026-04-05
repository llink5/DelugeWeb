// ArpeggiatorPanel tests: mode/octaves/sync editing plus rate/gate knobs.

import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ArpeggiatorPanel from '@/components/sound-editor/ArpeggiatorPanel.vue'

function makeSound(
  overrides: { mode?: string; numOctaves?: string; syncLevel?: string } = {},
  defaultParams: Record<string, string> = {},
): Record<string, unknown> {
  return {
    arpeggiator: {
      mode: 'off',
      numOctaves: '2',
      syncLevel: '7',
      ...overrides,
    },
    defaultParams: {
      arpeggiatorRate: '0x00000000',
      arpeggiatorGate: '0x00000000',
      ...defaultParams,
    },
  }
}

describe('ArpeggiatorPanel rendering', () => {
  test('renders with mode/octaves/sync controls', () => {
    const wrapper = mount(ArpeggiatorPanel, { props: { sound: makeSound() } })
    expect(wrapper.find('[data-testid="arpeggiator-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="arp-mode"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="arp-octaves"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="arp-sync"]').exists()).toBe(true)
  })

  test('reflects mode from sound', () => {
    const wrapper = mount(ArpeggiatorPanel, {
      props: { sound: makeSound({ mode: 'up' }) },
    })
    const modeSelect = wrapper.find('[data-testid="arp-mode"]').element as HTMLSelectElement
    expect(modeSelect.value).toBe('up')
  })

  test('reflects octaves from sound', () => {
    const wrapper = mount(ArpeggiatorPanel, {
      props: { sound: makeSound({ numOctaves: '4' }) },
    })
    const input = wrapper.find('[data-testid="arp-octaves"]').element as HTMLInputElement
    expect(input.value).toBe('4')
  })

  test('reflects sync level from sound', () => {
    const wrapper = mount(ArpeggiatorPanel, {
      props: { sound: makeSound({ syncLevel: '5' }) },
    })
    const select = wrapper.find('[data-testid="arp-sync"]').element as HTMLSelectElement
    expect(select.value).toBe('5')
  })

  test('renders rate and gate knobs', () => {
    const wrapper = mount(ArpeggiatorPanel, { props: { sound: makeSound() } })
    expect(wrapper.find('[data-param-path="arpeggiatorRate"]').exists()).toBe(true)
    expect(wrapper.find('[data-param-path="arpeggiatorGate"]').exists()).toBe(true)
  })
})

describe('ArpeggiatorPanel editing', () => {
  test('changing mode emits update:sound with new mode', async () => {
    const sound = makeSound({ mode: 'off' })
    const wrapper = mount(ArpeggiatorPanel, { props: { sound } })
    await wrapper.find('[data-testid="arp-mode"]').setValue('random')
    const emitted = wrapper.emitted('update:sound')
    expect(emitted).toBeTruthy()
    const next = emitted![0][0] as Record<string, unknown>
    const arp = next.arpeggiator as Record<string, unknown>
    expect(arp.mode).toBe('random')
    // Other fields preserved
    expect(arp.numOctaves).toBe('2')
    expect(arp.syncLevel).toBe('7')
  })

  test('changing octaves clamps to 1..8', async () => {
    const sound = makeSound()
    const wrapper = mount(ArpeggiatorPanel, { props: { sound } })
    const input = wrapper.find('[data-testid="arp-octaves"]')
    await input.setValue('99')
    await input.trigger('change')
    const emitted = wrapper.emitted('update:sound')!
    const next = emitted[0][0] as Record<string, unknown>
    const arp = next.arpeggiator as Record<string, unknown>
    expect(arp.numOctaves).toBe('8')
  })

  test('changing sync level emits update:sound', async () => {
    const sound = makeSound({ syncLevel: '7' })
    const wrapper = mount(ArpeggiatorPanel, { props: { sound } })
    await wrapper.find('[data-testid="arp-sync"]').setValue('5')
    const emitted = wrapper.emitted('update:sound')!
    const next = emitted[0][0] as Record<string, unknown>
    const arp = next.arpeggiator as Record<string, unknown>
    expect(arp.syncLevel).toBe('5')
  })

  test('does not mutate the input sound object', async () => {
    const sound = makeSound({ mode: 'off' })
    const wrapper = mount(ArpeggiatorPanel, { props: { sound } })
    await wrapper.find('[data-testid="arp-mode"]').setValue('up')
    const arp = sound.arpeggiator as Record<string, unknown>
    expect(arp.mode).toBe('off')
  })
})

describe('ArpeggiatorPanel readonly mode', () => {
  test('readonly disables all inputs', () => {
    const wrapper = mount(ArpeggiatorPanel, {
      props: { sound: makeSound(), readonly: true },
    })
    expect(
      (wrapper.find('[data-testid="arp-mode"]').element as HTMLSelectElement).disabled,
    ).toBe(true)
    expect(
      (wrapper.find('[data-testid="arp-octaves"]').element as HTMLInputElement).disabled,
    ).toBe(true)
    expect(
      (wrapper.find('[data-testid="arp-sync"]').element as HTMLSelectElement).disabled,
    ).toBe(true)
  })

  test('readonly prevents emissions', async () => {
    const wrapper = mount(ArpeggiatorPanel, {
      props: { sound: makeSound(), readonly: true },
    })
    await wrapper.find('[data-testid="arp-mode"]').trigger('change')
    expect(wrapper.emitted('update:sound')).toBeUndefined()
  })
})

describe('ArpeggiatorPanel missing arpeggiator element', () => {
  test('renders defaults when sound has no arpeggiator', () => {
    const wrapper = mount(ArpeggiatorPanel, {
      props: { sound: { defaultParams: {} } },
    })
    const modeSelect = wrapper.find('[data-testid="arp-mode"]').element as HTMLSelectElement
    expect(modeSelect.value).toBe('off')
  })
})
