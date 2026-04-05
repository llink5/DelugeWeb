<script setup lang="ts">
// Scrollable emulator log panel.
//
// Subscribes to the `log` and `breakpointHit` event streams on the
// supplied DelugeEmulator. Users of this component don't need to wire
// event handlers themselves — just drop it in and it self-subscribes.

import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { DelugeEmulator } from '@/lib/emulator/DelugeEmulator'

const props = defineProps<{
  emulator: DelugeEmulator
  /** Maximum number of log lines to retain. Older lines are discarded. */
  maxLines?: number
}>()

interface LogLine {
  level: 'info' | 'warn' | 'error'
  message: string
  timestamp: number
}

const MAX_DEFAULT = 500
const logLines = ref<LogLine[]>([])

let logUnsub: (() => void) | null = null
let breakpointUnsub: (() => void) | null = null

function append(level: LogLine['level'], message: string) {
  const next = [...logLines.value, { level, message, timestamp: Date.now() }]
  const cap = props.maxLines ?? MAX_DEFAULT
  if (next.length > cap) next.splice(0, next.length - cap)
  logLines.value = next
}

function clearLog() {
  logLines.value = []
}

/** Expose the append method so parents can push custom events. */
defineExpose({ append, clear: clearLog })

onMounted(() => {
  logUnsub = props.emulator.on('log', (evt) => append(evt.level, evt.message))
  breakpointUnsub = props.emulator.on('breakpointHit', (evt) => {
    append('info', `Breakpoint hit at 0x${evt.address.toString(16)}`)
  })
})

onBeforeUnmount(() => {
  logUnsub?.()
  breakpointUnsub?.()
})
</script>

<template>
  <section
    class="emulator-log flex flex-col gap-2"
    data-testid="emulator-log"
  >
    <div class="flex items-center justify-between">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
        Log ({{ logLines.length }})
      </h2>
      <button
        type="button"
        class="text-[11px] text-slate-400 hover:text-slate-200"
        @click="clearLog"
      >
        Clear
      </button>
    </div>
    <div
      class="h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-2 font-mono text-[11px] dark:border-slate-700"
      data-testid="log-output"
    >
      <div
        v-for="(line, i) in logLines"
        :key="i"
        :class="{
          'text-slate-300': line.level === 'info',
          'text-amber-400': line.level === 'warn',
          'text-rose-400': line.level === 'error',
        }"
      >
        [{{ line.level }}] {{ line.message }}
      </div>
      <div v-if="logLines.length === 0" class="text-slate-600">
        No log output yet.
      </div>
    </div>
  </section>
</template>
