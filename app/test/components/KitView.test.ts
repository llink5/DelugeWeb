// KitView tests: row list rendering, row selection, and per-row editing.

import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import KitView from '@/modules/preset-editor/KitView.vue'
import { parsePreset, serializePreset } from '@/lib/xml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '..', 'fixtures')

function loadKit(name: string): Record<string, unknown> {
  const xml = readFileSync(resolve(FIXTURES, name), 'utf-8')
  return parsePreset(xml).data
}

async function changeKnob(
  wrapper: ReturnType<typeof mount>,
  paramPath: string,
  value: number,
) {
  const knob = wrapper.find(`[data-param-path="${paramPath}"]`)
  if (!knob.find('input[type="range"]').exists()) {
    await knob.find('svg').trigger('click')
  }
  await knob.find('input[type="range"]').setValue(value)
}

describe('KitView row list', () => {
  test('renders a row per sound source', () => {
    const wrapper = mount(KitView, {
      props: { kit: loadKit('kit-basic.xml'), name: 'KIT' },
    })
    const rows = wrapper.findAll('[data-row-index]')
    expect(rows).toHaveLength(2)
  })

  test('shows each sound name in the row list', () => {
    const wrapper = mount(KitView, {
      props: { kit: loadKit('kit-basic.xml'), name: 'KIT' },
    })
    const list = wrapper.find('[data-testid="kit-row-list"]')
    expect(list.text()).toContain('KICK')
    expect(list.text()).toContain('SNARE')
  })

  test('shows kit name in header toolbar', () => {
    const wrapper = mount(KitView, {
      props: { kit: loadKit('kit-basic.xml'), name: 'MYKIT' },
    })
    expect(wrapper.text()).toContain('MYKIT')
  })

  test('shows row count in header', () => {
    const wrapper = mount(KitView, {
      props: { kit: loadKit('kit-basic.xml'), name: 'KIT' },
    })
    expect(wrapper.text()).toContain('2 rows')
  })

  test('first row is selected by default', () => {
    const wrapper = mount(KitView, {
      props: { kit: loadKit('kit-basic.xml'), name: 'KIT' },
    })
    const first = wrapper.find('[data-testid="kit-row-0"]')
    expect(first.classes().join(' ')).toMatch(/border-sky/)
  })
})

describe('KitView row selection', () => {
  test('clicking a row selects it', async () => {
    const wrapper = mount(KitView, {
      props: { kit: loadKit('kit-basic.xml'), name: 'KIT' },
    })
    await wrapper.find('[data-testid="kit-row-1"]').trigger('click')
    const second = wrapper.find('[data-testid="kit-row-1"]')
    expect(second.classes().join(' ')).toMatch(/border-sky/)
  })

  test('switching rows remounts the SoundEditor with the new sound', async () => {
    const wrapper = mount(KitView, {
      props: { kit: loadKit('kit-basic.xml'), name: 'KIT' },
    })
    // KICK has oscAVolume = 0x7FFFFFFF (display 50) and oscBVolume = 0x80000000 (display 0)
    await wrapper.vm.$nextTick()
    // Switch to SNARE (oscAVolume = 0x4CCCCCA8 ~= 40)
    await wrapper.find('[data-testid="kit-row-1"]').trigger('click')
    await wrapper.vm.$nextTick()
    // The param display for osc1 volume should now show 40 somewhere
    expect(wrapper.find('[data-param-path="oscAVolume"]').text()).toContain('40')
  })
})

describe('KitView editing', () => {
  test('editing a knob emits kit-changed with updated soundSources', async () => {
    const wrapper = mount(KitView, {
      props: { kit: loadKit('kit-basic.xml'), name: 'KIT' },
    })
    await changeKnob(wrapper, 'volume', 15)
    const emitted = wrapper.emitted('kit-changed')
    expect(emitted).toBeTruthy()
    const nextKit = emitted![0][0] as Record<string, unknown>
    const sources = nextKit.soundSources as Record<string, unknown>[]
    expect(Array.isArray(sources)).toBe(true)
    expect(sources).toHaveLength(2)
  })

  test('edits only touch the selected row', async () => {
    const wrapper = mount(KitView, {
      props: { kit: loadKit('kit-basic.xml'), name: 'KIT' },
    })
    // Select second row
    await wrapper.find('[data-testid="kit-row-1"]').trigger('click')
    await wrapper.vm.$nextTick()
    // Edit volume on second row
    await changeKnob(wrapper, 'volume', 10)
    const emitted = wrapper.emitted('kit-changed')!
    const nextKit = emitted[emitted.length - 1][0] as Record<string, unknown>
    const sources = nextKit.soundSources as Record<string, unknown>[]
    // First row's defaultParams.volume is still at its original value
    const firstDefaults = (sources[0] as Record<string, unknown>).defaultParams as Record<string, string>
    expect(firstDefaults.volume).toBe('0x4CCCCCA8')
  })

  test('shows unsaved marker after edit and clears on save', async () => {
    const wrapper = mount(KitView, {
      props: { kit: loadKit('kit-basic.xml'), name: 'KIT', path: 'KIT.xml' },
    })
    expect(wrapper.text()).toContain('saved')
    await changeKnob(wrapper, 'volume', 20)
    expect(wrapper.text()).toContain('unsaved')
    await wrapper.findAll('button').find((b) => b.text() === 'Save')!.trigger('click')
    expect(wrapper.text()).not.toContain('unsaved')
  })

  test('edited kit round-trips to valid XML', async () => {
    const wrapper = mount(KitView, {
      props: { kit: loadKit('kit-basic.xml'), name: 'KIT' },
    })
    await changeKnob(wrapper, 'volume', 25)
    const emitted = wrapper.emitted('kit-changed')!
    const nextKit = emitted[0][0] as Record<string, unknown>
    const xml = serializePreset('kit', nextKit)
    expect(xml).toMatch(/^<\?xml/)
    expect(xml).toContain('<kit')
    // Re-parse to confirm round-trip integrity
    const { rootName } = parsePreset(xml)
    expect(rootName).toBe('kit')
  })
})

describe('KitView undo/redo', () => {
  test('undo reverts last edit', async () => {
    const wrapper = mount(KitView, {
      props: { kit: loadKit('kit-basic.xml'), name: 'KIT' },
    })
    await changeKnob(wrapper, 'volume', 10)
    const undoBtn = wrapper.findAll('button').find((b) => b.text() === 'Undo')!
    expect(undoBtn.attributes('disabled')).toBeUndefined()
    await undoBtn.trigger('click')
    // After undo, should be clean state
    expect(wrapper.text()).not.toContain('unsaved')
  })

  test('undo disabled when no history', () => {
    const wrapper = mount(KitView, {
      props: { kit: loadKit('kit-basic.xml'), name: 'KIT' },
    })
    const undoBtn = wrapper.findAll('button').find((b) => b.text() === 'Undo')!
    expect(undoBtn.attributes('disabled')).toBeDefined()
  })
})
