<script setup lang="ts">
// Kit preset editor view.
//
// A Deluge kit is a list of up to 12 sound sources (drum voices). Each row
// holds a full synth/sample sound that is edited with the same SoundEditor
// component used for standalone synth presets.
//
// Layout: left column is the row selector with a coloured stripe and a type
// badge (Sample vs Synth), right pane is SoundEditor in `kit-row` context.
//
// Just like SynthView, this component owns an undo/redo history per editing
// session and surfaces save/download actions up to the container.

import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import SoundEditor from '@/components/sound-editor/SoundEditor.vue'

type SoundLike = Record<string, unknown>
type KitLike = Record<string, unknown>

const props = defineProps<{
  kit: KitLike
  name: string
  path?: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  save: [kit: KitLike]
  'save-as': [kit: KitLike]
  download: [kit: KitLike]
  'kit-changed': [kit: KitLike]
}>()

// ---------------------------------------------------------------------------
// Sound-source extraction
// ---------------------------------------------------------------------------
// In parsed form, kit.soundSources may be either a single sound or an array.
// Normalise here so the rest of the component works uniformly.

function asSoundArray(kit: KitLike): SoundLike[] {
  const container = kit.soundSources as unknown
  if (!container) return []
  if (Array.isArray(container)) return container as SoundLike[]
  // Single-sound kits parse to a bare object — wrap it.
  if (typeof container === 'object') {
    // Could be either { sound: ... } wrapper or the sound itself
    const record = container as Record<string, unknown>
    if (record.sound) {
      const s = record.sound
      return Array.isArray(s) ? (s as SoundLike[]) : [s as SoundLike]
    }
    return [record as SoundLike]
  }
  return []
}

// ---------------------------------------------------------------------------
// History management
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 50

const current = ref<KitLike>(props.kit)
const past = ref<KitLike[]>([])
const future = ref<KitLike[]>([])
const baseline = ref<KitLike>(props.kit)
const selectedIndex = ref(0)

watch(
  () => props.kit,
  (next) => {
    current.value = next
    past.value = []
    future.value = []
    baseline.value = next
    selectedIndex.value = 0
  },
)

const sounds = computed<SoundLike[]>(() => asSoundArray(current.value))

const canUndo = computed(() => past.value.length > 0)
const canRedo = computed(() => future.value.length > 0)
const dirty = computed(() => current.value !== baseline.value)

// Clamp the selection when the kit shrinks.
watch(sounds, (list) => {
  if (selectedIndex.value >= list.length && list.length > 0) {
    selectedIndex.value = list.length - 1
  }
})

const selectedSound = computed<SoundLike | null>(() => {
  const list = sounds.value
  if (list.length === 0) return null
  return list[selectedIndex.value] ?? list[0]
})

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

function cloneWithProto<T extends object>(obj: T): T {
  const clone = Object.create(Object.getPrototypeOf(obj))
  Object.assign(clone, obj)
  return clone
}

function commit(next: KitLike) {
  past.value = [...past.value, current.value].slice(-HISTORY_LIMIT)
  future.value = []
  current.value = next
  emit('kit-changed', next)
}

function updateSoundAt(index: number, newSound: SoundLike) {
  const list = sounds.value
  if (index < 0 || index >= list.length) return
  // soundSources is declared in the XML schema as a heteroArray, so the
  // parser always produces a plain JavaScript array. Replacing the entry at
  // `index` while preserving the array's identity shape is safe.
  const newList = list.slice()
  newList[index] = newSound

  const newKit = cloneWithProto(current.value)
  newKit.soundSources = newList
  commit(newKit)
}

function onSoundUpdate(newSound: SoundLike) {
  updateSoundAt(selectedIndex.value, newSound)
}

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

function undo() {
  if (past.value.length === 0) return
  const prev = past.value[past.value.length - 1]
  past.value = past.value.slice(0, -1)
  future.value = [current.value, ...future.value]
  current.value = prev
  emit('kit-changed', prev)
}

function redo() {
  if (future.value.length === 0) return
  const next = future.value[0]
  future.value = future.value.slice(1)
  past.value = [...past.value, current.value]
  current.value = next
  emit('kit-changed', next)
}

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
// Row display helpers
// ---------------------------------------------------------------------------

function soundName(sound: SoundLike, index: number): string {
  const n = sound.name
  if (typeof n === 'string' && n.length > 0) return n
  return `Row ${index + 1}`
}

/**
 * A kit row is either a "Sample" voice (oscillator type is `sample`) or a
 * "Synth" voice (everything else). The osc1 object is the source of truth.
 */
function soundKind(sound: SoundLike): 'sample' | 'synth' {
  const osc1 = sound.osc1 as Record<string, unknown> | undefined
  const type = osc1?.type
  return type === 'sample' ? 'sample' : 'synth'
}

// Colour stripes: derive a hue per row so adjacent rows stand out. The Deluge
// firmware has its own colour table, but we don't surface that in XML; here we
// generate a stable colour from the index for visual separation only.
function rowStripeColor(index: number): string {
  const hues = [
    '#F97316', '#FACC15', '#22C55E', '#06B6D4',
    '#3B82F6', '#8B5CF6', '#EC4899', '#EF4444',
    '#F59E0B', '#84CC16', '#14B8A6', '#A855F7',
  ]
  return hues[index % hues.length]
}

function onRowClick(index: number) {
  selectedIndex.value = index
}

defineExpose({ undo, redo, canUndo, canRedo, dirty, current, selectedIndex })
</script>

<template>
  <div class="kit-view flex flex-col gap-3" data-testid="kit-view">
    <!-- Toolbar -->
    <header
      class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
    >
      <div class="flex items-center gap-2">
        <span class="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold uppercase text-amber-500">
          Kit
        </span>
        <span class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ name }}</span>
        <span class="text-[10px] text-slate-500 dark:text-slate-400">
          {{ sounds.length }} row<span v-if="sounds.length !== 1">s</span>
        </span>
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

    <!-- Body: row list + editor -->
    <div class="flex flex-col gap-3 md:flex-row">
      <!-- Row list -->
      <aside
        class="flex w-full flex-col gap-1 md:w-56 md:shrink-0"
        data-testid="kit-row-list"
      >
        <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Sounds
        </div>
        <ul class="flex flex-col gap-1">
          <li
            v-for="(sound, index) in sounds"
            :key="index"
            class="group"
          >
            <button
              type="button"
              :data-testid="`kit-row-${index}`"
              :data-row-index="index"
              :class="[
                'flex w-full items-center gap-2 rounded border border-transparent px-2 py-1.5 text-left text-sm transition-colors',
                index === selectedIndex
                  ? 'border-sky-300 bg-sky-50 dark:border-sky-500/40 dark:bg-sky-950/30'
                  : 'hover:border-slate-300 hover:bg-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800',
              ]"
              @click="onRowClick(index)"
            >
              <span
                class="h-6 w-1 shrink-0 rounded"
                :style="{ backgroundColor: rowStripeColor(index) }"
                aria-hidden="true"
              ></span>
              <span
                :class="[
                  'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                  soundKind(sound) === 'sample'
                    ? 'bg-teal-500/15 text-teal-500'
                    : 'bg-indigo-500/15 text-indigo-400',
                ]"
              >
                {{ soundKind(sound) }}
              </span>
              <span class="flex-1 truncate text-slate-700 dark:text-slate-200">
                {{ soundName(sound, index) }}
              </span>
            </button>
          </li>
        </ul>
        <p
          v-if="sounds.length === 0"
          class="text-xs italic text-slate-500 dark:text-slate-400"
        >
          Kit has no rows.
        </p>
      </aside>

      <!-- Editor pane -->
      <main class="flex-1 min-w-0">
        <SoundEditor
          v-if="selectedSound"
          :key="selectedIndex"
          :sound="selectedSound"
          context="kit-row"
          :readonly="readonly"
          @update:sound="onSoundUpdate"
        />
        <div
          v-else
          class="flex h-64 items-center justify-center text-sm text-slate-400 dark:text-slate-500"
        >
          Select a kit row to edit.
        </div>
      </main>
    </div>
  </div>
</template>
