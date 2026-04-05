<script setup lang="ts">
// Song preset editor view.
//
// A Deluge song holds a list of session clips: instrument clips (backed by a
// synth `<sound>` or drum `<kit>` element) and audio clips that reference a
// sample on disk. This view presents the clip list on the left; selecting a
// clip routes into the appropriate editor — SoundEditor for synth clips,
// KitView for kit clips, and a read-only info panel for audio clips.
//
// Like the other container views, this component owns a mutation history and
// emits save / download events upward.

import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import SoundEditor from '@/components/sound-editor/SoundEditor.vue'
import KitView from './KitView.vue'

type SongLike = Record<string, unknown>
type ClipLike = Record<string, unknown>
type SoundLike = Record<string, unknown>

const props = defineProps<{
  song: SongLike
  name: string
  path?: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  save: [song: SongLike]
  'save-as': [song: SongLike]
  download: [song: SongLike]
  'song-changed': [song: SongLike]
}>()

// ---------------------------------------------------------------------------
// Clip extraction & typing
// ---------------------------------------------------------------------------

type ClipKind = 'synth' | 'kit' | 'audio' | 'other'

function clipKindOf(clip: ClipLike): ClipKind {
  // DRObjects carry their XML element name through `xmlName()` — use it first.
  const maybeXmlName = clip as unknown as { xmlName?: () => string }
  const xname =
    typeof maybeXmlName.xmlName === 'function' ? maybeXmlName.xmlName() : undefined
  if (xname === 'audioClip') return 'audio'
  // Fall back to shape detection for plain parsed objects.
  if (clip.filePath !== undefined || clip.trackName !== undefined) return 'audio'
  if (clip.sound) return 'synth'
  if (clip.kit) return 'kit'
  return 'other'
}

function clipName(clip: ClipLike, index: number): string {
  const kind = clipKindOf(clip)
  if (kind === 'audio') {
    const trackName = clip.trackName
    if (typeof trackName === 'string' && trackName.length > 0) return trackName
    const filePath = clip.filePath
    if (typeof filePath === 'string' && filePath.length > 0) {
      const slash = filePath.lastIndexOf('/')
      return slash >= 0 ? filePath.substring(slash + 1) : filePath
    }
  }
  if (kind === 'synth') {
    const sound = clip.sound as Record<string, unknown> | undefined
    const n = sound?.name
    if (typeof n === 'string' && n.length > 0) return n
  }
  if (kind === 'kit') {
    const kit = clip.kit as Record<string, unknown> | undefined
    const n = kit?.name
    if (typeof n === 'string' && n.length > 0) return n
    return 'Kit Clip'
  }
  return `Clip ${index + 1}`
}

function clipLengthBars(clip: ClipLike): string {
  const len = clip.length
  if (typeof len !== 'string' && typeof len !== 'number') return '—'
  const numeric = typeof len === 'number' ? len : Number(len)
  if (!Number.isFinite(numeric) || numeric <= 0) return '—'
  // Deluge stores clip length in ticks; one bar = 48 ticks at the default
  // 4/4 resolution. We show the tick count verbatim with the bar estimate.
  const bars = numeric / 48
  if (Number.isInteger(bars)) return `${bars} bar${bars === 1 ? '' : 's'}`
  return `${bars.toFixed(2)} bars`
}

function clipStripeColor(index: number, kind: ClipKind): string {
  // Three hue rings keyed to kind, offset by index for variation.
  const hues: Record<ClipKind, string[]> = {
    synth: ['#3B82F6', '#6366F1', '#8B5CF6', '#A855F7'],
    kit: ['#F97316', '#F59E0B', '#EAB308', '#FACC15'],
    audio: ['#14B8A6', '#06B6D4', '#0EA5E9', '#10B981'],
    other: ['#64748B'],
  }
  const arr = hues[kind]
  return arr[index % arr.length]
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 50

const current = ref<SongLike>(props.song)
const past = ref<SongLike[]>([])
const future = ref<SongLike[]>([])
const baseline = ref<SongLike>(props.song)
const selectedIndex = ref(0)

watch(
  () => props.song,
  (next) => {
    current.value = next
    past.value = []
    future.value = []
    baseline.value = next
    selectedIndex.value = 0
  },
)

const clips = computed<ClipLike[]>(() => {
  const raw = current.value.sessionClips
  if (Array.isArray(raw)) return raw as ClipLike[]
  return []
})

const canUndo = computed(() => past.value.length > 0)
const canRedo = computed(() => future.value.length > 0)
const dirty = computed(() => current.value !== baseline.value)

watch(clips, (list) => {
  if (selectedIndex.value >= list.length && list.length > 0) {
    selectedIndex.value = list.length - 1
  }
})

const selectedClip = computed<ClipLike | null>(() => {
  const list = clips.value
  if (list.length === 0) return null
  return list[selectedIndex.value] ?? list[0]
})

const selectedKind = computed<ClipKind | null>(() => {
  const c = selectedClip.value
  if (!c) return null
  return clipKindOf(c)
})

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

function cloneWithProto<T extends object>(obj: T): T {
  const clone = Object.create(Object.getPrototypeOf(obj))
  Object.assign(clone, obj)
  return clone
}

function commit(next: SongLike) {
  past.value = [...past.value, current.value].slice(-HISTORY_LIMIT)
  future.value = []
  current.value = next
  emit('song-changed', next)
}

function updateClipAt(index: number, newClip: ClipLike) {
  const list = clips.value
  if (index < 0 || index >= list.length) return
  const newList = list.slice()
  newList[index] = newClip
  const newSong = cloneWithProto(current.value)
  newSong.sessionClips = newList
  commit(newSong)
}

function onSynthSoundUpdate(newSound: SoundLike) {
  const clip = selectedClip.value
  if (!clip) return
  const newClip = cloneWithProto(clip)
  newClip.sound = newSound
  updateClipAt(selectedIndex.value, newClip)
}

function onKitClipUpdate(newKit: Record<string, unknown>) {
  const clip = selectedClip.value
  if (!clip) return
  const newClip = cloneWithProto(clip)
  newClip.kit = newKit
  updateClipAt(selectedIndex.value, newClip)
}

// ---------------------------------------------------------------------------
// Undo / redo / keyboard
// ---------------------------------------------------------------------------

function undo() {
  if (past.value.length === 0) return
  const prev = past.value[past.value.length - 1]
  past.value = past.value.slice(0, -1)
  future.value = [current.value, ...future.value]
  current.value = prev
  emit('song-changed', prev)
}

function redo() {
  if (future.value.length === 0) return
  const next = future.value[0]
  future.value = future.value.slice(1)
  past.value = [...past.value, current.value]
  current.value = next
  emit('song-changed', next)
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
// Save
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
// Row click
// ---------------------------------------------------------------------------

function onClipClick(index: number) {
  selectedIndex.value = index
}

defineExpose({ undo, redo, canUndo, canRedo, dirty, current, selectedIndex })
</script>

<template>
  <div class="song-view flex flex-col gap-3" data-testid="song-view">
    <!-- Toolbar -->
    <header
      class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
    >
      <div class="flex items-center gap-2">
        <span class="rounded-full bg-purple-500/15 px-2 py-0.5 text-xs font-semibold uppercase text-purple-500">
          Song
        </span>
        <span class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ name }}</span>
        <span class="text-[10px] text-slate-500 dark:text-slate-400">
          {{ clips.length }} clip<span v-if="clips.length !== 1">s</span>
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

    <!-- Body: clip list + editor -->
    <div class="flex flex-col gap-3 md:flex-row">
      <!-- Clip list -->
      <aside
        class="flex w-full flex-col gap-1 md:w-64 md:shrink-0"
        data-testid="song-clip-list"
      >
        <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Clips
        </div>
        <ul class="flex flex-col gap-1">
          <li
            v-for="(clip, index) in clips"
            :key="index"
          >
            <button
              type="button"
              :data-testid="`song-clip-${index}`"
              :data-clip-index="index"
              :data-clip-kind="clipKindOf(clip)"
              :class="[
                'flex w-full items-center gap-2 rounded border border-transparent px-2 py-1.5 text-left text-sm transition-colors',
                index === selectedIndex
                  ? 'border-sky-300 bg-sky-50 dark:border-sky-500/40 dark:bg-sky-950/30'
                  : 'hover:border-slate-300 hover:bg-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800',
              ]"
              @click="onClipClick(index)"
            >
              <span
                class="h-6 w-1 shrink-0 rounded"
                :style="{ backgroundColor: clipStripeColor(index, clipKindOf(clip)) }"
                aria-hidden="true"
              ></span>
              <span
                :class="[
                  'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                  clipKindOf(clip) === 'audio'
                    ? 'bg-teal-500/15 text-teal-500'
                    : clipKindOf(clip) === 'kit'
                      ? 'bg-amber-500/15 text-amber-400'
                      : clipKindOf(clip) === 'synth'
                        ? 'bg-indigo-500/15 text-indigo-400'
                        : 'bg-slate-500/15 text-slate-400',
                ]"
              >
                {{ clipKindOf(clip) }}
              </span>
              <span class="flex-1 truncate text-slate-700 dark:text-slate-200">
                {{ clipName(clip, index) }}
              </span>
              <span class="shrink-0 font-mono text-[10px] text-slate-400">
                {{ clipLengthBars(clip) }}
              </span>
            </button>
          </li>
        </ul>
        <p
          v-if="clips.length === 0"
          class="text-xs italic text-slate-500 dark:text-slate-400"
        >
          Song has no clips.
        </p>
      </aside>

      <!-- Editor pane -->
      <main class="flex-1 min-w-0">
        <!-- Synth clip -->
        <SoundEditor
          v-if="selectedClip && selectedKind === 'synth'"
          :key="`synth-${selectedIndex}`"
          :sound="(selectedClip.sound as SoundLike)"
          context="song-clip"
          :readonly="readonly"
          @update:sound="onSynthSoundUpdate"
        />

        <!-- Kit clip -->
        <div v-else-if="selectedClip && selectedKind === 'kit'">
          <KitView
            :key="`kit-${selectedIndex}`"
            :kit="(selectedClip.kit as Record<string, unknown>)"
            :name="clipName(selectedClip, selectedIndex)"
            :readonly="readonly"
            @kit-changed="onKitClipUpdate"
          />
        </div>

        <!-- Audio clip -->
        <section
          v-else-if="selectedClip && selectedKind === 'audio'"
          data-testid="audio-clip-info"
          class="rounded-lg border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-teal-500">
            Audio Clip
          </h3>
          <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt class="text-slate-500 dark:text-slate-400">Track name</dt>
            <dd class="text-slate-700 dark:text-slate-200">
              {{ selectedClip.trackName ?? '—' }}
            </dd>
            <dt class="text-slate-500 dark:text-slate-400">File path</dt>
            <dd
              class="truncate font-mono text-[11px] text-slate-700 dark:text-slate-200"
              data-testid="audio-file-path"
            >
              {{ selectedClip.filePath ?? '—' }}
            </dd>
            <dt class="text-slate-500 dark:text-slate-400">Start sample</dt>
            <dd class="font-mono text-[11px] text-slate-700 dark:text-slate-200">
              {{ selectedClip.startSamplePos ?? '—' }}
            </dd>
            <dt class="text-slate-500 dark:text-slate-400">End sample</dt>
            <dd class="font-mono text-[11px] text-slate-700 dark:text-slate-200">
              {{ selectedClip.endSamplePos ?? '—' }}
            </dd>
            <dt class="text-slate-500 dark:text-slate-400">Length</dt>
            <dd class="text-slate-700 dark:text-slate-200">
              {{ clipLengthBars(selectedClip) }}
            </dd>
          </dl>
          <p class="mt-3 text-[11px] italic text-slate-500 dark:text-slate-400">
            Audio clip parameters are read-only in the song view. Use the
            Preset Editor's per-clip views to adjust them.
          </p>
        </section>

        <div
          v-else
          class="flex h-64 items-center justify-center text-sm text-slate-400 dark:text-slate-500"
        >
          Select a clip to edit.
        </div>
      </main>
    </div>
  </div>
</template>
