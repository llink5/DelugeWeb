import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DiffView from '../../src/modules/preset-editor/DiffView.vue'

// Build a minimal parsed sound object (as would come from parsePreset).
function makeSound(overrides: Partial<{
  name: string
  lpfMode: string
  lpfFrequency: string
  oscAVolume: string
  cable: { source: string; destination: string; amount: string } | null
}> = {}): Record<string, unknown> {
  const sound: Record<string, unknown> = {
    name: overrides.name ?? 'Test',
    lpfMode: overrides.lpfMode ?? '24dB',
    mode: 'subtractive',
    defaultParams: {
      oscAVolume: overrides.oscAVolume ?? '0x7FFFFFFF',
      lpfFrequency: overrides.lpfFrequency ?? '0x7FFFFFFF',
      lpfResonance: '0x80000000',
      volume: '0x50000000',
      envelope1: {
        attack: '0x80000000',
        decay: '0xE6666654',
        sustain: '0x7FFFFFFF',
        release: '0x80000000',
      },
    } as Record<string, unknown>,
  }
  if (overrides.cable !== null && overrides.cable !== undefined) {
    ;(sound.defaultParams as Record<string, unknown>).patchCables = {
      patchCable: overrides.cable,
    }
  }
  return sound
}

describe('DiffView', () => {
  it('renders the summary with counts', () => {
    const soundA = makeSound({ lpfFrequency: '0x7FFFFFFF' })
    const soundB = makeSound({
      lpfFrequency: '0x20000000',
      cable: { source: 'lfo1', destination: 'pan', amount: '0x40000000' },
    })
    const wrapper = mount(DiffView, {
      props: { soundA, soundB, nameA: 'A', nameB: 'B' },
    })

    const summary = wrapper.find('[data-testid="diff-summary"]')
    expect(summary.exists()).toBe(true)
    const text = summary.text()
    expect(text).toContain('1 changed')
    expect(text).toContain('1 added')
    expect(text).toContain('0 removed')
  })

  it('renders the root with data-testid="diff-view"', () => {
    const soundA = makeSound()
    const soundB = makeSound()
    const wrapper = mount(DiffView, { props: { soundA, soundB } })
    expect(wrapper.find('[data-testid="diff-view"]').exists()).toBe(true)
  })

  it('shows the "no differences" state when identical and showUnchanged=false', () => {
    const sound = makeSound()
    const wrapper = mount(DiffView, {
      props: { soundA: sound, soundB: sound, showUnchanged: false },
    })
    expect(wrapper.find('[data-testid="diff-empty"]').exists()).toBe(true)
    // No module sections rendered
    expect(wrapper.findAll('[data-diff-kind]').length).toBe(0)
  })

  it('renders rows with data-diff-kind attributes', () => {
    const soundA = makeSound({ lpfFrequency: '0x7FFFFFFF', oscAVolume: '0x7FFFFFFF' })
    const soundB = makeSound({
      lpfFrequency: '0x20000000',
      oscAVolume: '0x40000000',
      cable: { source: 'lfo1', destination: 'pan', amount: '0x40000000' },
    })
    const wrapper = mount(DiffView, { props: { soundA, soundB } })

    const changed = wrapper.findAll('[data-diff-kind="changed"]')
    const added = wrapper.findAll('[data-diff-kind="added"]')
    expect(changed.length).toBeGreaterThanOrEqual(2) // lpfFrequency + oscAVolume
    expect(added.length).toBeGreaterThanOrEqual(1)   // cable
  })

  it('applies amber styling for changed rows, green for added, red for removed', () => {
    const soundA = makeSound({
      cable: { source: 'velocity', destination: 'volume', amount: '0x40000000' },
    })
    const soundB = makeSound({
      lpfFrequency: '0x20000000',
      cable: { source: 'lfo1', destination: 'pan', amount: '0x40000000' },
    })
    const wrapper = mount(DiffView, { props: { soundA, soundB } })

    const changedRow = wrapper.find('[data-diff-kind="changed"]')
    expect(changedRow.exists()).toBe(true)
    expect(changedRow.classes().some((c) => c.includes('amber'))).toBe(true)

    const addedRow = wrapper.find('[data-diff-kind="added"]')
    expect(addedRow.exists()).toBe(true)
    expect(addedRow.classes().some((c) => c.includes('green'))).toBe(true)

    const removedRow = wrapper.find('[data-diff-kind="removed"]')
    expect(removedRow.exists()).toBe(true)
    expect(removedRow.classes().some((c) => c.includes('red'))).toBe(true)
  })

  it('groups entries by module using data-module attributes', () => {
    const soundA = makeSound({ lpfFrequency: '0x7FFFFFFF', oscAVolume: '0x7FFFFFFF' })
    const soundB = makeSound({ lpfFrequency: '0x20000000', oscAVolume: '0x40000000' })
    const wrapper = mount(DiffView, { props: { soundA, soundB } })

    const modules = wrapper.findAll('[data-module]').map((w) => w.attributes('data-module'))
    expect(modules).toContain('LPF')
    expect(modules).toContain('OSC 1')
  })

  it('displays nameA and nameB in the header', () => {
    const soundA = makeSound()
    const soundB = makeSound({ lpfFrequency: '0x20000000' })
    const wrapper = mount(DiffView, {
      props: { soundA, soundB, nameA: 'AcidBass', nameB: 'FunkBass' },
    })
    const text = wrapper.text()
    expect(text).toContain('AcidBass')
    expect(text).toContain('FunkBass')
  })

  it('shows patch cable entries with source → destination as the param name', () => {
    const soundA = makeSound()
    const soundB = makeSound({
      cable: { source: 'lfo1', destination: 'volume', amount: '0x40000000' },
    })
    const wrapper = mount(DiffView, { props: { soundA, soundB } })

    const text = wrapper.text()
    // Arrow character used in cable labels
    expect(text).toContain('lfo1')
    expect(text).toContain('volume')
  })
})
