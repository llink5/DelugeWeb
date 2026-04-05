<script setup lang="ts">
// Disassembly window.
//
// Fetches `windowSize` instructions surrounding the current PC (or a
// user-supplied anchor address) and renders them with the current line
// highlighted. Clicking a line offers to set a breakpoint there.

import { ref, watchEffect } from 'vue'
import type { DelugeEmulator } from '@/lib/emulator/DelugeEmulator'
import type { DisassembledLine } from '@/lib/emulator/protocol'

const props = defineProps<{
  emulator: DelugeEmulator
  pc: number | null
  /** Optional override — anchor the window at this address instead of PC. */
  anchor?: number | null
  windowSize?: number
  refreshToken?: number
}>()

const emit = defineEmits<{
  'set-breakpoint': [address: number]
}>()

const lines = ref<DisassembledLine[]>([])
const loading = ref(false)
const error = ref('')

async function refresh() {
  const anchor = props.anchor ?? props.pc
  if (anchor === null || anchor === undefined) {
    lines.value = []
    return
  }
  const count = props.windowSize ?? 32
  const start = Math.max(0, (anchor - (count >> 1) * 4) >>> 0)
  loading.value = true
  error.value = ''
  try {
    const reply = await props.emulator.disassemble(start, count)
    if (reply.type === 'disassembly' && reply.ok) {
      lines.value = reply.lines
    } else if (reply.type === 'disassembly') {
      error.value = reply.error ?? 'disassemble failed'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watchEffect(() => {
  // React to pc/anchor/refreshToken changes
  void props.pc
  void props.anchor
  void props.refreshToken
  refresh().catch(() => {})
})

function fmtAddr(address: number): string {
  return '0x' + (address >>> 0).toString(16).padStart(8, '0')
}

function isCurrent(lineAddr: number): boolean {
  if (props.pc === null || props.pc === undefined) return false
  return ((lineAddr >>> 0) === (props.pc >>> 0))
}

function onContextMenu(event: MouseEvent, address: number) {
  event.preventDefault()
  emit('set-breakpoint', address)
}
</script>

<template>
  <div
    class="disassembly-view flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800"
    data-testid="disassembly-view"
  >
    <div class="flex items-center justify-between">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
        Disassembly {{ loading ? '…' : '' }}
      </h3>
      <span v-if="error" class="text-[10px] text-rose-400">{{ error }}</span>
    </div>

    <div
      v-if="lines.length > 0"
      class="max-h-80 overflow-auto font-mono text-[11px]"
    >
      <div
        v-for="line in lines"
        :key="line.address"
        :class="[
          'flex items-center gap-2 whitespace-pre px-1 py-0.5',
          isCurrent(line.address)
            ? 'bg-sky-500/20 text-sky-200'
            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700',
        ]"
        :data-address="line.address"
        :data-current="isCurrent(line.address) ? 'true' : undefined"
        @contextmenu="onContextMenu($event, line.address)"
      >
        <span
          :class="
            isCurrent(line.address)
              ? 'text-sky-300'
              : 'text-slate-400 dark:text-slate-500'
          "
        >
          {{ fmtAddr(line.address) }}
        </span>
        <span class="whitespace-pre">{{ line.text }}</span>
      </div>
    </div>
    <div v-else class="text-[11px] italic text-slate-400">
      Load an ELF and start the emulator to see code.
    </div>

    <p class="text-[10px] italic text-slate-400">
      Right-click a line to set a breakpoint.
    </p>
  </div>
</template>
