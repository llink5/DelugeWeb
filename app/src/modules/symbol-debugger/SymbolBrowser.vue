<script setup lang="ts">
// Symbol browser with live search.

import { ref, watch } from 'vue'
import type { DelugeEmulator } from '@/lib/emulator/DelugeEmulator'
import type { SymbolHitDto } from '@/lib/emulator/protocol'

const props = defineProps<{
  emulator: DelugeEmulator
}>()

const emit = defineEmits<{
  'set-breakpoint': [name: string, address: number]
  'add-watch': [name: string, address: number]
  'jump-to': [address: number]
}>()

const query = ref('')
const typeFilter = ref<'' | 'func' | 'object' | 'other'>('')
const results = ref<SymbolHitDto[]>([])
const loading = ref(false)
const error = ref('')

async function runSearch() {
  loading.value = true
  error.value = ''
  try {
    const reply = await props.emulator.searchSymbols(query.value, {
      max: 200,
      typeFilter: typeFilter.value || undefined,
    })
    if (reply.type === 'symbolResults' && reply.ok) {
      results.value = reply.hits
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

// Debounce the query
let debounceHandle: ReturnType<typeof setTimeout> | null = null
watch([query, typeFilter], () => {
  if (debounceHandle !== null) clearTimeout(debounceHandle)
  debounceHandle = setTimeout(() => {
    runSearch().catch(() => {})
  }, 150)
})

function fmtAddr(a: number): string {
  return '0x' + (a >>> 0).toString(16).padStart(8, '0')
}

function kindBadgeClass(type: string): string {
  if (type === 'func') return 'bg-sky-500/15 text-sky-400'
  if (type === 'object') return 'bg-amber-500/15 text-amber-400'
  return 'bg-slate-500/15 text-slate-400'
}
</script>

<template>
  <div
    class="symbol-browser flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800"
    data-testid="symbol-browser"
  >
    <div class="flex items-center justify-between">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
        Symbols ({{ results.length }})
      </h3>
      <button
        type="button"
        class="text-[10px] text-slate-400 hover:text-sky-400"
        @click="runSearch"
      >
        Refresh
      </button>
    </div>

    <div class="flex items-center gap-2">
      <input
        v-model="query"
        type="search"
        placeholder="search…"
        data-testid="symbol-search"
        class="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"
      />
      <select
        v-model="typeFilter"
        class="rounded border border-slate-300 bg-white px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"
      >
        <option value="">all</option>
        <option value="func">funcs</option>
        <option value="object">objects</option>
      </select>
    </div>

    <p v-if="error" class="text-[10px] text-rose-400">{{ error }}</p>

    <div class="max-h-72 overflow-auto font-mono text-[11px]">
      <div
        v-for="hit in results"
        :key="hit.name + ':' + hit.address"
        class="flex items-center gap-2 px-1 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-700"
        :data-symbol="hit.name"
      >
        <span
          :class="[
            'shrink-0 rounded px-1 py-px text-[9px] uppercase',
            kindBadgeClass(hit.type),
          ]"
        >
          {{ hit.type }}
        </span>
        <span class="flex-1 truncate text-slate-700 dark:text-slate-200" :title="hit.name">
          {{ hit.name }}
        </span>
        <span class="text-slate-400">{{ fmtAddr(hit.address) }}</span>
        <button
          v-if="hit.type === 'func'"
          type="button"
          class="text-[9px] text-slate-500 hover:text-sky-400"
          title="Set breakpoint"
          @click="emit('set-breakpoint', hit.name, hit.address)"
        >
          BP
        </button>
        <button
          v-if="hit.type === 'object'"
          type="button"
          class="text-[9px] text-slate-500 hover:text-amber-400"
          title="Add to watch"
          @click="emit('add-watch', hit.name, hit.address)"
        >
          +W
        </button>
        <button
          type="button"
          class="text-[9px] text-slate-500 hover:text-green-400"
          title="Jump to in disassembly"
          @click="emit('jump-to', hit.address)"
        >
          →
        </button>
      </div>
      <div v-if="results.length === 0 && !loading" class="italic text-slate-400">
        No symbols loaded. .bin firmware has no symbol table — load an
        .elf to populate the browser. The emulator runs fine either way;
        this browser is a convenience, not a requirement.
      </div>
    </div>
  </div>
</template>
