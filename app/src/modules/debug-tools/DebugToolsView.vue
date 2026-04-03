<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { midi } from '@/lib/midi'
import HexDump from './HexDump.vue'

const connected = ref(midi.isConnected)
const activeTab = ref<'ping' | 'read' | 'watch' | 'pointer'>('ping')
const memAvailable = ref<boolean | null>(null)

// Ping
const pingResult = ref('')
const pingError = ref('')
const pinging = ref(false)

// Read
const readAddr = ref('20000000')
const readLen = ref(256)
const readData = ref<Uint8Array<ArrayBufferLike>>(new Uint8Array(0))
const readError = ref('')
const reading = ref(false)

// Watch
const watchAddr = ref('20000000')
const watchLen = ref(64)
const watchInterval = ref(500)
const watching = ref(false)
const watchData = ref<Uint8Array<ArrayBufferLike>>(new Uint8Array(0))
const watchPrev = ref<Uint8Array<ArrayBufferLike> | undefined>(undefined)
let watchTimer: ReturnType<typeof setInterval> | null = null

// Pointer
const ptrAddr = ref('20000000')
const ptrOffsets = ref<{ offset: string; addr: number; value: string; data: Uint8Array }[]>([])
const ptrError = ref('')
const ptrLoading = ref(false)

const presets = [
  { label: 'SRAM', addr: '20000000', len: 256 },
  { label: 'SDRAM', addr: '0C000000', len: 256 },
  { label: 'Flash', addr: '18000000', len: 256 },
]

let unsubConnection: (() => void) | null = null

onMounted(() => {
  unsubConnection = midi.onConnectionChange((c) => {
    connected.value = c
    if (!c) {
      memAvailable.value = null
      stopWatch()
    }
  })
})

onUnmounted(() => {
  unsubConnection?.()
  stopWatch()
})

function parseHexAddr(s: string): number {
  return parseInt(s, 16) >>> 0
}

async function doPing() {
  pinging.value = true
  pingError.value = ''
  pingResult.value = ''
  try {
    const ver = await midi.memPing()
    pingResult.value = ver
    memAvailable.value = true
  } catch (e: any) {
    pingError.value = e.message ?? String(e)
    memAvailable.value = false
  } finally {
    pinging.value = false
  }
}

async function doRead() {
  reading.value = true
  readError.value = ''
  readData.value = new Uint8Array(0)
  try {
    readData.value = await midi.memRead(parseHexAddr(readAddr.value), readLen.value)
  } catch (e: any) {
    readError.value = e.message ?? String(e)
  } finally {
    reading.value = false
  }
}

function applyPreset(p: { addr: string; len: number }) {
  readAddr.value = p.addr
  readLen.value = p.len
}

function startWatch() {
  watching.value = true
  watchPrev.value = undefined
  watchData.value = new Uint8Array(0)
  doWatchPoll()
  watchTimer = setInterval(doWatchPoll, watchInterval.value)
}

function stopWatch() {
  watching.value = false
  if (watchTimer) {
    clearInterval(watchTimer)
    watchTimer = null
  }
}

async function doWatchPoll() {
  try {
    const data = await midi.memRead(parseHexAddr(watchAddr.value), watchLen.value)
    if (watchData.value.length > 0) {
      watchPrev.value = watchData.value
    }
    watchData.value = data
  } catch {
    stopWatch()
  }
}

watch(watchInterval, () => {
  if (watching.value) {
    stopWatch()
    startWatch()
  }
})

async function doPointerChase() {
  ptrLoading.value = true
  ptrError.value = ''
  ptrOffsets.value = []
  try {
    let currentAddr = parseHexAddr(ptrAddr.value)
    const steps: typeof ptrOffsets.value = []

    for (const entry of ptrOffsetEntries.value) {
      const data = await midi.memRead(currentAddr, 4)
      const value = data[0] | (data[1] << 8) | (data[2] << 16) | ((data[3] << 24) >>> 0)
      steps.push({
        offset: entry,
        addr: currentAddr,
        value: '0x' + (value >>> 0).toString(16).padStart(8, '0'),
        data,
      })
      const off = parseInt(entry, 16) || 0
      currentAddr = (value + off) >>> 0
    }

    ptrOffsets.value = steps
  } catch (e: any) {
    ptrError.value = e.message ?? String(e)
  } finally {
    ptrLoading.value = false
  }
}

const ptrOffsetEntries = ref<string[]>(['0'])

function addPtrOffset() {
  ptrOffsetEntries.value.push('0')
}

function removePtrOffset(idx: number) {
  ptrOffsetEntries.value.splice(idx, 1)
}
</script>

<template>
  <div class="p-6 max-w-4xl mx-auto space-y-4">
    <h1 class="text-xl font-semibold text-zinc-100">Debug Tools</h1>

    <!-- Banner -->
    <div class="bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm rounded-lg px-4 py-2">
      Requires modified firmware with MemAccess handler (Command 0x06)
    </div>

    <!-- MemAccess not available warning -->
    <div v-if="memAvailable === false" class="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-2">
      MemAccess not available — flash modified firmware
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 border-b border-zinc-800">
      <button
        v-for="tab in (['ping', 'read', 'watch', 'pointer'] as const)"
        :key="tab"
        class="px-4 py-2 text-sm capitalize transition"
        :class="activeTab === tab ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-400 hover:text-zinc-200'"
        @click="activeTab = tab"
      >{{ tab }}</button>
    </div>

    <!-- Ping Tab -->
    <div v-if="activeTab === 'ping'" class="space-y-3">
      <button
        class="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm rounded-lg transition"
        :disabled="!connected || pinging"
        @click="doPing"
      >
        {{ pinging ? 'Pinging...' : 'Ping' }}
      </button>
      <div v-if="pingResult" class="text-green-400 text-sm">Firmware: {{ pingResult }}</div>
      <div v-if="pingError" class="text-red-400 text-sm">{{ pingError }}</div>
    </div>

    <!-- Read Tab -->
    <div v-if="activeTab === 'read'" class="space-y-3">
      <!-- Preset buttons -->
      <div class="flex gap-2">
        <button
          v-for="p in presets"
          :key="p.label"
          class="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs rounded transition"
          :disabled="!connected"
          @click="applyPreset(p)"
        >{{ p.label }}</button>
      </div>

      <div class="flex gap-3 items-end">
        <div>
          <label class="text-xs text-zinc-500 block mb-1">Address (hex)</label>
          <input
            v-model="readAddr"
            class="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm font-mono w-40 focus:border-blue-500 focus:outline-none"
            placeholder="20000000"
          />
        </div>
        <div>
          <label class="text-xs text-zinc-500 block mb-1">Length</label>
          <input
            v-model.number="readLen"
            type="number"
            class="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm font-mono w-28 focus:border-blue-500 focus:outline-none"
            min="1"
            max="65535"
          />
        </div>
        <button
          class="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm rounded-lg transition"
          :disabled="!connected || reading"
          @click="doRead"
        >{{ reading ? 'Reading...' : 'Read' }}</button>
      </div>
      <div v-if="readError" class="text-red-400 text-sm">{{ readError }}</div>
      <HexDump v-if="readData.length > 0" :data="readData" :base-address="parseHexAddr(readAddr)" />
    </div>

    <!-- Watch Tab -->
    <div v-if="activeTab === 'watch'" class="space-y-3">
      <div class="flex gap-3 items-end">
        <div>
          <label class="text-xs text-zinc-500 block mb-1">Address (hex)</label>
          <input
            v-model="watchAddr"
            class="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm font-mono w-40 focus:border-blue-500 focus:outline-none"
            :disabled="watching"
          />
        </div>
        <div>
          <label class="text-xs text-zinc-500 block mb-1">Length</label>
          <input
            v-model.number="watchLen"
            type="number"
            class="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm font-mono w-28 focus:border-blue-500 focus:outline-none"
            min="1"
            max="512"
            :disabled="watching"
          />
        </div>
        <div>
          <label class="text-xs text-zinc-500 block mb-1">Interval: {{ watchInterval }}ms</label>
          <input
            v-model.number="watchInterval"
            type="range"
            min="100"
            max="2000"
            step="100"
            class="w-32"
          />
        </div>
        <button
          v-if="!watching"
          class="px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm rounded-lg transition"
          :disabled="!connected"
          @click="startWatch"
        >Start</button>
        <button
          v-else
          class="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-sm rounded-lg transition"
          @click="stopWatch"
        >Stop</button>
      </div>
      <HexDump
        v-if="watchData.length > 0"
        :data="watchData"
        :base-address="parseHexAddr(watchAddr)"
        :previous-data="watchPrev"
      />
    </div>

    <!-- Pointer Tab -->
    <div v-if="activeTab === 'pointer'" class="space-y-3">
      <div class="flex gap-3 items-end">
        <div>
          <label class="text-xs text-zinc-500 block mb-1">Start Address (hex)</label>
          <input
            v-model="ptrAddr"
            class="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm font-mono w-40 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <button
          class="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm rounded-lg transition"
          :disabled="!connected || ptrLoading"
          @click="doPointerChase"
        >{{ ptrLoading ? 'Chasing...' : 'Chase' }}</button>
      </div>

      <div class="space-y-2">
        <div v-for="(entry, idx) in ptrOffsetEntries" :key="idx" class="flex items-center gap-2">
          <span class="text-xs text-zinc-500 w-16">Step {{ idx + 1 }}</span>
          <span class="text-xs text-zinc-500">+0x</span>
          <input
            v-model="ptrOffsetEntries[idx]"
            class="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm font-mono w-24 focus:border-blue-500 focus:outline-none"
          />
          <button
            v-if="ptrOffsetEntries.length > 1"
            class="text-zinc-600 hover:text-red-400 text-sm"
            @click="removePtrOffset(idx)"
          >x</button>
          <!-- Show result for this step -->
          <span v-if="ptrOffsets[idx]" class="text-xs font-mono text-zinc-400">
            @ 0x{{ ptrOffsets[idx].addr.toString(16).padStart(8, '0') }}
            = {{ ptrOffsets[idx].value }}
          </span>
        </div>
        <button
          class="text-xs text-blue-400 hover:text-blue-300"
          @click="addPtrOffset"
        >+ Add offset</button>
      </div>

      <div v-if="ptrError" class="text-red-400 text-sm">{{ ptrError }}</div>
    </div>
  </div>
</template>
