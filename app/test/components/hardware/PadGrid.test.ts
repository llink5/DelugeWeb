import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PadGrid from '@/components/hardware/PadGrid.vue'

function makeColours(n = 136): Uint8Array {
  return new Uint8Array(n * 3)
}

describe('PadGrid layout', () => {
  test('renders 128 pads in the main grid plus 8 audition pads by default', () => {
    const wrapper = mount(PadGrid, { props: { colours: makeColours() } })
    const pads = wrapper.findAll('[data-pad-x]')
    expect(pads).toHaveLength(16 * 8)
    const audition = wrapper.findAll('[data-audition-row]')
    expect(audition).toHaveLength(8)
  })

  test('hides audition when hasAudition=false', () => {
    const wrapper = mount(PadGrid, {
      props: { colours: makeColours(), hasAudition: false },
    })
    expect(wrapper.find('[data-testid="pad-audition"]').exists()).toBe(false)
  })

  test('cols/rows override grid dimensions', () => {
    const wrapper = mount(PadGrid, {
      props: { colours: makeColours(32), cols: 8, rows: 4, hasAudition: false },
    })
    expect(wrapper.findAll('[data-pad-x]')).toHaveLength(32)
  })
})

describe('PadGrid colours', () => {
  test('renders colour from buffer', () => {
    const colours = makeColours()
    // Pad (0, 0) → index 0 → buffer[0..2]
    colours[0] = 200
    colours[1] = 50
    colours[2] = 100
    const wrapper = mount(PadGrid, { props: { colours } })
    const pad = wrapper.find('[data-pad-x="0"][data-pad-y="0"]')
    const bg = (pad.element as HTMLElement).style.backgroundColor
    expect(bg).toMatch(/rgb\(200,\s*50,\s*100\)/)
  })

  test('zero colour renders as dark grey, not black', () => {
    const wrapper = mount(PadGrid, { props: { colours: makeColours() } })
    const pad = wrapper.find('[data-pad-x="5"][data-pad-y="3"]')
    const bg = (pad.element as HTMLElement).style.backgroundColor
    // Vue normalises to rgb() form
    expect(bg.startsWith('rgb(26') || bg === '#1a1a1a').toBe(true)
  })

  test('audition pad picks colour from index 128..135', () => {
    const colours = makeColours()
    // Audition row 2 → index 128 + 2 = 130
    colours[130 * 3] = 123
    colours[130 * 3 + 1] = 45
    colours[130 * 3 + 2] = 67
    const wrapper = mount(PadGrid, { props: { colours } })
    const pad = wrapper.find('[data-audition-row="2"]')
    const bg = (pad.element as HTMLElement).style.backgroundColor
    expect(bg).toMatch(/rgb\(123,\s*45,\s*67\)/)
  })
})

describe('PadGrid events', () => {
  test('pad-press emits x, y, velocity on mousedown', async () => {
    const wrapper = mount(PadGrid, { props: { colours: makeColours() } })
    await wrapper
      .find('[data-pad-x="3"][data-pad-y="2"]')
      .trigger('mousedown', { clientY: 14 })
    const emitted = wrapper.emitted('pad-press')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toBe(3)
    expect(emitted![0][1]).toBe(2)
    const velocity = emitted![0][2] as number
    expect(velocity).toBeGreaterThanOrEqual(1)
    expect(velocity).toBeLessThanOrEqual(127)
  })

  test('pad-release emits x, y on mouseup', async () => {
    const wrapper = mount(PadGrid, { props: { colours: makeColours() } })
    await wrapper
      .find('[data-pad-x="0"][data-pad-y="0"]')
      .trigger('mouseup')
    const emitted = wrapper.emitted('pad-release')
    expect(emitted![0]).toEqual([0, 0])
  })

  test('audition-press / audition-release events', async () => {
    const wrapper = mount(PadGrid, { props: { colours: makeColours() } })
    await wrapper
      .find('[data-audition-row="4"]')
      .trigger('mousedown', { clientY: 14 })
    expect(wrapper.emitted('audition-press')![0][0]).toBe(4)
    await wrapper.find('[data-audition-row="4"]').trigger('mouseup')
    expect(wrapper.emitted('audition-release')![0][0]).toBe(4)
  })

  test('mouseleave fires release to prevent stuck pads', async () => {
    const wrapper = mount(PadGrid, { props: { colours: makeColours() } })
    await wrapper
      .find('[data-pad-x="5"][data-pad-y="5"]')
      .trigger('mouseleave')
    expect(wrapper.emitted('pad-release')![0]).toEqual([5, 5])
  })
})

describe('PadGrid active state', () => {
  test('active pads get the pressed styling class', () => {
    const active = new Set([0, 17, 127]) // (0,0), (1,1), (15,7)
    const wrapper = mount(PadGrid, {
      props: { colours: makeColours(), activePads: active },
    })
    const pad0 = wrapper.find('[data-pad-x="0"][data-pad-y="0"]')
    expect(pad0.classes().join(' ')).toContain('border-white')
    const pad1 = wrapper.find('[data-pad-x="1"][data-pad-y="1"]')
    expect(pad1.classes().join(' ')).toContain('border-white')
    const inactive = wrapper.find('[data-pad-x="2"][data-pad-y="2"]')
    expect(inactive.classes().join(' ')).toContain('border-black')
  })
})
