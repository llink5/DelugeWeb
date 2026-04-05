import { describe, it, expect } from 'vitest'
import { parsePreset } from '../../src/lib/xml/parser'
import { paramDiff } from '../../src/lib/diff/paramDiff'

// ---------------------------------------------------------------------------
// Inline XML fixtures (kept compact — enough to exercise the diff algorithm).
// ---------------------------------------------------------------------------

const SYNTH_BASIC = `<?xml version="1.0" encoding="UTF-8"?>
<sound
  name="Basic"
  mode="subtractive"
  polyphonic="poly"
  lpfMode="24dB">
  <osc1 type="square"/>
  <osc2 type="saw"/>
  <defaultParams
    oscAVolume="0x7FFFFFFF"
    oscAPulseWidth="0x00000000"
    oscBVolume="0x80000000"
    oscBPulseWidth="0x00000000"
    noiseVolume="0x80000000"
    volume="0x50000000"
    pan="0x00000000"
    lpfFrequency="0x7FFFFFFF"
    lpfResonance="0x80000000"
    hpfFrequency="0x80000000"
    hpfResonance="0x80000000"
    lfo1Rate="0x00000000"
    lfo2Rate="0x00000000"
    modFXRate="0x00000000"
    modFXDepth="0x80000000"
    modFXOffset="0x00000000"
    modFXFeedback="0x80000000"
    delayRate="0x00000000"
    delayFeedback="0x80000000"
    reverbAmount="0x80000000"
    arpeggiatorRate="0x00000000"
    arpeggiatorGate="0x00000000"
    portamento="0x80000000"
    compressorShape="0xDC28F5C1"
    stutterRate="0x00000000"
    sampleRateReduction="0x80000000"
    bitCrush="0x80000000"
    modulator1Amount="0x80000000"
    modulator1Feedback="0x80000000"
    modulator2Amount="0x80000000"
    modulator2Feedback="0x80000000"
    carrier1Feedback="0x80000000"
    carrier2Feedback="0x80000000"
    pitchAdjust="0x00000000">
    <envelope1 attack="0x80000000" decay="0xE6666654" sustain="0x7FFFFFFF" release="0x80000000"/>
    <envelope2 attack="0xE6666654" decay="0xE6666654" sustain="0xFFFFFFE9" release="0x80000000"/>
    <patchCables>
      <patchCable source="velocity" destination="volume" amount="0x40000000"/>
    </patchCables>
  </defaultParams>
</sound>`

const SYNTH_MODULATED = `<?xml version="1.0" encoding="UTF-8"?>
<sound
  name="Modulated"
  mode="subtractive"
  polyphonic="poly"
  lpfMode="12dB">
  <osc1 type="saw"/>
  <osc2 type="square"/>
  <defaultParams
    oscAVolume="0x7FFFFFFF"
    oscAPulseWidth="0x00000000"
    oscBVolume="0x40000000"
    oscBPulseWidth="0x00000000"
    noiseVolume="0x80000000"
    volume="0x50000000"
    pan="0x00000000"
    lpfFrequency="0x20000000"
    lpfResonance="0x40000000"
    hpfFrequency="0x80000000"
    hpfResonance="0x80000000"
    lfo1Rate="0x40000000"
    lfo2Rate="0x00000000"
    modFXRate="0x00000000"
    modFXDepth="0x80000000"
    modFXOffset="0x00000000"
    modFXFeedback="0x80000000"
    delayRate="0x00000000"
    delayFeedback="0x80000000"
    reverbAmount="0x80000000"
    arpeggiatorRate="0x00000000"
    arpeggiatorGate="0x00000000"
    portamento="0x80000000"
    compressorShape="0xDC28F5C1"
    stutterRate="0x00000000"
    sampleRateReduction="0x80000000"
    bitCrush="0x80000000"
    modulator1Amount="0x80000000"
    modulator1Feedback="0x80000000"
    modulator2Amount="0x80000000"
    modulator2Feedback="0x80000000"
    carrier1Feedback="0x80000000"
    carrier2Feedback="0x80000000"
    pitchAdjust="0x00000000">
    <envelope1 attack="0x80000000" decay="0xE6666654" sustain="0x7FFFFFFF" release="0x80000000"/>
    <envelope2 attack="0xE6666654" decay="0xE6666654" sustain="0xFFFFFFE9" release="0x80000000"/>
    <patchCables>
      <patchCable source="velocity" destination="volume" amount="0x40000000"/>
      <patchCable source="lfo1" destination="lpfFrequency" amount="0x20000000"/>
      <patchCable source="envelope2" destination="lpfFrequency" amount="0x60000000"/>
    </patchCables>
  </defaultParams>
</sound>`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSound(xml: string): Record<string, unknown> {
  const { data } = parsePreset(xml)
  return data
}

function cloneSound(s: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(s))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('paramDiff', () => {
  it('returns empty arrays for identical presets', () => {
    const a = parseSound(SYNTH_BASIC)
    const b = parseSound(SYNTH_BASIC)
    const result = paramDiff(a, b)
    expect(result.changed).toHaveLength(0)
    expect(result.added).toHaveLength(0)
    expect(result.removed).toHaveLength(0)
  })

  it('detects changes between synth-basic and synth-modulated', () => {
    const a = parseSound(SYNTH_BASIC)
    const b = parseSound(SYNTH_MODULATED)
    const result = paramDiff(a, b)

    // Many scalar changes expected
    expect(result.changed.length).toBeGreaterThan(0)

    // Specific: lpfFrequency changed
    const lpfFreq = result.changed.find((e) => e.paramKey === 'lpfFrequency')
    expect(lpfFreq).toBeDefined()
    expect(lpfFreq!.module).toBe('LPF')
    expect(lpfFreq!.param).toBe('Frequency')

    // Specific: oscBVolume changed
    const oscB = result.changed.find((e) => e.paramKey === 'oscBVolume')
    expect(oscB).toBeDefined()
    expect(oscB!.module).toBe('OSC 2')

    // Top-level enum: lpfMode + name changed
    const lpfMode = result.changed.find((e) => e.paramKey === 'lpfMode')
    expect(lpfMode).toBeDefined()
    expect(lpfMode!.module).toBe('General')
    expect(lpfMode!.valueA).toBe('24dB')
    expect(lpfMode!.valueB).toBe('12dB')

    // Added cables should appear in 'added'
    expect(result.added.length).toBeGreaterThanOrEqual(2)
    const cableAdds = result.added.filter((e) => e.module === 'Patch Cables')
    expect(cableAdds.length).toBeGreaterThanOrEqual(2)
    const cableKeys = cableAdds.map((c) => c.paramKey)
    expect(cableKeys).toContain('cable:lfo1->lpfFrequency')
    expect(cableKeys).toContain('cable:envelope2->lpfFrequency')
  })

  it('detects exactly one changed entry after manually tweaking one param', () => {
    const a = parseSound(SYNTH_BASIC)
    const b = cloneSound(a)
    const dp = b['defaultParams'] as Record<string, unknown>
    dp['lpfFrequency'] = '0x40000000'

    const result = paramDiff(a, b)
    expect(result.added).toHaveLength(0)
    expect(result.removed).toHaveLength(0)
    expect(result.changed).toHaveLength(1)
    expect(result.changed[0].paramKey).toBe('lpfFrequency')
    expect(result.changed[0].module).toBe('LPF')
    expect(result.changed[0].param).toBe('Frequency')
  })

  it('changed entries carry hexA/hexB/valueA/valueB', () => {
    const a = parseSound(SYNTH_BASIC)
    const b = cloneSound(a)
    const dp = b['defaultParams'] as Record<string, unknown>
    dp['oscAVolume'] = '0x40000000'

    const result = paramDiff(a, b)
    expect(result.changed).toHaveLength(1)
    const entry = result.changed[0]
    expect(entry.hexA).toBe('0x7FFFFFFF')
    expect(entry.hexB).toBe('0x40000000')
    expect(entry.valueA).toBeDefined()
    expect(entry.valueB).toBeDefined()
    // Display values should differ
    expect(entry.valueA).not.toEqual(entry.valueB)
  })

  it('detects added patch cable', () => {
    const a = parseSound(SYNTH_BASIC)
    const b = cloneSound(a)
    const dp = b['defaultParams'] as Record<string, unknown>
    const cables = dp['patchCables'] as Record<string, unknown>
    // Existing cable is single-object or array — normalize to array then append.
    const existing = cables['patchCable']
    const list = Array.isArray(existing) ? [...existing] : [existing]
    list.push({ source: 'lfo1', destination: 'pan', amount: '0x19999999' })
    cables['patchCable'] = list

    const result = paramDiff(a, b)
    expect(result.removed).toHaveLength(0)
    expect(result.changed).toHaveLength(0)
    expect(result.added).toHaveLength(1)
    expect(result.added[0].module).toBe('Patch Cables')
    expect(result.added[0].paramKey).toBe('cable:lfo1->pan')
  })

  it('detects removed patch cable', () => {
    const a = parseSound(SYNTH_MODULATED)
    const b = cloneSound(a)
    const dp = b['defaultParams'] as Record<string, unknown>
    const cables = dp['patchCables'] as Record<string, unknown>
    const list = cables['patchCable'] as unknown[]
    // Remove the lfo1->lpfFrequency cable.
    const filtered = list.filter((c) => {
      const rc = c as Record<string, unknown>
      return !(rc['source'] === 'lfo1' && rc['destination'] === 'lpfFrequency')
    })
    cables['patchCable'] = filtered

    const result = paramDiff(a, b)
    const removedCables = result.removed.filter((e) => e.module === 'Patch Cables')
    expect(removedCables.length).toBeGreaterThanOrEqual(1)
    expect(removedCables.map((c) => c.paramKey)).toContain('cable:lfo1->lpfFrequency')
  })

  it('groups all cable changes under the Patch Cables module', () => {
    const a = parseSound(SYNTH_BASIC)
    const b = parseSound(SYNTH_MODULATED)
    const result = paramDiff(a, b)

    const allCableEntries = [
      ...result.changed.filter((e) => e.paramKey.startsWith('cable:')),
      ...result.added.filter((e) => e.paramKey.startsWith('cable:')),
      ...result.removed.filter((e) => e.paramKey.startsWith('cable:')),
    ]
    expect(allCableEntries.length).toBeGreaterThan(0)
    for (const e of allCableEntries) {
      expect(e.module).toBe('Patch Cables')
    }
  })

  it('places envelope stages under Envelope 1 / Envelope 2 modules', () => {
    const a = parseSound(SYNTH_BASIC)
    const b = cloneSound(a)
    const dp = b['defaultParams'] as Record<string, unknown>
    const env1 = dp['envelope1'] as Record<string, unknown>
    env1['attack'] = '0x40000000'

    const result = paramDiff(a, b)
    expect(result.changed).toHaveLength(1)
    expect(result.changed[0].module).toBe('Envelope 1')
    expect(result.changed[0].param).toBe('Attack')
    expect(result.changed[0].paramKey).toBe('envelope1.attack')
  })

  it('handles sounds with no defaultParams gracefully', () => {
    const result = paramDiff({}, {})
    expect(result.changed).toHaveLength(0)
    expect(result.added).toHaveLength(0)
    expect(result.removed).toHaveLength(0)
  })
})
