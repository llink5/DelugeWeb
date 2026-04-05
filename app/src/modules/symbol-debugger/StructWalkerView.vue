<script setup lang="ts">
// Interactive struct walker.
//
// Pick a struct type + base address, view each field with its live value.
// Pointer fields expand inline to show the target struct's fields too.

import { ref, watchEffect } from 'vue'
import type { DelugeEmulator } from '@/lib/emulator/DelugeEmulator'
import type { StructFieldDto } from '@/lib/emulator/protocol'

const props = defineProps<{
  emulator: DelugeEmulator
  refreshToken: number
}>()

interface Node {
  id: number
  typeName: string
  address: number
  label: string
  fields: StructFieldDto[]
  children: Map<string, Node>
  expanded: boolean
}

const structTypes = ref<string[]>([])
const selectedType = ref('Song')
const rootAddress = ref('0x0C000000')
const rootNode = ref<Node | null>(null)
const error = ref('')
let nextNodeId = 1

async function loadStructTypes() {
  const reply = await props.emulator.listStructs()
  if (reply.type === 'structList' && reply.ok) {
    structTypes.value = reply.structs
    if (!structTypes.value.includes(selectedType.value)) {
      selectedType.value = structTypes.value[0] ?? ''
    }
  }
}

function parseAddress(s: string): number {
  const t = s.trim()
  if (t.startsWith('0x')) return parseInt(t, 16) >>> 0
  return (parseInt(t, 10) >>> 0)
}

async function readNode(
  typeName: string,
  address: number,
  label: string,
): Promise<Node | null> {
  const reply = await props.emulator.readStruct(typeName, address)
  if (reply.type !== 'structFields' || !reply.ok) {
    error.value = reply.type === 'structFields' ? (reply.error ?? 'read failed') : 'bad reply'
    return null
  }
  return {
    id: nextNodeId++,
    typeName,
    address,
    label,
    fields: reply.fields,
    children: new Map(),
    expanded: true,
  }
}

async function loadRoot() {
  error.value = ''
  const addr = parseAddress(rootAddress.value)
  const node = await readNode(selectedType.value, addr, selectedType.value)
  rootNode.value = node
}

async function expandPointer(
  parent: Node,
  field: StructFieldDto,
): Promise<void> {
  if (!field.pointsTo || field.pointsTo.address === 0) return
  if (parent.children.has(field.name)) {
    parent.children.delete(field.name)
    return
  }
  const child = await readNode(
    field.pointsTo.typeName,
    field.pointsTo.address,
    `${field.name} → ${field.pointsTo.typeName}`,
  )
  if (child) parent.children.set(field.name, child)
}

async function refreshNode(node: Node): Promise<void> {
  const reply = await props.emulator.readStruct(node.typeName, node.address)
  if (reply.type === 'structFields' && reply.ok) {
    node.fields = reply.fields
  }
  for (const child of node.children.values()) {
    await refreshNode(child)
  }
}

async function refreshAll() {
  if (rootNode.value) await refreshNode(rootNode.value)
}

watchEffect(() => {
  void props.refreshToken
  refreshAll().catch(() => {})
})

// Initial load of struct types
loadStructTypes().catch(() => {})

function fmtAddr(a: number): string {
  return '0x' + (a >>> 0).toString(16).padStart(8, '0')
}
</script>

<template>
  <div
    class="struct-walker flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800"
    data-testid="struct-walker"
  >
    <div class="flex items-center justify-between">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
        Struct Walker
      </h3>
      <button
        type="button"
        class="text-[10px] text-slate-400 hover:text-sky-400"
        @click="refreshAll"
      >
        Refresh
      </button>
    </div>

    <form class="flex items-center gap-2" @submit.prevent="loadRoot">
      <select
        v-model="selectedType"
        class="rounded border border-slate-300 bg-white px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"
      >
        <option v-for="t in structTypes" :key="t" :value="t">{{ t }}</option>
      </select>
      <input
        v-model="rootAddress"
        type="text"
        placeholder="0x..."
        class="flex-1 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs dark:border-slate-600 dark:bg-slate-900"
      />
      <button
        type="submit"
        class="rounded bg-sky-600 px-2 py-1 text-[10px] text-white hover:bg-sky-500"
      >
        Load
      </button>
    </form>

    <p v-if="error" class="text-[10px] text-rose-400">{{ error }}</p>

    <div v-if="rootNode" class="max-h-96 overflow-auto font-mono text-[11px]">
      <!-- Root -->
      <div class="font-semibold text-slate-700 dark:text-slate-200">
        {{ rootNode.typeName }} @ {{ fmtAddr(rootNode.address) }}
      </div>
      <div class="ml-2 mt-1 border-l border-slate-300 pl-2 dark:border-slate-600">
        <template v-for="f in rootNode.fields" :key="f.name">
          <div class="flex items-center gap-2 py-0.5">
            <span class="w-6 text-right text-slate-400">+{{ f.offset.toString(16) }}</span>
            <span class="w-28 truncate text-slate-600 dark:text-slate-300">
              {{ f.name }}
            </span>
            <span class="w-14 text-slate-400">{{ f.type }}</span>
            <span class="flex-1 text-slate-700 dark:text-slate-200">{{ f.display }}</span>
            <button
              v-if="f.pointsTo && f.pointsTo.address !== 0"
              type="button"
              class="text-[10px] text-sky-400 hover:text-sky-300"
              @click="expandPointer(rootNode, f)"
            >
              {{ rootNode.children.has(f.name) ? '−' : '+' }}
            </button>
          </div>
          <!-- Expanded pointer child -->
          <div
            v-if="rootNode.children.get(f.name)"
            class="ml-6 border-l border-slate-300 pl-2 dark:border-slate-600"
          >
            <div class="text-[10px] text-slate-400">
              {{ rootNode.children.get(f.name)!.typeName }} @ {{ fmtAddr(rootNode.children.get(f.name)!.address) }}
            </div>
            <div
              v-for="cf in rootNode.children.get(f.name)!.fields"
              :key="cf.name"
              class="flex items-center gap-2 py-0.5"
            >
              <span class="w-6 text-right text-slate-400">+{{ cf.offset.toString(16) }}</span>
              <span class="w-28 truncate text-slate-600 dark:text-slate-300">
                {{ cf.name }}
              </span>
              <span class="w-14 text-slate-400">{{ cf.type }}</span>
              <span class="flex-1 text-slate-700 dark:text-slate-200">{{ cf.display }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>
    <div v-else class="text-[11px] italic text-slate-400">
      Pick a type and address, click Load to walk the struct.
    </div>
  </div>
</template>
