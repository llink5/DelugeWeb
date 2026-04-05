<script setup lang="ts">
import { computed } from 'vue'
import { paramDiff, type DiffEntry } from '@/lib/diff/paramDiff'

interface DiffViewProps {
  soundA: Record<string, unknown>
  soundB: Record<string, unknown>
  nameA?: string
  nameB?: string
  showUnchanged?: boolean
}

const props = withDefaults(defineProps<DiffViewProps>(), {
  nameA: 'Preset A',
  nameB: 'Preset B',
  showUnchanged: false,
})

// ── Diff computation ────────────────────────────────────────────────

const diff = computed(() => paramDiff(props.soundA, props.soundB))

const counts = computed(() => ({
  changed: diff.value.changed.length,
  added: diff.value.added.length,
  removed: diff.value.removed.length,
}))

// ── Group entries by module ─────────────────────────────────────────

interface ModuleGroup {
  module: string
  entries: { kind: 'changed' | 'added' | 'removed'; entry: DiffEntry }[]
}

const groups = computed<ModuleGroup[]>(() => {
  const map = new Map<string, ModuleGroup>()
  const push = (kind: 'changed' | 'added' | 'removed', entry: DiffEntry) => {
    let g = map.get(entry.module)
    if (!g) {
      g = { module: entry.module, entries: [] }
      map.set(entry.module, g)
    }
    g.entries.push({ kind, entry })
  }
  for (const e of diff.value.changed) push('changed', e)
  for (const e of diff.value.added) push('added', e)
  for (const e of diff.value.removed) push('removed', e)
  // Stable module order: sort alphabetically but keep 'General' first,
  // 'Patch Cables' last.
  const all = Array.from(map.values())
  all.sort((x, y) => {
    const rank = (m: string): number => {
      if (m === 'General') return -1
      if (m === 'Patch Cables') return 1
      return 0
    }
    const rx = rank(x.module)
    const ry = rank(y.module)
    if (rx !== ry) return rx - ry
    return x.module.localeCompare(y.module)
  })
  return all
})

const hasAnyChanges = computed(() =>
  counts.value.changed + counts.value.added + counts.value.removed > 0,
)

function kindRowClass(kind: 'changed' | 'added' | 'removed'): string {
  if (kind === 'changed') return 'bg-amber-500/10 border-l-2 border-amber-400/60'
  if (kind === 'added') return 'bg-green-500/10 border-l-2 border-green-400/60'
  return 'bg-red-500/10 border-l-2 border-red-400/60'
}

function kindLabelClass(kind: 'changed' | 'added' | 'removed'): string {
  if (kind === 'changed') return 'text-amber-400'
  if (kind === 'added') return 'text-green-400'
  return 'text-red-400'
}

function kindLabel(kind: 'changed' | 'added' | 'removed'): string {
  if (kind === 'changed') return 'changed'
  if (kind === 'added') return 'added'
  return 'removed'
}

function formatValue(v: string | number | undefined): string {
  if (v === undefined || v === null) return '\u2014'
  return String(v)
}
</script>

<template>
  <div data-testid="diff-view" class="space-y-4">
    <!-- Header: nameA | → | nameB -->
    <div class="flex items-center gap-3 text-sm">
      <span class="px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-200 font-medium">
        {{ nameA }}
      </span>
      <span class="text-zinc-500">&rarr;</span>
      <span class="px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-200 font-medium">
        {{ nameB }}
      </span>
    </div>

    <!-- Summary -->
    <div data-testid="diff-summary" class="flex items-center gap-4 text-xs text-zinc-400">
      <span class="text-amber-400">{{ counts.changed }} changed</span>
      <span class="text-zinc-600">&bull;</span>
      <span class="text-green-400">{{ counts.added }} added</span>
      <span class="text-zinc-600">&bull;</span>
      <span class="text-red-400">{{ counts.removed }} removed</span>
    </div>

    <!-- No changes state -->
    <div
      v-if="!hasAnyChanges && !showUnchanged"
      data-testid="diff-empty"
      class="px-4 py-8 rounded-lg bg-zinc-900/50 border border-zinc-800 text-center text-sm text-zinc-500"
    >
      No parameter differences.
    </div>

    <!-- Module groups -->
    <div
      v-for="group in groups"
      :key="group.module"
      class="rounded-lg border border-zinc-800 overflow-hidden"
      :data-module="group.module"
    >
      <div class="px-4 py-2 bg-zinc-900 text-sm font-medium text-zinc-300">
        {{ group.module }}
      </div>
      <div class="divide-y divide-zinc-800/50">
        <div
          v-for="(row, idx) in group.entries"
          :key="row.entry.paramKey + ':' + idx"
          :data-diff-kind="row.kind"
          :class="['flex items-center gap-3 px-4 py-2 text-sm', kindRowClass(row.kind)]"
        >
          <span
            :class="['shrink-0 w-16 text-xs uppercase tracking-wide font-medium', kindLabelClass(row.kind)]"
          >
            {{ kindLabel(row.kind) }}
          </span>
          <span class="shrink-0 w-44 text-zinc-300 truncate" :title="row.entry.param">
            {{ row.entry.param }}
          </span>
          <div class="flex-1 flex items-center gap-2 font-mono text-xs">
            <span class="text-zinc-400 min-w-[4rem] text-right">
              {{ formatValue(row.entry.valueA) }}
            </span>
            <span class="text-zinc-600">&rarr;</span>
            <span class="text-zinc-200 min-w-[4rem]">
              {{ formatValue(row.entry.valueB) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
