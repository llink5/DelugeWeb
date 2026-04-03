<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { midi } from '@/lib/midi'
import { parsePreset, serializePreset, formatParam } from '@/lib/xml'
import { diff } from 'deep-diff'
import type {
  Preset,
  SoundPreset,
  KitPreset,
  Song,
  PresetEntry,
  PresetDiffEntry,
  PresetType,
  DefaultParams,
  Oscillator,
  LFO,
  Modulator,
  Unison,
  Arpeggiator,
  Envelope,
  PatchCable,
  ModKnob,
} from '@/lib/types'
import {
  scanPresets as svcScanPresets,
  loadPreset as svcLoadPreset,
  diffPresets,
} from './PresetService'

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

const presetType = ref<PresetType>('SYNTHS')
const entries = ref<PresetEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const presetA = ref<Preset | null>(null)
const pathA = ref<string>('')
const presetB = ref<Preset | null>(null)
const pathB = ref<string>('')

const viewMode = ref<'detail' | 'diff'>('detail')

// ---------------------------------------------------------------------------
// Computed helpers
// ---------------------------------------------------------------------------

const soundA = computed<SoundPreset | null>(() =>
  presetA.value && presetA.value._type === 'sound' ? presetA.value : null,
)

const paramsA = computed<DefaultParams | null>(() => {
  if (!presetA.value) return null
  if (presetA.value._type === 'sound' || presetA.value._type === 'kit') {
    return presetA.value.defaultParams ?? null
  }
  return null
})

const diffEntries = computed<PresetDiffEntry[]>(() => {
  if (!presetA.value || !presetB.value) return []
  return diffPresets(presetA.value, presetB.value)
})

const patchCablesA = computed<PatchCable[]>(() => {
  const cables = paramsA.value?.patchCables?.patchCable
  if (!cables) return []
  return Array.isArray(cables) ? cables : [cables]
})

const modKnobsA = computed<ModKnob[]>(() => {
  if (!presetA.value || presetA.value._type === 'song' || presetA.value._type === 'kit') return []
  const knobs = (presetA.value as SoundPreset).modKnobs?.modKnob
  if (!knobs) return []
  return Array.isArray(knobs) ? knobs : [knobs]
})

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

async function scanPresets() {
  loading.value = true
  error.value = null
  try {
    entries.value = await svcScanPresets(presetType.value)
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to scan presets'
  } finally {
    loading.value = false
  }
}

async function loadPreset(entry: PresetEntry) {
  loading.value = true
  error.value = null
  try {
    presetA.value = await svcLoadPreset(entry.path)
    pathA.value = entry.path
    viewMode.value = 'detail'
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load preset'
  } finally {
    loading.value = false
  }
}

async function loadForCompare(entry: PresetEntry) {
  loading.value = true
  error.value = null
  try {
    presetB.value = await svcLoadPreset(entry.path)
    pathB.value = entry.path
    viewMode.value = 'diff'
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load preset for comparison'
  } finally {
    loading.value = false
  }
}

function handleContextMenu(e: Event, entry: PresetEntry) {
  e.preventDefault()
  loadForCompare(entry)
}

// Reset entries when type changes
watch(presetType, () => {
  entries.value = []
  presetA.value = null
  presetB.value = null
  pathA.value = ''
  pathB.value = ''
})

// ---------------------------------------------------------------------------
// Section rendering helpers
// ---------------------------------------------------------------------------

function paramRows(obj: unknown): [string, string][] {
  if (!obj || typeof obj !== 'object') return []
  const o = obj as Record<string, unknown>
  const rows: [string, string][] = []
  for (const [key, val] of Object.entries(o)) {
    if (val === undefined || val === null) continue
    if (typeof val === 'object') continue // skip nested objects
    rows.push([key, String(formatParam(key, val))])
  }
  return rows
}

function envelopeRows(env: Envelope | null | undefined, label: string): [string, string][] {
  if (!env) return []
  return [
    [`${label} Attack`, String(formatParam('attack', env.attack))],
    [`${label} Decay`, String(formatParam('decay', env.decay))],
    [`${label} Sustain`, String(formatParam('sustain', env.sustain))],
    [`${label} Release`, String(formatParam('release', env.release))],
  ].filter(([, v]) => v !== 'undefined') as [string, string][]
}

function oscRows(osc: Oscillator | null | undefined, label: string): [string, string][] {
  if (!osc) return []
  const rows: [string, string][] = []
  if (osc.type !== undefined) rows.push([`${label} Type`, osc.type])
  if (osc.transpose !== undefined) rows.push([`${label} Transpose`, osc.transpose])
  if (osc.cents !== undefined) rows.push([`${label} Cents`, osc.cents])
  if (osc.retrigPhase !== undefined) rows.push([`${label} Retrig Phase`, String(formatParam('retrigPhase', osc.retrigPhase))])
  if (osc.loopMode !== undefined) rows.push([`${label} Loop Mode`, osc.loopMode])
  if (osc.reversed !== undefined) rows.push([`${label} Reversed`, osc.reversed])
  if (osc.fileName !== undefined) rows.push([`${label} File`, osc.fileName])
  if (osc.oscillatorSync !== undefined) rows.push([`${label} Sync`, osc.oscillatorSync])
  return rows
}

function lfoRows(lfo: LFO | null | undefined, label: string): [string, string][] {
  if (!lfo) return []
  const rows: [string, string][] = []
  if (lfo.type !== undefined) rows.push([`${label} Type`, lfo.type])
  if (lfo.syncLevel !== undefined) rows.push([`${label} Sync`, String(formatParam('syncLevel', lfo.syncLevel))])
  return rows
}

function modRows(mod: Modulator | null | undefined, label: string): [string, string][] {
  if (!mod) return []
  const rows: [string, string][] = []
  if (mod.transpose !== undefined) rows.push([`${label} Transpose`, mod.transpose])
  if (mod.cents !== undefined) rows.push([`${label} Cents`, mod.cents])
  if (mod.retrigPhase !== undefined) rows.push([`${label} Retrig Phase`, String(formatParam('retrigPhase', mod.retrigPhase))])
  if (mod.toModulator1 !== undefined) rows.push([`${label} -> Mod 1`, mod.toModulator1])
  return rows
}

function diffKindLabel(kind: string): string {
  switch (kind) {
    case 'E': return 'Changed'
    case 'N': return 'Added'
    case 'D': return 'Removed'
    case 'A': return 'Array'
    default: return kind
  }
}

function diffKindColor(kind: string): string {
  switch (kind) {
    case 'E': return 'text-amber-400'
    case 'N': return 'text-emerald-400'
    case 'D': return 'text-red-400'
    case 'A': return 'text-blue-400'
    default: return 'text-zinc-400'
  }
}

function formatSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(d?: Date): string {
  if (!d) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function nameFromPath(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}
</script>

<template>
  <div class="flex h-full min-h-0 bg-zinc-950 text-zinc-200">
    <!-- ─── Sidebar ─────────────────────────────────────────────────── -->
    <aside class="flex w-80 flex-col border-r border-zinc-800 bg-zinc-900/50">
      <!-- Type selector -->
      <div class="flex gap-1 border-b border-zinc-800 p-3">
        <button
          v-for="t in (['SYNTHS', 'KITS', 'SONGS'] as PresetType[])"
          :key="t"
          class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
          :class="presetType === t
            ? 'bg-blue-500/20 text-blue-400'
            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'"
          @click="presetType = t"
        >
          {{ t === 'SYNTHS' ? 'Synths' : t === 'KITS' ? 'Kits' : 'Songs' }}
        </button>
      </div>

      <!-- Scan button -->
      <div class="border-b border-zinc-800 p-3">
        <button
          class="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          :disabled="loading"
          @click="scanPresets"
        >
          {{ loading ? 'Scanning...' : 'Scan Presets' }}
        </button>
      </div>

      <!-- Error -->
      <div v-if="error" class="border-b border-zinc-800 bg-red-500/10 px-3 py-2 text-xs text-red-400">
        {{ error }}
      </div>

      <!-- Preset list -->
      <div class="flex-1 overflow-y-auto">
        <div v-if="entries.length === 0 && !loading" class="p-4 text-center text-xs text-zinc-500">
          No presets loaded. Click Scan to search the SD card.
        </div>
        <div
          v-for="entry in entries"
          :key="entry.path"
          class="cursor-pointer border-b border-zinc-800/50 px-3 py-2 transition-colors hover:bg-zinc-800/40"
          :class="pathA === entry.path
            ? 'border-l-2 border-l-blue-500 bg-zinc-800/50'
            : 'border-l-2 border-l-transparent'"
          @click="loadPreset(entry)"
          @contextmenu="handleContextMenu($event, entry)"
        >
          <div class="truncate text-sm font-medium text-zinc-200">{{ entry.name }}</div>
          <div class="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
            <span v-if="entry.size !== undefined">{{ formatSize(entry.size) }}</span>
            <span v-if="entry.date">{{ formatDate(entry.date) }}</span>
          </div>
          <div class="truncate text-xs text-zinc-600">{{ entry.path }}</div>
        </div>
      </div>

      <!-- Entry count -->
      <div v-if="entries.length > 0" class="border-t border-zinc-800 px-3 py-2 text-xs text-zinc-500">
        {{ entries.length }} preset{{ entries.length !== 1 ? 's' : '' }}
      </div>
    </aside>

    <!-- ─── Main panel ──────────────────────────────────────────────── -->
    <main class="flex flex-1 flex-col min-w-0">
      <!-- Tab bar -->
      <div class="flex border-b border-zinc-800">
        <button
          class="px-4 py-2.5 text-sm font-medium transition-colors"
          :class="viewMode === 'detail'
            ? 'border-b-2 border-blue-500 text-blue-400'
            : 'text-zinc-400 hover:text-zinc-200'"
          @click="viewMode = 'detail'"
        >
          Detail
        </button>
        <button
          class="px-4 py-2.5 text-sm font-medium transition-colors"
          :class="viewMode === 'diff'
            ? 'border-b-2 border-blue-500 text-blue-400'
            : 'text-zinc-400 hover:text-zinc-200'"
          @click="viewMode = 'diff'"
        >
          Diff
        </button>
      </div>

      <!-- Content area -->
      <div class="flex-1 overflow-y-auto p-6">
        <!-- No preset loaded -->
        <div v-if="!presetA && viewMode === 'detail'" class="flex h-full items-center justify-center text-zinc-500">
          <p class="text-sm">Select a preset from the sidebar to view its details.</p>
        </div>

        <!-- ─── Detail view ───────────────────────────────────────── -->
        <div v-else-if="viewMode === 'detail' && presetA" class="space-y-6">
          <h2 class="text-lg font-semibold text-zinc-100">
            {{ nameFromPath(pathA) }}
          </h2>

          <!-- General -->
          <section v-if="soundA">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">General</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-if="soundA.name" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Name</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ soundA.name }}</td>
                </tr>
                <tr v-if="soundA.mode" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Mode</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ soundA.mode }}</td>
                </tr>
                <tr v-if="soundA.polyphonic" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Polyphonic</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ soundA.polyphonic }}</td>
                </tr>
                <tr v-if="soundA.voicePriority" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Voice Priority</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('voicePriority', soundA.voicePriority) }}</td>
                </tr>
                <tr v-if="soundA.transpose" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Transpose</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ soundA.transpose }}</td>
                </tr>
                <tr v-if="soundA.clippingAmount" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Clipping</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ soundA.clippingAmount }}</td>
                </tr>
                <tr v-if="soundA.lpfMode" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">LPF Mode</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ soundA.lpfMode }}</td>
                </tr>
                <tr v-if="soundA.modFXType" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Mod FX Type</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ soundA.modFXType }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- OSC 1 -->
          <section v-if="soundA?.osc1">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">OSC 1</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-for="[label, val] in oscRows(soundA.osc1, 'OSC 1')" :key="label" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">{{ label }}</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ val }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- OSC 2 -->
          <section v-if="soundA?.osc2">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">OSC 2</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-for="[label, val] in oscRows(soundA.osc2, 'OSC 2')" :key="label" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">{{ label }}</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ val }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- LFO 1 & 2 -->
          <section v-if="soundA?.lfo1 || soundA?.lfo2">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">LFO 1 / 2</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-for="[label, val] in [...lfoRows(soundA?.lfo1, 'LFO 1'), ...lfoRows(soundA?.lfo2, 'LFO 2')]" :key="label" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">{{ label }}</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ val }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Modulators -->
          <section v-if="soundA?.modulator1 || soundA?.modulator2">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Modulators</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-for="[label, val] in [...modRows(soundA?.modulator1, 'Mod 1'), ...modRows(soundA?.modulator2, 'Mod 2')]" :key="label" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">{{ label }}</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ val }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Unison -->
          <section v-if="soundA?.unison">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Unison</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-if="soundA.unison.num" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Voices</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ soundA.unison.num }}</td>
                </tr>
                <tr v-if="soundA.unison.detune" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Detune</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ soundA.unison.detune }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Arpeggiator -->
          <section v-if="soundA?.arpeggiator">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Arpeggiator</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-if="soundA.arpeggiator.mode" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Mode</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ soundA.arpeggiator.mode }}</td>
                </tr>
                <tr v-if="soundA.arpeggiator.numOctaves" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Octaves</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ soundA.arpeggiator.numOctaves }}</td>
                </tr>
                <tr v-if="soundA.arpeggiator.syncLevel" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Sync</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('syncLevel', soundA.arpeggiator.syncLevel) }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Envelope 1 -->
          <section v-if="paramsA?.envelope1">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Envelope 1</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-for="[label, val] in envelopeRows(paramsA.envelope1, 'Env 1')" :key="label" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">{{ label }}</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ val }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Envelope 2 -->
          <section v-if="paramsA?.envelope2">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Envelope 2</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-for="[label, val] in envelopeRows(paramsA.envelope2, 'Env 2')" :key="label" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">{{ label }}</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ val }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Filters -->
          <section v-if="paramsA?.lpfFrequency || paramsA?.hpfFrequency || paramsA?.lpf || paramsA?.hpf">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Filters</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-if="paramsA?.lpfFrequency" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">LPF Frequency</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('lpfFrequency', paramsA.lpfFrequency) }}</td>
                </tr>
                <tr v-if="paramsA?.lpfResonance" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">LPF Resonance</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('lpfResonance', paramsA.lpfResonance) }}</td>
                </tr>
                <tr v-if="paramsA?.hpfFrequency" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">HPF Frequency</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('hpfFrequency', paramsA.hpfFrequency) }}</td>
                </tr>
                <tr v-if="paramsA?.hpfResonance" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">HPF Resonance</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('hpfResonance', paramsA.hpfResonance) }}</td>
                </tr>
                <tr v-for="[label, val] in paramRows(paramsA?.lpf)" :key="'lpf-' + label" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">LPF {{ label }}</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ val }}</td>
                </tr>
                <tr v-for="[label, val] in paramRows(paramsA?.hpf)" :key="'hpf-' + label" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">HPF {{ label }}</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ val }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- FX -->
          <section v-if="paramsA?.modFXRate || paramsA?.delayRate || paramsA?.reverbAmount || paramsA?.delay">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">FX</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-if="paramsA?.modFXRate" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Mod FX Rate</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('modFXRate', paramsA.modFXRate) }}</td>
                </tr>
                <tr v-if="paramsA?.modFXDepth" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Mod FX Depth</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('modFXDepth', paramsA.modFXDepth) }}</td>
                </tr>
                <tr v-if="paramsA?.modFXOffset" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Mod FX Offset</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('modFXOffset', paramsA.modFXOffset) }}</td>
                </tr>
                <tr v-if="paramsA?.modFXFeedback" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Mod FX Feedback</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('modFXFeedback', paramsA.modFXFeedback) }}</td>
                </tr>
                <tr v-if="paramsA?.delayRate" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Delay Rate</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('delayRate', paramsA.delayRate) }}</td>
                </tr>
                <tr v-if="paramsA?.delayFeedback" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Delay Feedback</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('delayFeedback', paramsA.delayFeedback) }}</td>
                </tr>
                <tr v-if="paramsA?.reverbAmount" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Reverb Amount</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('reverbAmount', paramsA.reverbAmount) }}</td>
                </tr>
                <tr v-if="paramsA?.stutterRate" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Stutter Rate</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('stutterRate', paramsA.stutterRate) }}</td>
                </tr>
                <tr v-if="paramsA?.sampleRateReduction" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Sample Rate Reduction</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('sampleRateReduction', paramsA.sampleRateReduction) }}</td>
                </tr>
                <tr v-if="paramsA?.bitCrush" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Bit Crush</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('bitCrush', paramsA.bitCrush) }}</td>
                </tr>
                <tr v-for="[label, val] in paramRows(paramsA?.delay)" :key="'delay-' + label" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Delay {{ label }}</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ val }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Patch Cables -->
          <section v-if="patchCablesA.length > 0">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Patch Cables</h3>
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-zinc-700">
                  <th class="py-1 pr-4 text-left text-xs font-medium text-zinc-500">Source</th>
                  <th class="py-1 pr-4 text-left text-xs font-medium text-zinc-500">Destination</th>
                  <th class="py-1 text-left text-xs font-medium text-zinc-500">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(cable, i) in patchCablesA" :key="i" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">{{ cable.source ?? '-' }}</td>
                  <td class="py-1 pr-4 text-zinc-400">{{ cable.destination ?? '-' }}</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('amount', cable.amount) }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Mod Knobs -->
          <section v-if="modKnobsA.length > 0">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Mod Knobs</h3>
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-zinc-700">
                  <th class="py-1 pr-4 text-left text-xs font-medium text-zinc-500">#</th>
                  <th class="py-1 pr-4 text-left text-xs font-medium text-zinc-500">Controls Param</th>
                  <th class="py-1 pr-4 text-left text-xs font-medium text-zinc-500">Patch Source</th>
                  <th class="py-1 text-left text-xs font-medium text-zinc-500">CC</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(knob, i) in modKnobsA" :key="i" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 font-mono text-zinc-500">{{ i }}</td>
                  <td class="py-1 pr-4 text-zinc-400">{{ knob.controlsParam ?? '-' }}</td>
                  <td class="py-1 pr-4 text-zinc-400">{{ knob.patchAmountFromSource ?? '-' }}</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ knob.cc ?? '-' }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Volume / Pan (always relevant) -->
          <section v-if="paramsA?.volume || paramsA?.pan">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Levels</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-if="paramsA?.volume" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Volume</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('volume', paramsA.volume) }}</td>
                </tr>
                <tr v-if="paramsA?.pan" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Pan</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('pan', paramsA.pan) }}</td>
                </tr>
                <tr v-if="paramsA?.oscAVolume" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">OSC A Volume</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('oscAVolume', paramsA.oscAVolume) }}</td>
                </tr>
                <tr v-if="paramsA?.oscBVolume" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">OSC B Volume</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('oscBVolume', paramsA.oscBVolume) }}</td>
                </tr>
                <tr v-if="paramsA?.noiseVolume" class="border-b border-zinc-800/50">
                  <td class="py-1 pr-4 text-zinc-400">Noise Volume</td>
                  <td class="py-1 font-mono text-amber-200/80">{{ formatParam('noiseVolume', paramsA.noiseVolume) }}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>

        <!-- ─── Diff view ─────────────────────────────────────────── -->
        <div v-else-if="viewMode === 'diff'" class="space-y-4">
          <div v-if="!presetA || !presetB" class="flex h-full items-center justify-center text-zinc-500">
            <p class="text-sm">
              Load a preset (click), then right-click another to compare.
            </p>
          </div>

          <template v-else>
            <!-- Header: filenames -->
            <div class="flex items-center gap-4">
              <div class="flex-1 rounded-lg bg-zinc-800/50 px-4 py-2">
                <div class="text-xs text-zinc-500">A</div>
                <div class="truncate text-sm font-medium text-zinc-200">{{ nameFromPath(pathA) }}</div>
                <div class="truncate text-xs text-zinc-500">{{ pathA }}</div>
              </div>
              <div class="text-zinc-600">vs</div>
              <div class="flex-1 rounded-lg bg-zinc-800/50 px-4 py-2">
                <div class="text-xs text-zinc-500">B</div>
                <div class="truncate text-sm font-medium text-zinc-200">{{ nameFromPath(pathB) }}</div>
                <div class="truncate text-xs text-zinc-500">{{ pathB }}</div>
              </div>
            </div>

            <!-- Identical message -->
            <div v-if="diffEntries.length === 0" class="rounded-lg border border-zinc-800 bg-zinc-900/50 px-6 py-10 text-center">
              <p class="text-sm text-emerald-400">Presets are identical.</p>
              <p class="mt-1 text-xs text-zinc-500">No differences found between the two files.</p>
            </div>

            <!-- Diff table -->
            <div v-else>
              <div class="mb-2 text-xs text-zinc-500">{{ diffEntries.length }} difference{{ diffEntries.length !== 1 ? 's' : '' }} found</div>
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-700">
                    <th class="py-1.5 pr-4 text-left text-xs font-medium text-zinc-500">Parameter</th>
                    <th class="py-1.5 pr-4 text-left text-xs font-medium text-zinc-500">Status</th>
                    <th class="py-1.5 pr-4 text-left text-xs font-medium text-zinc-500">A Value</th>
                    <th class="py-1.5 text-left text-xs font-medium text-zinc-500">B Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(d, i) in diffEntries" :key="i" class="border-b border-zinc-800/50">
                    <td class="py-1 pr-4 font-mono text-xs text-zinc-300">{{ d.path }}</td>
                    <td class="py-1 pr-4 text-xs font-medium" :class="diffKindColor(d.kind)">
                      {{ diffKindLabel(d.kind) }}
                    </td>
                    <td class="py-1 pr-4 font-mono text-xs" :class="d.kind === 'D' ? 'text-red-300' : 'text-zinc-400'">
                      {{ d.oldVal !== undefined ? String(d.oldVal) : '-' }}
                    </td>
                    <td class="py-1 font-mono text-xs" :class="d.kind === 'N' ? 'text-emerald-300' : 'text-zinc-400'">
                      {{ d.newVal !== undefined ? String(d.newVal) : '-' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>
    </main>
  </div>
</template>
