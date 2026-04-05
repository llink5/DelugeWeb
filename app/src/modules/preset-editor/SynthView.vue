<script setup lang="ts">
// Single-sound editor view.
//
// Wraps SoundEditor with:
//   - an internally managed undo/redo history (max 50 entries)
//   - Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts
//   - a save bar that surfaces "dirty" state and download controls
//
// The parent passes in the initial parsed sound (a plain object from the
// XML parser) along with the preset's display name. When the user hits save
// or download, we emit so the parent can forward to the active source.

import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import SoundEditor from '@/components/sound-editor/SoundEditor.vue'

type SoundLike = Record<string, unknown>

const props = defineProps<{
  sound: SoundLike
  name: string
  path?: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  save: [sound: SoundLike]
  'save-as': [sound: SoundLike]
  download: [sound: SoundLike]
  'sound-changed': [sound: SoundLike]
}>()

// ---------------------------------------------------------------------------
// History management
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 50

const current = ref<SoundLike>(props.sound)
const past = ref<SoundLike[]>([])
const future = ref<SoundLike[]>([])
const baseline = ref<SoundLike>(props.sound)

// When the parent swaps in a new sound (e.g. user picked a different file),
// reset our history.
watch(
  () => props.sound,
  (next) => {
    current.value = next
    past.value = []
    future.value = []
    baseline.value = next
  },
)

const canUndo = computed(() => past.value.length > 0)
const canRedo = computed(() => future.value.length > 0)
const dirty = computed(() => current.value !== baseline.value)

function commit(next: SoundLike) {
  past.value = [...past.value, current.value].slice(-HISTORY_LIMIT)
  future.value = []
  current.value = next
  emit('sound-changed', next)
}

function undo() {
  if (past.value.length === 0) return
  const prev = past.value[past.value.length - 1]
  past.value = past.value.slice(0, -1)
  future.value = [current.value, ...future.value]
  current.value = prev
  emit('sound-changed', prev)
}

function redo() {
  if (future.value.length === 0) return
  const next = future.value[0]
  future.value = future.value.slice(1)
  past.value = [...past.value, current.value]
  current.value = next
  emit('sound-changed', next)
}

function onSoundUpdate(next: SoundLike) {
  commit(next)
}

// ---------------------------------------------------------------------------
// Save actions
// ---------------------------------------------------------------------------

function onSave() {
  emit('save', current.value)
  baseline.value = current.value
}

function onSaveAs() {
  emit('save-as', current.value)
  baseline.value = current.value
}

function onDownload() {
  emit('download', current.value)
  baseline.value = current.value
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  if (!mod) return
  if (e.key === 'z' || e.key === 'Z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  } else if (e.key === 'y' || e.key === 'Y') {
    e.preventDefault()
    redo()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

// Expose undo/redo so a parent can trigger them programmatically if needed
defineExpose({ undo, redo, canUndo, canRedo, dirty, current })
</script>

<template>
  <div class="synth-view flex flex-col gap-3">
    <!-- Toolbar -->
    <header
      class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
    >
      <div class="flex items-center gap-2">
        <span class="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-semibold uppercase text-sky-500">
          Synth
        </span>
        <span class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ name }}</span>
        <span
          v-if="dirty"
          class="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] uppercase text-amber-600 dark:text-amber-400"
        >
          unsaved
        </span>
        <span v-else class="text-[10px] uppercase text-slate-400">saved</span>
      </div>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
          :disabled="!canUndo || readonly"
          title="Undo (Ctrl+Z)"
          @click="undo"
        >
          Undo
        </button>
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
          :disabled="!canRedo || readonly"
          title="Redo (Ctrl+Shift+Z)"
          @click="redo"
        >
          Redo
        </button>
        <div class="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-600" />
        <button
          v-if="path"
          type="button"
          class="rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-500 disabled:opacity-40"
          :disabled="!dirty || readonly"
          @click="onSave"
        >
          Save
        </button>
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
          :disabled="readonly"
          @click="onSaveAs"
        >
          Save as…
        </button>
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
          @click="onDownload"
        >
          Download .xml
        </button>
      </div>
    </header>

    <!-- Editor -->
    <SoundEditor
      :sound="current"
      context="synth"
      :readonly="readonly"
      @update:sound="onSoundUpdate"
    />
  </div>
</template>
