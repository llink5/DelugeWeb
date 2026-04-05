<script setup lang="ts">
// LFO waveform visualisation.
//
// Generates an SVG path for each standard LFO shape. Sample-and-hold and
// random shapes use a fixed seed sequence so the visualisation stays
// deterministic across renders regardless of Math.random().

import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    type: string
    color?: string
    compact?: boolean
    cycles?: number
  }>(),
  { color: 'currentColor', compact: false, cycles: 2 },
)

const PAD = 2

const width = computed(() => (props.compact ? 140 : 280))
const height = computed(() => (props.compact ? 40 : 80))

const innerWidth = computed(() => width.value - PAD * 2)
const innerHeight = computed(() => height.value - PAD * 2)

const midY = computed(() => PAD + innerHeight.value / 2)

// Deterministic pseudo-random sequence. Values map to -1..1.
const SEED_VALUES = [
  0.4, -0.7, 0.2, 0.9, -0.3, -0.5, 0.8, -0.1, 0.6, -0.9, 0.3, -0.4, 0.7, -0.2, 0.5, -0.8,
]

function seedAt(i: number): number {
  return SEED_VALUES[i % SEED_VALUES.length]
}

function mapY(norm: number): number {
  // norm: -1..1 → bottomY..topY
  const clamped = Math.max(-1, Math.min(1, norm))
  return midY.value - clamped * (innerHeight.value / 2)
}

const pathD = computed(() => {
  const cycles = Math.max(1, props.cycles)
  const cycleWidth = innerWidth.value / cycles
  const startX = PAD

  switch (props.type) {
    case 'sine':
      return sinePath(startX, cycleWidth, cycles)
    case 'triangle':
      return trianglePath(startX, cycleWidth, cycles)
    case 'saw':
      return sawPath(startX, cycleWidth, cycles)
    case 'square':
      return squarePath(startX, cycleWidth, cycles)
    case 'sampleAndHold':
      return sampleAndHoldPath(startX, cycleWidth, cycles)
    case 'random':
      return randomPath(startX, cycleWidth, cycles)
    default:
      return sinePath(startX, cycleWidth, cycles)
  }
})

function sinePath(startX: number, cycleWidth: number, cycles: number): string {
  const pointsPerCycle = 40
  const total = pointsPerCycle * cycles
  let d = ''
  for (let i = 0; i <= total; i++) {
    const frac = i / pointsPerCycle
    const x = startX + frac * cycleWidth
    const y = mapY(Math.sin(frac * 2 * Math.PI))
    d += (i === 0 ? 'M' : ' L') + ` ${x.toFixed(2)} ${y.toFixed(2)}`
  }
  return d
}

function trianglePath(startX: number, cycleWidth: number, cycles: number): string {
  let d = `M ${startX} ${mapY(0)}`
  for (let c = 0; c < cycles; c++) {
    const base = startX + c * cycleWidth
    d += ` L ${base + cycleWidth * 0.25} ${mapY(1)}`
    d += ` L ${base + cycleWidth * 0.75} ${mapY(-1)}`
    d += ` L ${base + cycleWidth} ${mapY(0)}`
  }
  return d
}

function sawPath(startX: number, cycleWidth: number, cycles: number): string {
  // Ramp-up saw: start low, rise to high, drop to low, repeat.
  let d = `M ${startX} ${mapY(-1)}`
  for (let c = 0; c < cycles; c++) {
    const base = startX + c * cycleWidth
    d += ` L ${base + cycleWidth} ${mapY(1)}`
    if (c < cycles - 1) {
      d += ` L ${base + cycleWidth} ${mapY(-1)}`
    }
  }
  return d
}

function squarePath(startX: number, cycleWidth: number, cycles: number): string {
  let d = `M ${startX} ${mapY(1)}`
  for (let c = 0; c < cycles; c++) {
    const base = startX + c * cycleWidth
    const mid = base + cycleWidth / 2
    const end = base + cycleWidth
    d += ` L ${mid} ${mapY(1)}`
    d += ` L ${mid} ${mapY(-1)}`
    d += ` L ${end} ${mapY(-1)}`
    if (c < cycles - 1) {
      d += ` L ${end} ${mapY(1)}`
    }
  }
  return d
}

function sampleAndHoldPath(startX: number, cycleWidth: number, cycles: number): string {
  // Eight steps per cycle, holding each random level.
  const stepsPerCycle = 8
  const stepWidth = cycleWidth / stepsPerCycle
  let d = ''
  for (let c = 0; c < cycles; c++) {
    for (let s = 0; s < stepsPerCycle; s++) {
      const idx = c * stepsPerCycle + s
      const x0 = startX + c * cycleWidth + s * stepWidth
      const x1 = x0 + stepWidth
      const y = mapY(seedAt(idx))
      if (idx === 0) {
        d = `M ${x0} ${y}`
      } else {
        d += ` L ${x0} ${y}`
      }
      d += ` L ${x1} ${y}`
    }
  }
  return d
}

function randomPath(startX: number, cycleWidth: number, cycles: number): string {
  // Smooth-ish random: four control points per cycle joined with straight lines.
  const pointsPerCycle = 8
  let d = ''
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i <= pointsPerCycle; i++) {
      const frac = i / pointsPerCycle
      const x = startX + c * cycleWidth + frac * cycleWidth
      const idx = c * pointsPerCycle + i
      const y = mapY(seedAt(idx))
      if (c === 0 && i === 0) {
        d = `M ${x.toFixed(2)} ${y.toFixed(2)}`
      } else {
        d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`
      }
    }
  }
  return d
}
</script>

<template>
  <div class="lfo-curve inline-block" data-testid="lfo-curve" :data-lfo-type="type">
    <svg
      :width="width"
      :height="height"
      :viewBox="`0 0 ${width} ${height}`"
      class="block"
      role="img"
      :aria-label="`LFO ${type}`"
    >
      <line
        :x1="PAD"
        :y1="midY"
        :x2="width - PAD"
        :y2="midY"
        stroke="currentColor"
        stroke-width="0.5"
        stroke-dasharray="2 2"
        class="text-slate-300 dark:text-slate-600"
      />
      <path
        :d="pathD"
        fill="none"
        :stroke="color"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
  </div>
</template>
