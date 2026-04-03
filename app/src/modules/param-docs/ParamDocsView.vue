<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ParamGroup from './ParamGroup.vue'
import paramData from './data/parameters.json'

const route = useRoute()
const router = useRouter()

const searchQuery = ref('')
const allParams = computed(() => {
  const categories = paramData.parameters as Record<string, any[]>
  const result: { category: string; params: any[] }[] = []
  for (const [cat, ps] of Object.entries(categories)) {
    result.push({ category: cat, params: ps })
  }
  return result
})

const filteredGroups = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return allParams.value

  return allParams.value
    .map((group) => ({
      category: group.category,
      params: group.params.filter((p: any) => {
        return (
          p.displayName?.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.xmlTag?.toLowerCase().includes(q) ||
          p.menuPath?.toLowerCase().includes(q) ||
          p.id?.toLowerCase().includes(q)
        )
      }),
    }))
    .filter((group) => group.params.length > 0)
})

const totalParams = computed(() => paramData._metadata.totalParameters)
const visibleCount = computed(() =>
  filteredGroups.value.reduce((sum, g) => sum + g.params.length, 0)
)
const hasFilter = computed(() => searchQuery.value.trim().length > 0)

// Handle URL query param and hash
onMounted(async () => {
  if (route.query.q) {
    searchQuery.value = route.query.q as string
  }
  await nextTick()
  if (route.hash) {
    const el = document.querySelector(route.hash)
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }
})

function updateSearch(value: string) {
  searchQuery.value = value
  router.replace({
    path: '/docs',
    query: value ? { q: value } : undefined,
    hash: route.hash,
  })
}

function clearSearch() {
  searchQuery.value = ''
  router.replace({ path: '/docs' })
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Sticky search header -->
    <div class="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800 px-4 sm:px-6 py-4">
      <div class="max-w-4xl mx-auto">
        <h1 class="text-lg font-semibold text-zinc-100 mb-3">Parameter Reference</h1>

        <!-- Search input -->
        <div class="relative">
          <svg
            class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            :value="searchQuery"
            @input="updateSearch(($event.target as HTMLInputElement).value)"
            placeholder="Search parameters by name, description, XML tag, menu path..."
            class="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-9 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition"
          />
          <button
            v-if="searchQuery"
            @click="clearSearch"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Result counter -->
        <div class="mt-2 text-xs text-zinc-500">
          <span v-if="hasFilter">{{ visibleCount }} of {{ totalParams }} parameters</span>
          <span v-else>{{ totalParams }} parameters</span>
        </div>
      </div>
    </div>

    <!-- Groups -->
    <div class="flex-1 overflow-auto px-4 sm:px-6 py-4">
      <div class="max-w-4xl mx-auto flex flex-col gap-3">
        <ParamGroup
          v-for="group in filteredGroups"
          :key="group.category"
          :category="group.category"
          :params="group.params"
          :force-open="hasFilter"
        />

        <!-- No results -->
        <div v-if="filteredGroups.length === 0" class="text-center py-12">
          <p class="text-zinc-500 text-sm">No parameters match "{{ searchQuery }}"</p>
          <button @click="clearSearch" class="mt-2 text-blue-400 text-sm hover:underline">
            Clear search
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
