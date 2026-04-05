<script setup lang="ts">
// Controlled preset randomizer ("PatchMorph").
//
// Per-section intensity sliders decide how much each part of the patch is
// reshuffled when the user hits Apply. A master slider pins all sections to
// the same value for a quick "gimme 40% random". The morph stays inside
// hardcoded safety bounds so the result is always musically usable and the
// XML stays loadable on a real Deluge.
//
// Hitting Apply snapshots the current sound so Undo always returns to the
// pre-morph state, regardless of how many times Apply has been pressed.

import { ref, computed } from 'vue'
import {
  PARAM_META,
  displayToHexLinear,
  type ParamMeta,
} from '@/lib/values/paramMeta'
import { DESTINATION_TO_PARAM_KEY } from '@/lib/values/patchCables'

type SoundLike = Record<string, unknown>

const props = withDefaults(
  defineProps<{
    sound: SoundLike
    readonly?: boolean
  }>(),
  { readonly: false },
)

const emit = defineEmits<{
  'update:sound': [sound: SoundLike]
}>()

// ---------------------------------------------------------------------------
// Safety limits (display-space)
// ---------------------------------------------------------------------------
// Values are capped to these display-space ranges even at intensity 100. The
// lower bound is always meta.min; only the upper bound is restricted.

const OSC_VOLUME_MAX = 40
const DELAY_FB_MAX = 25
const FX_GENERIC_MAX = 40
const ENVELOPE_MAX = 40
const MAX_MORPH_CABLES = 8

// ---------------------------------------------------------------------------
// Section intensity state
// ---------------------------------------------------------------------------

interface SectionIntensity {
  oscillators: number
  filters: number
  envelopes: number
  effects: number
  modulation: number
}

const intensity = ref<SectionIntensity>({
  oscillators: 40,
  filters: 40,
  envelopes: 40,
  effects: 40,
  modulation: 20,
})

const master = ref(40)

function applyMasterTo(value: number) {
  intensity.value = {
    oscillators: value,
    filters: value,
    envelopes: value,
    effects: value,
    modulation: Math.min(50, value), // keep cable gen moderate
  }
}

function onMasterInput(event: Event) {
  const v = Number((event.target as HTMLInputElement).value)
  master.value = v
  applyMasterTo(v)
}

function onIntensityInput(key: keyof SectionIntensity, event: Event) {
  const v = Number((event.target as HTMLInputElement).value)
  intensity.value = { ...intensity.value, [key]: v }
}

// ---------------------------------------------------------------------------
// Randomization helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Pick a new display value for a parameter with a unipolar / bipolar range,
 * interpolating between the current value and a random target value by the
 * given intensity (0..100). `maxDisplay` caps the upper bound for safety.
 */
function morphDisplayValue(
  current: number,
  meta: ParamMeta,
  intensityPct: number,
  maxDisplay?: number,
): number {
  const upperBound = maxDisplay !== undefined ? Math.min(meta.max, maxDisplay) : meta.max
  const lowerBound = meta.bipolar ? Math.max(meta.min, -upperBound) : meta.min
  const target = lowerBound + Math.random() * (upperBound - lowerBound)
  // Linear blend from current to target by intensity.
  const t = intensityPct / 100
  const result = current * (1 - t) + target * t
  return Math.round(clamp(result, lowerBound, upperBound))
}

function currentDisplay(
  defaultParams: Record<string, unknown>,
  key: string,
  meta: ParamMeta,
): number {
  const raw = (defaultParams[key] as string | undefined) ?? meta.default
  return hexToDisplayFromMeta(raw, meta)
}

function hexToDisplayFromMeta(hex: string, meta: ParamMeta): number {
  // Inline a linear hex->display, tolerating bad input.
  try {
    let v = parseInt(hex.substring(2, 10), 16)
    if (Number.isNaN(v)) return meta.min
    if (v & 0x80000000) v -= 0x100000000
    const unit = (v - (-0x80000000)) / 0x100000000
    return Math.round(meta.min + unit * (meta.max - meta.min))
  } catch {
    return meta.min
  }
}

// ---------------------------------------------------------------------------
// Morph generators per section
// ---------------------------------------------------------------------------

interface MorphUpdate {
  paramKey: string
  hex: string
}

function morphOscillators(
  defaultParams: Record<string, unknown>,
  pct: number,
): MorphUpdate[] {
  if (pct <= 0) return []
  const keys = ['oscAVolume', 'oscBVolume', 'oscAPulseWidth', 'oscBPulseWidth']
  const out: MorphUpdate[] = []
  for (const key of keys) {
    const meta = PARAM_META[key]
    if (!meta) continue
    const cap = key.endsWith('Volume') ? OSC_VOLUME_MAX : undefined
    const current = currentDisplay(defaultParams, key, meta)
    const next = morphDisplayValue(current, meta, pct, cap)
    out.push({ paramKey: key, hex: displayToHexLinear(next, meta.min, meta.max) })
  }
  return out
}

function morphFilters(
  defaultParams: Record<string, unknown>,
  pct: number,
): MorphUpdate[] {
  if (pct <= 0) return []
  const keys = ['lpfFrequency', 'lpfResonance', 'hpfFrequency', 'hpfResonance']
  const out: MorphUpdate[] = []
  for (const key of keys) {
    const meta = PARAM_META[key]
    if (!meta) continue
    // Resonance benefits from a lower cap; an open filter with high Q gets
    // harsh fast.
    const cap = key.endsWith('Resonance') ? 30 : undefined
    const current = currentDisplay(defaultParams, key, meta)
    const next = morphDisplayValue(current, meta, pct, cap)
    out.push({ paramKey: key, hex: displayToHexLinear(next, meta.min, meta.max) })
  }
  return out
}

function morphEffects(
  defaultParams: Record<string, unknown>,
  pct: number,
): MorphUpdate[] {
  if (pct <= 0) return []
  const out: MorphUpdate[] = []
  const fxKeys = ['modFXRate', 'modFXDepth', 'modFXFeedback', 'delayRate', 'reverbAmount']
  for (const key of fxKeys) {
    const meta = PARAM_META[key]
    if (!meta) continue
    const current = currentDisplay(defaultParams, key, meta)
    const next = morphDisplayValue(current, meta, pct, FX_GENERIC_MAX)
    out.push({ paramKey: key, hex: displayToHexLinear(next, meta.min, meta.max) })
  }
  // Delay feedback gets its own tighter cap
  const fb = PARAM_META.delayFeedback
  if (fb) {
    const current = currentDisplay(defaultParams, 'delayFeedback', fb)
    const next = morphDisplayValue(current, fb, pct, DELAY_FB_MAX)
    out.push({
      paramKey: 'delayFeedback',
      hex: displayToHexLinear(next, fb.min, fb.max),
    })
  }
  return out
}

/**
 * Envelope morphing is not a 0-100 random target: the slider selects a
 * target envelope shape from "short" (intensity 0) to "long" (intensity 100).
 * Attack and release scale with the slider; sustain is held at its current
 * value because randomizing sustain makes patches disappear.
 */
interface EnvelopeUpdate {
  envKey: 'envelope1' | 'envelope2'
  attack: string
  decay: string
  release: string
}

function morphEnvelopes(pct: number): EnvelopeUpdate[] {
  if (pct <= 0) return []
  const envMeta: ParamMeta = {
    id: 'envStage',
    displayName: 'Stage',
    module: 'envelope',
    xmlAttribute: 'stage',
    formatter: 'unipolar',
    min: 0,
    max: 50,
    default: '0x80000000',
    bipolar: false,
  }
  const t = pct / 100
  // Short end: attack 0, release 0, decay 10
  // Long end:  attack ENVELOPE_MAX, release ENVELOPE_MAX, decay ENVELOPE_MAX
  const attack = Math.round(t * ENVELOPE_MAX)
  const release = Math.round(t * ENVELOPE_MAX)
  const decay = Math.round(10 + t * (ENVELOPE_MAX - 10))
  const toHex = (v: number) => displayToHexLinear(v, envMeta.min, envMeta.max)
  return (['envelope1', 'envelope2'] as const).map((envKey) => ({
    envKey,
    attack: toHex(attack),
    decay: toHex(decay),
    release: toHex(release),
  }))
}

// Candidate modulation cables the morph can introduce at random. Sources and
// destinations are restricted to the subset the editor knows how to render.
const MORPH_SOURCES = ['envelope1', 'envelope2', 'lfo1', 'lfo2', 'velocity', 'note', 'random']
const MORPH_DESTINATIONS = ['volume', 'pan', 'lpfFrequency', 'lpfResonance', 'pitch', 'oscAVolume', 'oscBVolume']

interface CableMorph {
  source: string
  destination: string
  amount: string
}

function morphCables(pct: number): CableMorph[] {
  if (pct <= 0) return []
  const count = Math.round((pct / 100) * MAX_MORPH_CABLES)
  if (count <= 0) return []
  const out: CableMorph[] = []
  const used = new Set<string>()
  for (let i = 0; i < count * 3 && out.length < count; i++) {
    const src = MORPH_SOURCES[Math.floor(Math.random() * MORPH_SOURCES.length)]
    const dst = MORPH_DESTINATIONS[Math.floor(Math.random() * MORPH_DESTINATIONS.length)]
    const key = `${src}->${dst}`
    if (used.has(key)) continue
    used.add(key)
    // Cable depths are bipolar, so pick a signed range in [-40, +40].
    const depth = Math.round((Math.random() * 2 - 1) * 40)
    const hex = displayToHexLinear(depth, -50, 50)
    out.push({ source: src, destination: dst, amount: hex })
  }
  return out
}

// ---------------------------------------------------------------------------
// Apply / undo
// ---------------------------------------------------------------------------

const preMorphSound = ref<SoundLike | null>(null)

function cloneWithProto<T extends object>(obj: T): T {
  const clone = Object.create(Object.getPrototypeOf(obj))
  Object.assign(clone, obj)
  return clone
}

function apply() {
  if (props.readonly) return

  // Capture the pre-morph state for a clean undo path.
  preMorphSound.value = props.sound

  const defaultParams = (props.sound.defaultParams ?? {}) as Record<string, unknown>
  const updates: MorphUpdate[] = [
    ...morphOscillators(defaultParams, intensity.value.oscillators),
    ...morphFilters(defaultParams, intensity.value.filters),
    ...morphEffects(defaultParams, intensity.value.effects),
  ]

  const newDefaults = cloneWithProto(defaultParams)
  for (const u of updates) {
    newDefaults[u.paramKey] = u.hex
  }

  // Envelopes
  const envUpdates = morphEnvelopes(intensity.value.envelopes)
  for (const envU of envUpdates) {
    const current = (defaultParams[envU.envKey] ?? {}) as Record<string, string>
    const newEnv = cloneWithProto(current)
    newEnv.attack = envU.attack
    newEnv.decay = envU.decay
    newEnv.release = envU.release
    newDefaults[envU.envKey] = newEnv
  }

  // Cables
  if (intensity.value.modulation > 0) {
    const newCables = morphCables(intensity.value.modulation)
    if (newCables.length > 0) {
      const resolved = newCables.map((c) => ({
        source: c.source,
        destination: c.destination,
        amount: c.amount,
        // Surface the destination-to-paramKey mapping only for reference; the
        // firmware stores destinations using their own vocabulary.
        _resolvedKey: DESTINATION_TO_PARAM_KEY[c.destination] ?? c.destination,
      })) as unknown as Array<{ source: string; destination: string; amount: string }>

      const container = (newDefaults.patchCables ?? {}) as {
        patchCable?: Record<string, unknown> | Record<string, unknown>[]
      }
      newDefaults.patchCables = {
        ...container,
        patchCable: resolved.length === 1 ? resolved[0] : resolved,
      }
    }
  }

  const newSound = cloneWithProto(props.sound)
  newSound.defaultParams = newDefaults
  emit('update:sound', newSound)
}

function undo() {
  if (props.readonly || !preMorphSound.value) return
  emit('update:sound', preMorphSound.value)
  preMorphSound.value = null
}

const canUndo = computed(() => preMorphSound.value !== null)

// ---------------------------------------------------------------------------
// Section display config
// ---------------------------------------------------------------------------

interface Section {
  key: keyof SectionIntensity
  label: string
  description: string
}

const SECTIONS: Section[] = [
  { key: 'oscillators', label: 'Oscillators', description: 'Random volumes & PW' },
  { key: 'filters', label: 'Filters', description: 'LPF / HPF sweep' },
  { key: 'envelopes', label: 'Envelopes', description: 'Short ↔ long' },
  { key: 'effects', label: 'Effects', description: 'Delay / Reverb / Mod FX' },
  { key: 'modulation', label: 'Modulation', description: 'Random cables' },
]
</script>

<template>
  <div
    class="patch-morph flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
    data-testid="patch-morph"
  >
    <header class="flex items-center justify-between gap-2">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
        Patch Morph
      </h3>
      <div class="flex items-center gap-1">
        <button
          type="button"
          data-testid="morph-apply"
          class="rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-500 disabled:opacity-40"
          :disabled="readonly"
          @click="apply"
        >
          Apply
        </button>
        <button
          type="button"
          data-testid="morph-undo"
          class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700"
          :disabled="!canUndo || readonly"
          @click="undo"
        >
          Undo
        </button>
      </div>
    </header>

    <!-- Master slider -->
    <label class="flex items-center gap-2 border-b border-slate-200 pb-2 text-xs dark:border-slate-700">
      <span class="w-24 font-medium text-slate-700 dark:text-slate-200">Master</span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        :value="master"
        :disabled="readonly"
        data-testid="morph-master"
        class="flex-1 accent-sky-500"
        @input="onMasterInput"
      />
      <span class="w-8 text-right font-mono text-slate-500 dark:text-slate-400">{{ master }}</span>
    </label>

    <!-- Per-section sliders -->
    <div class="flex flex-col gap-2">
      <label
        v-for="section in SECTIONS"
        :key="section.key"
        class="flex items-center gap-2 text-xs"
      >
        <span class="w-24 text-slate-700 dark:text-slate-200">
          {{ section.label }}
          <span class="block text-[9px] text-slate-400 dark:text-slate-500">
            {{ section.description }}
          </span>
        </span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          :value="intensity[section.key]"
          :disabled="readonly"
          :data-testid="`morph-${section.key}`"
          class="flex-1 accent-sky-500"
          @input="(e) => onIntensityInput(section.key, e)"
        />
        <span class="w-8 text-right font-mono text-slate-500 dark:text-slate-400">
          {{ intensity[section.key] }}
        </span>
      </label>
    </div>

    <p class="text-[10px] italic text-slate-500 dark:text-slate-400">
      Morphs stay inside hardcoded safety bounds (OSC ≤ {{ OSC_VOLUME_MAX }}, delay FB ≤
      {{ DELAY_FB_MAX }}, effects ≤ {{ FX_GENERIC_MAX }}, envelopes ≤ {{ ENVELOPE_MAX }}).
    </p>
  </div>
</template>
