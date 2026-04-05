<script setup lang="ts">
// Breakpoint list + add/remove controls.

import { ref, watchEffect } from 'vue'
import type { DelugeEmulator } from '@/lib/emulator/DelugeEmulator'
import type { BreakpointDto } from '@/lib/emulator/protocol'

const props = defineProps<{
  emulator: DelugeEmulator
  refreshToken: number
}>()

const breakpoints = ref<BreakpointDto[]>([])
const addQuery = ref('')
const oneShot = ref(false)
const error = ref('')

async function refresh() {
  const reply = await props.emulator.listBreakpoints()
  if (reply.type === 'breakpointList' && reply.ok) {
    breakpoints.value = reply.breakpoints
  }
}

watchEffect(() => {
  void props.refreshToken
  refresh().catch(() => {})
})

async function addBreakpoint() {
  const q = addQuery.value.trim()
  if (!q) return
  error.value = ''
  try {
    if (q.startsWith('0x') || /^\d+$/.test(q)) {
      // Treat as a hex or decimal address
      const addr = q.startsWith('0x') ? parseInt(q, 16) : parseInt(q, 10)
      await props.emulator.setBreakpoint(addr >>> 0, { oneShot: oneShot.value })
    } else {
      // Resolve symbol name — use searchSymbols with exact-name expectation
      const reply = await props.emulator.searchSymbols(q, { max: 1 })
      if (reply.type === 'symbolResults' && reply.hits.length > 0) {
        const hit = reply.hits[0]
        await props.emulator.setBreakpoint(hit.address, {
          oneShot: oneShot.value,
          label: hit.name,
        })
      } else {
        error.value = `Unknown symbol: ${q}`
        return
      }
    }
    addQuery.value = ''
    await refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function removeBreakpoint(id: number) {
  await props.emulator.clearBreakpoint(id)
  await refresh()
}

function fmtAddr(a: number): string {
  return '0x' + (a >>> 0).toString(16).padStart(8, '0')
}
</script>

<template>
  <div
    class="breakpoint-panel flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800"
    data-testid="breakpoint-panel"
  >
    <div class="flex items-center justify-between">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
        Breakpoints ({{ breakpoints.length }})
      </h3>
      <button
        type="button"
        class="text-[10px] text-slate-400 hover:text-sky-400"
        @click="refresh"
      >
        Refresh
      </button>
    </div>

    <form class="flex items-center gap-2" @submit.prevent="addBreakpoint">
      <input
        v-model="addQuery"
        type="text"
        placeholder="symbol or 0xADDR"
        data-testid="bp-input"
        class="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"
      />
      <label class="flex items-center gap-1 text-[10px] text-slate-500">
        <input v-model="oneShot" type="checkbox" />
        once
      </label>
      <button
        type="submit"
        data-testid="bp-add"
        class="rounded bg-sky-600 px-2 py-1 text-[10px] text-white hover:bg-sky-500"
      >
        Add
      </button>
    </form>

    <p v-if="error" class="text-[10px] text-rose-400">{{ error }}</p>

    <div class="max-h-48 overflow-auto font-mono text-[11px]">
      <div
        v-for="bp in breakpoints"
        :key="bp.id"
        :data-bp-id="bp.id"
        class="flex items-center gap-2 px-1 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        <span class="w-5 text-slate-400">{{ bp.hits }}×</span>
        <span class="w-24 text-slate-400">{{ fmtAddr(bp.address) }}</span>
        <span class="flex-1 truncate text-slate-700 dark:text-slate-200">
          {{ bp.label ?? '—' }}
        </span>
        <span
          v-if="bp.oneShot"
          class="rounded bg-amber-500/20 px-1 text-[9px] text-amber-400"
          >once</span
        >
        <button
          type="button"
          class="text-[10px] text-slate-400 hover:text-rose-400"
          :data-testid="`bp-remove-${bp.id}`"
          @click="removeBreakpoint(bp.id)"
        >
          ✕
        </button>
      </div>
      <div v-if="breakpoints.length === 0" class="italic text-slate-400">
        No breakpoints set.
      </div>
    </div>
  </div>
</template>
