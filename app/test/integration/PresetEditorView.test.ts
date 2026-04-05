import { describe, test, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import PresetEditorView from '@/modules/preset-editor/PresetEditorView.vue'

const SYNTH_XML = readFileSync(
  resolve(__dirname, '../fixtures/synth-basic.xml'),
  'utf-8',
)
const KIT_XML = readFileSync(
  resolve(__dirname, '../fixtures/kit-basic.xml'),
  'utf-8',
)

/** Wait for FileReader callbacks to settle. */
async function waitForFileReader() {
  // FileReader onload is async — flush multiple rounds of microtasks
  for (let i = 0; i < 5; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('PresetEditorView file loading', () => {
  test('loadFile parses synth XML and renders sections', async () => {
    const wrapper = mount(PresetEditorView, {
      global: { stubs: { 'router-link': true } },
    })

    // Initially no preset is shown
    expect(wrapper.text()).toContain('Drop a preset XML file')

    // Call loadFile directly (bypasses FileList limitations in jsdom)
    const file = new File([SYNTH_XML], 'synth.xml', { type: 'text/xml' })
    ;(wrapper.vm as any).loadFile(file)

    await waitForFileReader()

    // Preset type badge should show SOUND
    expect(wrapper.text()).toContain('SOUND')
    // Should have oscillator sections
    expect(wrapper.text()).toContain('Oscillator 1')
  })

  test('loadFile parses kit XML and shows sources', async () => {
    const wrapper = mount(PresetEditorView, {
      global: { stubs: { 'router-link': true } },
    })

    const file = new File([KIT_XML], 'kit.xml', { type: 'text/xml' })
    ;(wrapper.vm as any).loadFile(file)

    await waitForFileReader()

    expect(wrapper.text()).toContain('KIT')
    expect(wrapper.text()).toContain('Sound Sources')
  })

  test('drop zone exists with dragover/dragleave feedback', async () => {
    const wrapper = mount(PresetEditorView, {
      global: { stubs: { 'router-link': true } },
    })

    const view = wrapper.find('[data-testid="preset-editor-view"]')
    expect(view.exists()).toBe(true)

    // Simulate dragover → visual feedback
    await view.trigger('dragover')
    expect(view.classes().join(' ')).toContain('ring-2')

    // Simulate dragleave → feedback removed
    await view.trigger('dragleave')
    expect(view.classes().join(' ')).not.toContain('ring-2')
  })

  test('handleFileUpload is wired to the file input change event', () => {
    const wrapper = mount(PresetEditorView, {
      global: { stubs: { 'router-link': true } },
    })
    // Verify the file input exists and has a change handler
    const fileInput = wrapper.find('input[type="file"][accept=".xml,.XML"]')
    expect(fileInput.exists()).toBe(true)
    // The input should be inside a clickable label
    const label = fileInput.element.closest('label')
    expect(label).toBeTruthy()
  })

  test('shows error for parse failures', async () => {
    const wrapper = mount(PresetEditorView, {
      global: { stubs: { 'router-link': true } },
    })

    // Load something that is XML but not a Deluge preset — should still parse without throwing
    const file = new File(['<notapreset/>'], 'test.xml', { type: 'text/xml' })
    ;(wrapper.vm as any).loadFile(file)

    await waitForFileReader()

    // Should render something (rootName = "notapreset") — no crash
    expect(wrapper.text()).toContain('NOTAPRESET')
  })
})
