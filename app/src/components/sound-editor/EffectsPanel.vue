<script setup lang="ts">
// Effects row for a Deluge sound: Delay, Reverb, Mod FX and Distortion.
//
// Mirrors the editing pattern used by SoundEditor: the component receives a
// parsed sound object as a prop, builds clones that preserve DRObject
// prototypes on every edit and emits a new sound on each change. The parent
// keeps canonical state and can implement undo/redo around the editor.

import { computed } from 'vue'
import KnobRing from './KnobRing.vue'
import EngineModule from './EngineModule.vue'
import { colorForSource } from './modSourceColors'
import { PARAM_META, hexToDisplayLinear, type ParamMeta } from '@/lib/values/paramMeta'
import {
  asCableArray,
  cablesForParam,
  type PatchCable,
} from '@/lib/values/patchCables'

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
      const depth = hexToDisplayLinear(c.amount, -50, 50)
      const color = colorForSource(c.source).light
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
// Mod FX type selector
// ---------------------------------------------------------------------------

const MOD_FX_TYPES = [
  { value: 'none', label: 'None' },
  { value: 'flanger', label: 'Flanger' },
  { value: 'chorus', label: 'Chorus' },
  { value: 'phaser', label: 'Phaser' },
]

const modFXType = computed(() => String(props.sound.modFXType ?? 'none'))

function updateModFXType(value: string) {
  if (props.readonly) return
  const newSound = cloneWithProto(props.sound)
  newSound.modFXType = value
  emit('update:sound', newSound)
}

// ---------------------------------------------------------------------------
// Module parameter lists
// ---------------------------------------------------------------------------

const DELAY_PARAMS = ['delayRate', 'delayFeedback']
const REVERB_PARAMS = ['reverbAmount']
const MOD_FX_PARAMS = ['modFXRate', 'modFXDepth', 'modFXOffset', 'modFXFeedback']
const DISTORTION_PARAMS = ['bitCrush', 'sampleRateReduction']
</script>

<template>
  <div
    class="effects-panel grid grid-cols-2 gap-3 md:grid-cols-4"
    data-testid="effects-panel"
  >
    <EngineModule title="Delay">
      <template v-for="key in DELAY_PARAMS" :key="key">
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

    <EngineModule title="Reverb">
      <template v-for="key in REVERB_PARAMS" :key="key">
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
      title="Mod FX"
      :mode="modFXType"
      :mode-options="MOD_FX_TYPES"
      @update:mode="updateModFXType"
    >
      <template v-for="key in MOD_FX_PARAMS" :key="key">
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

    <EngineModule title="Distortion">
      <template v-for="key in DISTORTION_PARAMS" :key="key">
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
</template>
