import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EncoderWheel from '@/components/hardware/EncoderWheel.vue'

describe('EncoderWheel rendering', () => {
  test('label is shown', () => {
    const wrapper = mount(EncoderWheel, { props: { label: 'Tempo' } })
    expect(wrapper.text()).toContain('Tempo')
  })

  test('default size is 60×60', () => {
    const wrapper = mount(EncoderWheel, { props: { label: 'X' } })
    const disc = wrapper.find('.encoder > div')
    expect((disc.element as HTMLElement).style.width).toBe('60px')
    expect((disc.element as HTMLElement).style.height).toBe('60px')
  })
})

describe('EncoderWheel turn events', () => {
  test('wheel down emits turn(+1)', async () => {
    const wrapper = mount(EncoderWheel, { props: { label: 'x' } })
    // Vue Test Utils doesn't dispatch wheel via trigger reliably — dispatch
    // directly on the disc element.
    const disc = wrapper.find('.encoder > div').element
    const event = new WheelEvent('wheel', { deltaY: 20 })
    disc.dispatchEvent(event)
    const emitted = wrapper.emitted('turn')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual([1])
  })

  test('wheel up emits turn(-1)', async () => {
    const wrapper = mount(EncoderWheel, { props: { label: 'x' } })
    const disc = wrapper.find('.encoder > div').element
    const event = new WheelEvent('wheel', { deltaY: -20 })
    disc.dispatchEvent(event)
    expect(wrapper.emitted('turn')![0]).toEqual([-1])
  })
})

describe('EncoderWheel press events', () => {
  test('mousedown emits press', async () => {
    const wrapper = mount(EncoderWheel, { props: { label: 'x', pushable: true } })
    await wrapper.find('.encoder > div').trigger('mousedown')
    expect(wrapper.emitted('press')).toBeTruthy()
  })

  test('non-pushable encoders do not emit press', async () => {
    const wrapper = mount(EncoderWheel, { props: { label: 'x', pushable: false } })
    await wrapper.find('.encoder > div').trigger('mousedown')
    expect(wrapper.emitted('press')).toBeUndefined()
  })
})
