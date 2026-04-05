// Helpers for working with patch cable lists as they appear in parsed
// Deluge preset XML.
//
// In XML: `<defaultParams><patchCables><patchCable source="..." destination="..." amount="..."/></patchCables></defaultParams>`
// In parsed form: `defaultParams.patchCables.patchCable` is either a single
// cable object or an array of cable objects (the parser promotes to array
// only when more than one child is present).

export interface PatchCable {
  source?: string
  destination?: string
  amount?: string
  rangeAdjustable?: string
}

export type PatchCableContainer =
  | { patchCable?: PatchCable | PatchCable[] }
  | undefined

/** Normalise a patch cable container to an array of cables (never undefined). */
export function asCableArray(container: PatchCableContainer): PatchCable[] {
  if (!container) return []
  const pc = container.patchCable
  if (!pc) return []
  return Array.isArray(pc) ? pc : [pc]
}

/** Store a list of cables back into a container in the parser's expected shape. */
export function setCables(
  container: PatchCableContainer,
  cables: PatchCable[],
): PatchCableContainer {
  if (!container) {
    if (cables.length === 0) return undefined
    return { patchCable: cables.length === 1 ? cables[0] : cables }
  }
  if (cables.length === 0) {
    // Preserve container identity but clear cables
    return { ...container, patchCable: undefined }
  }
  return { ...container, patchCable: cables.length === 1 ? cables[0] : cables }
}

/**
 * Map patch cable destination names to the XML attribute they modulate.
 * The firmware uses a different destination vocabulary than the attribute
 * names on defaultParams; this mapping covers the common UI-reachable cases.
 */
export const DESTINATION_TO_PARAM_KEY: Record<string, string> = {
  volume: 'volume',
  pan: 'pan',
  pitch: 'pitchAdjust',
  lpfFrequency: 'lpfFrequency',
  lpfResonance: 'lpfResonance',
  hpfFrequency: 'hpfFrequency',
  hpfResonance: 'hpfResonance',
  lfo1Rate: 'lfo1Rate',
  lfo2Rate: 'lfo2Rate',
  oscAVolume: 'oscAVolume',
  oscBVolume: 'oscBVolume',
  noiseVolume: 'noiseVolume',
  oscAPulseWidth: 'oscAPulseWidth',
  oscBPulseWidth: 'oscBPulseWidth',
  modulator1Volume: 'modulator1Amount',
  modulator2Volume: 'modulator2Amount',
  modulator1Feedback: 'modulator1Feedback',
  modulator2Feedback: 'modulator2Feedback',
  carrier1Feedback: 'carrier1Feedback',
  carrier2Feedback: 'carrier2Feedback',
  modFXRate: 'modFXRate',
  modFXDepth: 'modFXDepth',
  delayRate: 'delayRate',
  delayFeedback: 'delayFeedback',
  reverbAmount: 'reverbAmount',
  arpeggiatorRate: 'arpeggiatorRate',
  stutterRate: 'stutterRate',
  bitcrushAmount: 'bitCrush',
  sampleRateReduction: 'sampleRateReduction',
  portamento: 'portamento',
}

/** Resolve a cable destination to the XML attribute it targets. */
export function paramKeyForDestination(destination: string | undefined): string | undefined {
  if (!destination) return undefined
  return DESTINATION_TO_PARAM_KEY[destination] ?? destination
}

/** All cables whose destination resolves to a given defaultParams attribute. */
export function cablesForParam(
  cables: PatchCable[],
  paramKey: string,
): PatchCable[] {
  return cables.filter((c) => paramKeyForDestination(c.destination) === paramKey)
}
