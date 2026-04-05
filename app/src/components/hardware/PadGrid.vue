<script setup lang="ts">
// 16×8 RGB pad grid with optional audition column.
//
// The grid is driven by a colours buffer: 3 bytes per pad (R,G,B), laid out
// row-major (pad at column C, row R → index (R*16 + C) * 3). When audition
// pads are enabled, 8 extra pads are rendered to the right of the main grid
// and addressed via indices 128..135 (i.e. colours[128*3..]).
//
// Press/release events are emitted on mousedown/mouseup. For keyboard input
// the parent view listens globally and calls the `press` / `release`
// exposed methods.

import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** RGB triples, row-major. Length must be ≥ (cols*rows + (hasAudition?rows:0)) * 3. */
    colours: Uint8Array
    /** Pads currently held down, as flat indices (R*16+C). */
    activePads?: Set<number>
    /** Columns in the main grid. Default 16. */
    cols?: number
    /** Rows in the main grid. Default 8. */
    rows?: number
    /** Show 8 extra audition pads next to the last column. */
    hasAudition?: boolean
    /** CSS pad size. Default 28px. */
    padSize?: number
    /** Gap between pads. */
    padGap?: number
  }>(),
  {
    cols: 16,
    rows: 8,
    hasAudition: true,
    padSize: 28,
    padGap: 4,
    activePads: () => new Set<number>(),
  },
)

const emit = defineEmits<{
  'pad-press': [x: number, y: number, velocity: number]
  'pad-release': [x: number, y: number]
  'audition-press': [row: number, velocity: number]
  'audition-release': [row: number]
}>()

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function cssColour(idx: number): string {
  const o = idx * 3
  const r = props.colours[o] ?? 0
  const g = props.colours[o + 1] ?? 0
  const b = props.colours[o + 2] ?? 0
  // Even when the pad is "off" on the device the colour triple is usually
  // (0,0,0). Render a very dark grey instead of pure black so the grid
  // outline remains visible.
  if (r === 0 && g === 0 && b === 0) return '#1a1a1a'
  return `rgb(${r}, ${g}, ${b})`
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const rowIndices = computed(() =>
  Array.from({ length: props.rows }, (_, i) => i),
)
const colIndices = computed(() =>
  Array.from({ length: props.cols }, (_, i) => i),
)

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function onPadDown(x: number, y: number, ev: MouseEvent) {
  ev.preventDefault()
  // Use relative Y within the pad for velocity so the bottom of the pad =
  // high velocity, top = low velocity. Limits to 1..127.
  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  const rel = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height))
  const velocity = Math.max(1, Math.min(127, Math.round(64 + rel * 63)))
  emit('pad-press', x, y, velocity)
}

function onPadUp(x: number, y: number) {
  emit('pad-release', x, y)
}

function onAuditionDown(row: number, ev: MouseEvent) {
  ev.preventDefault()
  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  const rel = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height))
  const velocity = Math.max(1, Math.min(127, Math.round(64 + rel * 63)))
  emit('audition-press', row, velocity)
}

function onAuditionUp(row: number) {
  emit('audition-release', row)
}

function isActive(x: number, y: number): boolean {
  return props.activePads.has(y * props.cols + x)
}

function auditionIndex(row: number): number {
  // Audition pads live at index 128..135 in the colour buffer.
  return props.cols * props.rows + row
}

defineExpose({
  isActive,
  auditionIndex,
})
</script>

<template>
  <div
    class="pad-grid inline-flex select-none gap-3 p-3"
    data-testid="pad-grid"
  >
    <!-- Main 16×8 grid -->
    <div
      class="flex flex-col"
      :style="{ gap: padGap + 'px' }"
      data-testid="pad-main"
    >
      <div
        v-for="y in rowIndices"
        :key="'row-' + y"
        class="flex"
        :style="{ gap: padGap + 'px' }"
      >
        <div
          v-for="x in colIndices"
          :key="'pad-' + x + '-' + y"
          class="pad cursor-pointer rounded-sm border"
          :data-pad-x="x"
          :data-pad-y="y"
          :class="isActive(x, y) ? 'border-white/80 scale-95' : 'border-black/40'"
          :style="{
            width: padSize + 'px',
            height: padSize + 'px',
            backgroundColor: cssColour(y * cols + x),
            transition: 'transform 40ms ease',
          }"
          @mousedown="onPadDown(x, y, $event)"
          @mouseup="onPadUp(x, y)"
          @mouseleave="onPadUp(x, y)"
        />
      </div>
    </div>

    <!-- Audition column -->
    <div
      v-if="hasAudition"
      class="flex flex-col"
      :style="{ gap: padGap + 'px' }"
      data-testid="pad-audition"
    >
      <div
        v-for="y in rowIndices"
        :key="'aud-' + y"
        class="pad cursor-pointer rounded-full border border-black/40"
        :data-audition-row="y"
        :style="{
          width: padSize + 'px',
          height: padSize + 'px',
          backgroundColor: cssColour(auditionIndex(y)),
          transition: 'transform 40ms ease',
        }"
        @mousedown="onAuditionDown(y, $event)"
        @mouseup="onAuditionUp(y)"
        @mouseleave="onAuditionUp(y)"
      />
    </div>
  </div>
</template>
