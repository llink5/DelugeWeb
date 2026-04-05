<script setup lang="ts">
// Deluge OLED renderer.
//
// Draws a 128×64 SSD1306-format framebuffer into a canvas. The framebuffer
// is organised as 8 pages of 128 columns: byte[page*128 + col] holds 8
// vertical pixels stacked LSB→MSB top-to-bottom.
//
// Shared by display-mirror (reads the framebuffer over SysEx from real
// hardware) and the virtual-hardware view (reads from the emulator). Both
// pass the same 1024-byte (8 pages × 128 columns) or 768-byte (6 pages ×
// 128, Deluge's effective range) array and get an identical rendering.

import { ref, watch, onMounted } from 'vue'

const props = withDefaults(
  defineProps<{
    /** SSD1306 framebuffer (128×64 = 1024 bytes; Deluge uses 768). */
    framebuffer: Uint8Array
    /** Pixel size in CSS pixels. Default 5 gives a 640×240 canvas. */
    pixelSize?: number
    /** ON pixel colour. */
    onColor?: string
    /** OFF / background colour. */
    offColor?: string
    /** Number of pages (rows of 8 pixels each). Deluge uses 6 (48 pixels). */
    pages?: number
  }>(),
  {
    pixelSize: 5,
    onColor: '#EEEEEE',
    offColor: '#111111',
    pages: 6,
  },
)

const canvas = ref<HTMLCanvasElement | null>(null)

const width = () => 128 * props.pixelSize
const height = () => props.pages * 8 * props.pixelSize

function draw() {
  const c = canvas.value
  if (!c) return
  const ctx = c.getContext('2d')
  if (!ctx) return
  const ps = props.pixelSize
  // Fill background
  ctx.fillStyle = props.offColor
  ctx.fillRect(0, 0, width(), height())
  // Fill ON pixels
  ctx.fillStyle = props.onColor
  const fb = props.framebuffer
  const pages = props.pages
  for (let col = 0; col < 128; col++) {
    for (let page = 0; page < pages; page++) {
      const byte = fb[page * 128 + col] ?? 0
      if (byte === 0) continue
      for (let bit = 0; bit < 8; bit++) {
        if (byte & (1 << bit)) {
          const x = col * ps + 0.5
          const y = (page * 8 + bit) * ps + 0.5
          ctx.fillRect(x, y, ps - 0.5, ps - 0.5)
        }
      }
    }
  }
}

onMounted(draw)
watch(
  () => [props.framebuffer, props.pixelSize, props.onColor, props.offColor, props.pages],
  draw,
  { deep: false },
)

// Expose the canvas for screenshot/export scenarios.
function toDataUrl(mime = 'image/png'): string | null {
  return canvas.value?.toDataURL(mime) ?? null
}
defineExpose({ toDataUrl, draw })
</script>

<template>
  <canvas
    ref="canvas"
    :width="width()"
    :height="height()"
    class="block oled-display"
    data-testid="oled-display"
    :style="{ imageRendering: 'pixelated' }"
  />
</template>
