<script setup lang="ts">
defineProps<{
  param: {
    id: string
    xmlTag: string | null
    displayName: string
    shortName: string | null
    type: string
    min: number | null
    max: number | null
    defaultValue: string | null
    enumValues: { value: number; label: string }[] | null
    unit: string | null
    category: string
    menuPath: string
    firmwareVersion: string | null
    description: string | null
    kind: string | null
    paramIndex: number | null
    bipolar: boolean | null
  }
}>()

const contributeUrl = 'https://github.com/llink5/DelugeWeb/blob/main/app/src/modules/param-docs/data/parameters.json'

const typeBadgeColor: Record<string, string> = {
  integer: 'bg-sky-500/20 text-sky-300',
  decimal: 'bg-amber-500/20 text-amber-300',
  enum: 'bg-purple-500/20 text-purple-300',
  boolean: 'bg-emerald-500/20 text-emerald-300',
}
</script>

<template>
  <div class="py-3 px-4 border-b border-zinc-800/50 last:border-b-0 hover:bg-zinc-800/20 transition-colors">
    <!-- Header row -->
    <div class="flex flex-wrap items-start gap-2 mb-1.5">
      <h4 class="font-semibold text-zinc-100 text-sm">{{ param.displayName }}</h4>
      <span
        :class="typeBadgeColor[param.type] ?? 'bg-zinc-700 text-zinc-300'"
        class="text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wide"
      >
        {{ param.type }}
      </span>
      <span v-if="param.bipolar" class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-400 uppercase tracking-wide">
        bipolar
      </span>
    </div>

    <!-- Menu path breadcrumb -->
    <div class="text-xs text-zinc-500 mb-2 flex items-center gap-1">
      <template v-for="(seg, i) in param.menuPath.split(' > ')" :key="i">
        <span v-if="i > 0" class="text-zinc-600">/</span>
        <span>{{ seg }}</span>
      </template>
    </div>

    <!-- Description -->
    <p v-if="param.description" class="text-xs text-zinc-400 mb-2 leading-relaxed">
      {{ param.description }}
    </p>
    <p v-else class="text-xs text-zinc-500 italic mb-2">
      <a :href="contributeUrl" target="_blank" class="underline hover:text-blue-400 transition-colors">Unknown — contribute this value</a>
    </p>

    <!-- Details grid -->
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
      <!-- XML Tag -->
      <div>
        <span class="text-zinc-500">XML Tag</span>
        <div v-if="param.xmlTag" class="font-mono text-zinc-300 mt-0.5">{{ param.xmlTag }}</div>
        <div v-else class="text-zinc-600 italic mt-0.5">
          <a :href="contributeUrl" target="_blank" class="underline hover:text-blue-400 transition-colors">Unknown — contribute this value</a>
        </div>
      </div>

      <!-- Default -->
      <div>
        <span class="text-zinc-500">Default</span>
        <div v-if="param.defaultValue" class="text-blue-300 font-medium mt-0.5">{{ param.defaultValue }}</div>
        <div v-else class="text-zinc-600 italic mt-0.5">
          <a :href="contributeUrl" target="_blank" class="underline hover:text-blue-400 transition-colors">Unknown — contribute this value</a>
        </div>
      </div>

      <!-- Range -->
      <div v-if="param.min !== null || param.max !== null">
        <span class="text-zinc-500">Range</span>
        <div class="text-zinc-300 mt-0.5">
          {{ param.min ?? '?' }} – {{ param.max ?? '?' }}
          <span v-if="param.unit" class="text-zinc-500 ml-0.5">{{ param.unit }}</span>
        </div>
      </div>
      <div v-else-if="param.unit">
        <span class="text-zinc-500">Unit</span>
        <div class="text-zinc-300 mt-0.5">{{ param.unit }}</div>
      </div>

      <!-- Kind -->
      <div v-if="param.kind">
        <span class="text-zinc-500">Kind</span>
        <div class="text-zinc-300 mt-0.5">{{ param.kind }}</div>
      </div>
    </div>

    <!-- Enum values -->
    <div v-if="param.enumValues && param.enumValues.length > 0" class="mt-2">
      <span class="text-xs text-zinc-500">Values</span>
      <div class="flex flex-wrap gap-1 mt-1">
        <span
          v-for="ev in param.enumValues"
          :key="ev.value"
          class="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700/50"
        >
          {{ ev.label }}
          <span class="text-zinc-500 ml-0.5">({{ ev.value }})</span>
        </span>
      </div>
    </div>
  </div>
</template>
