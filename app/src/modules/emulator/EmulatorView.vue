<script setup lang="ts">
// Emulator shell view.
//
// Top-level container for the Deluge emulator: a thin toolbar, the virtual
// hardware surface, and a collapsible debug panel. Musicians see only the
// Deluge; developers flip the Debug toggle and get registers, log, watches,
// breakpoints, and performance numbers.
//
// This view owns the emulator lifecycle (boot, shutdown, firmware load,
// transport, SD-card attach, audio start) and subscribes to event streams
// that feed the OLED framebuffer and pad LED colours. All UI panels are
// imported from existing modules — nothing is reimplemented here.

import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useEmulator } from '@/lib/emulator/useEmulator'
import { loadElfFromFile } from '@/lib/emulator/elfSources'
import { PerfStats } from '@/lib/emulator/PerfStats'
import { AudioBridge, createAudioContextHook } from '@/lib/audio/AudioBridge'
import {
  encodePadPress,
  encodePadRelease,
  encodeButtonPress,
  encodeButtonRelease,
  DELUGE_BUTTONS,
} from '@/lib/emulator/peripherals/PicInput'
import { buildFat32Image } from '@/lib/storage/Fat32Builder'

import VirtualHardwareView from '@/modules/virtual-hardware/VirtualHardwareView.vue'
import RegisterView from '@/modules/symbol-debugger/RegisterView.vue'
import WatchPanel from '@/modules/symbol-debugger/WatchPanel.vue'
import BreakpointPanel from '@/modules/symbol-debugger/BreakpointPanel.vue'
import EmulatorLog from '@/modules/symbol-debugger/EmulatorLog.vue'
import PerformanceMonitor from '@/modules/symbol-debugger/PerformanceMonitor.vue'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const emulatorStore = useEmulator()
const ready = emulatorStore.booted
const running = ref(false)
const elfLoaded = ref(false)
const errorMessage = ref('')
const debugMode = ref(false)

// Feed data from the emulator to VirtualHardwareView via props.
// 128×48 OLED framebuffer (Deluge is 6 pages = 48px). Worker emits 1024
// bytes (128×64) but we only render the first 768.
const oledFramebuffer = ref(new Uint8Array(1024))
// 18 cols × 8 rows × 3 bytes (16 main + 2 sidebar).
const padColours = ref(new Uint8Array(18 * 8 * 3))

// Perf stats — recorded around step(), rendered by PerformanceMonitor.
const perfStats = new PerfStats()
const refreshToken = ref(0)
function refreshPerf() {
  refreshToken.value++
}

// Audio
const audioEnabled = ref(false)
const audioBridge = new AudioBridge({ sampleRate: 44100, channels: 2 })

// SD card status
const sdSectors = ref<number | null>(null)

// ---------------------------------------------------------------------------
// Emulator event subscriptions
// ---------------------------------------------------------------------------

let displayUnsub: (() => void) | null = null
let ledUnsub: (() => void) | null = null
let audioUnsub: (() => void) | null = null

function wireSubscriptions() {
  const em = emulatorStore.emulator
  displayUnsub = em.on('displayUpdate', (evt) => {
    oledFramebuffer.value = new Uint8Array(evt.framebuffer)
  })
  ledUnsub = em.on('ledUpdate', (evt) => {
    padColours.value = new Uint8Array(evt.colors)
  })
  audioUnsub = em.on('audioBuffer', (evt) => {
    const samples = new Int16Array(evt.samples)
    audioBridge.feedSamples(samples)
  })
}

function unwireSubscriptions() {
  displayUnsub?.()
  ledUnsub?.()
  audioUnsub?.()
  displayUnsub = null
  ledUnsub = null
  audioUnsub = null
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

async function bootEmulator() {
  errorMessage.value = ''
  try {
    await emulatorStore.ensureBooted()
    wireSubscriptions()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

async function shutdownEmulator() {
  unwireSubscriptions()
  if (audioEnabled.value) {
    await audioBridge.stop()
    audioEnabled.value = false
  }
  emulatorStore.shutdown()
  elfLoaded.value = false
  running.value = false
  sdSectors.value = null
}

// ---------------------------------------------------------------------------
// Firmware load / transport
// ---------------------------------------------------------------------------

const fileInput = ref<HTMLInputElement | null>(null)

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const { buffer } = await loadElfFromFile(file)
    await loadFirmware(buffer)
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

async function loadFirmware(buffer: ArrayBuffer) {
  if (!ready.value) return
  errorMessage.value = ''
  const reply = await emulatorStore.emulator.loadFirmware(buffer)
  if (!reply.ok) {
    errorMessage.value = reply.error ?? 'loadFirmware failed'
    return
  }
  elfLoaded.value = true
  perfStats.reset()
  refreshPerf()
}

async function onStart() {
  if (!ready.value) return
  const reply = await emulatorStore.emulator.start()
  if (!reply.ok) {
    errorMessage.value = reply.error ?? 'start failed'
    return
  }
  running.value = true
}

async function onStop() {
  if (!ready.value) return
  await emulatorStore.emulator.stop()
  running.value = false
}

async function onStep() {
  if (!ready.value) return
  const t0 = performance.now()
  const reply = await emulatorStore.emulator.step(100_000)
  const elapsed = performance.now() - t0
  if (reply.type === 'stepped') {
    perfStats.record(reply.executed, elapsed)
    refreshPerf()
  }
}

async function onReset() {
  if (!ready.value) return
  await emulatorStore.emulator.reset()
  elfLoaded.value = false
  running.value = false
  sdSectors.value = null
  perfStats.reset()
  refreshPerf()
}

// ---------------------------------------------------------------------------
// Audio on/off
// ---------------------------------------------------------------------------

async function enableAudio() {
  if (audioEnabled.value) return
  try {
    const workletUrl = new URL(
      '@/lib/audio/workletProcessor.ts',
      import.meta.url,
    )
    audioBridge.attachContext(createAudioContextHook(workletUrl))
    await audioBridge.start()
    audioEnabled.value = true
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

async function disableAudio() {
  if (!audioEnabled.value) return
  await audioBridge.stop()
  audioEnabled.value = false
}

// ---------------------------------------------------------------------------
// SD card attach
// ---------------------------------------------------------------------------

async function attachDefaultSdImage() {
  if (!ready.value) return
  try {
    const image = buildFat32Image(
      [
        { path: '/SYNTHS' },
        { path: '/KITS' },
        { path: '/SONGS' },
        { path: '/SAMPLES' },
      ],
      { sizeMiB: 33, label: 'DELUGE' },
    )
    const ab = new ArrayBuffer(image.byteLength)
    new Uint8Array(ab).set(image)
    const reply = await emulatorStore.emulator.attachSdImage(ab)
    if (reply.type === 'sdImageAttached' && reply.ok) {
      sdSectors.value = reply.sectors
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

// ---------------------------------------------------------------------------
// Hardware input routing — UI events → PIC UART RX → firmware
// ---------------------------------------------------------------------------

// UI rows are top-down (row 0 = top). Firmware rows are bottom-up.
function flipRow(uiRow: number): number {
  return 7 - uiRow
}

async function onPadPress(x: number, y: number /* uiRow */) {
  if (!ready.value) return
  try {
    await emulatorStore.emulator.injectPicBytes(encodePadPress(x, flipRow(y)))
  } catch {
    /* swallow — input errors shouldn't break the UI */
  }
}
async function onPadRelease(x: number, y: number) {
  if (!ready.value) return
  try {
    await emulatorStore.emulator.injectPicBytes(encodePadRelease(x, flipRow(y)))
  } catch {
    /* swallow */
  }
}

async function onButtonPress(id: string) {
  if (!ready.value || !(id in DELUGE_BUTTONS)) return
  try {
    await emulatorStore.emulator.injectPicBytes(encodeButtonPress(id))
  } catch {
    /* swallow */
  }
}
async function onButtonRelease(id: string) {
  if (!ready.value || !(id in DELUGE_BUTTONS)) return
  try {
    await emulatorStore.emulator.injectPicBytes(encodeButtonRelease(id))
  } catch {
    /* swallow */
  }
}

async function onEncoderPress(id: string) {
  // Encoder button presses use the same PIC matrix as regular buttons.
  if (!ready.value || !(id in DELUGE_BUTTONS)) return
  try {
    await emulatorStore.emulator.injectPicBytes(encodeButtonPress(id))
    // Treat press as a tap — release immediately.
    await emulatorStore.emulator.injectPicBytes(encodeButtonRelease(id))
  } catch {
    /* swallow */
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
  if (ready.value) wireSubscriptions()
})

onBeforeUnmount(() => {
  unwireSubscriptions()
  // Don't shut the singleton down — other views share it.
})

const statusLabel = computed(() => {
  if (!ready.value) return 'worker offline'
  if (running.value) return 'running'
  if (elfLoaded.value) return 'idle'
  return 'ready'
})

const statusClass = computed(() => {
  if (!ready.value) return 'bg-slate-500/15 text-slate-400'
  if (running.value) return 'bg-sky-500/15 text-sky-400'
  return 'bg-green-500/15 text-green-500'
})
</script>

<template>
  <div
    class="emulator-view flex flex-col gap-3 p-4"
    data-testid="emulator-view"
  >
    <!-- Toolbar -->
    <header
      class="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
    >
      <h1 class="text-lg font-semibold text-slate-700 dark:text-slate-200">
        Deluge Emulator
      </h1>
      <span
        class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
        :class="statusClass"
      >
        {{ statusLabel }}
      </span>

      <div class="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-600" />

      <button
        v-if="!ready"
        type="button"
        data-testid="boot-worker"
        class="rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-500"
        @click="bootEmulator"
      >
        Boot worker
      </button>
      <button
        v-else
        type="button"
        class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
        @click="shutdownEmulator"
      >
        Shutdown
      </button>

      <div class="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-600" />

      <input
        ref="fileInput"
        type="file"
        accept=".elf,.bin"
        class="hidden"
        @change="onFileChange"
      />
      <button
        type="button"
        data-testid="load-elf"
        class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700"
        :disabled="!ready"
        @click="fileInput?.click()"
        title="Load .bin or .elf firmware"
      >
        Load firmware…
      </button>
      <button
        type="button"
        data-testid="attach-sd"
        class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700"
        :disabled="!ready"
        @click="attachDefaultSdImage"
        title="Create and attach an empty 33 MiB FAT32 SD card"
      >
        Attach SD
      </button>
      <span v-if="sdSectors !== null" class="text-[10px] text-slate-400">
        SD: {{ sdSectors.toLocaleString() }} sectors
      </span>

      <div class="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-600" />

      <button
        type="button"
        data-testid="start-run"
        class="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-500 disabled:opacity-40"
        :disabled="!elfLoaded || running"
        @click="onStart"
      >
        ▶ Start
      </button>
      <button
        type="button"
        data-testid="stop-run"
        class="rounded bg-rose-600 px-2 py-1 text-xs text-white hover:bg-rose-500 disabled:opacity-40"
        :disabled="!running"
        @click="onStop"
      >
        ■ Stop
      </button>
      <button
        type="button"
        data-testid="step-run"
        class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700"
        :disabled="!elfLoaded"
        @click="onStep"
      >
        Step
      </button>
      <button
        type="button"
        data-testid="reset-run"
        class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700"
        :disabled="!ready"
        @click="onReset"
      >
        Reset
      </button>

      <div class="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-600" />

      <button
        v-if="!audioEnabled"
        type="button"
        data-testid="audio-enable"
        class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700"
        :disabled="!ready"
        @click="enableAudio"
      >
        🔇 Audio off
      </button>
      <button
        v-else
        type="button"
        data-testid="audio-disable"
        class="rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-500"
        @click="disableAudio"
      >
        🔊 Audio on
      </button>

      <div class="ml-auto flex items-center gap-2">
        <label
          class="flex cursor-pointer items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
        >
          <input
            v-model="debugMode"
            type="checkbox"
            data-testid="debug-toggle"
            class="h-3 w-3"
          />
          <span>Debug</span>
        </label>
      </div>
    </header>

    <!-- Error banner -->
    <div
      v-if="errorMessage"
      class="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-900/30 dark:text-red-300"
    >
      {{ errorMessage }}
    </div>

    <!-- Main: virtual hardware surface -->
    <VirtualHardwareView
      :framebuffer="oledFramebuffer"
      :pad-colours="padColours"
      :pad-cols="18"
      :pad-rows="8"
      :has-audition="false"
      :oled-pages="6"
      @pad-press="onPadPress"
      @pad-release="onPadRelease"
      @button-press="onButtonPress"
      @button-release="onButtonRelease"
      @encoder-press="onEncoderPress"
    />

    <!-- Debug panel — only when toggle is on -->
    <section
      v-if="debugMode && ready"
      class="debug-panel flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50/30 p-3 dark:border-amber-700/40 dark:bg-amber-950/20"
      data-testid="debug-panel"
    >
      <div class="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-500">
        Debug
      </div>
      <PerformanceMonitor :stats="perfStats" :refresh-token="refreshToken" />
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div class="flex flex-col gap-3 lg:col-span-2">
          <EmulatorLog :emulator="emulatorStore.emulator" />
        </div>
        <div class="flex flex-col gap-3">
          <RegisterView
            :emulator="emulatorStore.emulator"
            :refresh-token="refreshToken"
          />
          <WatchPanel
            :emulator="emulatorStore.emulator"
            :refresh-token="refreshToken"
          />
          <BreakpointPanel
            :emulator="emulatorStore.emulator"
            :refresh-token="refreshToken"
          />
        </div>
      </div>
    </section>
  </div>
</template>
