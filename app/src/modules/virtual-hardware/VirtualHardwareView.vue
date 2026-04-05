<script setup lang="ts">
// Virtual Deluge hardware surface.
//
// Composes the OLED display, 7-segment, pad grid, hardware buttons, and
// rotary encoders into a desktop-shaped layout. All displayed data is
// passed in via props — this component doesn't know whether the bytes
// come from a running emulator, a live SysEx feed from a real device, or
// synthetic seed data. User input events are emitted for the parent to
// route as it sees fit.

import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import OledDisplay from '@/components/hardware/OledDisplay.vue'
import SevenSegDisplay from '@/components/hardware/SevenSegDisplay.vue'
import PadGrid from '@/components/hardware/PadGrid.vue'
import ButtonBar from '@/components/hardware/ButtonBar.vue'
import EncoderWheel from '@/components/hardware/EncoderWheel.vue'
import {
  TRANSPORT_BUTTONS,
  MODE_BUTTONS,
  INSTRUMENT_BUTTONS,
  FILE_BUTTONS,
} from './buttons'
import { installKeyboardShortcuts } from './KeyboardShortcuts'

type EncoderId = 'X_ENC' | 'Y_ENC' | 'SELECT_ENC' | 'TEMPO_ENC'

const props = withDefaults(
  defineProps<{
    /** OLED framebuffer (128×H page format). Auto-seeded if absent. */
    framebuffer?: Uint8Array
    /** Pad colour buffer (R,G,B triples, layout depends on `padCols`). */
    padColours?: Uint8Array
    /** 4-digit 7-segment state. */
    sevenSegDigits?: Uint8Array
    /** Bitmask of lit decimal points (bits 0..3). */
    sevenSegDots?: number
    /** Number of main pad columns (16 main, then audition/sidebar). */
    padCols?: number
    /** Number of pad rows. */
    padRows?: number
    /** Render an audition column next to the main grid? */
    hasAudition?: boolean
    /** OLED pages (6 = Deluge 48px, 8 = full 64px). */
    oledPages?: number
    /** Attach keyboard shortcuts. */
    keyboardShortcuts?: boolean
    /** Compact layout for narrow screens. */
    compact?: boolean
  }>(),
  {
    padCols: 16,
    padRows: 8,
    hasAudition: true,
    oledPages: 6,
    keyboardShortcuts: true,
    compact: false,
  },
)

const emit = defineEmits<{
  'pad-press': [x: number, y: number, velocity: number]
  'pad-release': [x: number, y: number]
  'audition-press': [row: number, velocity: number]
  'audition-release': [row: number]
  'button-press': [id: string]
  'button-release': [id: string]
  'encoder-turn': [id: EncoderId, delta: number]
  'encoder-press': [id: EncoderId]
}>()

// ---------------------------------------------------------------------------
// Seed data (used when parent doesn't supply props)
// ---------------------------------------------------------------------------

const seededPads = ref<Uint8Array | null>(null)
const seededOled = ref<Uint8Array | null>(null)

function seedPads(cols: number, rows: number, hasAudition: boolean): Uint8Array {
  const pads = cols * rows + (hasAudition ? rows : 0)
  const b = new Uint8Array(pads * 3)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col
      const o = idx * 3
      const alt = (row + col) % 2 === 0
      b[o] = alt ? 25 : 10
      b[o + 1] = alt ? 35 : 20
      b[o + 2] = alt ? 60 : 35
    }
  }
  if (hasAudition) {
    const auditionBase = cols * rows
    for (let row = 0; row < rows; row++) {
      const o = (auditionBase + row) * 3
      b[o] = 90
      b[o + 1] = 55
      b[o + 2] = 10
    }
  }
  return b
}

function seedOled(pages: number): Uint8Array {
  const fb = new Uint8Array(128 * pages)
  for (let col = 0; col < 128; col++) {
    fb[col] = 0x01 // top row
    fb[(pages - 1) * 128 + col] = 0x80 // bottom row
  }
  for (let page = 0; page < pages; page++) {
    fb[page * 128 + 0] = 0xff
    fb[page * 128 + 127] = 0xff
  }
  return fb
}

const effectivePads = computed(
  () =>
    props.padColours ??
    seededPads.value ??
    seedPads(props.padCols, props.padRows, props.hasAudition),
)
const effectiveOled = computed(
  () => props.framebuffer ?? seededOled.value ?? seedOled(props.oledPages),
)
const effectiveSegDigits = computed(
  () => props.sevenSegDigits ?? new Uint8Array([1, 2, 3, 4]),
)
const effectiveSegDots = computed(() => props.sevenSegDots ?? 0b0010)

// ---------------------------------------------------------------------------
// Visual-feedback state (press indicators, encoder rotations)
// ---------------------------------------------------------------------------

const activePads = ref(new Set<number>())
const pressedButtons = ref(new Set<string>())
const encoderRotations = ref({
  X_ENC: 0,
  Y_ENC: 0,
  SELECT_ENC: 0,
  TEMPO_ENC: 0,
})

// ---------------------------------------------------------------------------
// Input handlers — emit and update visual feedback
// ---------------------------------------------------------------------------

function onPadPress(x: number, y: number, velocity: number) {
  const next = new Set(activePads.value)
  next.add(y * props.padCols + x)
  activePads.value = next
  emit('pad-press', x, y, velocity)
}
function onPadRelease(x: number, y: number) {
  const next = new Set(activePads.value)
  next.delete(y * props.padCols + x)
  activePads.value = next
  emit('pad-release', x, y)
}
function onAuditionPress(row: number, velocity: number) {
  emit('audition-press', row, velocity)
}
function onAuditionRelease(row: number) {
  emit('audition-release', row)
}

function onButtonPress(id: string) {
  const next = new Set(pressedButtons.value)
  next.add(id)
  pressedButtons.value = next
  emit('button-press', id)
}
function onButtonRelease(id: string) {
  const next = new Set(pressedButtons.value)
  next.delete(id)
  pressedButtons.value = next
  emit('button-release', id)
}

function onEncoderTurn(id: EncoderId, delta: number) {
  encoderRotations.value = {
    ...encoderRotations.value,
    [id]: encoderRotations.value[id] + delta,
  }
  emit('encoder-turn', id, delta)
}
function onEncoderPress(id: EncoderId) {
  emit('encoder-press', id)
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts (opt-in via `keyboardShortcuts` prop)
// ---------------------------------------------------------------------------

let uninstallKeyboard: (() => void) | null = null

onMounted(() => {
  if (!props.padColours) seededPads.value = seedPads(props.padCols, props.padRows, props.hasAudition)
  if (!props.framebuffer) seededOled.value = seedOled(props.oledPages)
  if (props.keyboardShortcuts) {
    uninstallKeyboard = installKeyboardShortcuts({
      onPadPress: (x, y) => onPadPress(x, y, 100),
      onPadRelease,
      onButtonPress,
      onButtonRelease,
      onEncoderTurn: (id, delta) => {
        if (id === 'X_ENC' || id === 'Y_ENC' || id === 'SELECT_ENC' || id === 'TEMPO_ENC') {
          onEncoderTurn(id, delta)
        }
      },
    })
  }
})

onBeforeUnmount(() => {
  uninstallKeyboard?.()
})
</script>

<template>
  <div
    class="virtual-hardware-view flex flex-col gap-4"
    :class="compact ? 'p-2' : 'p-4'"
    data-testid="virtual-hardware-view"
  >
    <!-- Displays -->
    <div class="flex flex-wrap items-start gap-4">
      <div
        class="rounded-lg border border-slate-700 bg-slate-900 p-2"
        data-testid="oled-host"
      >
        <OledDisplay
          :framebuffer="effectiveOled"
          :pixel-size="compact ? 3 : 4"
          :pages="oledPages"
        />
      </div>
      <div
        class="rounded-lg border border-slate-700 bg-slate-900 p-2"
        data-testid="seven-seg-host"
      >
        <SevenSegDisplay
          :digits="effectiveSegDigits"
          :dots="effectiveSegDots"
          :scale="compact ? 0.5 : 0.7"
        />
      </div>
    </div>

    <!-- Pad grid -->
    <div class="rounded-lg border border-slate-200 bg-slate-900 dark:border-slate-700">
      <PadGrid
        :colours="effectivePads"
        :active-pads="activePads"
        :cols="padCols"
        :rows="padRows"
        :has-audition="hasAudition"
        :pad-size="compact ? 20 : 28"
        :pad-gap="compact ? 2 : 4"
        @pad-press="onPadPress"
        @pad-release="onPadRelease"
        @audition-press="onAuditionPress"
        @audition-release="onAuditionRelease"
      />
    </div>

    <!-- Button groups + encoders -->
    <div
      class="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800"
    >
      <div class="text-[10px] uppercase tracking-wider text-slate-500">Transport</div>
      <ButtonBar
        :buttons="TRANSPORT_BUTTONS"
        :pressed="pressedButtons"
        @button-press="onButtonPress"
        @button-release="onButtonRelease"
      />
      <div class="text-[10px] uppercase tracking-wider text-slate-500">Modes</div>
      <ButtonBar
        :buttons="MODE_BUTTONS"
        :pressed="pressedButtons"
        @button-press="onButtonPress"
        @button-release="onButtonRelease"
      />
      <div class="text-[10px] uppercase tracking-wider text-slate-500">Instruments</div>
      <ButtonBar
        :buttons="INSTRUMENT_BUTTONS"
        :pressed="pressedButtons"
        @button-press="onButtonPress"
        @button-release="onButtonRelease"
      />
      <div class="text-[10px] uppercase tracking-wider text-slate-500">File / Sync</div>
      <ButtonBar
        :buttons="FILE_BUTTONS"
        :pressed="pressedButtons"
        @button-press="onButtonPress"
        @button-release="onButtonRelease"
      />
      <div class="text-[10px] uppercase tracking-wider text-slate-500">Encoders</div>
      <div class="flex items-end gap-6 px-2 py-1">
        <EncoderWheel
          label="◀▶ X"
          :rotation="encoderRotations.X_ENC"
          @turn="(d) => onEncoderTurn('X_ENC', d)"
          @press="() => onEncoderPress('X_ENC')"
        />
        <EncoderWheel
          label="▼▲ Y"
          :rotation="encoderRotations.Y_ENC"
          @turn="(d) => onEncoderTurn('Y_ENC', d)"
          @press="() => onEncoderPress('Y_ENC')"
        />
        <EncoderWheel
          label="Select"
          :rotation="encoderRotations.SELECT_ENC"
          @turn="(d) => onEncoderTurn('SELECT_ENC', d)"
          @press="() => onEncoderPress('SELECT_ENC')"
        />
        <EncoderWheel
          label="Tempo"
          :rotation="encoderRotations.TEMPO_ENC"
          @turn="(d) => onEncoderTurn('TEMPO_ENC', d)"
          @press="() => onEncoderPress('TEMPO_ENC')"
        />
      </div>
    </div>
  </div>
</template>
