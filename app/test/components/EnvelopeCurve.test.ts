// Component tests for EnvelopeCurve.
// Verifies rendering, prop reactivity, interactive slider emission, and
// that the sustain level is held horizontally between the decay and
// release segments.

import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EnvelopeCurve from '@/components/sound-editor/EnvelopeCurve.vue'

function mountEnv(overrides: Record<string, unknown> = {}) {
  return mount(EnvelopeCurve, {
    props: {
      attack: 10,
      decay: 20,
      sustain: 30,
      release: 15,
      ...overrides,
    },
  })
}

describe('EnvelopeCurve rendering', () => {
  test('renders root element with test id and an SVG path', () => {
    const wrapper = mountEnv()
    expect(wrapper.attributes('data-testid')).toBe('envelope-curve')
    expect(wrapper.find('path').exists()).toBe(true)
  })

  test('path draws five line segments starting with M', () => {
    const wrapper = mountEnv()
    const paths = wrapper.findAll('path')
    // fill path is first, stroke path is second; both contain the A-D-S-R shape
    const strokeD = paths[1].attributes('d') ?? ''
    expect(strokeD.startsWith('M')).toBe(true)
    const lineCount = (strokeD.match(/ L /g) ?? []).length
    expect(lineCount).toBe(4)
  })

  test('uses the supplied color for stroke', () => {
    const wrapper = mountEnv({ color: '#D85A30' })
    const stroke = wrapper.findAll('path')[1].attributes('stroke')
    expect(stroke).toBe('#D85A30')
  })

  test('reacts to prop changes', async () => {
    const wrapper = mountEnv({ attack: 5, decay: 5, sustain: 25, release: 5 })
    const before = wrapper.findAll('path')[1].attributes('d')
    await wrapper.setProps({ attack: 40 })
    const after = wrapper.findAll('path')[1].attributes('d')
    expect(after).not.toBe(before)
  })
})

describe('EnvelopeCurve viewport', () => {
  test('compact mode uses 140x40 viewBox', () => {
    const wrapper = mountEnv({ compact: true })
    const svg = wrapper.find('svg')
    expect(svg.attributes('width')).toBe('140')
    expect(svg.attributes('height')).toBe('40')
    expect(svg.attributes('viewBox')).toBe('0 0 140 40')
  })

  test('normal mode uses 280x140 viewBox', () => {
    const wrapper = mountEnv({ compact: false })
    const svg = wrapper.find('svg')
    expect(svg.attributes('width')).toBe('280')
    expect(svg.attributes('height')).toBe('140')
    expect(svg.attributes('viewBox')).toBe('0 0 280 140')
  })
})

describe('EnvelopeCurve geometry', () => {
  function parsePoints(d: string): Array<{ x: number; y: number }> {
    // Matches numbers after M or L commands.
    const tokens = d.match(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g) ?? []
    return tokens.map((t) => {
      const m = t.match(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/)!
      return { x: Number(m[1]), y: Number(m[2]) }
    })
  }

  test('sustain level is held horizontally between decay end and sustain end', () => {
    const wrapper = mountEnv({ attack: 10, decay: 10, sustain: 30, release: 10 })
    const d = wrapper.findAll('path')[1].attributes('d') ?? ''
    const pts = parsePoints(d)
    expect(pts.length).toBe(5)
    // points: [start, peak, decayEnd, sustainEnd, releaseEnd]
    // decayEnd.y === sustainEnd.y (sustain is held)
    expect(pts[2].y).toBeCloseTo(pts[3].y, 5)
    // sustainEnd.x > decayEnd.x (the hold has width)
    expect(pts[3].x).toBeGreaterThan(pts[2].x)
  })

  test('peak is at the top and start/release-end are at the bottom', () => {
    const wrapper = mountEnv({ attack: 10, decay: 10, sustain: 25, release: 10 })
    const d = wrapper.findAll('path')[1].attributes('d') ?? ''
    const pts = parsePoints(d)
    // peak has the smallest y (SVG y grows down = top)
    const minY = Math.min(...pts.map((p) => p.y))
    expect(pts[1].y).toBeCloseTo(minY, 5)
    // start and release end share the same y (bottom)
    expect(pts[0].y).toBeCloseTo(pts[4].y, 5)
  })

  test('higher sustain produces a higher (smaller y) sustain line', () => {
    const low = mountEnv({ attack: 10, decay: 10, sustain: 5, release: 10 })
    const high = mountEnv({ attack: 10, decay: 10, sustain: 45, release: 10 })
    const lowD = low.findAll('path')[1].attributes('d') ?? ''
    const highD = high.findAll('path')[1].attributes('d') ?? ''
    const lowPts = parsePoints(lowD)
    const highPts = parsePoints(highD)
    // higher sustain = smaller y (closer to top)
    expect(highPts[2].y).toBeLessThan(lowPts[2].y)
  })
})

describe('EnvelopeCurve interactive mode', () => {
  test('sliders are hidden by default', () => {
    const wrapper = mountEnv({ interactive: false })
    expect(wrapper.find('.envelope-sliders').exists()).toBe(false)
    expect(wrapper.find('input[type="range"]').exists()).toBe(false)
  })

  test('shows four sliders when interactive', () => {
    const wrapper = mountEnv({ interactive: true })
    expect(wrapper.find('.envelope-sliders').exists()).toBe(true)
    const sliders = wrapper.findAll('input[type="range"]')
    expect(sliders.length).toBe(4)
    const stages = sliders.map((s) => s.attributes('data-stage'))
    expect(stages).toEqual(['attack', 'decay', 'sustain', 'release'])
  })

  test('each slider emits the corresponding update event', async () => {
    const wrapper = mountEnv({ interactive: true })
    const attackSlider = wrapper.find('input[data-stage="attack"]')
    await attackSlider.setValue(42)
    expect(wrapper.emitted('update:attack')).toBeTruthy()
    expect(wrapper.emitted('update:attack')![0]).toEqual([42])

    const decaySlider = wrapper.find('input[data-stage="decay"]')
    await decaySlider.setValue(7)
    expect(wrapper.emitted('update:decay')![0]).toEqual([7])

    const sustainSlider = wrapper.find('input[data-stage="sustain"]')
    await sustainSlider.setValue(50)
    expect(wrapper.emitted('update:sustain')![0]).toEqual([50])

    const releaseSlider = wrapper.find('input[data-stage="release"]')
    await releaseSlider.setValue(0)
    expect(wrapper.emitted('update:release')![0]).toEqual([0])
  })

  test('slider clamps out-of-range input', async () => {
    const wrapper = mountEnv({ interactive: true })
    const slider = wrapper.find('input[data-stage="attack"]')
    // input[type=range] clamps natively, but the component also clamps.
    // Force an out-of-range value via DOM.
    ;(slider.element as HTMLInputElement).value = '9999'
    await slider.trigger('input')
    const emitted = wrapper.emitted('update:attack')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toBe(50)
  })
})
