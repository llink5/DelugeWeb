// Deluge parameter value formatters.
// Convert raw hex / numeric values from Deluge XML into human-readable form.
// Ported from downrush/viewScore/src/FmtSound.js

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse a hex string (0x...) to a signed 32-bit integer. */
function hexToSigned32(hex: string): number {
  let v = parseInt(hex.substring(2, 10), 16)
  if (v & 0x80000000) v -= 0x100000000
  return v
}

/** Returns true if the value is a hex string (starts with "0x"). */
function isHex(v: string): boolean {
  return v.startsWith('0x')
}

/** Append ellipsis indicator if the hex string has trailing data beyond 10 chars. */
function maybeEllipsis(v: string, result: number | string): string | number {
  if (v.length > 10) return String(result) + '...'
  return result
}

// ---------------------------------------------------------------------------
// Sync level name table
// ---------------------------------------------------------------------------

const syncLevelTab = [
  'off', '4 bars', '2 bars', '1 bar', '2nd', '4th', '8th', '16th', '32nd', '64th',
]

// ---------------------------------------------------------------------------
// Priority name table
// ---------------------------------------------------------------------------

const priorityTab = ['low', 'medium', 'high']

// ---------------------------------------------------------------------------
// Public formatters
// ---------------------------------------------------------------------------

/**
 * Convert a hex value to the 0-50 range.
 * Maps the full signed 32-bit range [0x80000000 .. 0x7FFFFFFF] to [0 .. 50].
 */
export function fixh(v: unknown): unknown {
  if (v === undefined) return v
  if (typeof v !== 'string') return v
  if (!isHex(v)) return v

  const asInt = hexToSigned32(v)
  const ranged = Math.round(((asInt + 0x80000000) * 50) / 0x100000000)
  return maybeEllipsis(v, ranged)
}

/**
 * Convert a hex value to the -50..+50 range (mod matrix weights).
 * Maps 0xC0000000..0x3FFFFFFF to -50..50.
 */
export function fixm50to50(v: unknown): unknown {
  if (v === undefined) return 0
  if (typeof v !== 'string') return v
  if (!isHex(v)) return v

  const asInt = hexToSigned32(v)
  const res = Math.round(((asInt + 0x80000000) * 200) / 0x100000000) - 100
  return maybeEllipsis(v, res)
}

/**
 * Convert a hex value to a pan display string: "16L", "0", or "16R".
 */
export function fixpan(v: unknown): unknown {
  if (v === undefined) return 0
  if (typeof v !== 'string') return v
  if (!isHex(v)) return v

  const asInt = hexToSigned32(v)
  const rangedm32to32 = Math.round(((asInt + 0x80000000) * 64) / 0x100000000) - 32
  let ranged: string | number
  if (rangedm32to32 === 0) ranged = 0
  else if (rangedm32to32 < 0) ranged = Math.abs(rangedm32to32) + 'L'
  else ranged = rangedm32to32 + 'R'
  return maybeEllipsis(v, ranged)
}

/**
 * Convert a retrigger phase value to degrees, or "off" if -1.
 */
export function fixphase(v: unknown): unknown {
  if (v === undefined) return v
  const vn = Number(v)
  if (vn === -1) return 'off'
  return Math.round((vn >>> 0) / 11930464)
}

/**
 * Scale a positive hex value (0x00000000..0x7FFFFFFF) to 0-50.
 */
export function fixpos50(v: unknown): unknown {
  if (v === undefined) return undefined
  if (typeof v !== 'string') return v
  if (!isHex(v)) return v

  const asInt = parseInt(v.substring(2, 10), 16)
  const ranged = Math.round((asInt * 50) / 0x7fffffff)
  return maybeEllipsis(v, ranged)
}

/**
 * Convert a reverb amount (numeric) to the 0-50 range.
 */
export function fixrev(v: unknown): unknown {
  if (v === undefined) return v
  const vn = Number(v)
  return Math.round((vn * 50) / 0x7fffffff)
}

/**
 * Convert a hex value to MIDI CC range 0-127.
 */
export function fmtMidiCC(v: unknown): unknown {
  if (v === undefined) return 0
  if (typeof v !== 'string') return v
  if (!isHex(v)) return v

  const asInt = hexToSigned32(v)
  const res = Math.round(((asInt + 0x80000000) * 127) / 0x100000000)
  return maybeEllipsis(v, res)
}

/**
 * Format a modulator destination: 0 -> "carrier", 1 -> "mod 1".
 */
export function fmtmoddest(v: unknown): string {
  if (v === undefined) return ''
  const tvn = Number(v)
  if (tvn === 0) return 'carrier'
  if (tvn === 1) return 'mod 1'
  return 'Unknown'
}

/**
 * Format an on/off toggle: > 0 -> "on", else "off".
 */
export function fmtonoff(v: unknown): string {
  if (v === undefined) return ''
  const tvn = Number(v)
  if (tvn > 0) return 'on'
  return 'off'
}

/**
 * Format a voice priority value: 0 -> "low", 1 -> "medium", 2 -> "high".
 */
export function fmtprior(v: unknown): string {
  if (v === undefined) return ''
  const p = Number(v)
  if (p < 0 || p >= priorityTab.length) return ''
  return priorityTab[p]
}

/**
 * Format interpolation mode: 1 -> "linear", else "sinc".
 */
export function fmtinterp(v: unknown): string | null {
  if (v === undefined) return null
  if (Number(v) === 1) return 'linear'
  return 'sinc'
}

/**
 * Format a sync level index to its name.
 */
export function fmtsync(v: unknown): string {
  if (v === undefined) return ''
  const tvn = Number(v)
  if (tvn < 0 || tvn >= syncLevelTab.length) return ''
  return syncLevelTab[tvn]
}

/**
 * Format a time value (in ms) to seconds with 3 decimal places.
 */
export function fmttime(v: unknown): string | undefined {
  if (v === undefined) return v
  const t = Number(v) / 1000
  return t.toFixed(3)
}

/**
 * Format oscillator transpose: transpose + cents/100.
 * Expects an object with `transpose` and `cents` properties.
 */
export function fmttransp(osc: Record<string, unknown> | undefined): string {
  if (osc === undefined) return ''
  if (osc.transpose === undefined) return ''
  const amt = Number(osc.transpose) + Number(osc.cents) / 100
  return amt.toFixed(2)
}

// ---------------------------------------------------------------------------
// Convenience dispatcher
// ---------------------------------------------------------------------------

/** Map of parameter keys to their formatter functions. */
const paramFormatters: Record<string, (v: unknown) => unknown> = {
  // 0-50 range params
  volume: fixh,
  oscAVolume: fixh,
  oscAPulseWidth: fixh,
  oscBVolume: fixh,
  oscBPulseWidth: fixh,
  noiseVolume: fixh,
  lpfFrequency: fixh,
  lpfResonance: fixh,
  hpfFrequency: fixh,
  hpfResonance: fixh,
  lfo1Rate: fixh,
  lfo2Rate: fixh,
  modFXRate: fixh,
  modFXDepth: fixh,
  delayRate: fixh,
  delayFeedback: fixh,
  reverbAmount: fixh,
  arpeggiatorRate: fixh,
  arpeggiatorGate: fixh,
  portamento: fixh,
  compressorShape: fixh,
  stutterRate: fixh,
  sampleRateReduction: fixh,
  bitCrush: fixh,
  modFXOffset: fixh,
  modFXFeedback: fixh,
  pitchAdjust: fixh,

  // mod matrix (patch cable amounts)
  amount: fixm50to50,
  modulator1Amount: fixm50to50,
  modulator1Feedback: fixm50to50,
  modulator2Amount: fixm50to50,
  modulator2Feedback: fixm50to50,
  carrier1Feedback: fixm50to50,
  carrier2Feedback: fixm50to50,

  // pan
  pan: fixpan,

  // positive 0-50
  roomSize: fixpos50,
  dampening: fixpos50,
  width: fixpos50,
  bass: fixpos50,
  treble: fixpos50,
  bassFrequency: fixpos50,
  trebleFrequency: fixpos50,
  frequency: fixpos50,
  resonance: fixpos50,

  // envelope times
  attack: fixh,
  decay: fixh,
  sustain: fixh,
  release: fixh,

  // sync levels
  syncLevel: fmtsync,

  // on/off
  pingPong: fmtonoff,
  analog: fmtonoff,

  // priority
  voicePriority: fmtprior,

  // interpolation
  linearInterpolation: fmtinterp,

  // phase
  retrigPhase: fixphase,
}

/**
 * Format a single parameter value by key name.
 * Falls back to returning the raw value if no formatter is registered.
 */
export function formatParam(key: string, value: unknown): unknown {
  const fmt = paramFormatters[key]
  if (fmt) return fmt(value)
  return value
}
