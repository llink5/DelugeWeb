// Init preset templates.
//
// The Deluge defines an "INIT" preset that every new sound starts from: a
// single saw oscillator, unmodulated filter wide open, simple AD envelope,
// velocity->volume cable. The editor uses these templates for:
//   - DiffView "Preset vs Init" mode: surface what the user actually changed
//     relative to a fresh preset.
//   - PatchMorph reset: restore a clean baseline before morphing again.
//   - New-preset button (future).
//
// The XML strings below were extracted from the stock init-preset.xml fixture.
// They round-trip cleanly through parsePreset() / serializePreset().

export const INIT_SYNTH_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sound
\tpresetSlot="0"
\tpresetSubSlot="-1"
\tname="INIT"
\tpolyphonic="poly"
\tclippingAmount="0"
\tvoicePriority="1"
\tsideChainSend="0"
\tmode="subtractive"
\ttranspose="0"
\tlpfMode="24dB"
\tmodFXType="none">
\t<osc1 type="saw" transpose="0" cents="0" retrigPhase="-1"/>
\t<osc2 type="saw" transpose="0" cents="0" retrigPhase="-1"/>
\t<lfo1 type="triangle" syncLevel="0"/>
\t<lfo2 type="triangle"/>
\t<unison num="1" detune="8"/>
\t<compressor syncLevel="7" attack="327244" release="936"/>
\t<delay pingPong="1" analog="0" syncLevel="7"/>
\t<arpeggiator mode="off" numOctaves="2" syncLevel="7"/>
\t<defaultParams
\t\tarpeggiatorGate="0x00000000"
\t\tportamento="0x80000000"
\t\tcompressorShape="0xDC28F5B2"
\t\toscAVolume="0x7FFFFFFF"
\t\toscAPulseWidth="0x00000000"
\t\toscBVolume="0x80000000"
\t\toscBPulseWidth="0x00000000"
\t\tnoiseVolume="0x80000000"
\t\tvolume="0x4CCCCCA8"
\t\tpan="0x00000000"
\t\tlpfFrequency="0x7FFFFFFF"
\t\tlpfResonance="0x80000000"
\t\thpfFrequency="0x80000000"
\t\thpfResonance="0x80000000"
\t\tlfo1Rate="0x1999997E"
\t\tlfo2Rate="0x00000000"
\t\tmodulator1Amount="0x80000000"
\t\tmodulator1Feedback="0x80000000"
\t\tmodulator2Amount="0x80000000"
\t\tmodulator2Feedback="0x80000000"
\t\tcarrier1Feedback="0x80000000"
\t\tcarrier2Feedback="0x80000000"
\t\tpitchAdjust="0x00000000"
\t\tmodFXRate="0x00000000"
\t\tmodFXDepth="0x80000000"
\t\tdelayRate="0x00000000"
\t\tdelayFeedback="0x80000000"
\t\treverbAmount="0x80000000"
\t\tarpeggiatorRate="0x00000000"
\t\tstutterRate="0x00000000"
\t\tsampleRateReduction="0x80000000"
\t\tbitCrush="0x80000000"
\t\tmodFXOffset="0x00000000"
\t\tmodFXFeedback="0x80000000">
\t\t<envelope1 attack="0x80000000" decay="0xE6666654" sustain="0x7FFFFFFF" release="0x80000000"/>
\t\t<envelope2 attack="0xE6666654" decay="0xE6666654" sustain="0xFFFFFFE9" release="0xE6666654"/>
\t\t<patchCables>
\t\t\t<patchCable source="velocity" destination="volume" amount="0x33333320"/>
\t\t</patchCables>
\t</defaultParams>
</sound>
`

import { parsePreset } from '../xml/parser'

/**
 * Parse the init XML into a plain sound object.
 *
 * Returns a fresh instance each call so callers can safely mutate the result.
 * Requires a DOMParser, so runs in the browser / jsdom only.
 */
export function parseInitSynth(): Record<string, unknown> {
  const { data } = parsePreset(INIT_SYNTH_XML)
  return data
}
