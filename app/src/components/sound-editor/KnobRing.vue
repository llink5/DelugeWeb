<script setup lang="ts">
// A single parameter knob with mod-source indicators.
//
// The knob operates on display values (e.g. 0..50) but emits hex strings so
// parents can write results straight back to the XML model. Each modulation
// source routed to this parameter appears as a small coloured arc at the
// outer perimeter; its length represents the modulation depth.

import { computed, ref } from 'vue'
import { displayToHexLinear } from '@/lib/values/paramMeta'

export interface ModIndicator {
  /** Source identifier (env1, lfo2, velocity, ...) */
  sourceId: string
  /** CSS colour used for the arc */
  color: string
  /** Signed depth in the parameter's display range (e.g. -50..+50) */
  depth: number
}

const props = withDefaults(
  defineProps<{
    label: string
    value: number
    rawValue: string
    min: number
    max: number
    bipolar: boolean
    modSources?: ModIndicator[]
    paramPath: string
    readonly?: boolean
  }>(),
  { modSources: () => [], readonly: false },
)

const emit = defineEmits<{
  'update:value': [hex: string, paramPath: string]
}>()

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const SIZE = 72
const CENTER = SIZE / 2
const TRACK_RADIUS = 28
const MOD_RADIUS = 34
const STROKE = 4

// Unipolar: 270° sweep, starting at bottom-left (225° compass), ending at 135° (bottom-right)
// Bipolar: same visual sweep, but the "filled" arc grows from the top center
const SWEEP_DEGREES = 270
const START_COMPASS = 225 // bottom-left on a clock face
const CENTER_COMPASS = 0 // top, for bipolar knobs

function toSvg(cx: number, cy: number, r: number, compassDeg: number) {
  const rad = ((compassDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(r: number, fromDeg: number, toDeg: number): string {
  const start = toSvg(CENTER, CENTER, r, fromDeg)
  const end = toSvg(CENTER, CENTER, r, toDeg)
  // Normalise delta to a positive clockwise sweep
  let delta = toDeg - fromDeg
  while (delta < 0) delta += 360
  while (delta > 360) delta -= 360
  const largeArc = delta > 180 ? 1 : 0
  const sweep = 1 // clockwise
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${end.x} ${end.y}`
}

// ---------------------------------------------------------------------------
// Reactive geometry
// ---------------------------------------------------------------------------

const unit = computed(() => {
  const span = props.max - props.min
  if (span === 0) return 0
  const clamped = Math.max(props.min, Math.min(props.max, props.value))
  return (clamped - props.min) / span
})

const trackPath = computed(() =>
  arcPath(TRACK_RADIUS, START_COMPASS, START_COMPASS + SWEEP_DEGREES),
)

const valuePath = computed(() => {
  if (props.bipolar) {
    // Bipolar: arc grows outward from centre (top) in either direction
    const midUnit = 0.5
    const delta = (unit.value - midUnit) * SWEEP_DEGREES
    if (Math.abs(delta) < 0.5) return ''
    if (delta > 0) {
      return arcPath(TRACK_RADIUS, CENTER_COMPASS, CENTER_COMPASS + delta)
    }
    return arcPath(TRACK_RADIUS, CENTER_COMPASS + delta + 360, CENTER_COMPASS + 360)
  }
  // Unipolar: arc grows from start to current
  if (unit.value < 0.001) return ''
  return arcPath(TRACK_RADIUS, START_COMPASS, START_COMPASS + unit.value * SWEEP_DEGREES)
})

const knobPointerAngle = computed(() => START_COMPASS + unit.value * SWEEP_DEGREES)

const pointerEnd = computed(() =>
  toSvg(CENTER, CENTER, TRACK_RADIUS - STROKE / 2 - 2, knobPointerAngle.value),
)

// Mod-source arcs: anchored at the current knob position, extending by depth
const modArcs = computed(() => {
  const span = props.max - props.min
  if (span === 0) return []
  return props.modSources.map((m) => {
    const depthUnit = m.depth / span
    const delta = depthUnit * SWEEP_DEGREES
    const baseAngle = knobPointerAngle.value
    const from = delta >= 0 ? baseAngle : baseAngle + delta
    const to = delta >= 0 ? baseAngle + delta : baseAngle
    if (Math.abs(delta) < 0.5) {
      // Too small to draw as arc — render as dot at base angle
      return { path: '', color: m.color, sourceId: m.sourceId, dot: toSvg(CENTER, CENTER, MOD_RADIUS, baseAngle) }
    }
    return { path: arcPath(MOD_RADIUS, from, to), color: m.color, sourceId: m.sourceId, dot: null }
  })
})

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

const editing = ref(false)

function openEditor() {
  if (props.readonly) return
  editing.value = !editing.value
}

function closeEditor() {
  editing.value = false
}

function applyValue(next: number) {
  if (Number.isNaN(next)) return
  const clamped = Math.max(props.min, Math.min(props.max, Math.round(next)))
  if (clamped === props.value) return
  const hex = displayToHexLinear(clamped, props.min, props.max)
  emit('update:value', hex, props.paramPath)
}

function onSliderInput(event: Event) {
  const target = event.target as HTMLInputElement
  applyValue(Number(target.value))
}

function onNumericInput(event: Event) {
  const target = event.target as HTMLInputElement
  applyValue(Number(target.value))
}

function formatDisplay(v: number): string {
  if (!props.bipolar) return String(v)
  if (v === 0) return '0'
  return v > 0 ? `+${v}` : String(v)
}
</script>

<template>
  <div
    class="knob-ring inline-flex flex-col items-center gap-1 select-none"
    :data-param-path="paramPath"
  >
    <svg
      :width="SIZE"
      :height="SIZE"
      :viewBox="`0 0 ${SIZE} ${SIZE}`"
      class="cursor-pointer"
      :class="{ 'cursor-default opacity-70': readonly }"
      role="slider"
      :aria-label="label"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuenow="value"
      @click="openEditor"
    >
      <!-- Track arc -->
      <path
        :d="trackPath"
        fill="none"
        stroke="currentColor"
        :stroke-width="STROKE"
        stroke-linecap="round"
        class="text-slate-300 dark:text-slate-700"
      />
      <!-- Value arc -->
      <path
        v-if="valuePath"
        :d="valuePath"
        fill="none"
        stroke="currentColor"
        :stroke-width="STROKE"
        stroke-linecap="round"
        class="text-sky-500 dark:text-sky-400"
      />
      <!-- Pointer line from centre to current position -->
      <line
        :x1="CENTER"
        :y1="CENTER"
        :x2="pointerEnd.x"
        :y2="pointerEnd.y"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        class="text-slate-700 dark:text-slate-200"
      />
      <!-- Mod source arcs / dots -->
      <template v-for="(arc, i) in modArcs" :key="arc.sourceId + i">
        <path
          v-if="arc.path"
          :d="arc.path"
          fill="none"
          :stroke="arc.color"
          stroke-width="2"
          stroke-linecap="round"
        />
        <circle
          v-else-if="arc.dot"
          :cx="arc.dot.x"
          :cy="arc.dot.y"
          r="2"
          :fill="arc.color"
        />
      </template>
      <!-- Centre value text -->
      <text
        :x="CENTER"
        :y="CENTER + 4"
        text-anchor="middle"
        class="text-xs font-mono fill-slate-800 dark:fill-slate-100"
      >
        {{ formatDisplay(value) }}
      </text>
    </svg>
    <div class="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {{ label }}
    </div>
    <div
      v-if="editing"
      class="knob-editor flex items-center gap-2 rounded border border-slate-300 bg-white px-2 py-1 shadow-md dark:border-slate-600 dark:bg-slate-800"
      @click.stop
    >
      <input
        type="range"
        :min="min"
        :max="max"
        :value="value"
        step="1"
        class="w-24"
        :disabled="readonly"
        @input="onSliderInput"
      />
      <input
        type="number"
        :min="min"
        :max="max"
        :value="value"
        class="w-12 rounded border border-slate-300 bg-white px-1 text-xs dark:border-slate-600 dark:bg-slate-900"
        :disabled="readonly"
        @change="onNumericInput"
      />
      <button
        type="button"
        class="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        @click="closeEditor"
      >
        ✕
      </button>
    </div>
  </div>
</template>
