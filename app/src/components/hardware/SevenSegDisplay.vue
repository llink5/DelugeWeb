<script setup lang="ts">
// 4-digit 7-segment display renderer.
//
// Each digit is an 8-bit value: for digits 0-9 the matching lit-segment
// mask is looked up; higher values can be used to display hex characters
// (not emitted by the Deluge but supported for completeness). The `dots`
// field is a 4-bit bitmask of decimal points (bit N = digit N).

import { ref, watch, onMounted } from 'vue'

const props = withDefaults(
  defineProps<{
    digits: Uint8Array // 4 bytes expected
    dots: number // 4-bit mask
    scale?: number // overall canvas scale, default 1
    litColor?: string
    offColor?: string
    background?: string
  }>(),
  {
    scale: 1,
    litColor: '#CC3333',
    offColor: '#331111',
    background: '#111111',
  },
)

const canvas = ref<HTMLCanvasElement | null>(null)

// Digit → segment bitmap. Bit layout: a(0) b(1) c(2) d(3) e(4) f(5) g(6).
const DIGIT_MAP: readonly number[] = [
  0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, // 0-9
  0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71, // A-F
]

// Segment polygons in a 40x70-ish cell (pre-scale).
const SEG_POLYS: readonly string[] = [
  '4,2 8,6 32,6 36,2 32,-2 8,-2',
  '37,4 33,8 33,30 37,34 41,30 41,8',
  '37,36 33,40 33,62 37,66 41,62 41,40',
  '4,68 8,64 32,64 36,68 32,72 8,72',
  '-1,36 3,40 3,62 -1,66 -5,62 -5,40',
  '-1,4 3,8 3,30 -1,34 -5,30 -5,8',
  '4,35 8,31 32,31 36,35 32,39 8,39',
]

const BASE_WIDTH = 320
const BASE_HEIGHT = 140

const width = () => BASE_WIDTH * props.scale
const height = () => BASE_HEIGHT * props.scale

function draw() {
  const c = canvas.value
  if (!c) return
  const ctx = c.getContext('2d')
  if (!ctx) return
  const s = props.scale
  ctx.fillStyle = props.background
  ctx.fillRect(0, 0, width(), height())

  for (let d = 0; d < 4; d++) {
    const val = props.digits[d] ?? 0
    const mask = val < DIGIT_MAP.length ? DIGIT_MAP[val] : 0
    const ox = (30 + d * 72) * s
    const oy = 30 * s
    for (let seg = 0; seg < 7; seg++) {
      const lit = (mask & (1 << seg)) !== 0
      ctx.fillStyle = lit ? props.litColor : props.offColor
      const pts = SEG_POLYS[seg]
        .split(' ')
        .map((p) => p.split(',').map(Number))
      ctx.beginPath()
      ctx.moveTo(ox + pts[0][0] * s, oy + pts[0][1] * s)
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(ox + pts[i][0] * s, oy + pts[i][1] * s)
      }
      ctx.closePath()
      ctx.fill()
    }
    // Decimal dot
    ctx.fillStyle = props.dots & (1 << d) ? props.litColor : props.offColor
    ctx.beginPath()
    ctx.arc(ox + 44 * s, oy + 68 * s, 4 * s, 0, Math.PI * 2)
    ctx.fill()
  }
}

onMounted(draw)
watch(
  () => [props.digits, props.dots, props.scale, props.litColor, props.offColor],
  draw,
  { deep: false },
)

defineExpose({ draw })
</script>

<template>
  <canvas
    ref="canvas"
    :width="width()"
    :height="height()"
    class="block seven-seg-display"
    data-testid="seven-seg-display"
  />
</template>
