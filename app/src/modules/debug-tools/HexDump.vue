<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  data: Uint8Array<ArrayBufferLike>
  baseAddress?: number
  previousData?: Uint8Array<ArrayBufferLike>
}>()

const COLS = 16

const rows = computed(() => {
  const result: { offset: number; hex: { value: string; changed: boolean; dim: boolean }[]; ascii: { char: string; changed: boolean; dim: boolean }[] }[] = []
  const base = props.baseAddress ?? 0

  for (let i = 0; i < props.data.length; i += COLS) {
    const hex: { value: string; changed: boolean; dim: boolean }[] = []
    const ascii: { char: string; changed: boolean; dim: boolean }[] = []

    for (let j = 0; j < COLS; j++) {
      if (i + j < props.data.length) {
        const b = props.data[i + j]
        const prev = props.previousData && (i + j) < props.previousData.length ? props.previousData[i + j] : undefined
        const changed = prev !== undefined && prev !== b
        const dim = b === 0x00
        hex.push({ value: b.toString(16).padStart(2, '0'), changed, dim })
        const ch = b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'
        ascii.push({ char: ch, changed, dim })
      } else {
        hex.push({ value: '  ', changed: false, dim: true })
        ascii.push({ char: ' ', changed: false, dim: true })
      }
    }

    result.push({ offset: base + i, hex, ascii })
  }
  return result
})
</script>

<template>
  <div class="font-mono text-xs leading-5 bg-zinc-950 rounded-lg p-4 overflow-auto border border-zinc-800">
    <div v-if="data.length === 0" class="text-zinc-600 italic">No data</div>
    <div v-for="row in rows" :key="row.offset" class="flex gap-4 whitespace-pre">
      <span class="text-zinc-500 select-none">{{ row.offset.toString(16).padStart(8, '0') }}</span>
      <span class="flex gap-[3px]">
        <span
          v-for="(b, idx) in row.hex"
          :key="idx"
          :class="[b.changed ? 'text-yellow-400 bg-yellow-400/10' : b.dim ? 'text-zinc-700' : 'text-zinc-300']"
        >{{ b.value }}<span v-if="idx === 7" class="text-zinc-800"> </span></span>
      </span>
      <span class="text-zinc-500">|</span>
      <span class="flex">
        <span
          v-for="(c, idx) in row.ascii"
          :key="idx"
          :class="[c.changed ? 'text-yellow-400' : c.dim ? 'text-zinc-700' : 'text-zinc-400']"
        >{{ c.char }}</span>
      </span>
      <span class="text-zinc-500">|</span>
    </div>
  </div>
</template>
