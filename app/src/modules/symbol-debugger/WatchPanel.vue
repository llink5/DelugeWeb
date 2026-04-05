<script setup lang="ts">
// Live variable watch list.
//
// Each watch entry is a symbol name or raw address plus an optional
// read-as-struct overlay. On every refresh we read memory at each entry's
// address and format according to its configured display type.

import { ref, watchEffect } from 'vue'
import type { DelugeEmulator } from '@/lib/emulator/DelugeEmulator'

interface Watch {
  id: number
  label: string
  address: number
  display: string
}

const props = defineProps<{
  emulator: DelugeEmulator
  refreshToken: number
}>()

const watches = ref<Watch[]>([])
const addQuery = ref('')
const error = ref('')
let nextId = 1

async function refreshValues() {
  for (const w of watches.value) {
    const reply = await props.emulator.readMem(w.address, 4)
    if (reply.type === 'memData' && reply.ok) {
      const view = new DataView(reply.data)
      const v = view.getUint32(0, true) >>> 0
      w.display =
        '0x' + v.toString(16).toUpperCase().padStart(8, '0') + ' (' + (v | 0) + ')'
    }
  }
}

watchEffect(() => {
  void props.refreshToken
  refreshValues().catch(() => {})
})

async function addWatch() {
  const q = addQuery.value.trim()
  if (!q) return
  error.value = ''
  try {
    let address = 0
    let label = q
    if (q.startsWith('0x') || /^\d+$/.test(q)) {
      address = q.startsWith('0x') ? parseInt(q, 16) : parseInt(q, 10)
    } else {
      const reply = await props.emulator.searchSymbols(q, { max: 1, typeFilter: 'object' })
      if (reply.type === 'symbolResults' && reply.hits.length > 0) {
        const hit = reply.hits[0]
        address = hit.address
        label = hit.name
      } else {
        error.value = `Unknown object symbol: ${q}`
        return
      }
    }
    watches.value.push({ id: nextId++, label, address: address >>> 0, display: '—' })
    addQuery.value = ''
    await refreshValues()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

function removeWatch(id: number) {
  watches.value = watches.value.filter((w) => w.id !== id)
}

// Public API for parent to push watches (e.g. from SymbolBrowser "+W")
function addFromExternal(label: string, address: number) {
  watches.value.push({
    id: nextId++,
    label,
    address: address >>> 0,
    display: '—',
  })
  refreshValues().catch(() => {})
}

defineExpose({ addFromExternal })

function fmtAddr(a: number): string {
  return '0x' + (a >>> 0).toString(16).padStart(8, '0')
}
</script>

<template>
  <div
    class="watch-panel flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800"
    data-testid="watch-panel"
  >
    <div class="flex items-center justify-between">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
        Watches ({{ watches.length }})
      </h3>
      <button
        type="button"
        class="text-[10px] text-slate-400 hover:text-sky-400"
        @click="refreshValues"
      >
        Refresh
      </button>
    </div>

    <form class="flex items-center gap-2" @submit.prevent="addWatch">
      <input
        v-model="addQuery"
        type="text"
        placeholder="symbol or 0xADDR"
        data-testid="watch-input"
        class="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"
      />
      <button
        type="submit"
        class="rounded bg-sky-600 px-2 py-1 text-[10px] text-white hover:bg-sky-500"
      >
        Add
      </button>
    </form>

    <p v-if="error" class="text-[10px] text-rose-400">{{ error }}</p>

    <div class="max-h-48 overflow-auto font-mono text-[11px]">
      <div
        v-for="w in watches"
        :key="w.id"
        :data-watch-id="w.id"
        class="flex items-center gap-2 px-1 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        <span class="w-24 text-slate-400">{{ fmtAddr(w.address) }}</span>
        <span class="flex-1 truncate text-slate-700 dark:text-slate-200">{{ w.label }}</span>
        <span class="text-slate-500">{{ w.display }}</span>
        <button
          type="button"
          class="text-[10px] text-slate-400 hover:text-rose-400"
          @click="removeWatch(w.id)"
        >
          ✕
        </button>
      </div>
      <div v-if="watches.length === 0" class="italic text-slate-400">
        No watches.
      </div>
    </div>
  </div>
</template>
