<script setup lang="ts">
// Editable patch-cable matrix.
//
// Each row binds a modulation source to a destination parameter with a signed
// depth (-50..+50 display, stored as a bipolar hex string in XML). Changes
// never mutate the props array: every edit emits a complete new cable list so
// the parent can own and validate the state.

import { computed } from 'vue'
import type { PatchCable } from '@/lib/values/patchCables'
import { DESTINATION_TO_PARAM_KEY } from '@/lib/values/patchCables'
import { displayToHexLinear, hexToDisplayLinear } from '@/lib/values/paramMeta'
import { colorForSource, labelForSource } from '@/components/sound-editor/modSourceColors'

const props = withDefaults(
  defineProps<{
    cables: PatchCable[]
    availableSources?: string[]
    availableDestinations?: string[]
    readonly?: boolean
  }>(),
  { readonly: false },
)

const emit = defineEmits<{
  'update:cables': [cables: PatchCable[]]
}>()

const DEFAULT_SOURCES = [
  'velocity',
  'note',
  'aftertouch',
  'envelope1',
  'envelope2',
  'lfo1',
  'lfo2',
  'random',
  'compressor',
]

const sources = computed<string[]>(() =>
  props.availableSources && props.availableSources.length
    ? props.availableSources
    : DEFAULT_SOURCES,
)

const destinations = computed<string[]>(() =>
  props.availableDestinations && props.availableDestinations.length
    ? props.availableDestinations
    : Object.keys(DESTINATION_TO_PARAM_KEY),
)

const DEPTH_MIN = -50
const DEPTH_MAX = 50

function depthOf(cable: PatchCable): number {
  if (!cable.amount) return 0
  try {
    return hexToDisplayLinear(cable.amount, DEPTH_MIN, DEPTH_MAX)
  } catch {
    return 0
  }
}

function depthWidth(depth: number): string {
  const mag = Math.min(50, Math.abs(depth))
  return `${(mag / 50) * 100}%`
}

function replaceAt(index: number, patch: Partial<PatchCable>): PatchCable[] {
  return props.cables.map((c, i) => (i === index ? { ...c, ...patch } : c))
}

function onSourceChange(index: number, event: Event) {
  if (props.readonly) return
  const value = (event.target as HTMLSelectElement).value
  emit('update:cables', replaceAt(index, { source: value }))
}

function onDestinationChange(index: number, event: Event) {
  if (props.readonly) return
  const value = (event.target as HTMLSelectElement).value
  emit('update:cables', replaceAt(index, { destination: value }))
}

function onDepthChange(index: number, event: Event) {
  if (props.readonly) return
  const raw = Number((event.target as HTMLInputElement).value)
  if (Number.isNaN(raw)) return
  let clamped = Math.round(raw)
  if (clamped < DEPTH_MIN) clamped = DEPTH_MIN
  if (clamped > DEPTH_MAX) clamped = DEPTH_MAX
  const amount = displayToHexLinear(clamped, DEPTH_MIN, DEPTH_MAX)
  emit('update:cables', replaceAt(index, { amount }))
}

function onRemove(index: number) {
  if (props.readonly) return
  emit('update:cables', props.cables.filter((_, i) => i !== index))
}

function onAdd() {
  if (props.readonly) return
  const next: PatchCable = {
    source: sources.value[0],
    destination: destinations.value[0],
    amount: '0x00000000',
  }
  emit('update:cables', [...props.cables, next])
}
</script>

<template>
  <div
    data-testid="mod-matrix"
    class="mod-matrix flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800"
  >
    <header class="flex items-center justify-between gap-2">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
        Mod Matrix
      </h3>
      <span class="text-[10px] text-slate-500 dark:text-slate-400">
        {{ cables.length }} cable<span v-if="cables.length !== 1">s</span>
      </span>
    </header>

    <p
      v-if="cables.length === 0"
      class="text-xs italic text-slate-500 dark:text-slate-400"
    >
      No modulation cables — click Add to create one.
    </p>

    <table v-else class="w-full border-collapse text-xs">
      <thead>
        <tr class="text-left text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <th class="pb-1 pr-2 font-medium">Source</th>
          <th class="pb-1 pr-2 font-medium">Destination</th>
          <th class="pb-1 pr-2 text-right font-medium">Depth</th>
          <th class="pb-1 pr-2 font-medium">Range</th>
          <th class="pb-1 font-medium"></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(cable, i) in cables"
          :key="i"
          :data-cable-index="i"
          class="border-t border-slate-100 dark:border-slate-700"
        >
          <td class="py-1.5 pr-2">
            <div class="flex items-center gap-1.5">
              <span
                class="inline-block h-2 w-2 rounded-full"
                :style="{ backgroundColor: colorForSource(cable.source ?? '').light }"
              ></span>
              <select
                v-if="!readonly"
                :value="cable.source ?? ''"
                class="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-900"
                @change="onSourceChange(i, $event)"
              >
                <option v-for="src in sources" :key="src" :value="src">
                  {{ labelForSource(src) }}
                </option>
                <option
                  v-if="cable.source && !sources.includes(cable.source)"
                  :value="cable.source"
                >
                  {{ labelForSource(cable.source) }}
                </option>
              </select>
              <span v-else class="text-slate-700 dark:text-slate-200">
                {{ labelForSource(cable.source ?? '') }}
              </span>
            </div>
          </td>
          <td class="py-1.5 pr-2">
            <select
              v-if="!readonly"
              :value="cable.destination ?? ''"
              class="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-900"
              @change="onDestinationChange(i, $event)"
            >
              <option v-for="dest in destinations" :key="dest" :value="dest">
                {{ dest }}
              </option>
              <option
                v-if="cable.destination && !destinations.includes(cable.destination)"
                :value="cable.destination"
              >
                {{ cable.destination }}
              </option>
            </select>
            <span v-else class="text-slate-700 dark:text-slate-200">
              {{ cable.destination ?? '' }}
            </span>
          </td>
          <td class="py-1.5 pr-2 text-right font-mono text-slate-700 dark:text-slate-200">
            <input
              v-if="!readonly"
              type="number"
              :min="DEPTH_MIN"
              :max="DEPTH_MAX"
              step="1"
              :value="depthOf(cable)"
              class="w-14 rounded border border-slate-300 bg-white px-1 text-right text-xs dark:border-slate-600 dark:bg-slate-900"
              @change="onDepthChange(i, $event)"
            />
            <span v-else>{{ depthOf(cable) }}</span>
          </td>
          <td class="py-1.5 pr-2">
            <div
              class="relative flex h-3 w-full min-w-[80px] items-center"
              data-testid="depth-bar"
            >
              <!-- Background track -->
              <div class="absolute inset-x-0 h-[2px] rounded bg-slate-200 dark:bg-slate-700"></div>
              <!-- Centre line -->
              <div class="absolute left-1/2 h-full w-px -translate-x-1/2 bg-slate-400 dark:bg-slate-500"></div>
              <!-- Positive fill -->
              <div
                v-if="depthOf(cable) > 0"
                class="absolute left-1/2 h-[4px] rounded bg-teal-500 dark:bg-teal-400"
                data-testid="depth-bar-pos"
                :style="{ width: depthWidth(depthOf(cable)) }"
              ></div>
              <!-- Negative fill -->
              <div
                v-if="depthOf(cable) < 0"
                class="absolute right-1/2 h-[4px] rounded bg-rose-500 dark:bg-rose-400"
                data-testid="depth-bar-neg"
                :style="{ width: depthWidth(depthOf(cable)) }"
              ></div>
              <!-- Slider overlay -->
              <input
                v-if="!readonly"
                type="range"
                :min="DEPTH_MIN"
                :max="DEPTH_MAX"
                step="1"
                :value="depthOf(cable)"
                class="relative z-10 w-full cursor-pointer opacity-0"
                @input="onDepthChange(i, $event)"
              />
            </div>
          </td>
          <td class="py-1.5 text-right">
            <button
              v-if="!readonly"
              type="button"
              class="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-700 dark:hover:text-rose-400"
              data-testid="remove-cable"
              :aria-label="`Remove cable ${i + 1}`"
              @click="onRemove(i)"
            >
              ✕
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="flex justify-start">
      <button
        v-if="!readonly"
        type="button"
        data-testid="add-cable"
        class="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700"
        @click="onAdd"
      >
        + Add cable
      </button>
    </div>
  </div>
</template>
