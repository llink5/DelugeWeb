import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import VirtualHardwareView from '@/modules/virtual-hardware/VirtualHardwareView.vue'

describe('VirtualHardwareView pad interaction', () => {
  test('mousedown on a pad emits pad-press with x, y, velocity', async () => {
    const wrapper = mount(VirtualHardwareView, {
      props: { keyboardShortcuts: false },
    })
    const pad = wrapper.find('[data-pad-x="3"][data-pad-y="2"]')
    expect(pad.exists()).toBe(true)

    await pad.trigger('mousedown', { clientY: 14 })

    const emitted = wrapper.emitted('pad-press')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toBe(3) // x
    expect(emitted![0][1]).toBe(2) // y
    expect(typeof emitted![0][2]).toBe('number') // velocity
  })

  test('pad gets active styling while held', async () => {
    const wrapper = mount(VirtualHardwareView, {
      props: { keyboardShortcuts: false },
    })
    const pad = wrapper.find('[data-pad-x="5"][data-pad-y="3"]')

    await pad.trigger('mousedown', { clientY: 14 })
    // After mousedown, the pad should have active classes
    const classes = pad.classes().join(' ')
    expect(classes).toContain('border-white')
    expect(classes).toContain('scale-95')
  })

  test('pad loses active styling on mouseup', async () => {
    const wrapper = mount(VirtualHardwareView, {
      props: { keyboardShortcuts: false },
    })
    const pad = wrapper.find('[data-pad-x="5"][data-pad-y="3"]')

    await pad.trigger('mousedown', { clientY: 14 })
    await pad.trigger('mouseup')

    const classes = pad.classes().join(' ')
    expect(classes).toContain('border-black')
    expect(classes).not.toContain('scale-95')
  })

  test('mousedown on a button emits button-press', async () => {
    const wrapper = mount(VirtualHardwareView, {
      props: { keyboardShortcuts: false },
    })
    const btn = wrapper.find('[data-button-id]')
    expect(btn.exists()).toBe(true)
    const id = btn.attributes('data-button-id')!

    await btn.trigger('mousedown')
    const emitted = wrapper.emitted('button-press')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toBe(id)
  })

  test('encoder wheel event emits encoder-turn', async () => {
    const wrapper = mount(VirtualHardwareView, {
      props: { keyboardShortcuts: false },
    })
    const encoder = wrapper.find('[data-testid="encoder-wheel"]')
    expect(encoder.exists()).toBe(true)

    // The wheel is on the inner div
    const wheel = encoder.find('.cursor-pointer')
    await wheel.trigger('wheel', { deltaY: 100 })

    const emitted = wrapper.emitted('encoder-turn')
    expect(emitted).toBeTruthy()
  })
})
