// Parameter metadata and hex <-> display conversion.
//
// The Deluge firmware stores most parameter values as signed 32-bit integers
// encoded as hex strings in the XML (e.g. "0x7FFFFFFF"). Display values are
// quantized integer scales visible on the device (0..50 for most params,
// -32..+32 for pan, etc.).
//
// This module provides:
//   - A linear mapping between the signed 32-bit hex space and any display
//     range defined by a `ParamMeta` record.
//   - A metadata table listing the parameters the editor knows about.
//
// The conversion is lossy (51 display values vs. 2^32 hex values), but
// round-tripping through `displayToHex(hexToDisplay(hex, meta), meta)` lands
// on a canonical hex for that display value. This is acceptable: the Deluge
// itself quantizes values to the same display resolution, so the audible
// result is identical.

export type FormatterType = 'unipolar' | 'bipolar' | 'pan' | 'enum' | 'raw'

export interface ParamMeta {
  /** Stable identifier for this parameter, e.g. "osc1Volume". */
  id: string
  /** Human-readable name, e.g. "Volume". */
  displayName: string
  /** Owning module, e.g. "osc1", "lpf", "env1". */
  module: string
  /** XML attribute or element key used by the Deluge. */
  xmlAttribute: string
  /** How to convert between hex and display. */
  formatter: FormatterType
  /** Display-space minimum. */
  min: number
  /** Display-space maximum. */
  max: number
  /** Default hex value for init presets. */
  default: string
  /** Whether the parameter is bipolar (has a signed center). */
  bipolar: boolean
  /** Named values for `enum` formatters (e.g. waveform names). */
  enumValues?: string[]
}

// ---------------------------------------------------------------------------
// Internal conversion helpers
// ---------------------------------------------------------------------------

const HEX_MIN = -0x80000000 // signed 32-bit minimum
const HEX_MAX = 0x7fffffff // signed 32-bit maximum
const HEX_SPAN = 0x100000000 // 2^32

/** Parse a hex string ("0x...") into a signed 32-bit integer. */
function parseSigned32(hex: string): number {
  if (typeof hex !== 'string' || !hex.startsWith('0x')) {
    throw new Error(`Invalid hex value: ${String(hex)}`)
  }
  // Only consume the first 8 hex digits; ignore any trailing characters.
  let v = parseInt(hex.substring(2, 10), 16)
  if (Number.isNaN(v)) {
    throw new Error(`Invalid hex value: ${hex}`)
  }
  if (v & 0x80000000) v -= 0x100000000
  return v
}

/** Encode a signed 32-bit integer as an 8-digit uppercase hex string. */
function formatHex(asInt: number): string {
  let clamped = asInt
  if (clamped > HEX_MAX) clamped = HEX_MAX
  if (clamped < HEX_MIN) clamped = HEX_MIN
  const u32 = clamped < 0 ? clamped + HEX_SPAN : clamped
  return '0x' + u32.toString(16).toUpperCase().padStart(8, '0')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a raw hex value to its display-space integer equivalent.
 * Uses a linear mapping from the signed 32-bit range to [meta.min, meta.max].
 * For `enum` formatters, returns the numeric index into `meta.enumValues`.
 * For `raw` formatters, returns the hex value unchanged as a number via parse.
 */
export function hexToDisplay(hex: string, meta: ParamMeta): number {
  if (meta.formatter === 'raw') {
    return parseSigned32(hex)
  }
  if (meta.formatter === 'enum') {
    // Enum values may be stored as numeric indices, not hex
    const n = Number(hex)
    if (!Number.isNaN(n)) return n
    return parseSigned32(hex)
  }

  const asInt = parseSigned32(hex)
  // unit in [0, 1 - 2^-32]
  const unit = (asInt - HEX_MIN) / HEX_SPAN
  const span = meta.max - meta.min
  return Math.round(meta.min + unit * span)
}

/**
 * Convert a display-space value to its hex representation.
 * Inverse of `hexToDisplay`; the mapping is lossy (many hex values map to
 * the same display integer) but the chosen hex is deterministic.
 */
export function displayToHex(value: number, meta: ParamMeta): string {
  if (meta.formatter === 'enum' || meta.formatter === 'raw') {
    // Enums and raw values pass straight through as signed 32-bit
    return formatHex(Math.round(value))
  }

  // Clamp to display range before mapping back
  let clamped = value
  if (clamped < meta.min) clamped = meta.min
  if (clamped > meta.max) clamped = meta.max

  const span = meta.max - meta.min
  const unit = span === 0 ? 0 : (clamped - meta.min) / span
  // Use the upper edge of the hex bucket for the maximum display value so
  // that the maximum display value round-trips to HEX_MAX rather than
  // overflowing to the minimum.
  let asInt: number
  if (clamped >= meta.max) {
    asInt = HEX_MAX
  } else {
    asInt = Math.round(HEX_MIN + unit * HEX_SPAN)
  }
  return formatHex(asInt)
}

/**
 * Pure linear hex → display conversion without a full `ParamMeta` record.
 * Useful for generic UI components that only know a parameter's numeric
 * range (e.g. a knob that accepts min/max props).
 */
export function hexToDisplayLinear(hex: string, min: number, max: number): number {
  const asInt = parseSigned32(hex)
  const unit = (asInt - HEX_MIN) / HEX_SPAN
  return Math.round(min + unit * (max - min))
}

/** Inverse of `hexToDisplayLinear`. */
export function displayToHexLinear(value: number, min: number, max: number): string {
  let clamped = value
  if (clamped < min) clamped = min
  if (clamped > max) clamped = max
  if (clamped >= max) return formatHex(HEX_MAX)
  const span = max - min
  const unit = span === 0 ? 0 : (clamped - min) / span
  return formatHex(Math.round(HEX_MIN + unit * HEX_SPAN))
}

/** Format a pan display value with L/R suffix (or "0" center). */
export function formatPan(display: number): string {
  if (display === 0) return '0'
  if (display < 0) return `${Math.abs(display)}L`
  return `${display}R`
}

// ---------------------------------------------------------------------------
// Parameter metadata table
// ---------------------------------------------------------------------------

// Default hex constants expressed in the conventional way
const H_MIN = '0x80000000' // display 0 on unipolar, -max on bipolar
const H_ZERO = '0x00000000' // display 25 on unipolar, 0 on bipolar
const H_MAX = '0x7FFFFFFF' // display 50 on unipolar, +max on bipolar
const H_VOL_DEFAULT = '0x4CCCCCA8' // display 40, common default volume

function unipolar(
  id: string,
  displayName: string,
  module: string,
  xmlAttribute: string,
  defaultHex: string = H_MIN,
): ParamMeta {
  return {
    id,
    displayName,
    module,
    xmlAttribute,
    formatter: 'unipolar',
    min: 0,
    max: 50,
    default: defaultHex,
    bipolar: false,
  }
}

function bipolar(
  id: string,
  displayName: string,
  module: string,
  xmlAttribute: string,
  range = 50,
  defaultHex: string = H_ZERO,
): ParamMeta {
  return {
    id,
    displayName,
    module,
    xmlAttribute,
    formatter: 'bipolar',
    min: -range,
    max: range,
    default: defaultHex,
    bipolar: true,
  }
}

function pan(
  id: string,
  displayName: string,
  module: string,
  xmlAttribute: string,
  defaultHex: string = H_ZERO,
): ParamMeta {
  return {
    id,
    displayName,
    module,
    xmlAttribute,
    formatter: 'pan',
    min: -32,
    max: 32,
    default: defaultHex,
    bipolar: true,
  }
}

/** The editor's known parameter metadata, keyed by the defaultParams attribute name. */
export const PARAM_META: Record<string, ParamMeta> = {
  // Oscillators (stored on defaultParams as oscA*, oscB*)
  oscAVolume: unipolar('osc1Volume', 'Volume', 'osc1', 'oscAVolume', H_MAX),
  oscAPulseWidth: unipolar('osc1PulseWidth', 'Pulse Width', 'osc1', 'oscAPulseWidth', H_ZERO),
  oscBVolume: unipolar('osc2Volume', 'Volume', 'osc2', 'oscBVolume', H_MIN),
  oscBPulseWidth: unipolar('osc2PulseWidth', 'Pulse Width', 'osc2', 'oscBPulseWidth', H_ZERO),
  noiseVolume: unipolar('noiseVolume', 'Noise', 'noise', 'noiseVolume', H_MIN),

  // Amp
  volume: unipolar('volume', 'Volume', 'amp', 'volume', H_VOL_DEFAULT),
  pan: pan('pan', 'Pan', 'amp', 'pan', H_ZERO),

  // Filters
  lpfFrequency: unipolar('lpfFrequency', 'Frequency', 'lpf', 'lpfFrequency', H_MAX),
  lpfResonance: unipolar('lpfResonance', 'Resonance', 'lpf', 'lpfResonance', H_MIN),
  hpfFrequency: unipolar('hpfFrequency', 'Frequency', 'hpf', 'hpfFrequency', H_MIN),
  hpfResonance: unipolar('hpfResonance', 'Resonance', 'hpf', 'hpfResonance', H_MIN),

  // LFOs
  lfo1Rate: unipolar('lfo1Rate', 'Rate', 'lfo1', 'lfo1Rate', '0x1999997E'),
  lfo2Rate: unipolar('lfo2Rate', 'Rate', 'lfo2', 'lfo2Rate', H_MIN),

  // FM
  modulator1Amount: bipolar('modulator1Amount', 'Amount', 'modulator1', 'modulator1Amount', 50, H_MIN),
  modulator1Feedback: bipolar('modulator1Feedback', 'Feedback', 'modulator1', 'modulator1Feedback', 50, H_MIN),
  modulator2Amount: bipolar('modulator2Amount', 'Amount', 'modulator2', 'modulator2Amount', 50, H_MIN),
  modulator2Feedback: bipolar('modulator2Feedback', 'Feedback', 'modulator2', 'modulator2Feedback', 50, H_MIN),
  carrier1Feedback: bipolar('carrier1Feedback', 'Feedback', 'osc1', 'carrier1Feedback', 50, H_MIN),
  carrier2Feedback: bipolar('carrier2Feedback', 'Feedback', 'osc2', 'carrier2Feedback', 50, H_MIN),

  // Master pitch
  pitchAdjust: bipolar('pitchAdjust', 'Pitch', 'amp', 'pitchAdjust', 50, H_ZERO),

  // Effects
  modFXRate: unipolar('modFXRate', 'Rate', 'modFX', 'modFXRate', H_MIN),
  modFXDepth: unipolar('modFXDepth', 'Depth', 'modFX', 'modFXDepth', H_MIN),
  modFXOffset: unipolar('modFXOffset', 'Offset', 'modFX', 'modFXOffset', H_ZERO),
  modFXFeedback: unipolar('modFXFeedback', 'Feedback', 'modFX', 'modFXFeedback', H_MIN),
  delayRate: unipolar('delayRate', 'Rate', 'delay', 'delayRate', H_ZERO),
  delayFeedback: unipolar('delayFeedback', 'Feedback', 'delay', 'delayFeedback', H_MIN),
  reverbAmount: unipolar('reverbAmount', 'Reverb', 'reverb', 'reverbAmount', H_MIN),
  bitCrush: unipolar('bitCrush', 'Bit Crush', 'distortion', 'bitCrush', H_MIN),
  sampleRateReduction: unipolar('sampleRateReduction', 'Sample Rate', 'distortion', 'sampleRateReduction', H_MIN),
  stutterRate: unipolar('stutterRate', 'Stutter', 'stutter', 'stutterRate', H_ZERO),

  // Arpeggiator
  arpeggiatorGate: unipolar('arpeggiatorGate', 'Gate', 'arpeggiator', 'arpeggiatorGate', H_ZERO),
  arpeggiatorRate: unipolar('arpeggiatorRate', 'Rate', 'arpeggiator', 'arpeggiatorRate', H_ZERO),

  // Portamento / compressor shape
  portamento: unipolar('portamento', 'Portamento', 'amp', 'portamento', H_MIN),
  compressorShape: bipolar('compressorShape', 'Shape', 'compressor', 'compressorShape', 50, '0xDC28F5B2'),
}

/**
 * Metadata for envelope attack/decay/sustain/release. The same unipolar
 * mapping applies to each of the four segments on both envelope1 and envelope2.
 */
export const ENVELOPE_PARAM_META: Record<string, ParamMeta> = {
  attack: unipolar('envAttack', 'Attack', 'envelope', 'attack', H_MIN),
  decay: unipolar('envDecay', 'Decay', 'envelope', 'decay', H_MIN),
  sustain: unipolar('envSustain', 'Sustain', 'envelope', 'sustain', H_MAX),
  release: unipolar('envRelease', 'Release', 'envelope', 'release', H_MIN),
}

/** Patch cable amounts are bipolar -50..+50 matching the device UI. */
export const PATCH_CABLE_AMOUNT_META: ParamMeta = bipolar(
  'patchCableAmount',
  'Amount',
  'patchCable',
  'amount',
  50,
  H_ZERO,
)

/**
 * Look up parameter metadata by its XML attribute name.
 * Returns undefined for unknown keys (e.g. new params the editor doesn't
 * recognize yet).
 */
export function getParamMeta(xmlKey: string): ParamMeta | undefined {
  return PARAM_META[xmlKey]
}

// ---------------------------------------------------------------------------
// Module display names
// ---------------------------------------------------------------------------

/**
 * Map internal module IDs (the `module` field on `ParamMeta`) to human-readable
 * display names used in the editor UI and in diff output.
 */
export const MODULE_DISPLAY_NAMES: Record<string, string> = {
  osc1: 'OSC 1',
  osc2: 'OSC 2',
  noise: 'Noise',
  amp: 'AMP',
  lpf: 'LPF',
  hpf: 'HPF',
  lfo1: 'LFO 1',
  lfo2: 'LFO 2',
  modulator1: 'FM',
  modulator2: 'FM',
  modFX: 'Mod FX',
  delay: 'Delay',
  reverb: 'Reverb',
  arpeggiator: 'Arpeggiator',
  stutter: 'Stutter',
  distortion: 'Distortion',
  compressor: 'Compressor',
  patchCable: 'Patch Cables',
  envelope: 'Envelope',
  envelope1: 'Envelope 1',
  envelope2: 'Envelope 2',
}

/** Resolve a module ID to its display name, or return the ID unchanged. */
export function moduleDisplayName(moduleId: string): string {
  return MODULE_DISPLAY_NAMES[moduleId] ?? moduleId
}
