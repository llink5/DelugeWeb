import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ButtonBar, { type HardwareButton } from '@/components/hardware/ButtonBar.vue'

const SAMPLE: HardwareButton[] = [
  { id: 'play', label: 'Play', hasLed: true, accent: 'primary' },
  { id: 'record', label: 'Record', hasLed: true, accent: 'danger' },
  { id: 'shift', label: 'Shift', accent: 'mod' },
]

describe('ButtonBar rendering', () => {
  test('renders one button per entry', () => {
    const wrapper = mount(ButtonBar, { props: { buttons: SAMPLE } })
    expect(wrapper.findAll('[data-button-id]')).toHaveLength(3)
  })

  test('label text is shown', () => {
    const wrapper = mount(ButtonBar, { props: { buttons: SAMPLE } })
    expect(wrapper.find('[data-button-id="play"]').text()).toContain('Play')
    expect(wrapper.find('[data-button-id="shift"]').text()).toContain('Shift')
  })

  test('LED dot appears only when hasLed is true', () => {
    const wrapper = mount(ButtonBar, { props: { buttons: SAMPLE } })
    const playLed = wrapper.find('[data-button-id="play"] [data-led-state]')
    expect(playLed.exists()).toBe(true)
    const shiftLed = wrapper.find('[data-button-id="shift"] [data-led-state]')
    expect(shiftLed.exists()).toBe(false)
  })

  test('LED state reflects ledState prop', () => {
    const wrapper = mount(ButtonBar, {
      props: {
        buttons: SAMPLE,
        ledState: { play: 'on', record: 'blink' },
      },
    })
    const playLed = wrapper.find('[data-button-id="play"] [data-led-state]')
    expect(playLed.attributes('data-led-state')).toBe('on')
    const recordLed = wrapper.find('[data-button-id="record"] [data-led-state]')
    expect(recordLed.attributes('data-led-state')).toBe('blink')
  })
})

describe('ButtonBar events', () => {
  test('button-press fires on mousedown', async () => {
    const wrapper = mount(ButtonBar, { props: { buttons: SAMPLE } })
    await wrapper.find('[data-button-id="play"]').trigger('mousedown')
    expect(wrapper.emitted('button-press')![0]).toEqual(['play'])
  })

  test('button-release fires on mouseup', async () => {
    const wrapper = mount(ButtonBar, { props: { buttons: SAMPLE } })
    await wrapper.find('[data-button-id="record"]').trigger('mouseup')
    expect(wrapper.emitted('button-release')![0]).toEqual(['record'])
  })

  test('mouseleave fires release', async () => {
    const wrapper = mount(ButtonBar, { props: { buttons: SAMPLE } })
    await wrapper.find('[data-button-id="shift"]').trigger('mouseleave')
    expect(wrapper.emitted('button-release')![0]).toEqual(['shift'])
  })
})

describe('ButtonBar pressed state', () => {
  test('pressed buttons carry the data-pressed attribute', () => {
    const wrapper = mount(ButtonBar, {
      props: {
        buttons: SAMPLE,
        pressed: new Set(['shift']),
      },
    })
    expect(
      wrapper.find('[data-button-id="shift"]').attributes('data-pressed'),
    ).toBe('true')
    expect(
      wrapper.find('[data-button-id="play"]').attributes('data-pressed'),
    ).toBeUndefined()
  })
})
