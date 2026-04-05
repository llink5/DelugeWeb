<script setup lang="ts">
// Live ARM register view.
//
// Shows all 16 GPRs (R0..R15 / SP/LR/PC aliases) plus a decoded CPSR. Calls
// getRegisters on the emulator each time `refresh()` is invoked.

import { ref, computed, watchEffect } from 'vue'
import type { DelugeEmulator } from '@/lib/emulator/DelugeEmulator'

const props = defineProps<{
  emulator: DelugeEmulator
  /** External tick used to force a refresh. Increment to reload. */
  refreshToken: number
}>()

interface Registers {
  r0: number; r1: number; r2: number; r3: number
  r4: number; r5: number; r6: number; r7: number
  r8: number; r9: number; r10: number; r11: number
  r12: number; sp: number; lr: number; pc: number
  cpsr: number
}

const registers = ref<Registers | null>(null)

async function refresh() {
  const reply = await props.emulator.getRegisters()
  if (reply.type === 'registers' && reply.ok) {
    registers.value = { ...reply.registers } as unknown as Registers
  }
}

watchEffect(() => {
  // React to the refresh token changing
  void props.refreshToken
  refresh().catch(() => {})
})

function hex32(value: number | undefined): string {
  if (value === undefined) return '—'
  return '0x' + (value >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

const flags = computed(() => {
  const cpsr = registers.value?.cpsr ?? 0
  return {
    N: (cpsr >>> 31) & 1,
    Z: (cpsr >>> 30) & 1,
    C: (cpsr >>> 29) & 1,
    V: (cpsr >>> 28) & 1,
    I: (cpsr >>> 7) & 1,
    F: (cpsr >>> 6) & 1,
    T: (cpsr >>> 5) & 1,
    mode: cpsr & 0x1f,
  }
})

const MODE_NAMES: Record<number, string> = {
  0x10: 'USR', 0x11: 'FIQ', 0x12: 'IRQ', 0x13: 'SVC',
  0x17: 'ABT', 0x1b: 'UND', 0x1f: 'SYS',
}

const modeName = computed(() => MODE_NAMES[flags.value.mode] ?? 'UNK')

const GPR_NAMES: Array<keyof Registers> = [
  'r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7',
  'r8', 'r9', 'r10', 'r11', 'r12', 'sp', 'lr', 'pc',
]
</script>

<template>
  <div
    class="register-view flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800"
    data-testid="register-view"
  >
    <div class="flex items-center justify-between">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
        Registers
      </h3>
      <button
        type="button"
        class="text-[10px] text-slate-400 hover:text-sky-400"
        @click="refresh"
      >
        Refresh
      </button>
    </div>

    <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
      <div
        v-for="name in GPR_NAMES"
        :key="name"
        class="flex items-center justify-between"
        :data-reg="name"
      >
        <span class="text-slate-500 dark:text-slate-400">{{ name.toUpperCase() }}</span>
        <span class="text-slate-700 dark:text-slate-200">
          {{ hex32(registers?.[name]) }}
        </span>
      </div>
    </div>

    <div class="border-t border-slate-200 pt-2 dark:border-slate-700">
      <div class="flex items-center justify-between font-mono">
        <span class="text-slate-500 dark:text-slate-400">CPSR</span>
        <span class="text-slate-700 dark:text-slate-200">
          {{ hex32(registers?.cpsr) }}
        </span>
      </div>
      <div class="mt-1 flex items-center gap-2 font-mono text-[10px]">
        <span
          v-for="(v, f) in { N: flags.N, Z: flags.Z, C: flags.C, V: flags.V }"
          :key="f"
          :class="
            v === 1
              ? 'rounded bg-sky-500/20 px-1 text-sky-400'
              : 'rounded border border-slate-600 px-1 text-slate-500'
          "
        >
          {{ f }}
        </span>
        <span class="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-600"></span>
        <span
          :class="
            flags.T === 1
              ? 'rounded bg-amber-500/20 px-1 text-amber-400'
              : 'rounded border border-slate-600 px-1 text-slate-500'
          "
        >
          {{ flags.T === 1 ? 'Thumb' : 'ARM' }}
        </span>
        <span class="rounded border border-slate-600 px-1 text-slate-400">
          {{ modeName }}
        </span>
      </div>
    </div>
  </div>
</template>
