<script setup lang="ts">
// Arpeggiator editor.
//
// Deluge arpeggiator state is split across two places in the XML: the
// `<arpeggiator>` element under a sound (mode, numOctaves, syncLevel) and the
// tempo-ish parameters that live on defaultParams (arpeggiatorRate,
// arpeggiatorGate). This panel edits both; emits a new sound on every change.

import { computed } from 'vue'
import KnobRing from './KnobRing.vue'
import EngineModule from './EngineModule.vue'
import { PARAM_META, hexToDisplayLinear } from '@/lib/values/paramMeta'

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

const arpeggiator = computed(
  () => (props.sound.arpeggiator ?? {}) as Record<string, unknown>,
)

const defaultParams = computed(
  () => (props.sound.defaultParams ?? {}) as Record<string, unknown>,
)

// ---------------------------------------------------------------------------
// Arpeggiator options
// ---------------------------------------------------------------------------

const ARP_MODES = [
  { value: 'off', label: 'Off' },
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'both', label: 'Up & Down' },
  { value: 'random', label: 'Random' },
]

// Sync levels follow the firmware's standard tempo subdivisions. Value 0 is
// "off" (free running), 9 is whole-note based.
const SYNC_LEVELS = [
  { value: '0', label: 'Off' },
  { value: '1', label: '1/256' },
  { value: '2', label: '1/128' },
  { value: '3', label: '1/64' },
  { value: '4', label: '1/32' },
  { value: '5', label: '1/16' },
  { value: '6', label: '1/8' },
  { value: '7', label: '1/4' },
  { value: '8', label: '1/2' },
  { value: '9', label: '1' },
]

const mode = computed(() => String(arpeggiator.value.mode ?? 'off'))
const numOctaves = computed(() => String(arpeggiator.value.numOctaves ?? '2'))
const syncLevel = computed(() => String(arpeggiator.value.syncLevel ?? '7'))

const rateParam = computed(() => {
  const meta = PARAM_META.arpeggiatorRate
  const raw = (defaultParams.value.arpeggiatorRate as string | undefined) ?? meta.default
  return {
    meta,
    rawValue: raw,
    displayValue: hexToDisplayLinear(raw, meta.min, meta.max),
  }
})

const gateParam = computed(() => {
  const meta = PARAM_META.arpeggiatorGate
  const raw = (defaultParams.value.arpeggiatorGate as string | undefined) ?? meta.default
  return {
    meta,
    rawValue: raw,
    displayValue: hexToDisplayLinear(raw, meta.min, meta.max),
  }
})

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

function cloneWithProto<T extends object>(obj: T): T {
  const clone = Object.create(Object.getPrototypeOf(obj))
  Object.assign(clone, obj)
  return clone
}

function emitArp(update: Partial<{ mode: string; numOctaves: string; syncLevel: string }>) {
  if (props.readonly) return
  const newArp = cloneWithProto(arpeggiator.value)
  Object.assign(newArp, update)
  const newSound = cloneWithProto(props.sound)
  newSound.arpeggiator = newArp
  emit('update:sound', newSound)
}

function emitDefaultParamChange(hex: string, paramKey: string) {
  if (props.readonly) return
  const newDefaults = cloneWithProto(defaultParams.value)
  newDefaults[paramKey] = hex
  const newSound = cloneWithProto(props.sound)
  newSound.defaultParams = newDefaults
  emit('update:sound', newSound)
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function onModeChange(event: Event) {
  emitArp({ mode: (event.target as HTMLSelectElement).value })
}

function onOctavesChange(event: Event) {
  const v = (event.target as HTMLInputElement).value
  const n = Math.max(1, Math.min(8, Number(v) || 1))
  emitArp({ numOctaves: String(n) })
}

function onSyncChange(event: Event) {
  emitArp({ syncLevel: (event.target as HTMLSelectElement).value })
}
</script>

<template>
  <div class="arpeggiator-panel" data-testid="arpeggiator-panel">
    <EngineModule title="Arpeggiator">
      <div class="flex w-full flex-col gap-2 text-xs">
        <!-- Mode -->
        <label class="flex items-center gap-2">
          <span class="w-14 text-slate-500 dark:text-slate-400">Mode</span>
          <select
            :value="mode"
            :disabled="readonly"
            data-testid="arp-mode"
            class="flex-1 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-900"
            @change="onModeChange"
          >
            <option v-for="m in ARP_MODES" :key="m.value" :value="m.value">
              {{ m.label }}
            </option>
          </select>
        </label>

        <!-- Octaves -->
        <label class="flex items-center gap-2">
          <span class="w-14 text-slate-500 dark:text-slate-400">Octaves</span>
          <input
            type="number"
            min="1"
            max="8"
            step="1"
            :value="numOctaves"
            :disabled="readonly"
            data-testid="arp-octaves"
            class="w-14 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-900"
            @change="onOctavesChange"
          />
        </label>

        <!-- Sync -->
        <label class="flex items-center gap-2">
          <span class="w-14 text-slate-500 dark:text-slate-400">Sync</span>
          <select
            :value="syncLevel"
            :disabled="readonly"
            data-testid="arp-sync"
            class="flex-1 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-900"
            @change="onSyncChange"
          >
            <option v-for="s in SYNC_LEVELS" :key="s.value" :value="s.value">
              {{ s.label }}
            </option>
          </select>
        </label>
      </div>

      <KnobRing
        :label="rateParam.meta.displayName"
        :value="rateParam.displayValue"
        :raw-value="rateParam.rawValue"
        :min="rateParam.meta.min"
        :max="rateParam.meta.max"
        :bipolar="rateParam.meta.bipolar"
        :mod-sources="[]"
        param-path="arpeggiatorRate"
        :readonly="readonly"
        @update:value="emitDefaultParamChange"
      />
      <KnobRing
        :label="gateParam.meta.displayName"
        :value="gateParam.displayValue"
        :raw-value="gateParam.rawValue"
        :min="gateParam.meta.min"
        :max="gateParam.meta.max"
        :bipolar="gateParam.meta.bipolar"
        :mod-sources="[]"
        param-path="arpeggiatorGate"
        :readonly="readonly"
        @update:value="emitDefaultParamChange"
      />
    </EngineModule>
  </div>
</template>
