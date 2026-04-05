<script setup lang="ts">
// ADSR envelope visualisation.
//
// Renders an SVG path with five points: start at the bottom, rise to the
// peak over the attack segment, fall to the sustain level over the decay
// segment, hold, then fall back to the bottom over the release segment.
// Attack, decay and release are interpreted as relative widths that share
// the available horizontal space; sustain is a level in the same 0..50
// display range used elsewhere in the editor.

import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    attack: number
    decay: number
    sustain: number
    release: number
    color?: string
    interactive?: boolean
    compact?: boolean
  }>(),
  { color: 'currentColor', interactive: false, compact: false },
)

const emit = defineEmits<{
  'update:attack': [value: number]
  'update:decay': [value: number]
  'update:sustain': [value: number]
  'update:release': [value: number]
}>()

const MIN = 0
const MAX = 50
const SUSTAIN_FRACTION = 0.25 // Reserve 25% of the width for the sustain hold
const PAD = 2

const width = computed(() => (props.compact ? 140 : 280))
const height = computed(() => (props.compact ? 40 : 140))

const innerWidth = computed(() => width.value - PAD * 2)
const innerHeight = computed(() => height.value - PAD * 2)

const bottomY = computed(() => PAD + innerHeight.value)
const topY = computed(() => PAD)

function clamp(v: number): number {
  return Math.max(MIN, Math.min(MAX, v))
}

const points = computed(() => {
  const a = clamp(props.attack)
  const d = clamp(props.decay)
  const s = clamp(props.sustain)
  const r = clamp(props.release)

  // Share the "time" portion of the viewport (everything except the sustain
  // hold) proportionally between attack, decay and release. If all three are
  // zero, fall back to an even split so the curve is still visible.
  const totalTime = a + d + r
  const timeWidth = innerWidth.value * (1 - SUSTAIN_FRACTION)
  const sustainWidth = innerWidth.value * SUSTAIN_FRACTION

  const attackW = totalTime === 0 ? timeWidth / 3 : (a / totalTime) * timeWidth
  const decayW = totalTime === 0 ? timeWidth / 3 : (d / totalTime) * timeWidth
  const releaseW = totalTime === 0 ? timeWidth / 3 : (r / totalTime) * timeWidth

  const sustainY = bottomY.value - (s / MAX) * innerHeight.value

  const x0 = PAD
  const x1 = x0 + attackW
  const x2 = x1 + decayW
  const x3 = x2 + sustainWidth
  const x4 = x3 + releaseW

  return {
    start: { x: x0, y: bottomY.value },
    peak: { x: x1, y: topY.value },
    decayEnd: { x: x2, y: sustainY },
    sustainEnd: { x: x3, y: sustainY },
    releaseEnd: { x: x4, y: bottomY.value },
  }
})

const pathD = computed(() => {
  const p = points.value
  return (
    `M ${p.start.x} ${p.start.y}` +
    ` L ${p.peak.x} ${p.peak.y}` +
    ` L ${p.decayEnd.x} ${p.decayEnd.y}` +
    ` L ${p.sustainEnd.x} ${p.sustainEnd.y}` +
    ` L ${p.releaseEnd.x} ${p.releaseEnd.y}`
  )
})

const fillD = computed(() => {
  const p = points.value
  return (
    pathD.value +
    ` L ${p.releaseEnd.x} ${bottomY.value}` +
    ` L ${p.start.x} ${bottomY.value} Z`
  )
})

function onSlider(stage: 'attack' | 'decay' | 'sustain' | 'release', event: Event) {
  const target = event.target as HTMLInputElement
  const next = clamp(Number(target.value))
  if (Number.isNaN(next)) return
  if (stage === 'attack') emit('update:attack', next)
  else if (stage === 'decay') emit('update:decay', next)
  else if (stage === 'sustain') emit('update:sustain', next)
  else emit('update:release', next)
}
</script>

<template>
  <div class="envelope-curve inline-flex flex-col gap-1" data-testid="envelope-curve">
    <svg
      :width="width"
      :height="height"
      :viewBox="`0 0 ${width} ${height}`"
      class="block"
      role="img"
      aria-label="Envelope curve"
    >
      <path :d="fillD" :fill="color" fill-opacity="0.15" stroke="none" />
      <path
        :d="pathD"
        fill="none"
        :stroke="color"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <circle
        v-for="(pt, i) in [points.peak, points.decayEnd, points.sustainEnd]"
        :key="i"
        :cx="pt.x"
        :cy="pt.y"
        r="2"
        :fill="color"
      />
    </svg>
    <div
      v-if="interactive"
      class="envelope-sliders grid grid-cols-4 gap-2 text-[10px] text-slate-600 dark:text-slate-300"
    >
      <label class="flex flex-col items-start gap-0.5">
        <span class="uppercase tracking-wide">A</span>
        <input
          type="range"
          :min="MIN"
          :max="MAX"
          :value="attack"
          step="1"
          class="w-full"
          data-stage="attack"
          @input="onSlider('attack', $event)"
        />
        <span class="font-mono">{{ attack }}</span>
      </label>
      <label class="flex flex-col items-start gap-0.5">
        <span class="uppercase tracking-wide">D</span>
        <input
          type="range"
          :min="MIN"
          :max="MAX"
          :value="decay"
          step="1"
          class="w-full"
          data-stage="decay"
          @input="onSlider('decay', $event)"
        />
        <span class="font-mono">{{ decay }}</span>
      </label>
      <label class="flex flex-col items-start gap-0.5">
        <span class="uppercase tracking-wide">S</span>
        <input
          type="range"
          :min="MIN"
          :max="MAX"
          :value="sustain"
          step="1"
          class="w-full"
          data-stage="sustain"
          @input="onSlider('sustain', $event)"
        />
        <span class="font-mono">{{ sustain }}</span>
      </label>
      <label class="flex flex-col items-start gap-0.5">
        <span class="uppercase tracking-wide">R</span>
        <input
          type="range"
          :min="MIN"
          :max="MAX"
          :value="release"
          step="1"
          class="w-full"
          data-stage="release"
          @input="onSlider('release', $event)"
        />
        <span class="font-mono">{{ release }}</span>
      </label>
    </div>
  </div>
</template>
