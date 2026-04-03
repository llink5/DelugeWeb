<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { midi, MidiConnection } from '@/lib/midi'

const oledCanvas = ref<HTMLCanvasElement | null>(null)
const segCanvas = ref<HTMLCanvasElement | null>(null)

const oledData = ref(new Uint8Array(768))
const segDigits = ref(new Uint8Array(4))
const segDots = ref(0)
const isLive = ref(false)

let refreshTimer: ReturnType<typeof setInterval> | null = null
let unsubDisplay: (() => void) | null = null

// ── 7-segment geometry ──────────────────────────────────────────────
// Each digit is drawn in a 40x70 cell. Segments: a(top), b(TR), c(BR), d(bot), e(BL), f(TL), g(mid)
// Segment bit mapping: standard 7-seg — bit0=a, bit1=b, bit2=c, bit3=d, bit4=e, bit5=f, bit6=g
const DIGIT_MAP: number[] = [
  0x3F, // 0: a b c d e f
  0x06, // 1: b c
  0x5B, // 2: a b d e g
  0x4F, // 3: a b c d g
  0x66, // 4: b c f g
  0x6D, // 5: a c d f g
  0x7D, // 6: a c d e f g
  0x07, // 7: a b c
  0x7F, // 8: all
  0x6F, // 9: a b c d f g
]

// Polygon points for each segment (relative to digit origin), in a 40x70 box
const SEG_POLYS: string[] = [
  '4,2 8,6 32,6 36,2 32,-2 8,-2',         // a — top horizontal
  '37,4 33,8 33,30 37,34 41,30 41,8',      // b — top-right vertical
  '37,36 33,40 33,62 37,66 41,62 41,40',   // c — bottom-right vertical
  '4,68 8,64 32,64 36,68 32,72 8,72',      // d — bottom horizontal
  '-1,36 3,40 3,62 -1,66 -5,62 -5,40',     // e — bottom-left vertical
  '-1,4 3,8 3,30 -1,34 -5,30 -5,8',        // f — top-left vertical
  '4,35 8,31 32,31 36,35 32,39 8,39',      // g — middle horizontal
]

// ── Drawing ─────────────────────────────────────────────────────────

function drawOled() {
  const canvas = oledCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.fillStyle = '#111111'
  ctx.fillRect(0, 0, 640, 240)

  const data = oledData.value
  ctx.fillStyle = '#eeeeee'

  for (let col = 0; col < 128; col++) {
    for (let block = 0; block < 6; block++) {
      const byte = data[block * 128 + col]
      for (let bit = 0; bit < 8; bit++) {
        if (byte & (1 << bit)) {
          const x = col * 5 + 0.5
          const y = (block * 8 + bit) * 5 + 0.5
          ctx.fillRect(x, y, 4.5, 4.5)
        }
      }
    }
  }
}

function draw7Seg() {
  const canvas = segCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.fillStyle = '#111111'
  ctx.fillRect(0, 0, 320, 140)

  const digits = segDigits.value
  const dots = segDots.value

  for (let d = 0; d < 4; d++) {
    const digitVal = digits[d]
    const segments = digitVal < 10 ? DIGIT_MAP[digitVal] : 0
    const ox = 30 + d * 72
    const oy = 30

    for (let s = 0; s < 7; s++) {
      const active = (segments & (1 << s)) !== 0
      ctx.fillStyle = active ? '#CC3333' : '#331111'

      const pts = SEG_POLYS[s].split(' ').map((p) => {
        const [px, py] = p.split(',').map(Number)
        return [ox + px, oy + py] as [number, number]
      })

      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1])
      }
      ctx.closePath()
      ctx.fill()
    }

    // Decimal point
    if (dots & (1 << d)) {
      ctx.fillStyle = '#CC3333'
    } else {
      ctx.fillStyle = '#331111'
    }
    ctx.beginPath()
    ctx.arc(ox + 44, oy + 68, 4, 0, Math.PI * 2)
    ctx.fill()
  }
}

// ── Display data handler ────────────────────────────────────────────

function onDisplayData(type: 'oled' | '7seg', data: Uint8Array) {
  if (type === 'oled') {
    if (data.length < 4) return
    const subCmd = data[0]
    const displayType = data[1]

    if (subCmd === 0x01) {
      // Full frame — RLE-encoded OLED data starting at byte 2
      const decoded = MidiConnection.unpackRle(data.subarray(2))
      if (decoded.length >= 768) {
        oledData.value = new Uint8Array(decoded.subarray(0, 768))
      } else {
        const buf = new Uint8Array(768)
        buf.set(decoded)
        oledData.value = buf
      }
    } else if (subCmd === 0x02) {
      // Delta frame — first byte is start offset, second is length, then RLE data
      if (data.length < 5) return
      const first = data[2]
      const len = data[3]
      const decoded = MidiConnection.unpackRle(data.subarray(4))
      const buf = new Uint8Array(oledData.value)
      for (let i = 0; i < decoded.length && first + i < 768; i++) {
        buf[first + i] = decoded[i]
      }
      oledData.value = buf
    }

    nextTick(drawOled)
  } else if (type === '7seg') {
    // 7-segment data: 4 digit values + dot bitmask
    if (data.length >= 5) {
      const d = new Uint8Array(4)
      d[0] = data[0]
      d[1] = data[1]
      d[2] = data[2]
      d[3] = data[3]
      segDigits.value = d
      segDots.value = data[4]
    }
    nextTick(draw7Seg)
  }
}

// ── Live control ────────────────────────────────────────────────────

function startLive() {
  if (isLive.value) return
  isLive.value = true
  midi.requestOled(true)
  midi.request7Seg()
  refreshTimer = setInterval(() => {
    midi.requestOled()
    midi.request7Seg()
  }, 1000)
}

function stopLive() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  isLive.value = false
}

function screenshot() {
  const canvas = oledCanvas.value
  if (!canvas) return
  const url = canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = `deluge-oled-${Date.now()}.png`
  a.click()
}

// ── Lifecycle ───────────────────────────────────────────────────────

onMounted(() => {
  unsubDisplay = midi.onDisplayData(onDisplayData)
  nextTick(() => {
    drawOled()
    draw7Seg()
  })
})

onUnmounted(() => {
  stopLive()
  unsubDisplay?.()
})
</script>

<template>
  <div class="p-6 space-y-6">
    <h2 class="text-xl font-semibold text-zinc-200">Display Mirror</h2>

    <!-- Controls -->
    <div class="flex items-center gap-3">
      <button
        v-if="!isLive"
        class="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition"
        @click="startLive"
      >
        Start Live
      </button>
      <button
        v-else
        class="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-500 transition"
        @click="stopLive"
      >
        Stop Live
      </button>
      <button
        class="px-4 py-2 rounded-lg bg-zinc-700 text-zinc-300 text-sm font-medium hover:bg-zinc-600 transition"
        @click="screenshot"
      >
        Screenshot
      </button>
      <span
        v-if="isLive"
        class="flex items-center gap-2 text-sm text-emerald-400"
      >
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        Live
      </span>
    </div>

    <!-- OLED Display -->
    <div class="space-y-2">
      <h3 class="text-sm font-medium text-zinc-400">OLED Display</h3>
      <div class="inline-block rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900">
        <canvas
          ref="oledCanvas"
          width="640"
          height="240"
          class="block"
        />
      </div>
    </div>

    <!-- 7-Segment Display -->
    <div class="space-y-2">
      <h3 class="text-sm font-medium text-zinc-400">7-Segment Display</h3>
      <div class="inline-block rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900">
        <canvas
          ref="segCanvas"
          width="320"
          height="140"
          class="block"
        />
      </div>
    </div>
  </div>
</template>
