<script setup lang="ts">
// File-source selector for the preset editor.
//
// Today this covers the offline case only: drag & drop XML onto the zone, or
// pick a file via the browser picker. Loaded presets are held in the injected
// `LocalSource` and surfaced as a clickable list. A future `DelugeSource`
// toggle can slot in alongside without changing the editor code above.

import { ref } from 'vue'
import type { LocalSource } from '@/lib/source/LocalSource'
import type { SourcePresetEntry } from '@/lib/source/PresetSource'

const props = defineProps<{
  source: LocalSource
  activePath?: string
}>()

const emit = defineEmits<{
  'preset-selected': [entry: SourcePresetEntry, xml: string]
  'load-error': [message: string]
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const entries = ref<SourcePresetEntry[]>([])

async function refreshList() {
  const synths = await props.source.listPresets('synth')
  const kits = await props.source.listPresets('kit')
  const songs = await props.source.listPresets('song')
  entries.value = [...synths, ...kits, ...songs]
}

// ---------------------------------------------------------------------------
// File handling
// ---------------------------------------------------------------------------

async function handleFiles(files: FileList | File[] | null) {
  if (!files) return
  for (const file of Array.from(files)) {
    try {
      const { entry, xml } = await props.source.loadFromFile(file)
      await refreshList()
      emit('preset-selected', entry, xml)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load file'
      emit('load-error', message)
    }
  }
}

function onFileInput(event: Event) {
  const input = event.target as HTMLInputElement
  handleFiles(input.files)
  input.value = ''
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  isDragging.value = false
  handleFiles(event.dataTransfer?.files ?? null)
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  isDragging.value = true
}

function onDragLeave() {
  isDragging.value = false
}

async function onEntryClick(entry: SourcePresetEntry) {
  try {
    const xml = await props.source.loadXml(entry.path)
    emit('preset-selected', entry, xml)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load preset'
    emit('load-error', message)
  }
}

function onEntryRemove(entry: SourcePresetEntry) {
  props.source.unregister(entry.path)
  refreshList()
}

function kindBadgeClass(kind: string): string {
  if (kind === 'synth') return 'bg-sky-500/15 text-sky-400'
  if (kind === 'kit') return 'bg-amber-500/15 text-amber-400'
  return 'bg-purple-500/15 text-purple-400'
}

// Initial population
refreshList()
</script>

<template>
  <div class="source-selector flex flex-col gap-3">
    <!-- Drop zone / file picker -->
    <div
      class="drop-zone flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors"
      :class="
        isDragging
          ? 'border-sky-400 bg-sky-500/5 text-sky-500 dark:text-sky-300'
          : 'border-slate-300 text-slate-500 hover:border-slate-400 dark:border-slate-600 dark:hover:border-slate-500'
      "
      @drop="onDrop"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
    >
      <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round"
          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
      <div class="text-sm">
        Drop Deluge <code class="font-mono">.xml</code> files here
      </div>
      <button
        type="button"
        class="text-xs underline hover:text-sky-500"
        @click="fileInput?.click()"
      >
        or browse…
      </button>
      <input
        ref="fileInput"
        type="file"
        accept=".xml,.XML"
        multiple
        class="hidden"
        @change="onFileInput"
      />
    </div>

    <!-- Loaded presets -->
    <div v-if="entries.length > 0" class="preset-list flex flex-col gap-1">
      <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Loaded presets ({{ entries.length }})
      </div>
      <ul class="flex flex-col gap-1">
        <li
          v-for="entry in entries"
          :key="entry.path"
          class="group flex items-center justify-between gap-2 rounded border border-transparent px-2 py-1 text-sm hover:border-slate-300 hover:bg-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          :class="{ 'border-sky-300 bg-sky-50 dark:border-sky-500/40 dark:bg-sky-950/30': entry.path === activePath }"
        >
          <button
            type="button"
            class="flex flex-1 items-center gap-2 text-left"
            @click="onEntryClick(entry)"
          >
            <span
              class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase"
              :class="kindBadgeClass(entry.type)"
            >
              {{ entry.type }}
            </span>
            <span class="truncate text-slate-700 dark:text-slate-200">{{ entry.name }}</span>
          </button>
          <button
            type="button"
            class="invisible text-xs text-slate-400 hover:text-red-500 group-hover:visible"
            title="Remove from registry"
            @click.stop="onEntryRemove(entry)"
          >
            ✕
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
