<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { midi, MidiConnection } from '@/lib/midi'
import FilePreview from './FilePreview.vue'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  date: Date
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const currentPath = ref('/')
const entries = ref<FileEntry[]>([])
const loading = ref(false)
const error = ref('')
const selectedItems = ref<Set<string>>(new Set())
const showUploadModal = ref(false)
const showNewFolderModal = ref(false)
const showRenameModal = ref(false)
const showDeleteModal = ref(false)
const previewItem = ref<FileEntry | null>(null)

const newFolderName = ref('')
const renameOldName = ref('')
const renameNewName = ref('')
const uploadInput = ref<HTMLInputElement | null>(null)
const newFolderInput = ref<HTMLInputElement | null>(null)
const renameInput = ref<HTMLInputElement | null>(null)

// Context menu
const contextMenu = ref<{ x: number; y: number; item: FileEntry } | null>(null)

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const breadcrumbs = computed(() => {
  const parts = currentPath.value.split('/').filter(Boolean)
  const segments: { name: string; path: string }[] = [{ name: 'SD', path: '/' }]
  let accumulated = ''
  for (const part of parts) {
    accumulated += '/' + part
    segments.push({ name: part, path: accumulated })
  }
  return segments
})

const hasSelection = computed(() => selectedItems.value.size > 0)

const selectedFiles = computed(() => {
  return entries.value.filter((e) => selectedItems.value.has(e.path) && !e.isDir)
})

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

function navigate(path: string) {
  currentPath.value = path
  selectedItems.value.clear()
  previewItem.value = null
  contextMenu.value = null
  loadDir()
}

async function loadDir() {
  loading.value = true
  error.value = ''
  try {
    const raw = await midi.listDir(currentPath.value)
    entries.value = raw.map((e) => {
      const isDir = e.attr !== undefined ? (Number(e.attr) & 0x10) !== 0 : false
      const fdate = e.date !== undefined ? Number(e.date) : 0
      const ftime = e.time !== undefined ? Number(e.time) : 0
      const basePath = currentPath.value.endsWith('/') ? currentPath.value : currentPath.value + '/'
      return {
        name: e.name,
        path: basePath + e.name,
        isDir,
        size: e.size !== undefined ? Number(e.size) : 0,
        date: MidiConnection.fdatetime2Date(fdate, ftime),
      }
    })

    // Sort: directories first, then alphabetical by name (case-insensitive)
    entries.value.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load directory'
    entries.value = []
  } finally {
    loading.value = false
  }
}

function goUp() {
  if (currentPath.value === '/') return
  const parts = currentPath.value.split('/').filter(Boolean)
  parts.pop()
  navigate(parts.length === 0 ? '/' : '/' + parts.join('/'))
}

function toggleSelect(item: FileEntry) {
  const s = new Set(selectedItems.value)
  if (s.has(item.path)) {
    s.delete(item.path)
  } else {
    s.add(item.path)
  }
  selectedItems.value = s
}

function toggleSelectAll() {
  if (selectedItems.value.size === entries.value.length) {
    selectedItems.value = new Set()
  } else {
    selectedItems.value = new Set(entries.value.map((e) => e.path))
  }
}

function handleRowClick(item: FileEntry) {
  if (item.isDir) {
    navigate(item.path)
  } else {
    previewItem.value = item
  }
}

function handleContextMenu(event: MouseEvent, item: FileEntry) {
  event.preventDefault()
  contextMenu.value = { x: event.clientX, y: event.clientY, item }
}

function closeContextMenu() {
  contextMenu.value = null
}

// --- Delete ---

function confirmDelete() {
  if (!hasSelection.value) return
  showDeleteModal.value = true
}

async function deleteSelected() {
  showDeleteModal.value = false
  loading.value = true
  error.value = ''
  try {
    for (const path of selectedItems.value) {
      const entry = entries.value.find((e) => e.path === path)
      if (entry?.isDir) {
        await midi.recursiveDelete(path, true)
      } else {
        await midi.deleteItem(path)
      }
    }
    selectedItems.value.clear()
    await loadDir()
  } catch (e: any) {
    error.value = e?.message ?? 'Delete failed'
    loading.value = false
  }
}

async function deleteContextItem() {
  if (!contextMenu.value) return
  const item = contextMenu.value.item
  contextMenu.value = null
  loading.value = true
  error.value = ''
  try {
    if (item.isDir) {
      await midi.recursiveDelete(item.path, true)
    } else {
      await midi.deleteItem(item.path)
    }
    selectedItems.value.delete(item.path)
    await loadDir()
  } catch (e: any) {
    error.value = e?.message ?? 'Delete failed'
    loading.value = false
  }
}

// --- New Folder ---

function openNewFolderModal() {
  newFolderName.value = ''
  showNewFolderModal.value = true
  nextTick(() => newFolderInput.value?.focus())
}

async function createFolder() {
  const name = newFolderName.value.trim()
  if (!name) return
  showNewFolderModal.value = false
  loading.value = true
  error.value = ''
  try {
    const dirPath = currentPath.value.endsWith('/')
      ? currentPath.value + name
      : currentPath.value + '/' + name
    await midi.mkdir(dirPath)
    await loadDir()
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to create folder'
    loading.value = false
  }
}

// --- Rename ---

function openRenameModal(item?: FileEntry) {
  const target = item ?? (contextMenu.value?.item)
  if (!target) return
  contextMenu.value = null
  renameOldName.value = target.name
  renameNewName.value = target.name
  showRenameModal.value = true
  nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

async function rename() {
  const oldName = renameOldName.value.trim()
  const newName = renameNewName.value.trim()
  if (!oldName || !newName || oldName === newName) {
    showRenameModal.value = false
    return
  }
  showRenameModal.value = false
  loading.value = true
  error.value = ''
  try {
    const basePath = currentPath.value.endsWith('/') ? currentPath.value : currentPath.value + '/'
    await midi.rename(basePath + oldName, basePath + newName)
    await loadDir()
  } catch (e: any) {
    error.value = e?.message ?? 'Rename failed'
    loading.value = false
  }
}

// --- Download ---

async function downloadFile(item: FileEntry) {
  contextMenu.value = null
  try {
    const data = await midi.readFile(item.path)
    const blob = new Blob([data as BlobPart])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = item.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e: any) {
    error.value = e?.message ?? 'Download failed'
  }
}

async function downloadSelected() {
  for (const file of selectedFiles.value) {
    await downloadFile(file)
  }
}

// --- Upload ---

function openUploadDialog() {
  uploadInput.value?.click()
}

async function uploadFiles(event: Event) {
  const target = event.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return
  showUploadModal.value = true
  loading.value = true
  error.value = ''
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const buf = await file.arrayBuffer()
      const data = new Uint8Array(buf)
      const filePath = currentPath.value.endsWith('/')
        ? currentPath.value + file.name
        : currentPath.value + '/' + file.name
      await midi.writeFile(filePath, data)
    }
    await loadDir()
  } catch (e: any) {
    error.value = e?.message ?? 'Upload failed'
  } finally {
    loading.value = false
    showUploadModal.value = false
    // Reset file input
    target.value = ''
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes === 0) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  if (y < 1981) return '-'
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${mm}-${dd} ${hh}:${mi}`
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
  loadDir()
})

</script>

<template>
  <!-- Click-away for context menu -->
  <div class="flex flex-col h-full" @click="closeContextMenu">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
      <!-- Breadcrumbs -->
      <nav class="flex items-center gap-1 text-sm min-w-0 flex-1">
        <template v-for="(seg, idx) in breadcrumbs" :key="seg.path">
          <span v-if="idx > 0" class="text-zinc-600">/</span>
          <button
            class="text-zinc-300 hover:text-blue-400 transition truncate"
            :class="{ 'font-semibold text-zinc-100': idx === breadcrumbs.length - 1 }"
            @click="navigate(seg.path)"
          >
            {{ seg.name }}
          </button>
        </template>
      </nav>

      <!-- Action buttons -->
      <div class="flex items-center gap-1.5">
        <!-- Go Up -->
        <button
          v-if="currentPath !== '/'"
          class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition"
          @click="goUp"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 12V4M4 8l4-4 4 4" />
          </svg>
          Up
        </button>

        <!-- Refresh -->
        <button
          class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition"
          @click="loadDir"
        >
          <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': loading }" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 8A6 6 0 1 1 10 2.5" />
            <path d="M14 2v4h-4" />
          </svg>
          Refresh
        </button>

        <!-- New Folder -->
        <button
          class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition"
          @click="openNewFolderModal"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 4v8M4 8h8" />
          </svg>
          New Folder
        </button>

        <!-- Upload -->
        <button
          class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition"
          @click="openUploadDialog"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 10V2M4 6l4-4 4 4" />
            <path d="M2 12v2h12v-2" />
          </svg>
          Upload
        </button>
        <input ref="uploadInput" type="file" multiple class="hidden" @change="uploadFiles" />

        <!-- Download -->
        <button
          v-if="selectedFiles.length > 0"
          class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition"
          @click="downloadSelected"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 2v8M4 6l4 4 4-4" />
            <path d="M2 12v2h12v-2" />
          </svg>
          Download
        </button>

        <!-- Delete -->
        <button
          v-if="hasSelection"
          class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
          @click="confirmDelete"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 4h10M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M6 7v5M10 7v5M4 4l1 9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l1-9" />
          </svg>
          Delete ({{ selectedItems.size }})
        </button>
      </div>
    </div>

    <!-- Error banner -->
    <div
      v-if="error"
      class="flex items-center justify-between px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm"
    >
      <span>{{ error }}</span>
      <button class="text-red-400 hover:text-red-300" @click="error = ''">Dismiss</button>
    </div>

    <!-- Loading bar -->
    <div v-if="loading" class="h-0.5 bg-blue-500/30">
      <div class="h-full bg-blue-500 animate-pulse w-full"></div>
    </div>

    <!-- File list -->
    <div class="flex-1 overflow-auto">
      <!-- Empty state -->
      <div v-if="!loading && entries.length === 0 && !error" class="flex flex-col items-center justify-center h-full text-zinc-500">
        <svg class="w-12 h-12 mb-3 text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1H10.5a2 2 0 0 0-2 1.5L7 17H5a2 2 0 0 1-2-2V7z" />
          <path d="M8 12.5A1.5 1.5 0 0 1 9.5 11H21l-3 8H7.5L8 12.5z" />
        </svg>
        <p class="text-sm">Empty directory</p>
      </div>

      <!-- Table -->
      <table v-else class="w-full text-sm">
        <thead class="sticky top-0 bg-zinc-900 border-b border-zinc-800 z-10">
          <tr class="text-zinc-500 text-left text-xs uppercase tracking-wider">
            <th class="w-10 px-4 py-2">
              <input
                type="checkbox"
                class="accent-blue-500 cursor-pointer"
                :checked="entries.length > 0 && selectedItems.size === entries.length"
                :indeterminate="selectedItems.size > 0 && selectedItems.size < entries.length"
                @change="toggleSelectAll"
              />
            </th>
            <th class="px-2 py-2">Name</th>
            <th class="px-2 py-2 w-24 text-right hidden sm:table-cell">Size</th>
            <th class="px-2 py-2 w-40 text-right hidden md:table-cell">Modified</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in entries"
            :key="item.path"
            class="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer transition"
            :class="{ 'bg-blue-500/10': selectedItems.has(item.path) }"
            @click="handleRowClick(item)"
            @contextmenu="handleContextMenu($event, item)"
          >
            <!-- Checkbox -->
            <td class="px-4 py-2" @click.stop>
              <input
                type="checkbox"
                class="accent-blue-500 cursor-pointer"
                :checked="selectedItems.has(item.path)"
                @change="toggleSelect(item)"
              />
            </td>

            <!-- Name with icon -->
            <td class="px-2 py-2">
              <div class="flex items-center gap-2">
                <!-- Folder icon -->
                <svg
                  v-if="item.isDir"
                  class="w-4 h-4 text-blue-400 shrink-0"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M1 4a1 1 0 0 1 1-1h3.586a1 1 0 0 1 .707.293L7.707 4.707A1 1 0 0 0 8.414 5H14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z" />
                </svg>
                <!-- File icon -->
                <svg
                  v-else
                  class="w-4 h-4 text-zinc-400 shrink-0"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <path d="M4 1.5h5.5L13 5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z" />
                  <path d="M9.5 1.5V5H13" />
                </svg>
                <span
                  class="truncate"
                  :class="item.isDir ? 'text-zinc-100 font-medium' : 'text-zinc-300'"
                >
                  {{ item.name }}
                </span>
              </div>
            </td>

            <!-- Size -->
            <td class="px-2 py-2 text-right text-zinc-500 tabular-nums hidden sm:table-cell">
              {{ item.isDir ? '-' : formatSize(item.size) }}
            </td>

            <!-- Date -->
            <td class="px-2 py-2 text-right text-zinc-500 tabular-nums hidden md:table-cell">
              {{ formatDate(item.date) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Context Menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="fixed z-50 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-40"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <button
          class="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 transition"
          @click="openRenameModal(contextMenu!.item)"
        >
          Rename
        </button>
        <button
          v-if="!contextMenu.item.isDir"
          class="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 transition"
          @click="downloadFile(contextMenu!.item)"
        >
          Download
        </button>
        <hr class="border-zinc-700 my-1" />
        <button
          class="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-zinc-700 transition"
          @click="deleteContextItem"
        >
          Delete
        </button>
      </div>
    </Teleport>

    <!-- File Preview Overlay -->
    <FilePreview
      v-if="previewItem"
      :item="previewItem"
      @close="previewItem = null"
    />

    <!-- New Folder Modal -->
    <Teleport to="body">
      <div
        v-if="showNewFolderModal"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        @click.self="showNewFolderModal = false"
      >
        <div class="bg-zinc-800 rounded-xl p-6 max-w-md w-full mx-4" @click.stop>
          <h3 class="text-lg font-semibold text-zinc-100 mb-4">New Folder</h3>
          <input
            ref="newFolderInput"
            v-model="newFolderName"
            type="text"
            placeholder="Folder name"
            class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition"
            @keydown.enter="createFolder"
            @keydown.escape="showNewFolderModal = false"
          />
          <div class="flex justify-end gap-2 mt-4">
            <button
              class="px-3 py-1.5 text-sm rounded-lg text-zinc-400 hover:text-zinc-200 transition"
              @click="showNewFolderModal = false"
            >
              Cancel
            </button>
            <button
              class="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition disabled:opacity-40"
              :disabled="!newFolderName.trim()"
              @click="createFolder"
            >
              Create
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Rename Modal -->
    <Teleport to="body">
      <div
        v-if="showRenameModal"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        @click.self="showRenameModal = false"
      >
        <div class="bg-zinc-800 rounded-xl p-6 max-w-md w-full mx-4" @click.stop>
          <h3 class="text-lg font-semibold text-zinc-100 mb-1">Rename</h3>
          <p class="text-sm text-zinc-500 mb-4">Renaming "{{ renameOldName }}"</p>
          <input
            ref="renameInput"
            v-model="renameNewName"
            type="text"
            placeholder="New name"
            class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition"
            @keydown.enter="rename"
            @keydown.escape="showRenameModal = false"
          />
          <div class="flex justify-end gap-2 mt-4">
            <button
              class="px-3 py-1.5 text-sm rounded-lg text-zinc-400 hover:text-zinc-200 transition"
              @click="showRenameModal = false"
            >
              Cancel
            </button>
            <button
              class="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition disabled:opacity-40"
              :disabled="!renameNewName.trim() || renameNewName === renameOldName"
              @click="rename"
            >
              Rename
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Delete Confirm Modal -->
    <Teleport to="body">
      <div
        v-if="showDeleteModal"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        @click.self="showDeleteModal = false"
      >
        <div class="bg-zinc-800 rounded-xl p-6 max-w-md w-full mx-4" @click.stop>
          <h3 class="text-lg font-semibold text-zinc-100 mb-2">Confirm Delete</h3>
          <p class="text-sm text-zinc-400 mb-4">
            Delete {{ selectedItems.size }} selected item{{ selectedItems.size > 1 ? 's' : '' }}?
            This cannot be undone.
          </p>
          <div class="flex justify-end gap-2">
            <button
              class="px-3 py-1.5 text-sm rounded-lg text-zinc-400 hover:text-zinc-200 transition"
              @click="showDeleteModal = false"
            >
              Cancel
            </button>
            <button
              class="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-500 transition"
              @click="deleteSelected"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Upload Progress Modal -->
    <Teleport to="body">
      <div
        v-if="showUploadModal"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      >
        <div class="bg-zinc-800 rounded-xl p-6 max-w-md w-full mx-4 text-center">
          <svg class="w-8 h-8 mx-auto mb-3 text-blue-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <p class="text-zinc-200 text-sm">Uploading files...</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>
