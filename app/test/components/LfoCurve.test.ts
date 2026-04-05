// Component tests for LfoCurve.
// Verifies that each supported waveform type renders a non-empty SVG path,
// that the data-lfo-type attribute mirrors the prop, and that the cycles
// prop affects the path geometry.

import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LfoCurve from '@/components/sound-editor/LfoCurve.vue'

const TYPES = ['sine', 'triangle', 'saw', 'square', 'sampleAndHold', 'random']

describe('LfoCurve rendering', () => {
  test('renders root element with test id', () => {
    const wrapper = mount(LfoCurve, { props: { type: 'sine' } })
    expect(wrapper.attributes('data-testid')).toBe('lfo-curve')
  })

  test.each(TYPES)('renders a non-empty path for %s', (type) => {
    const wrapper = mount(LfoCurve, { props: { type } })
    const paths = wrapper.findAll('path')
    expect(paths.length).toBeGreaterThanOrEqual(1)
    const d = paths[paths.length - 1].attributes('d') ?? ''
    expect(d.length).toBeGreaterThan(0)
    expect(d.startsWith('M')).toBe(true)
    // Must contain at least one L (line) command.
    expect(/\sL\s/.test(d)).toBe(true)
  })

  test.each(TYPES)('data-lfo-type mirrors the type prop for %s', (type) => {
    const wrapper = mount(LfoCurve, { props: { type } })
    expect(wrapper.attributes('data-lfo-type')).toBe(type)
  })

  test('applies the color prop to the waveform stroke', () => {
    const wrapper = mount(LfoCurve, { props: { type: 'sine', color: '#378ADD' } })
    const waveform = wrapper.findAll('path').pop()!
    expect(waveform.attributes('stroke')).toBe('#378ADD')
  })

  test('unknown type falls back to a sine curve', () => {
    const wrapper = mount(LfoCurve, { props: { type: 'nonsense' } })
    const d = wrapper.find('path').attributes('d') ?? ''
    expect(d.length).toBeGreaterThan(0)
  })
})

describe('LfoCurve viewport', () => {
  test('compact mode uses 140x40', () => {
    const wrapper = mount(LfoCurve, { props: { type: 'sine', compact: true } })
    const svg = wrapper.find('svg')
    expect(svg.attributes('width')).toBe('140')
    expect(svg.attributes('height')).toBe('40')
    expect(svg.attributes('viewBox')).toBe('0 0 140 40')
  })

  test('normal mode uses 280x80', () => {
    const wrapper = mount(LfoCurve, { props: { type: 'sine', compact: false } })
    const svg = wrapper.find('svg')
    expect(svg.attributes('width')).toBe('280')
    expect(svg.attributes('height')).toBe('80')
    expect(svg.attributes('viewBox')).toBe('0 0 280 80')
  })
})

describe('LfoCurve cycles scaling', () => {
  function countPoints(d: string): number {
    return (d.match(/[ML]\s*-?\d/g) ?? []).length
  }

  test('more cycles produce more points for a sine wave', () => {
    const two = mount(LfoCurve, { props: { type: 'sine', cycles: 2 } })
    const four = mount(LfoCurve, { props: { type: 'sine', cycles: 4 } })
    const dTwo = two.find('path').attributes('d') ?? ''
    const dFour = four.find('path').attributes('d') ?? ''
    expect(countPoints(dFour)).toBeGreaterThan(countPoints(dTwo))
  })

  test('triangle with 3 cycles has three peaks', () => {
    const wrapper = mount(LfoCurve, { props: { type: 'triangle', cycles: 3 } })
    const d = wrapper.find('path').attributes('d') ?? ''
    // triangle path per cycle has 3 L segments: up, down, back to zero
    const lineCount = (d.match(/\sL\s/g) ?? []).length
    expect(lineCount).toBe(3 * 3)
  })

  test('sampleAndHold is deterministic between renders', () => {
    const a = mount(LfoCurve, { props: { type: 'sampleAndHold', cycles: 2 } })
    const b = mount(LfoCurve, { props: { type: 'sampleAndHold', cycles: 2 } })
    expect(a.find('path').attributes('d')).toBe(b.find('path').attributes('d'))
  })

  test('random is deterministic between renders', () => {
    const a = mount(LfoCurve, { props: { type: 'random', cycles: 2 } })
    const b = mount(LfoCurve, { props: { type: 'random', cycles: 2 } })
    expect(a.find('path').attributes('d')).toBe(b.find('path').attributes('d'))
  })
})
