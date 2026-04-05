<script setup lang="ts">
// The main sound editor: composes engine-module cards of parameter knobs
// around a parsed `sound` object from the Deluge XML model.
//
// The component is deliberately pure: it receives the sound as a prop and
// emits a new sound object on every edit. The parent (SynthView, KitView,
// SongView) owns the canonical state and can implement undo/redo on top.
//
// It works uniformly across contexts: a standalone synth preset, a kit row,
// or an instrument embedded in a song. The XML model is the same in every
// case; only the surrounding UI chrome differs.

import { computed, ref } from 'vue'
import KnobRing from './KnobRing.vue'
import EngineModule from './EngineModule.vue'
import EnvelopeCurve from './EnvelopeCurve.vue'
import LfoCurve from './LfoCurve.vue'
import EffectsPanel from './EffectsPanel.vue'
import ArpeggiatorPanel from './ArpeggiatorPanel.vue'
import ModMatrix from './ModMatrix.vue'
import ModSourcePanel from './ModSourcePanel.vue'
import PatchMorph from './PatchMorph.vue'
import { colorForSource } from './modSourceColors'
import {
  PARAM_META,
  ENVELOPE_PARAM_META,
  hexToDisplayLinear,
  hexToDisplay,
  displayToHex,
  type ParamMeta,
} from '@/lib/values/paramMeta'
import {
  asCableArray,
  cablesForParam,
  setCables,
  type PatchCable,
} from '@/lib/values/patchCables'

// SoundPreset as parsed from XML: a loose record with optional nested
// objects. Typing it precisely conflicts with the parser's dynamic shape.
type SoundLike = Record<string, unknown>

const props = withDefaults(
  defineProps<{
    sound: SoundLike
    context?: 'synth' | 'kit-row' | 'song-clip'
    readonly?: boolean
  }>(),
  { context: 'synth', readonly: false },
)

const emit = defineEmits<{
  'update:sound': [sound: SoundLike]
}>()

// ---------------------------------------------------------------------------
// Extracted sub-structures
// ---------------------------------------------------------------------------

const defaultParams = computed(
  () => (props.sound.defaultParams ?? {}) as Record<string, unknown>,
)

const cables = computed(() => {
  const container = defaultParams.value.patchCables as
    | { patchCable?: PatchCable | PatchCable[] }
    | undefined
  return asCableArray(container)
})

const synthMode = computed(() => String(props.sound.mode ?? 'subtractive'))

// ---------------------------------------------------------------------------
// Mod indicators per parameter
// ---------------------------------------------------------------------------

function modIndicatorsFor(paramKey: string) {
  const relevant = cablesForParam(cables.value, paramKey)
  const meta = PARAM_META[paramKey]
  if (!meta) return []
  return relevant
    .map((c) => {
      if (!c.source || !c.amount) return null
      // Cable amounts live in the bipolar -50..+50 display space
      const depth = hexToDisplayLinear(c.amount, -50, 50)
      const color = colorForSource(c.source).light
      // Scale depth to the host parameter's range so the indicator arc
      // visually matches the amount of modulation relative to the knob.
      const scaledDepth = (depth / 50) * ((meta.max - meta.min) / 2)
      return {
        sourceId: c.source,
        color,
        depth: scaledDepth,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

// ---------------------------------------------------------------------------
// Value extraction
// ---------------------------------------------------------------------------

interface KnobParam {
  meta: ParamMeta
  rawValue: string
  displayValue: number
}

function paramFor(key: string): KnobParam | null {
  const meta = PARAM_META[key]
  if (!meta) return null
  const rawValue = (defaultParams.value[key] as string | undefined) ?? meta.default
  const displayValue = hexToDisplayLinear(rawValue, meta.min, meta.max)
  return { meta, rawValue, displayValue }
}

// ---------------------------------------------------------------------------
// Edit handling
// ---------------------------------------------------------------------------

function cloneWithProto<T extends object>(obj: T): T {
  const clone = Object.create(Object.getPrototypeOf(obj))
  Object.assign(clone, obj)
  return clone
}

function onParamChange(hex: string, paramKey: string) {
  if (props.readonly) return
  const newDefaults = cloneWithProto(defaultParams.value)
  newDefaults[paramKey] = hex
  const newSound = cloneWithProto(props.sound)
  newSound.defaultParams = newDefaults
  emit('update:sound', newSound)
}

// ---------------------------------------------------------------------------
// Oscillator type / LPF mode selectors
// ---------------------------------------------------------------------------

const OSC_TYPES = [
  { value: 'saw', label: 'Saw' },
  { value: 'square', label: 'Square' },
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'analogSquare', label: 'Analog Sq' },
  { value: 'analogSaw', label: 'Analog Saw' },
  { value: 'wavetable', label: 'Wavetable' },
  { value: 'sample', label: 'Sample' },
]

const LPF_MODES = [
  { value: '24dB', label: '24dB' },
  { value: '12dB', label: '12dB' },
  { value: 'drive', label: 'Drive' },
]

const osc1Type = computed(() => {
  const o = props.sound.osc1 as Record<string, unknown> | undefined
  return (o?.type as string) ?? 'saw'
})
const osc2Type = computed(() => {
  const o = props.sound.osc2 as Record<string, unknown> | undefined
  return (o?.type as string) ?? 'saw'
})
const lpfMode = computed(() => (props.sound.lpfMode as string) ?? '24dB')

function updateOscType(osc: 'osc1' | 'osc2', value: string) {
  if (props.readonly) return
  const oscObj = (props.sound[osc] ?? {}) as Record<string, unknown>
  const newOsc = cloneWithProto(oscObj)
  newOsc.type = value
  const newSound = cloneWithProto(props.sound)
  newSound[osc] = newOsc
  emit('update:sound', newSound)
}

function updateLpfMode(value: string) {
  if (props.readonly) return
  const newSound = cloneWithProto(props.sound)
  newSound.lpfMode = value
  emit('update:sound', newSound)
}

// ---------------------------------------------------------------------------
// Module parameter lists
// ---------------------------------------------------------------------------

const OSC1_PARAMS = ['oscAVolume', 'oscAPulseWidth']
const OSC2_PARAMS = ['oscBVolume', 'oscBPulseWidth']
const LPF_PARAMS = ['lpfFrequency', 'lpfResonance']
const HPF_PARAMS = ['hpfFrequency', 'hpfResonance']
const AMP_PARAMS = ['volume', 'pan', 'pitchAdjust', 'portamento']
const FM_PARAMS = ['modulator1Amount', 'modulator1Feedback', 'modulator2Amount', 'modulator2Feedback']

const isFmMode = computed(() => synthMode.value === 'fm')

// ---------------------------------------------------------------------------
// Envelopes (env1 / env2)
// ---------------------------------------------------------------------------

interface EnvelopeValues {
  attack: number
  decay: number
  sustain: number
  release: number
}

function envelopeValues(envKey: 'envelope1' | 'envelope2'): EnvelopeValues {
  const env = (defaultParams.value[envKey] ?? {}) as Record<string, string | undefined>
  return {
    attack: hexToDisplay(env.attack ?? ENVELOPE_PARAM_META.attack.default, ENVELOPE_PARAM_META.attack),
    decay: hexToDisplay(env.decay ?? ENVELOPE_PARAM_META.decay.default, ENVELOPE_PARAM_META.decay),
    sustain: hexToDisplay(env.sustain ?? ENVELOPE_PARAM_META.sustain.default, ENVELOPE_PARAM_META.sustain),
    release: hexToDisplay(env.release ?? ENVELOPE_PARAM_META.release.default, ENVELOPE_PARAM_META.release),
  }
}

const env1Values = computed(() => envelopeValues('envelope1'))
const env2Values = computed(() => envelopeValues('envelope2'))

function onEnvelopeStageChange(
  envKey: 'envelope1' | 'envelope2',
  stage: 'attack' | 'decay' | 'sustain' | 'release',
  displayValue: number,
) {
  if (props.readonly) return
  const env = (defaultParams.value[envKey] ?? {}) as Record<string, string>
  const newEnv = cloneWithProto(env)
  newEnv[stage] = displayToHex(displayValue, ENVELOPE_PARAM_META[stage])
  const newDefaults = cloneWithProto(defaultParams.value)
  newDefaults[envKey] = newEnv
  const newSound = cloneWithProto(props.sound)
  newSound.defaultParams = newDefaults
  emit('update:sound', newSound)
}

// ---------------------------------------------------------------------------
// LFOs
// ---------------------------------------------------------------------------

const LFO_TYPES = [
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'saw', label: 'Saw' },
  { value: 'square', label: 'Square' },
  { value: 'sampleAndHold', label: 'S&H' },
  { value: 'random', label: 'Random' },
]

const lfo1Type = computed(() => {
  const l = props.sound.lfo1 as Record<string, unknown> | undefined
  return (l?.type as string) ?? 'triangle'
})
const lfo2Type = computed(() => {
  const l = props.sound.lfo2 as Record<string, unknown> | undefined
  return (l?.type as string) ?? 'triangle'
})

function updateLfoType(lfo: 'lfo1' | 'lfo2', value: string) {
  if (props.readonly) return
  const lfoObj = (props.sound[lfo] ?? {}) as Record<string, unknown>
  const newLfo = cloneWithProto(lfoObj)
  newLfo.type = value
  const newSound = cloneWithProto(props.sound)
  newSound[lfo] = newLfo
  emit('update:sound', newSound)
}

// ---------------------------------------------------------------------------
// Patch cables (Mod Matrix)
// ---------------------------------------------------------------------------

const cableList = computed(() => cables.value)

function onCablesChange(newCables: PatchCable[]) {
  if (props.readonly) return
  const container = defaultParams.value.patchCables as
    | { patchCable?: PatchCable | PatchCable[] }
    | undefined
  const newContainer = setCables(container, newCables)
  const newDefaults = cloneWithProto(defaultParams.value)
  if (newContainer === undefined) {
    delete newDefaults.patchCables
  } else {
    newDefaults.patchCables = newContainer
  }
  const newSound = cloneWithProto(props.sound)
  newSound.defaultParams = newDefaults
  emit('update:sound', newSound)
}

// ---------------------------------------------------------------------------
// Collapsible sections
// ---------------------------------------------------------------------------

const showModMatrix = ref(true)
const showEffects = ref(true)
const showModulation = ref(true)
const showArpeggiator = ref(false)
const showPatchMorph = ref(false)
</script>

<template>
  <div class="sound-editor flex flex-col gap-3" :data-context="context">
    <!-- Engine row: oscillators, filters, amp -->
    <div class="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
      <EngineModule
        :title="isFmMode ? 'Carrier 1' : 'OSC 1'"
        :mode="osc1Type"
        :mode-options="OSC_TYPES"
        @update:mode="(v) => updateOscType('osc1', v)"
      >
        <template v-for="key in OSC1_PARAMS" :key="key">
          <KnobRing
            v-if="paramFor(key)"
            :label="paramFor(key)!.meta.displayName"
            :value="paramFor(key)!.displayValue"
            :raw-value="paramFor(key)!.rawValue"
            :min="paramFor(key)!.meta.min"
            :max="paramFor(key)!.meta.max"
            :bipolar="paramFor(key)!.meta.bipolar"
            :mod-sources="modIndicatorsFor(key)"
            :param-path="key"
            :readonly="readonly"
            @update:value="onParamChange"
          />
        </template>
      </EngineModule>

      <EngineModule
        :title="isFmMode ? 'Carrier 2' : 'OSC 2'"
        :mode="osc2Type"
        :mode-options="OSC_TYPES"
        @update:mode="(v) => updateOscType('osc2', v)"
      >
        <template v-for="key in OSC2_PARAMS" :key="key">
          <KnobRing
            v-if="paramFor(key)"
            :label="paramFor(key)!.meta.displayName"
            :value="paramFor(key)!.displayValue"
            :raw-value="paramFor(key)!.rawValue"
            :min="paramFor(key)!.meta.min"
            :max="paramFor(key)!.meta.max"
            :bipolar="paramFor(key)!.meta.bipolar"
            :mod-sources="modIndicatorsFor(key)"
            :param-path="key"
            :readonly="readonly"
            @update:value="onParamChange"
          />
        </template>
      </EngineModule>

      <EngineModule
        title="LPF"
        :mode="lpfMode"
        :mode-options="LPF_MODES"
        @update:mode="updateLpfMode"
      >
        <template v-for="key in LPF_PARAMS" :key="key">
          <KnobRing
            v-if="paramFor(key)"
            :label="paramFor(key)!.meta.displayName"
            :value="paramFor(key)!.displayValue"
            :raw-value="paramFor(key)!.rawValue"
            :min="paramFor(key)!.meta.min"
            :max="paramFor(key)!.meta.max"
            :bipolar="paramFor(key)!.meta.bipolar"
            :mod-sources="modIndicatorsFor(key)"
            :param-path="key"
            :readonly="readonly"
            @update:value="onParamChange"
          />
        </template>
      </EngineModule>

      <EngineModule title="HPF">
        <template v-for="key in HPF_PARAMS" :key="key">
          <KnobRing
            v-if="paramFor(key)"
            :label="paramFor(key)!.meta.displayName"
            :value="paramFor(key)!.displayValue"
            :raw-value="paramFor(key)!.rawValue"
            :min="paramFor(key)!.meta.min"
            :max="paramFor(key)!.meta.max"
            :bipolar="paramFor(key)!.meta.bipolar"
            :mod-sources="modIndicatorsFor(key)"
            :param-path="key"
            :readonly="readonly"
            @update:value="onParamChange"
          />
        </template>
      </EngineModule>

      <EngineModule title="AMP">
        <template v-for="key in AMP_PARAMS" :key="key">
          <KnobRing
            v-if="paramFor(key)"
            :label="paramFor(key)!.meta.displayName"
            :value="paramFor(key)!.displayValue"
            :raw-value="paramFor(key)!.rawValue"
            :min="paramFor(key)!.meta.min"
            :max="paramFor(key)!.meta.max"
            :bipolar="paramFor(key)!.meta.bipolar"
            :mod-sources="modIndicatorsFor(key)"
            :param-path="key"
            :readonly="readonly"
            @update:value="onParamChange"
          />
        </template>
      </EngineModule>
    </div>

    <!-- FM row only visible in FM mode -->
    <div v-if="isFmMode" class="grid grid-cols-2 gap-3 md:grid-cols-4">
      <EngineModule title="FM">
        <template v-for="key in FM_PARAMS" :key="key">
          <KnobRing
            v-if="paramFor(key)"
            :label="paramFor(key)!.meta.displayName"
            :value="paramFor(key)!.displayValue"
            :raw-value="paramFor(key)!.rawValue"
            :min="paramFor(key)!.meta.min"
            :max="paramFor(key)!.meta.max"
            :bipolar="paramFor(key)!.meta.bipolar"
            :mod-sources="modIndicatorsFor(key)"
            :param-path="key"
            :readonly="readonly"
            @update:value="onParamChange"
          />
        </template>
      </EngineModule>
    </div>

    <!-- Modulation sources row: envelopes and LFOs -->
    <section class="flex flex-col gap-2">
      <button
        type="button"
        class="flex items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
        @click="showModulation = !showModulation"
      >
        <span>{{ showModulation ? '▾' : '▸' }}</span>
        <span>Modulation Sources</span>
      </button>
      <div v-if="showModulation" class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <EngineModule title="Env 1" accent-class="text-[#D85A30] dark:text-[#F0997B]">
          <EnvelopeCurve
            v-bind="env1Values"
            :color="colorForSource('envelope1').light"
            :interactive="!readonly"
            :compact="false"
            @update:attack="(v) => onEnvelopeStageChange('envelope1', 'attack', v)"
            @update:decay="(v) => onEnvelopeStageChange('envelope1', 'decay', v)"
            @update:sustain="(v) => onEnvelopeStageChange('envelope1', 'sustain', v)"
            @update:release="(v) => onEnvelopeStageChange('envelope1', 'release', v)"
          />
          <ModSourcePanel source-id="envelope1" :cables="cableList" :compact="true" />
        </EngineModule>
        <EngineModule title="Env 2" accent-class="text-[#D4537E] dark:text-[#ED93B1]">
          <EnvelopeCurve
            v-bind="env2Values"
            :color="colorForSource('envelope2').light"
            :interactive="!readonly"
            :compact="false"
            @update:attack="(v) => onEnvelopeStageChange('envelope2', 'attack', v)"
            @update:decay="(v) => onEnvelopeStageChange('envelope2', 'decay', v)"
            @update:sustain="(v) => onEnvelopeStageChange('envelope2', 'sustain', v)"
            @update:release="(v) => onEnvelopeStageChange('envelope2', 'release', v)"
          />
          <ModSourcePanel source-id="envelope2" :cables="cableList" :compact="true" />
        </EngineModule>
        <EngineModule
          title="LFO 1"
          accent-class="text-[#378ADD] dark:text-[#85B7EB]"
          :mode="lfo1Type"
          :mode-options="LFO_TYPES"
          @update:mode="(v) => updateLfoType('lfo1', v)"
        >
          <LfoCurve :type="lfo1Type" :color="colorForSource('lfo1').light" :compact="false" />
          <ModSourcePanel source-id="lfo1" :cables="cableList" :compact="true" />
          <KnobRing
            v-if="paramFor('lfo1Rate')"
            :label="paramFor('lfo1Rate')!.meta.displayName"
            :value="paramFor('lfo1Rate')!.displayValue"
            :raw-value="paramFor('lfo1Rate')!.rawValue"
            :min="paramFor('lfo1Rate')!.meta.min"
            :max="paramFor('lfo1Rate')!.meta.max"
            :bipolar="paramFor('lfo1Rate')!.meta.bipolar"
            :mod-sources="modIndicatorsFor('lfo1Rate')"
            param-path="lfo1Rate"
            :readonly="readonly"
            @update:value="onParamChange"
          />
        </EngineModule>
        <EngineModule
          title="LFO 2"
          accent-class="text-[#1D9E75] dark:text-[#5DCAA5]"
          :mode="lfo2Type"
          :mode-options="LFO_TYPES"
          @update:mode="(v) => updateLfoType('lfo2', v)"
        >
          <LfoCurve :type="lfo2Type" :color="colorForSource('lfo2').light" :compact="false" />
          <ModSourcePanel source-id="lfo2" :cables="cableList" :compact="true" />
          <KnobRing
            v-if="paramFor('lfo2Rate')"
            :label="paramFor('lfo2Rate')!.meta.displayName"
            :value="paramFor('lfo2Rate')!.displayValue"
            :raw-value="paramFor('lfo2Rate')!.rawValue"
            :min="paramFor('lfo2Rate')!.meta.min"
            :max="paramFor('lfo2Rate')!.meta.max"
            :bipolar="paramFor('lfo2Rate')!.meta.bipolar"
            :mod-sources="modIndicatorsFor('lfo2Rate')"
            param-path="lfo2Rate"
            :readonly="readonly"
            @update:value="onParamChange"
          />
        </EngineModule>
      </div>
    </section>

    <!-- Effects row -->
    <section class="flex flex-col gap-2">
      <button
        type="button"
        class="flex items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
        @click="showEffects = !showEffects"
      >
        <span>{{ showEffects ? '▾' : '▸' }}</span>
        <span>Effects</span>
      </button>
      <EffectsPanel
        v-if="showEffects"
        :sound="sound"
        :readonly="readonly"
        @update:sound="(s) => emit('update:sound', s)"
      />
    </section>

    <!-- Arpeggiator -->
    <section class="flex flex-col gap-2">
      <button
        type="button"
        class="flex items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
        @click="showArpeggiator = !showArpeggiator"
      >
        <span>{{ showArpeggiator ? '▾' : '▸' }}</span>
        <span>Arpeggiator</span>
      </button>
      <ArpeggiatorPanel
        v-if="showArpeggiator"
        :sound="sound"
        :readonly="readonly"
        @update:sound="(s) => emit('update:sound', s)"
      />
    </section>

    <!-- Mod Matrix -->
    <section class="flex flex-col gap-2">
      <button
        type="button"
        class="flex items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
        @click="showModMatrix = !showModMatrix"
      >
        <span>{{ showModMatrix ? '▾' : '▸' }}</span>
        <span>Mod Matrix ({{ cableList.length }})</span>
      </button>
      <ModMatrix
        v-if="showModMatrix"
        :cables="cableList"
        :readonly="readonly"
        @update:cables="onCablesChange"
      />
    </section>

    <!-- Patch Morph -->
    <section class="flex flex-col gap-2">
      <button
        type="button"
        class="flex items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
        @click="showPatchMorph = !showPatchMorph"
      >
        <span>{{ showPatchMorph ? '▾' : '▸' }}</span>
        <span>Patch Morph</span>
      </button>
      <PatchMorph
        v-if="showPatchMorph"
        :sound="sound"
        :readonly="readonly"
        @update:sound="(s) => emit('update:sound', s)"
      />
    </section>
  </div>
</template>
