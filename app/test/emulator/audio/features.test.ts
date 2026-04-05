import { describe, test, expect } from 'vitest'
import {
  detectAudioFeatures,
  audioFeatureSummary,
} from '@/lib/audio/features'

describe('detectAudioFeatures', () => {
  test('returns a full boolean record', () => {
    const f = detectAudioFeatures()
    expect(typeof f.audioContext).toBe('boolean')
    expect(typeof f.audioWorklet).toBe('boolean')
    expect(typeof f.sharedArrayBuffer).toBe('boolean')
    expect(typeof f.crossOriginIsolated).toBe('boolean')
  })
})

describe('audioFeatureSummary', () => {
  test('all enabled renders ticks', () => {
    const summary = audioFeatureSummary({
      audioContext: true,
      audioWorklet: true,
      sharedArrayBuffer: true,
      crossOriginIsolated: true,
    })
    expect(summary).toContain('AudioContext ✓')
    expect(summary).toContain('AudioWorklet ✓')
    expect(summary).toContain('SharedArrayBuffer ✓')
    expect(summary).toContain('COI ✓')
  })

  test('disabled features render ✗', () => {
    const summary = audioFeatureSummary({
      audioContext: false,
      audioWorklet: false,
      sharedArrayBuffer: false,
      crossOriginIsolated: false,
    })
    expect(summary).toContain('AudioContext ✗')
    expect(summary).toContain('AudioWorklet ✗')
    expect(summary).toContain('SharedArrayBuffer ✗')
    expect(summary).toContain('coi-serviceworker')
  })
})
