<script setup lang="ts">
// Symbol debugger top-level view.
//
// Composes the individual debugger panels (registers, disassembly, symbols,
// breakpoints, watches, struct walker) around the shared DelugeEmulator
// singleton. Users boot the worker and load an ELF from the Emulator view;
// this view shares the same worker and surfaces everything the debugger
// knows about it.

import { ref, computed, onBeforeUnmount } from 'vue'
import { useEmulator } from '@/lib/emulator/useEmulator'
import RegisterView from './RegisterView.vue'
import DisassemblyView from './DisassemblyView.vue'
import SymbolBrowser from './SymbolBrowser.vue'
import BreakpointPanel from './BreakpointPanel.vue'
import WatchPanel from './WatchPanel.vue'
import StructWalkerView from './StructWalkerView.vue'

const emulatorStore = useEmulator()
const booted = emulatorStore.booted

// Every panel reacts to refreshToken. Incrementing it causes each panel to
// re-fetch from the worker.
const refreshToken = ref(0)
const currentPc = ref<number | null>(null)
const anchorAddress = ref<number | null>(null)
const error = ref('')

const watchPanelRef = ref<{ addFromExternal: (name: string, address: number) => void } | null>(null)

let breakpointHitUnsub: (() => void) | null = null

async function bootEmulator() {
  error.value = ''
  try {
    await emulatorStore.ensureBooted()
    if (!breakpointHitUnsub) {
      breakpointHitUnsub = emulatorStore.emulator.on('breakpointHit', (evt) => {
        currentPc.value = evt.registers.pc as number
        refreshToken.value++
      })
    }
    await refreshPc()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function refreshPc() {
  if (!booted.value) return
  const reply = await emulatorStore.emulator.getRegisters()
  if (reply.type === 'registers' && reply.ok) {
    currentPc.value = reply.registers.pc >>> 0
  }
  refreshToken.value++
}

async function step() {
  if (!booted.value) return
  const reply = await emulatorStore.emulator.step(1)
  if (reply.type === 'stepped' && reply.ok) {
    currentPc.value = reply.pc >>> 0
    anchorAddress.value = null // follow PC
    refreshToken.value++
  }
}

async function stepMany(n: number) {
  if (!booted.value) return
  const reply = await emulatorStore.emulator.step(n)
  if (reply.type === 'stepped' && reply.ok) {
    currentPc.value = reply.pc >>> 0
    anchorAddress.value = null
    refreshToken.value++
  }
}

function onSetBreakpointFromSymbol(name: string, address: number) {
  emulatorStore.emulator
    .setBreakpoint(address, { label: name })
    .then(() => refreshToken.value++)
    .catch((e) => {
      error.value = e instanceof Error ? e.message : String(e)
    })
}

function onSetBreakpointFromDisassembly(address: number) {
  emulatorStore.emulator
    .setBreakpoint(address)
    .then(() => refreshToken.value++)
    .catch((e) => {
      error.value = e instanceof Error ? e.message : String(e)
    })
}

function onAddWatch(name: string, address: number) {
  watchPanelRef.value?.addFromExternal(name, address)
}

function onJumpTo(address: number) {
  anchorAddress.value = address >>> 0
  refreshToken.value++
}

function followPc() {
  anchorAddress.value = null
  refreshToken.value++
}

const disassemblyAnchor = computed(() =>
  anchorAddress.value ?? currentPc.value,
)

onBeforeUnmount(() => {
  breakpointHitUnsub?.()
})
</script>

<template>
  <div
    class="symbol-debugger flex flex-col gap-3 p-4"
    data-testid="symbol-debugger-view"
  >
    <header class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-semibold text-slate-700 dark:text-slate-200">
        Symbol Debugger
      </h1>
      <span
        v-if="!booted"
        class="rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-400"
      >
        worker offline
      </span>
      <button
        v-if="!booted"
        type="button"
        class="rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-500"
        data-testid="boot-worker"
        @click="bootEmulator"
      >
        Boot worker
      </button>
      <template v-else>
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
          @click="refreshPc"
        >
          Refresh
        </button>
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
          @click="step"
        >
          Step 1
        </button>
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
          @click="stepMany(100)"
        >
          Step 100
        </button>
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
          @click="stepMany(10000)"
        >
          Step 10k
        </button>
        <button
          v-if="anchorAddress !== null"
          type="button"
          class="rounded border border-amber-300 px-2 py-1 text-xs text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/30"
          @click="followPc"
        >
          Follow PC
        </button>
      </template>
    </header>

    <div
      v-if="error"
      class="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-900/30 dark:text-red-300"
    >
      {{ error }}
    </div>

    <div v-if="!booted" class="text-sm text-slate-400">
      Boot the worker in the Emulator tab first (or click Boot worker above),
      then load an ELF. Debugger views below need a running emulator to show
      anything.
    </div>

    <div v-else class="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <div class="flex flex-col gap-3 lg:col-span-2">
        <DisassemblyView
          :emulator="emulatorStore.emulator"
          :pc="currentPc"
          :anchor="anchorAddress"
          :refresh-token="refreshToken"
          @set-breakpoint="onSetBreakpointFromDisassembly"
        />
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SymbolBrowser
            :emulator="emulatorStore.emulator"
            @set-breakpoint="onSetBreakpointFromSymbol"
            @add-watch="onAddWatch"
            @jump-to="onJumpTo"
          />
          <BreakpointPanel
            :emulator="emulatorStore.emulator"
            :refresh-token="refreshToken"
          />
        </div>
        <StructWalkerView
          :emulator="emulatorStore.emulator"
          :refresh-token="refreshToken"
        />
      </div>
      <div class="flex flex-col gap-3">
        <RegisterView
          :emulator="emulatorStore.emulator"
          :refresh-token="refreshToken"
        />
        <WatchPanel
          ref="watchPanelRef"
          :emulator="emulatorStore.emulator"
          :refresh-token="refreshToken"
        />
      </div>
    </div>
  </div>
</template>
