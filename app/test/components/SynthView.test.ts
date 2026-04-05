// SynthView integration tests: undo/redo history, dirty tracking,
// save/download events, and keyboard shortcut handling.

import { describe, test, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import SynthView from '@/modules/preset-editor/SynthView.vue'
import { parsePreset } from '@/lib/xml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '..', 'fixtures')

function loadSound(name: string): Record<string, unknown> {
  const xml = readFileSync(resolve(FIXTURES, name), 'utf-8')
  return parsePreset(xml).data
}

async function changeKnob(wrapper: ReturnType<typeof mount>, paramPath: string, value: number) {
  const knob = wrapper.find(`[data-param-path="${paramPath}"]`)
  // Open the editor if it isn't already (click toggles)
  if (!knob.find('input[type="range"]').exists()) {
    await knob.find('svg').trigger('click')
  }
  await knob.find('input[type="range"]').setValue(value)
}

describe('SynthView toolbar state', () => {
  test('starts clean (no dirty flag)', () => {
    const wrapper = mount(SynthView, {
      props: { sound: loadSound('synth-basic.xml'), name: 'TEST' },
    })
    expect(wrapper.text()).toContain('saved')
    expect(wrapper.text()).not.toContain('unsaved')
  })

  test('marks dirty after an edit', async () => {
    const wrapper = mount(SynthView, {
      props: { sound: loadSound('synth-basic.xml'), name: 'TEST' },
    })
    await changeKnob(wrapper, 'volume', 20)
    expect(wrapper.text()).toContain('unsaved')
  })

  test('shows preset name', () => {
    const wrapper = mount(SynthView, {
      props: { sound: loadSound('synth-basic.xml'), name: 'MYPRESET' },
    })
    expect(wrapper.text()).toContain('MYPRESET')
  })
})

describe('SynthView undo/redo buttons', () => {
  let wrapper: ReturnType<typeof mount>

  beforeEach(() => {
    wrapper = mount(SynthView, {
      props: { sound: loadSound('synth-basic.xml'), name: 'TEST' },
    })
  })

  function findButton(label: string) {
    return wrapper.findAll('button').find((b) => b.text() === label)!
  }

  test('undo button is disabled when no history', () => {
    expect(findButton('Undo').attributes('disabled')).toBeDefined()
    expect(findButton('Redo').attributes('disabled')).toBeDefined()
  })

  test('undo enables after an edit, redo enables after undo', async () => {
    await changeKnob(wrapper, 'volume', 20)
    expect(findButton('Undo').attributes('disabled')).toBeUndefined()
    expect(findButton('Redo').attributes('disabled')).toBeDefined()

    await findButton('Undo').trigger('click')
    expect(findButton('Redo').attributes('disabled')).toBeUndefined()
  })

  test('undo reverts the last edit', async () => {
    // Volume defaults to 0x4CCCCCA8 → display 40
    expect(wrapper.find('[data-module="amp"]').text()).toContain('40')
    await changeKnob(wrapper, 'volume', 15)
    expect(wrapper.find('[data-module="amp"]').text()).toContain('15')
    await findButton('Undo').trigger('click')
    expect(wrapper.find('[data-module="amp"]').text()).toContain('40')
  })

  test('redo re-applies an undone edit', async () => {
    await changeKnob(wrapper, 'volume', 15)
    await findButton('Undo').trigger('click')
    expect(wrapper.find('[data-module="amp"]').text()).toContain('40')
    await findButton('Redo').trigger('click')
    expect(wrapper.find('[data-module="amp"]').text()).toContain('15')
  })

  test('new edit after undo clears the redo stack', async () => {
    await changeKnob(wrapper, 'volume', 15)
    await findButton('Undo').trigger('click')
    expect(findButton('Redo').attributes('disabled')).toBeUndefined()
    await changeKnob(wrapper, 'volume', 25)
    expect(findButton('Redo').attributes('disabled')).toBeDefined()
  })

  test('history trims to 50 entries', async () => {
    // 55 edits, undo 50 times should leave one at most
    for (let i = 1; i <= 55; i++) {
      await changeKnob(wrapper, 'volume', i % 50)
    }
    // After 50 undos, the undo button should become disabled
    for (let i = 0; i < 55; i++) {
      if (findButton('Undo').attributes('disabled') !== undefined) break
      await findButton('Undo').trigger('click')
    }
    // The oldest state has been discarded; we can't get back to 40 (the original)
    expect(wrapper.find('[data-module="amp"]').text()).not.toContain('40')
  })
})

describe('SynthView keyboard shortcuts', () => {
  test('Ctrl+Z triggers undo', async () => {
    const wrapper = mount(SynthView, {
      props: { sound: loadSound('synth-basic.xml'), name: 'TEST' },
      attachTo: document.body,
    })
    await changeKnob(wrapper, 'volume', 15)
    expect(wrapper.find('[data-module="amp"]').text()).toContain('15')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-module="amp"]').text()).toContain('40')
    wrapper.unmount()
  })

  test('Ctrl+Shift+Z triggers redo', async () => {
    const wrapper = mount(SynthView, {
      props: { sound: loadSound('synth-basic.xml'), name: 'TEST' },
      attachTo: document.body,
    })
    await changeKnob(wrapper, 'volume', 15)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    await wrapper.vm.$nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-module="amp"]').text()).toContain('15')
    wrapper.unmount()
  })

  test('unmounted components drop keyboard listeners', async () => {
    const sound = loadSound('synth-basic.xml')
    const wrapper = mount(SynthView, {
      props: { sound, name: 'TEST' },
      attachTo: document.body,
    })
    await changeKnob(wrapper, 'volume', 15)
    wrapper.unmount()
    // No assertion; just confirm no uncaught error when firing a keydown
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
  })
})

describe('SynthView save events', () => {
  test('emits save with current sound', async () => {
    const wrapper = mount(SynthView, {
      props: { sound: loadSound('synth-basic.xml'), name: 'T', path: 'T.xml' },
    })
    await changeKnob(wrapper, 'volume', 20)
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === 'Save')!
    expect(saveBtn.attributes('disabled')).toBeUndefined()
    await saveBtn.trigger('click')
    const emitted = wrapper.emitted('save')
    expect(emitted).toBeTruthy()
  })

  test('save button is hidden without a path', () => {
    const wrapper = mount(SynthView, {
      props: { sound: loadSound('synth-basic.xml'), name: 'T' },
    })
    expect(wrapper.findAll('button').find((b) => b.text() === 'Save')).toBeUndefined()
  })

  test('save becomes disabled when not dirty', () => {
    const wrapper = mount(SynthView, {
      props: { sound: loadSound('synth-basic.xml'), name: 'T', path: 'T.xml' },
    })
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === 'Save')!
    expect(saveBtn.attributes('disabled')).toBeDefined()
  })

  test('emits download on button click', async () => {
    const wrapper = mount(SynthView, {
      props: { sound: loadSound('synth-basic.xml'), name: 'T' },
    })
    const btn = wrapper.findAll('button').find((b) => b.text().includes('Download'))!
    await btn.trigger('click')
    expect(wrapper.emitted('download')).toBeTruthy()
  })

  test('save marks state as clean again', async () => {
    const wrapper = mount(SynthView, {
      props: { sound: loadSound('synth-basic.xml'), name: 'T', path: 'T.xml' },
    })
    await changeKnob(wrapper, 'volume', 20)
    expect(wrapper.text()).toContain('unsaved')
    await wrapper.findAll('button').find((b) => b.text() === 'Save')!.trigger('click')
    expect(wrapper.text()).not.toContain('unsaved')
  })

  test('replacing the sound prop resets history', async () => {
    const wrapper = mount(SynthView, {
      props: { sound: loadSound('synth-basic.xml'), name: 'A' },
    })
    await changeKnob(wrapper, 'volume', 20)
    expect(wrapper.findAll('button').find((b) => b.text() === 'Undo')!.attributes('disabled'))
      .toBeUndefined()
    await wrapper.setProps({ sound: loadSound('synth-fm.xml'), name: 'B' })
    expect(wrapper.findAll('button').find((b) => b.text() === 'Undo')!.attributes('disabled'))
      .toBeDefined()
    expect(wrapper.text()).not.toContain('unsaved')
  })
})
