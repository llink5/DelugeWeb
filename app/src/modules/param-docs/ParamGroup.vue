<script setup lang="ts">
import { ref, watch } from 'vue'
import ParamEntry from './ParamEntry.vue'

const props = defineProps<{
  category: string
  params: any[]
  forceOpen: boolean
}>()

const open = ref(false)

watch(() => props.forceOpen, (val) => {
  if (val) open.value = true
})

function toggle() {
  open.value = !open.value
}
</script>

<template>
  <div :id="category.toLowerCase()" class="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900/50">
    <!-- Header -->
    <button
      @click="toggle"
      class="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-800/40 transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-2">
        <svg
          class="w-4 h-4 text-zinc-500 transition-transform duration-200"
          :class="{ 'rotate-90': open }"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <h3 class="text-sm font-semibold text-zinc-200">{{ category }}</h3>
        <span class="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">{{ params.length }}</span>
      </div>
    </button>

    <!-- Content with smooth animation -->
    <div
      class="grid transition-[grid-template-rows] duration-200 ease-out"
      :class="open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
    >
      <div class="overflow-hidden">
        <div class="border-t border-zinc-800">
          <ParamEntry v-for="p in params" :key="p.id" :param="p" />
        </div>
      </div>
    </div>
  </div>
</template>
