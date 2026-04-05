<script setup lang="ts">
// Emulator performance monitor.
//
// Reads from a shared PerfStats instance and renders a snapshot on every
// refreshToken change. The parent owns the PerfStats and feeds it samples
// via record(executed, elapsedMs) around each step call.

import { computed } from 'vue'
import type { PerfStats } from '@/lib/emulator/PerfStats'

const props = defineProps<{
  stats: PerfStats
  refreshToken: number
}>()

const snapshot = computed(() => {
  // Force re-evaluation when refreshToken changes.
  void props.refreshToken
  return props.stats.snapshot()
})
</script>

<template>
  <section
    class="perf-monitor grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 md:grid-cols-4"
    data-testid="perf-monitor"
  >
    <div>
      <div class="text-[10px] uppercase text-slate-500 dark:text-slate-400">Rolling MIPS</div>
      <div class="font-mono text-slate-700 dark:text-slate-200">
        {{ snapshot.rollingMips.toFixed(2) }}
      </div>
    </div>
    <div>
      <div class="text-[10px] uppercase text-slate-500 dark:text-slate-400">Avg MIPS</div>
      <div class="font-mono text-slate-700 dark:text-slate-200">
        {{ snapshot.averageMips.toFixed(2) }}
      </div>
    </div>
    <div>
      <div class="text-[10px] uppercase text-slate-500 dark:text-slate-400">Step latency</div>
      <div class="font-mono text-slate-700 dark:text-slate-200">
        {{ snapshot.lastLatencyMs.toFixed(1) }}ms
      </div>
    </div>
    <div>
      <div class="text-[10px] uppercase text-slate-500 dark:text-slate-400">Instructions</div>
      <div class="font-mono text-slate-700 dark:text-slate-200">
        {{ snapshot.totalInstructions.toLocaleString() }}
      </div>
    </div>
  </section>
</template>
