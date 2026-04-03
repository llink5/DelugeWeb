<script setup lang="ts">
import { ref, computed } from 'vue'
import { parsePreset, formatParam } from '@/lib/xml'
import { midi } from '@/lib/midi'

// ── State ───────────────────────────────────────────────────────────

const preset = ref<Record<string, unknown> | null>(null)
const rootName = ref('')
const path = ref('')
const loading = ref(false)
const error = ref('')
const collapsedSections = ref<Set<string>>(new Set())

// ── Preset type detection ───────────────────────────────────────────

const isKit = computed(() => rootName.value === 'kit')
const isSound = computed(() => rootName.value === 'sound')

// ── Load from file ──────────────────────────────────────────────────

function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files || !input.files[0]) return
  const file = input.files[0]
  error.value = ''
  loading.value = true

  const reader = new FileReader()
  reader.onload = () => {
    try {
      const text = reader.result as string
      const result = parsePreset(text)
      rootName.value = result.rootName
      preset.value = result.data
      collapsedSections.value = new Set()
    } catch (e: any) {
      error.value = 'Failed to parse preset: ' + (e.message || 'Unknown error')
      preset.value = null
    } finally {
      loading.value = false
    }
  }
  reader.onerror = () => {
    error.value = 'Failed to read file'
    loading.value = false
  }
  reader.readAsText(file)
  input.value = ''
}

// ── Load from Deluge ────────────────────────────────────────────────

async function loadFromDeluge() {
  if (!path.value.trim()) return
  error.value = ''
  loading.value = true

  try {
    const data = await midi.readFile(path.value.trim())
    const text = new TextDecoder().decode(data)
    const result = parsePreset(text)
    rootName.value = result.rootName
    preset.value = result.data
    collapsedSections.value = new Set()
  } catch (e: any) {
    error.value = 'Failed to load preset: ' + (e.message || 'Unknown error')
    preset.value = null
  } finally {
    loading.value = false
  }
}

// ── Section toggle ──────────────────────────────────────────────────

function toggleSection(key: string) {
  if (collapsedSections.value.has(key)) {
    collapsedSections.value.delete(key)
  } else {
    collapsedSections.value.add(key)
  }
  // Force reactivity
  collapsedSections.value = new Set(collapsedSections.value)
}

function isSectionOpen(key: string): boolean {
  return !collapsedSections.value.has(key)
}

// ── Param extraction helpers ────────────────────────────────────────

interface ParamRow {
  key: string
  value: unknown
  formatted: unknown
}

function extractParams(obj: Record<string, unknown> | null | undefined): ParamRow[] {
  if (!obj) return []
  const rows: ParamRow[] = []
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'object' && !Array.isArray(value)) continue
    if (key === 'uniqueId' || key === '_class' || key === '_type') continue
    rows.push({
      key,
      value,
      formatted: formatParam(key, value),
    })
  }
  return rows
}

function getSubObject(obj: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  if (!obj) return null
  const val = obj[key]
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return val as Record<string, unknown>
  }
  return null
}

function getArray(obj: Record<string, unknown> | null | undefined, key: string): unknown[] {
  if (!obj) return []
  const val = obj[key]
  if (Array.isArray(val)) return val
  return []
}

// ── Sound preset sections ───────────────────────────────────────────

const soundSections = computed(() => {
  if (!preset.value || !isSound.value) return []
  const p = preset.value
  const sections: { key: string; label: string; params: ParamRow[]; sub?: Record<string, unknown> }[] = []

  // General info
  sections.push({ key: 'general', label: 'General', params: extractParams(p) })

  // OSC1
  const osc1 = getSubObject(p, 'osc1')
  if (osc1) sections.push({ key: 'osc1', label: 'Oscillator 1', params: extractParams(osc1) })

  // OSC2
  const osc2 = getSubObject(p, 'osc2')
  if (osc2) sections.push({ key: 'osc2', label: 'Oscillator 2', params: extractParams(osc2) })

  // Default params (contains most sound parameters)
  const defaultParams = getSubObject(p, 'defaultParams')
  if (defaultParams) {
    // Filter
    const lpf = getSubObject(defaultParams, 'lpf') ?? getSubObject(defaultParams, 'hpf')
    if (lpf) sections.push({ key: 'filter', label: 'Filter', params: extractParams(lpf) })

    // Envelope 1
    const env1 = getSubObject(defaultParams, 'envelope1')
    if (env1) sections.push({ key: 'env1', label: 'Envelope 1', params: extractParams(env1) })

    // Envelope 2
    const env2 = getSubObject(defaultParams, 'envelope2')
    if (env2) sections.push({ key: 'env2', label: 'Envelope 2', params: extractParams(env2) })

    // LFO1
    const lfo1 = getSubObject(defaultParams, 'lfo1')
    if (lfo1) sections.push({ key: 'lfo1', label: 'LFO 1', params: extractParams(lfo1) })

    // LFO2
    const lfo2 = getSubObject(defaultParams, 'lfo2')
    if (lfo2) sections.push({ key: 'lfo2', label: 'LFO 2', params: extractParams(lfo2) })

    // Modulation
    const modKnobs = getSubObject(defaultParams, 'modKnobs')
    if (modKnobs) sections.push({ key: 'modulation', label: 'Modulation', params: extractParams(modKnobs) })

    // FX
    const delay = getSubObject(defaultParams, 'delay')
    const reverb = getSubObject(defaultParams, 'reverb')
    const modFx = getSubObject(defaultParams, 'modFX')
    const fxParams: ParamRow[] = [
      ...extractParams(delay),
      ...extractParams(reverb),
      ...extractParams(modFx),
    ]
    if (fxParams.length > 0) sections.push({ key: 'fx', label: 'Effects', params: fxParams })

    // Patch cables
    const patchCables = getArray(defaultParams, 'patchCables')
    if (patchCables.length > 0) {
      const cableParams = patchCables.map((cable, i) => {
        const c = cable as Record<string, unknown>
        return {
          key: `cable_${i}`,
          value: `${c.source ?? '?'} -> ${c.destination ?? '?'}`,
          formatted: `${c.source ?? '?'} -> ${c.destination ?? '?'}: ${formatParam('amount', c.amount)}`,
        }
      })
      sections.push({ key: 'patchCables', label: 'Patch Cables', params: cableParams })
    }

    // Remaining defaultParams scalars
    const dpParams = extractParams(defaultParams)
    if (dpParams.length > 0) {
      sections.push({ key: 'defaultParams', label: 'Default Parameters', params: dpParams })
    }
  }

  // Arpeggiator
  const arp = getSubObject(p, 'arpeggiator')
  if (arp) sections.push({ key: 'arpeggiator', label: 'Arpeggiator', params: extractParams(arp) })

  return sections
})

// ── Kit preset sections ─────────────────────────────────────────────

const kitSections = computed(() => {
  if (!preset.value || !isKit.value) return { kitParams: [] as ParamRow[], sources: [] as { index: number; label: string; sections: { key: string; label: string; params: ParamRow[] }[] }[] }
  const p = preset.value

  const kitParams = extractParams(p)

  // Sound sources
  const soundSources = getArray(p, 'soundSources')
  const sources = soundSources.map((source, i) => {
    const s = source as Record<string, unknown>
    const label = (s.name as string) || `Sound ${i + 1}`
    const sectionList: { key: string; label: string; params: ParamRow[] }[] = []

    sectionList.push({ key: `src_${i}_general`, label: 'General', params: extractParams(s) })

    const osc1 = getSubObject(s, 'osc1')
    if (osc1) sectionList.push({ key: `src_${i}_osc1`, label: 'OSC 1', params: extractParams(osc1) })

    const osc2 = getSubObject(s, 'osc2')
    if (osc2) sectionList.push({ key: `src_${i}_osc2`, label: 'OSC 2', params: extractParams(osc2) })

    const dp = getSubObject(s, 'defaultParams')
    if (dp) sectionList.push({ key: `src_${i}_params`, label: 'Parameters', params: extractParams(dp) })

    return { index: i, label, sections: sectionList }
  })

  return { kitParams, sources }
})

const expandedSources = ref<Set<number>>(new Set())

function toggleSource(index: number) {
  if (expandedSources.value.has(index)) {
    expandedSources.value.delete(index)
  } else {
    expandedSources.value.add(index)
  }
  expandedSources.value = new Set(expandedSources.value)
}
</script>

<template>
  <div class="p-6 space-y-6">
    <h2 class="text-xl font-semibold text-zinc-200">Preset Editor</h2>

    <!-- Load controls -->
    <div class="flex flex-wrap items-end gap-4">
      <!-- File upload -->
      <div class="space-y-1">
        <label class="text-sm text-zinc-400">Load from file</label>
        <label class="block px-4 py-2 rounded-lg bg-zinc-700 text-zinc-300 text-sm font-medium hover:bg-zinc-600 transition cursor-pointer text-center">
          Choose File
          <input type="file" accept=".xml,.XML" class="hidden" @change="handleFileUpload" />
        </label>
      </div>

      <!-- Deluge path -->
      <div class="flex items-end gap-2 flex-1 min-w-[300px]">
        <div class="flex-1 space-y-1">
          <label class="text-sm text-zinc-400">Load from Deluge</label>
          <input
            v-model="path"
            type="text"
            placeholder="/SYNTHS/MyPreset.xml"
            class="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
            @keyup.enter="loadFromDeluge"
          />
        </div>
        <button
          class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition disabled:opacity-50"
          :disabled="loading || !path.trim()"
          @click="loadFromDeluge"
        >
          Load
        </button>
      </div>
    </div>

    <!-- Loading indicator -->
    <div v-if="loading" class="text-sm text-zinc-400">Loading preset...</div>

    <!-- Error -->
    <div v-if="error" class="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
      {{ error }}
    </div>

    <!-- Read-only notice -->
    <div v-if="preset" class="px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50 text-xs text-zinc-500">
      Read-only view. Editing is planned for a future release.
    </div>

    <!-- Preset type badge -->
    <div v-if="preset" class="flex items-center gap-3">
      <span class="px-2.5 py-1 rounded-full text-xs font-medium" :class="isKit ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400'">
        {{ rootName.toUpperCase() }}
      </span>
      <span v-if="preset.presetName" class="text-sm text-zinc-300">{{ preset.presetName }}</span>
    </div>

    <!-- Sound preset display -->
    <template v-if="isSound && preset">
      <div
        v-for="section in soundSections"
        :key="section.key"
        class="rounded-lg border border-zinc-800 overflow-hidden"
      >
        <button
          class="flex items-center justify-between w-full px-4 py-3 bg-zinc-900 hover:bg-zinc-800/70 transition text-left"
          @click="toggleSection(section.key)"
        >
          <span class="text-sm font-medium text-zinc-300">{{ section.label }}</span>
          <svg
            class="w-4 h-4 text-zinc-500 transition-transform"
            :class="{ 'rotate-180': isSectionOpen(section.key) }"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div v-if="isSectionOpen(section.key)" class="divide-y divide-zinc-800/50">
          <div
            v-for="row in section.params"
            :key="row.key"
            class="flex items-center justify-between px-4 py-2 hover:bg-zinc-800/20 transition-colors"
          >
            <span class="text-sm text-zinc-400">{{ row.key }}</span>
            <span class="text-sm font-mono text-zinc-200">{{ row.formatted }}</span>
          </div>
          <div v-if="section.params.length === 0" class="px-4 py-3 text-sm text-zinc-600">
            No parameters
          </div>
        </div>
      </div>
    </template>

    <!-- Kit preset display -->
    <template v-if="isKit && preset">
      <!-- Kit-level params -->
      <div v-if="kitSections.kitParams.length > 0" class="rounded-lg border border-zinc-800 overflow-hidden">
        <button
          class="flex items-center justify-between w-full px-4 py-3 bg-zinc-900 hover:bg-zinc-800/70 transition text-left"
          @click="toggleSection('kit-params')"
        >
          <span class="text-sm font-medium text-zinc-300">Kit Parameters</span>
          <svg
            class="w-4 h-4 text-zinc-500 transition-transform"
            :class="{ 'rotate-180': isSectionOpen('kit-params') }"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div v-if="isSectionOpen('kit-params')" class="divide-y divide-zinc-800/50">
          <div
            v-for="row in kitSections.kitParams"
            :key="row.key"
            class="flex items-center justify-between px-4 py-2 hover:bg-zinc-800/20 transition-colors"
          >
            <span class="text-sm text-zinc-400">{{ row.key }}</span>
            <span class="text-sm font-mono text-zinc-200">{{ row.formatted }}</span>
          </div>
        </div>
      </div>

      <!-- Sound sources -->
      <div class="space-y-2">
        <h3 class="text-sm font-medium text-zinc-400">Sound Sources ({{ kitSections.sources.length }})</h3>
        <div
          v-for="source in kitSections.sources"
          :key="source.index"
          class="rounded-lg border border-zinc-800 overflow-hidden"
        >
          <button
            class="flex items-center justify-between w-full px-4 py-3 bg-zinc-900 hover:bg-zinc-800/70 transition text-left"
            @click="toggleSource(source.index)"
          >
            <span class="text-sm font-medium text-zinc-300">{{ source.label }}</span>
            <svg
              class="w-4 h-4 text-zinc-500 transition-transform"
              :class="{ 'rotate-180': expandedSources.has(source.index) }"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div v-if="expandedSources.has(source.index)" class="space-y-0">
            <div
              v-for="sub in source.sections"
              :key="sub.key"
            >
              <button
                class="flex items-center justify-between w-full px-4 py-2 bg-zinc-850 hover:bg-zinc-800/50 transition text-left border-t border-zinc-800/50"
                @click="toggleSection(sub.key)"
              >
                <span class="text-xs font-medium text-zinc-400 uppercase tracking-wide">{{ sub.label }}</span>
                <svg
                  class="w-3.5 h-3.5 text-zinc-600 transition-transform"
                  :class="{ 'rotate-180': isSectionOpen(sub.key) }"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div v-if="isSectionOpen(sub.key)" class="divide-y divide-zinc-800/30">
                <div
                  v-for="row in sub.params"
                  :key="row.key"
                  class="flex items-center justify-between px-6 py-1.5 hover:bg-zinc-800/20 transition-colors"
                >
                  <span class="text-xs text-zinc-500">{{ row.key }}</span>
                  <span class="text-xs font-mono text-zinc-300">{{ row.formatted }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- No preset loaded -->
    <div v-if="!preset && !loading && !error" class="flex flex-col items-center justify-center py-16 text-zinc-600">
      <svg class="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      <p class="text-sm">Load a preset XML file or enter a Deluge path to view parameters.</p>
    </div>
  </div>
</template>
