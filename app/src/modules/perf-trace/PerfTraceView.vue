<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { midi } from '@/lib/midi'

// ── Types ───────────────────────────────────────────────────────────

interface TraceEvent {
  timestamp: number
  adjustedTime: number
  tag: string
  value: string
  duration: number | null
}

interface TagInfo {
  tag: string
  count: number
  minTime: number
  maxTime: number
  color: string
}

// ── State ───────────────────────────────────────────────────────────

const events = ref<TraceEvent[]>([])
const isCapturing = ref(false)
const timeScaleLabel = ref<'seconds' | 'ms' | 'us'>('seconds')
const tagInfoMap = ref<Map<string, TagInfo>>(new Map())

const timeScale = computed(() => {
  switch (timeScaleLabel.value) {
    case 'seconds': return 400_000_000
    case 'ms': return 400_000
    case 'us': return 400
  }
})

const timeUnit = computed(() => {
  switch (timeScaleLabel.value) {
    case 'seconds': return 's'
    case 'ms': return 'ms'
    case 'us': return 'us'
  }
})

const eventCount = computed(() => events.value.length)

const timeRange = computed(() => {
  if (events.value.length === 0) return ''
  const first = events.value[0].adjustedTime
  const last = events.value[events.value.length - 1].adjustedTime
  const delta = (last - first) / timeScale.value
  return delta.toFixed(3) + ' ' + timeUnit.value
})

// ── Event collector ─────────────────────────────────────────────────

let overflowArmed = false
let baseTime = 0
let lineBuffer = ''
let processTimer: ReturnType<typeof setInterval> | null = null
const pendingLines: string[] = []

function parseLine(line: string): TraceEvent | null {
  const match = line.match(/^([0-9A-Fa-f]{8})\s+(.*)$/)
  if (!match) return null

  const rawTimestamp = parseInt(match[1], 16)
  const body = match[2].trim()

  // Overflow detection
  if (overflowArmed && rawTimestamp < 0x60000000) {
    baseTime += 0x100000000
    overflowArmed = false
  }
  if (rawTimestamp > 0xA0000000) {
    overflowArmed = true
  }

  const adjustedTime = baseTime + rawTimestamp

  // Parse tag and value from body: "TAG value" or just "TAG"
  const parts = body.split(/\s+/, 2)
  const tag = parts[0] || ''
  const value = parts[1] || ''

  return {
    timestamp: rawTimestamp,
    adjustedTime,
    tag,
    value,
    duration: null,
  }
}

function processLines() {
  if (pendingLines.length === 0) return

  const batch = pendingLines.splice(0)
  const newEvents: TraceEvent[] = []

  for (const line of batch) {
    if (line.trim().length === 0) continue
    const evt = parseLine(line)
    if (evt) newEvents.push(evt)
  }

  if (newEvents.length === 0) return

  // Match endings (tags ending with ~) to compute durations
  matchEndings(newEvents)

  // Update tag info
  for (const evt of newEvents) {
    let info = tagInfoMap.value.get(evt.tag)
    if (!info) {
      info = {
        tag: evt.tag,
        count: 0,
        minTime: evt.adjustedTime,
        maxTime: evt.adjustedTime,
        color: tagColor(evt.tag),
      }
      tagInfoMap.value.set(evt.tag, info)
    }
    info.count++
    if (evt.adjustedTime < info.minTime) info.minTime = evt.adjustedTime
    if (evt.adjustedTime > info.maxTime) info.maxTime = evt.adjustedTime
  }

  events.value = [...events.value, ...newEvents]
}

function matchEndings(batch: TraceEvent[]) {
  // Scan backward for tags ending with ~ and find their start counterpart
  for (let i = batch.length - 1; i >= 0; i--) {
    const evt = batch[i]
    if (!evt.tag.endsWith('~')) continue

    const startTag = evt.tag.slice(0, -1)
    // Search backward for matching start
    for (let j = i - 1; j >= 0; j--) {
      if (batch[j].tag === startTag && batch[j].duration === null) {
        batch[j].duration = evt.adjustedTime - batch[j].adjustedTime
        break
      }
    }
  }
}

// ── Consistent tag color hashing ────────────────────────────────────

const TAG_COLORS = [
  '#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa',
  '#fb923c', '#22d3ee', '#e879f9', '#4ade80', '#f87171',
  '#38bdf8', '#c084fc', '#2dd4bf', '#facc15', '#fb7185',
]

function tagColor(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]
}

// ── Capture control ─────────────────────────────────────────────────

function startCapture() {
  if (isCapturing.value) return
  isCapturing.value = true
  overflowArmed = false
  baseTime = 0
  lineBuffer = ''

  midi.startDebugStream((text: string) => {
    lineBuffer += text
    const lines = lineBuffer.split('\n')
    // Keep last partial line in buffer
    lineBuffer = lines.pop() || ''
    pendingLines.push(...lines)
  })

  processTimer = setInterval(processLines, 100)
}

function stopCapture() {
  if (!isCapturing.value) return
  midi.stopDebugStream()
  isCapturing.value = false

  if (processTimer) {
    clearInterval(processTimer)
    processTimer = null
  }

  // Process remaining
  if (lineBuffer.trim()) {
    pendingLines.push(lineBuffer)
    lineBuffer = ''
  }
  processLines()
}

function clearEvents() {
  events.value = []
  tagInfoMap.value = new Map()
  overflowArmed = false
  baseTime = 0
}

// ── File upload ─────────────────────────────────────────────────────

function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files || !input.files[0]) return
  const file = input.files[0]

  const reader = new FileReader()
  reader.onload = () => {
    const text = reader.result as string
    const lines = text.split('\n')

    clearEvents()

    for (const line of lines) {
      if (line.trim().length === 0) continue
      pendingLines.push(line)
    }
    processLines()
  }
  reader.readAsText(file)
  input.value = ''
}

// ── Format helpers ──────────────────────────────────────────────────

function formatTime(adjustedTime: number): string {
  const t = adjustedTime / timeScale.value
  if (timeScaleLabel.value === 'us') return t.toFixed(0)
  if (timeScaleLabel.value === 'ms') return t.toFixed(2)
  return t.toFixed(6)
}

function formatDuration(duration: number | null): string {
  if (duration === null) return '-'
  const t = duration / timeScale.value
  if (timeScaleLabel.value === 'us') return t.toFixed(0)
  if (timeScaleLabel.value === 'ms') return t.toFixed(2)
  return t.toFixed(6)
}

// ── Lifecycle ───────────────────────────────────────────────────────

onUnmounted(() => {
  if (isCapturing.value) stopCapture()
})
</script>

<template>
  <div class="p-6 space-y-6">
    <h2 class="text-xl font-semibold text-zinc-200">Performance Trace</h2>

    <!-- Controls -->
    <div class="flex flex-wrap items-center gap-3">
      <button
        v-if="!isCapturing"
        class="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition"
        @click="startCapture"
      >
        Start Capture
      </button>
      <button
        v-else
        class="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-500 transition"
        @click="stopCapture"
      >
        Stop Capture
      </button>

      <button
        class="px-4 py-2 rounded-lg bg-zinc-700 text-zinc-300 text-sm font-medium hover:bg-zinc-600 transition"
        @click="clearEvents"
      >
        Clear
      </button>

      <label class="px-4 py-2 rounded-lg bg-zinc-700 text-zinc-300 text-sm font-medium hover:bg-zinc-600 transition cursor-pointer">
        Load File
        <input type="file" accept=".txt,.log,.csv" class="hidden" @change="handleFileUpload" />
      </label>

      <!-- Time scale -->
      <div class="flex items-center gap-1 ml-auto">
        <span class="text-sm text-zinc-500 mr-1">Scale:</span>
        <button
          v-for="s in (['seconds', 'ms', 'us'] as const)"
          :key="s"
          class="px-3 py-1.5 rounded text-xs font-medium transition"
          :class="timeScaleLabel === s ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'"
          @click="timeScaleLabel = s"
        >
          {{ s }}
        </button>
      </div>
    </div>

    <!-- Summary -->
    <div class="flex items-center gap-6 text-sm text-zinc-400">
      <span>Events: <span class="text-zinc-200 font-medium">{{ eventCount }}</span></span>
      <span v-if="timeRange">Range: <span class="text-zinc-200 font-medium">{{ timeRange }}</span></span>
      <span v-if="isCapturing" class="flex items-center gap-2 text-emerald-400">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        Capturing
      </span>
    </div>

    <!-- Tag legend -->
    <div v-if="tagInfoMap.size > 0" class="flex flex-wrap gap-2">
      <span
        v-for="[tag, info] of tagInfoMap"
        :key="tag"
        class="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 text-xs"
      >
        <span class="w-2.5 h-2.5 rounded-sm" :style="{ backgroundColor: info.color }" />
        <span class="text-zinc-300">{{ tag }}</span>
        <span class="text-zinc-500">({{ info.count }})</span>
      </span>
    </div>

    <!-- Event table -->
    <div class="rounded-lg border border-zinc-800 overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-zinc-900 border-b border-zinc-800">
            <th class="text-left px-4 py-2.5 text-zinc-400 font-medium w-40">Time ({{ timeUnit }})</th>
            <th class="text-left px-4 py-2.5 text-zinc-400 font-medium w-48">Tag</th>
            <th class="text-left px-4 py-2.5 text-zinc-400 font-medium w-48">Value</th>
            <th class="text-left px-4 py-2.5 text-zinc-400 font-medium w-40">Duration ({{ timeUnit }})</th>
          </tr>
        </thead>
        <tbody class="max-h-[600px] overflow-y-auto block">
          <tr
            v-for="(evt, i) in events"
            :key="i"
            class="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
            :class="{ 'contents': false }"
          >
            <td class="px-4 py-1.5 font-mono text-zinc-300 w-40">{{ formatTime(evt.adjustedTime) }}</td>
            <td class="px-4 py-1.5 w-48">
              <span
                class="inline-block px-1.5 py-0.5 rounded text-xs font-medium"
                :style="{ backgroundColor: tagColor(evt.tag) + '22', color: tagColor(evt.tag) }"
              >
                {{ evt.tag }}
              </span>
            </td>
            <td class="px-4 py-1.5 font-mono text-zinc-400 w-48">{{ evt.value || '-' }}</td>
            <td class="px-4 py-1.5 font-mono text-zinc-400 w-40">{{ formatDuration(evt.duration) }}</td>
          </tr>
          <tr v-if="events.length === 0">
            <td colspan="4" class="px-4 py-8 text-center text-zinc-600">
              No events captured. Start a capture or load a trace file.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
