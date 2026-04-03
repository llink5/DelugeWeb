<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { midi } from '@/lib/midi'

// ---------------------------------------------------------------------------
// Props / Emits
// ---------------------------------------------------------------------------

interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  date: Date
}

const props = defineProps<{
  item: FileEntry
}>()

const emit = defineEmits<{
  close: []
}>()

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const loading = ref(true)
const error = ref('')
const textContent = ref('')
const imageUrl = ref('')

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const ext = computed(() => {
  const dot = props.item.name.lastIndexOf('.')
  if (dot < 0) return ''
  return props.item.name.slice(dot + 1).toLowerCase()
})

const isText = computed(() => ['xml', 'txt', 'json', 'csv', 'log', 'cfg', 'ini', 'md'].includes(ext.value))
const isImage = computed(() => ['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(ext.value))
const isAudio = computed(() => ['wav', 'aif', 'aiff'].includes(ext.value))

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// ---------------------------------------------------------------------------
// Load content
// ---------------------------------------------------------------------------

async function loadContent() {
  loading.value = true
  error.value = ''
  try {
    if (isText.value) {
      const data = await midi.readFile(props.item.path)
      textContent.value = new TextDecoder().decode(data)
    } else if (isImage.value) {
      const data = await midi.readFile(props.item.path)
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        bmp: 'image/bmp',
      }
      const mime = mimeMap[ext.value] ?? 'application/octet-stream'
      const blob = new Blob([data as BlobPart], { type: mime })
      imageUrl.value = URL.createObjectURL(blob)
    }
    // Audio files don't need to be loaded -- we just show metadata
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load file'
  } finally {
    loading.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
  loadContent()
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  if (imageUrl.value) {
    URL.revokeObjectURL(imageUrl.value)
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click.self="emit('close')"
    >
      <div
        class="bg-zinc-800 rounded-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col shadow-2xl"
        @click.stop
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-700 shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <svg
              class="w-4 h-4 text-zinc-400 shrink-0"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path d="M4 1.5h5.5L13 5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z" />
              <path d="M9.5 1.5V5H13" />
            </svg>
            <span class="text-zinc-100 font-medium text-sm truncate">{{ item.name }}</span>
            <span class="text-zinc-500 text-xs shrink-0">({{ formatSize(item.size) }})</span>
          </div>
          <button
            class="text-zinc-400 hover:text-zinc-200 transition p-1"
            @click="emit('close')"
          >
            <svg class="w-5 h-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-auto p-5">
          <!-- Loading -->
          <div v-if="loading" class="flex items-center justify-center py-12">
            <svg class="w-6 h-6 text-blue-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          </div>

          <!-- Error -->
          <div v-else-if="error" class="text-red-400 text-sm text-center py-8">
            {{ error }}
          </div>

          <!-- Text preview -->
          <template v-else-if="isText">
            <pre class="font-mono text-xs text-zinc-300 whitespace-pre-wrap break-words leading-relaxed bg-zinc-900 rounded-lg p-4 max-h-[60vh] overflow-auto">{{ textContent }}</pre>
          </template>

          <!-- Image preview -->
          <template v-else-if="isImage">
            <div class="flex items-center justify-center">
              <img
                :src="imageUrl"
                :alt="item.name"
                class="max-w-full max-h-[60vh] rounded-lg object-contain"
              />
            </div>
          </template>

          <!-- Audio info -->
          <template v-else-if="isAudio">
            <div class="flex flex-col items-center justify-center py-8 text-zinc-400">
              <svg class="w-12 h-12 mb-3 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
              <p class="text-sm font-medium text-zinc-200">Audio File</p>
              <p class="text-xs text-zinc-500 mt-1">{{ item.name }} -- {{ formatSize(item.size) }}</p>
            </div>
          </template>

          <!-- Unknown type -->
          <template v-else>
            <div class="flex flex-col items-center justify-center py-8 text-zinc-500">
              <svg class="w-12 h-12 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                <path d="M14 3v5h5" />
              </svg>
              <p class="text-sm">No preview available</p>
              <p class="text-xs text-zinc-600 mt-1">{{ formatSize(item.size) }}</p>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
