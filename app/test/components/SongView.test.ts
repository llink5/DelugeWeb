// SongView tests: clip list rendering, typed routing, per-clip editing.

import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import SongView from '@/modules/preset-editor/SongView.vue'
import { parsePreset, serializePreset } from '@/lib/xml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '..', 'fixtures')

function loadSong(): Record<string, unknown> {
  const xml = readFileSync(resolve(FIXTURES, 'song-basic.xml'), 'utf-8')
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

describe('SongView clip list', () => {
  test('renders all clips', () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG' },
    })
    const rows = wrapper.findAll('[data-clip-index]')
    expect(rows).toHaveLength(2)
  })

  test('shows clip count in toolbar', () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG' },
    })
    expect(wrapper.text()).toContain('2 clips')
  })

  test('detects synth clip type', () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG' },
    })
    const first = wrapper.find('[data-testid="song-clip-0"]')
    expect(first.attributes('data-clip-kind')).toBe('synth')
  })

  test('detects audio clip type', () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG' },
    })
    const second = wrapper.find('[data-testid="song-clip-1"]')
    expect(second.attributes('data-clip-kind')).toBe('audio')
  })

  test('shows synth clip name', () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG' },
    })
    expect(wrapper.find('[data-testid="song-clip-0"]').text()).toContain('BASS')
  })

  test('shows audio clip track name', () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG' },
    })
    expect(wrapper.find('[data-testid="song-clip-1"]').text()).toContain('AMBIENCE')
  })

  test('shows clip length in bars', () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG' },
    })
    // 96 ticks / 48 = 2 bars for the first clip
    expect(wrapper.find('[data-testid="song-clip-0"]').text()).toContain('2 bars')
  })
})

describe('SongView clip routing', () => {
  test('selecting a synth clip shows the SoundEditor', async () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG' },
    })
    // First clip is the synth clip and is selected by default
    expect(wrapper.find('[data-param-path="volume"]').exists()).toBe(true)
  })

  test('selecting an audio clip shows the audio info panel', async () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG' },
    })
    await wrapper.find('[data-testid="song-clip-1"]').trigger('click')
    expect(wrapper.find('[data-testid="audio-clip-info"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-file-path"]').text()).toContain(
      'SAMPLES/AMBIENT1.WAV',
    )
  })

  test('audio info panel hides SoundEditor', async () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG' },
    })
    await wrapper.find('[data-testid="song-clip-1"]').trigger('click')
    expect(wrapper.find('[data-param-path="volume"]').exists()).toBe(false)
  })
})

describe('SongView editing', () => {
  test('editing a synth clip knob emits song-changed with updated clip', async () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG' },
    })
    await changeKnob(wrapper, 'volume', 12)
    const emitted = wrapper.emitted('song-changed')
    expect(emitted).toBeTruthy()
    const nextSong = emitted![0][0] as Record<string, unknown>
    const clips = nextSong.sessionClips as Record<string, unknown>[]
    // First clip's sound volume should now be a different hex value
    const firstClip = clips[0]
    const sound = firstClip.sound as Record<string, unknown>
    const defaults = sound.defaultParams as Record<string, string>
    expect(defaults.volume).not.toBe('0x4CCCCCA8')
  })

  test('edited song round-trips to valid XML', async () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG' },
    })
    await changeKnob(wrapper, 'volume', 20)
    const emitted = wrapper.emitted('song-changed')!
    const nextSong = emitted[0][0] as Record<string, unknown>
    const xml = serializePreset('song', nextSong)
    expect(xml).toContain('<song')
    expect(xml).toContain('instrumentClip')
    expect(xml).toContain('audioClip')
    // Re-parsing should also succeed
    const { rootName } = parsePreset(xml)
    expect(rootName).toBe('song')
  })

  test('audio clip is not editable (no events emitted from audio panel)', async () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG' },
    })
    await wrapper.find('[data-testid="song-clip-1"]').trigger('click')
    // No editing affordances in the audio panel
    expect(wrapper.find('[data-testid="audio-clip-info"]').exists()).toBe(true)
    expect(wrapper.emitted('song-changed')).toBeUndefined()
  })
})

describe('SongView toolbar', () => {
  test('shows song name', () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG' },
    })
    expect(wrapper.text()).toContain('MYSONG')
  })

  test('dirty flag appears after an edit and clears on save', async () => {
    const wrapper = mount(SongView, {
      props: { song: loadSong(), name: 'MYSONG', path: 'S.xml' },
    })
    expect(wrapper.text()).toContain('saved')
    await changeKnob(wrapper, 'volume', 15)
    expect(wrapper.text()).toContain('unsaved')
    await wrapper.findAll('button').find((b) => b.text() === 'Save')!.trigger('click')
    expect(wrapper.text()).not.toContain('unsaved')
  })
})
