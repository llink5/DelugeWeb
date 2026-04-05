// Semantic parameter diff for parsed Deluge sound objects.
//
// Compares two sound objects (as produced by parsePreset) and returns
// structured changes grouped by module. Uses the central `PARAM_META` /
// `ENVELOPE_PARAM_META` tables for parameter metadata and display conversion,
// so the diff output stays consistent with the editor's knob labels.

import {
  PARAM_META,
  ENVELOPE_PARAM_META,
  hexToDisplay,
  moduleDisplayName,
  type ParamMeta,
} from '../values/paramMeta'

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface DiffEntry {
  module: string
  param: string
  paramKey: string
  valueA?: string | number
  valueB?: string | number
  hexA?: string
  hexB?: string
}

export interface DiffResult {
  changed: DiffEntry[]
  added: DiffEntry[]
  removed: DiffEntry[]
}

// ---------------------------------------------------------------------------
// Per-parameter module overrides
// ---------------------------------------------------------------------------
//
// PARAM_META groups some parameters under logical modules that suit the
// editor's knob layout (e.g. pitchAdjust under 'amp'). The diff view groups
// them differently for readability. These overrides apply on top of the
// central metadata table.

const DIFF_MODULE_OVERRIDES: Record<string, string> = {
  pitchAdjust: 'General',
  portamento: 'General',
  compressorShape: 'Compressor',
  modulator1Amount: 'FM',
  modulator1Feedback: 'FM',
  modulator2Amount: 'FM',
  modulator2Feedback: 'FM',
  carrier1Feedback: 'FM',
  carrier2Feedback: 'FM',
}

const DIFF_NAME_OVERRIDES: Record<string, string> = {
  modulator1Amount: 'Mod 1 Amount',
  modulator1Feedback: 'Mod 1 Feedback',
  modulator2Amount: 'Mod 2 Amount',
  modulator2Feedback: 'Mod 2 Feedback',
  carrier1Feedback: 'Carrier 1 FB',
  carrier2Feedback: 'Carrier 2 FB',
  pitchAdjust: 'Pitch Adjust',
  compressorShape: 'Shape',
  sampleRateReduction: 'SR Reduction',
}

function diffModuleFor(paramKey: string, meta: ParamMeta): string {
  return DIFF_MODULE_OVERRIDES[paramKey] ?? moduleDisplayName(meta.module)
}

function diffNameFor(paramKey: string, meta: ParamMeta): string {
  return DIFF_NAME_OVERRIDES[paramKey] ?? meta.displayName
}

// Parameters that live under defaultParams.lpf / defaultParams.hpf subobjects.
// These are only present in kit-style XML where the filter is a nested element.
const FILTER_SUB_PARAM_META: Record<string, { displayName: string }> = {
  frequency: { displayName: 'Frequency' },
  resonance: { displayName: 'Resonance' },
}

// Top-level sound attributes we surface in the diff as 'General' entries.
const TOP_LEVEL_ENUM_FIELDS: Record<string, string> = {
  name:       'Name',
  mode:       'Synth Mode',
  lpfMode:    'LPF Mode',
  modFXType:  'Mod FX Type',
  transpose:  'Transpose',
  polyphonic: 'Polyphonic',
}

// ---------------------------------------------------------------------------
// Value formatting — thin wrapper that falls back to raw hex on error
// ---------------------------------------------------------------------------

function safeHexToDisplay(hex: string, meta: ParamMeta): string | number {
  if (typeof hex !== 'string') return String(hex)
  try {
    return hexToDisplay(hex, meta)
  } catch {
    return hex
  }
}

// A synthetic bipolar meta used for patch cable amounts (display range -50..+50).
const CABLE_AMOUNT_META: ParamMeta = {
  id: 'patchCableAmount',
  displayName: 'Amount',
  module: 'patchCable',
  xmlAttribute: 'amount',
  formatter: 'bipolar',
  min: -50,
  max: 50,
  default: '0x00000000',
  bipolar: true,
}

// Filter sub-object params (nested <lpf>/<hpf>) are unipolar 0..50.
function filterSubParamMeta(displayName: string, module: string): ParamMeta {
  return {
    id: `${module}.${displayName}`,
    displayName,
    module,
    xmlAttribute: displayName.toLowerCase(),
    formatter: 'unipolar',
    min: 0,
    max: 50,
    default: '0x80000000',
    bipolar: false,
  }
}

// ---------------------------------------------------------------------------
// Safe property access
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function getString(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined
  const v = obj[key]
  if (v === undefined || v === null) return undefined
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return undefined
}

function getRecord(obj: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(obj)) return undefined
  const v = obj[key]
  return isRecord(v) ? v : undefined
}

// ---------------------------------------------------------------------------
// Patch cable flattening
// ---------------------------------------------------------------------------

interface CableInfo {
  source: string
  destination: string
  amount: string
}

function asCableArray(patchCables: unknown): CableInfo[] {
  const container = isRecord(patchCables) ? patchCables['patchCable'] : patchCables
  if (container === undefined || container === null) return []
  const list = Array.isArray(container) ? container : [container]
  const result: CableInfo[] = []
  for (const raw of list) {
    if (!isRecord(raw)) continue
    const source = getString(raw, 'source') ?? '?'
    const destination = getString(raw, 'destination') ?? '?'
    const amount = getString(raw, 'amount') ?? '0x00000000'
    result.push({ source, destination, amount })
  }
  return result
}

// ---------------------------------------------------------------------------
// Parameter extraction
// ---------------------------------------------------------------------------

interface ExtractedParam {
  paramKey: string
  module: string
  displayName: string
  hex: string
  display: string | number
}

interface ExtractedEnum {
  paramKey: string
  module: string
  displayName: string
  value: string
}

interface ExtractedCable {
  paramKey: string     // 'cable:source->destination'
  source: string
  destination: string
  hex: string
  display: string | number
}

interface Extraction {
  params: Map<string, ExtractedParam>
  enums: Map<string, ExtractedEnum>
  cables: Map<string, ExtractedCable>
}

function extract(sound: unknown): Extraction {
  const params = new Map<string, ExtractedParam>()
  const enums = new Map<string, ExtractedEnum>()
  const cables = new Map<string, ExtractedCable>()

  if (!isRecord(sound)) {
    return { params, enums, cables }
  }

  // Top-level enum/general fields
  for (const [attr, label] of Object.entries(TOP_LEVEL_ENUM_FIELDS)) {
    const v = getString(sound, attr)
    if (v !== undefined) {
      enums.set(attr, {
        paramKey: attr,
        module: 'General',
        displayName: label,
        value: v,
      })
    }
  }

  const defaultParams = getRecord(sound, 'defaultParams')
  if (defaultParams) {
    // Scalar default params — driven by the central PARAM_META table
    for (const [attr, meta] of Object.entries(PARAM_META)) {
      const raw = getString(defaultParams, attr)
      if (raw === undefined) continue
      params.set(attr, {
        paramKey: attr,
        module: diffModuleFor(attr, meta),
        displayName: diffNameFor(attr, meta),
        hex: raw,
        display: safeHexToDisplay(raw, meta),
      })
    }

    // Envelopes
    for (const envKey of ['envelope1', 'envelope2'] as const) {
      const env = getRecord(defaultParams, envKey)
      if (!env) continue
      const label = moduleDisplayName(envKey)
      for (const [stage, stageMeta] of Object.entries(ENVELOPE_PARAM_META)) {
        const raw = getString(env, stage)
        if (raw === undefined) continue
        const paramKey = `${envKey}.${stage}`
        params.set(paramKey, {
          paramKey,
          module: label,
          displayName: stageMeta.displayName,
          hex: raw,
          display: safeHexToDisplay(raw, stageMeta),
        })
      }
    }

    // Filter sub-objects (defaultParams.lpf / hpf) — nested form used by kits
    for (const filterKey of ['lpf', 'hpf'] as const) {
      const filt = getRecord(defaultParams, filterKey)
      if (!filt) continue
      const label = moduleDisplayName(filterKey)
      for (const [fattr, fmeta] of Object.entries(FILTER_SUB_PARAM_META)) {
        const raw = getString(filt, fattr)
        if (raw === undefined) continue
        const paramKey = `${filterKey}.${fattr}`
        const synthMeta = filterSubParamMeta(fmeta.displayName, filterKey)
        params.set(paramKey, {
          paramKey,
          module: label,
          displayName: fmeta.displayName,
          hex: raw,
          display: safeHexToDisplay(raw, synthMeta),
        })
      }
    }

    // Patch cables
    const cableList = asCableArray(defaultParams['patchCables'])
    for (const c of cableList) {
      const key = `${c.source}->${c.destination}`
      cables.set(key, {
        paramKey: `cable:${key}`,
        source: c.source,
        destination: c.destination,
        hex: c.amount,
        display: safeHexToDisplay(c.amount, CABLE_AMOUNT_META),
      })
    }
  }

  return { params, enums, cables }
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export function paramDiff(soundA: unknown, soundB: unknown): DiffResult {
  const a = extract(soundA)
  const b = extract(soundB)

  const changed: DiffEntry[] = []
  const added: DiffEntry[] = []
  const removed: DiffEntry[] = []

  // Scalar params
  const allParamKeys = new Set<string>([...a.params.keys(), ...b.params.keys()])
  for (const k of allParamKeys) {
    const ea = a.params.get(k)
    const eb = b.params.get(k)
    if (ea && eb) {
      if (ea.hex !== eb.hex) {
        changed.push({
          module: ea.module,
          param: ea.displayName,
          paramKey: k,
          valueA: ea.display,
          valueB: eb.display,
          hexA: ea.hex,
          hexB: eb.hex,
        })
      }
    } else if (eb) {
      added.push({
        module: eb.module,
        param: eb.displayName,
        paramKey: k,
        valueB: eb.display,
        hexB: eb.hex,
      })
    } else if (ea) {
      removed.push({
        module: ea.module,
        param: ea.displayName,
        paramKey: k,
        valueA: ea.display,
        hexA: ea.hex,
      })
    }
  }

  // Enum / top-level
  const allEnumKeys = new Set<string>([...a.enums.keys(), ...b.enums.keys()])
  for (const k of allEnumKeys) {
    const ea = a.enums.get(k)
    const eb = b.enums.get(k)
    if (ea && eb) {
      if (ea.value !== eb.value) {
        changed.push({
          module: ea.module,
          param: ea.displayName,
          paramKey: k,
          valueA: ea.value,
          valueB: eb.value,
        })
      }
    } else if (eb) {
      added.push({
        module: eb.module,
        param: eb.displayName,
        paramKey: k,
        valueB: eb.value,
      })
    } else if (ea) {
      removed.push({
        module: ea.module,
        param: ea.displayName,
        paramKey: k,
        valueA: ea.value,
      })
    }
  }

  // Patch cables
  const allCableKeys = new Set<string>([...a.cables.keys(), ...b.cables.keys()])
  for (const k of allCableKeys) {
    const ea = a.cables.get(k)
    const eb = b.cables.get(k)
    const paramName = `${(ea ?? eb)!.source} \u2192 ${(ea ?? eb)!.destination}`
    if (ea && eb) {
      if (ea.hex !== eb.hex) {
        changed.push({
          module: 'Patch Cables',
          param: paramName,
          paramKey: ea.paramKey,
          valueA: ea.display,
          valueB: eb.display,
          hexA: ea.hex,
          hexB: eb.hex,
        })
      }
    } else if (eb) {
      added.push({
        module: 'Patch Cables',
        param: paramName,
        paramKey: eb.paramKey,
        valueB: eb.display,
        hexB: eb.hex,
      })
    } else if (ea) {
      removed.push({
        module: 'Patch Cables',
        param: paramName,
        paramKey: ea.paramKey,
        valueA: ea.display,
        hexA: ea.hex,
      })
    }
  }

  return { changed, added, removed }
}
