<script setup lang="ts">
// Modulation source summary panel.
//
// For a single mod source (envelope1/2, lfo1/2, velocity, note, aftertouch,
// random, sidechain), show the source's colour and a row of "route pills" for
// every patch cable whose source matches. Each pill renders the destination
// parameter name and the signed depth, coloured to match the source.
//
// This is a read-only summary — clicking a pill emits `navigate` so a parent
// can scroll the matching knob into view or highlight it. Editing depths lives
// in ModMatrix.

import { computed } from 'vue'
import type { PatchCable } from '@/lib/values/patchCables'
import { paramKeyForDestination } from '@/lib/values/patchCables'
import { hexToDisplayLinear } from '@/lib/values/paramMeta'
import { colorForSource, labelForSource } from './modSourceColors'

const props = withDefaults(
  defineProps<{
    sourceId: string
    cables: PatchCable[]
    /** Optional override label (e.g. "Env 1 (AMP)" when the panel is paired with an envelope card). */
    label?: string
    /** When true, render compactly (route pills only, no header). */
    compact?: boolean
  }>(),
  { compact: false },
)

const emit = defineEmits<{
  navigate: [destination: string, paramKey: string]
}>()

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

const color = computed(() => colorForSource(props.sourceId))
const sourceLabel = computed(() => props.label ?? labelForSource(props.sourceId))

interface Route {
  destination: string
  paramKey: string
  depth: number
}

const routes = computed<Route[]>(() => {
  const out: Route[] = []
  for (const c of props.cables) {
    if (c.source !== props.sourceId) continue
    if (!c.destination) continue
    const paramKey = paramKeyForDestination(c.destination) ?? c.destination
    let depth = 0
    if (c.amount) {
      try {
        depth = hexToDisplayLinear(c.amount, -50, 50)
      } catch {
        depth = 0
      }
    }
    out.push({ destination: c.destination, paramKey, depth })
  }
  return out
})

// Short human-friendly label for a destination. Keeps pills compact even when
// the firmware name is long (e.g. "sampleRateReduction" -> "SR Reduction").
const DEST_LABELS: Record<string, string> = {
  volume: 'AMP Vol',
  pan: 'Pan',
  pitch: 'Pitch',
  lpfFrequency: 'LPF Cut',
  lpfResonance: 'LPF Res',
  hpfFrequency: 'HPF Cut',
  hpfResonance: 'HPF Res',
  lfo1Rate: 'LFO1 Rate',
  lfo2Rate: 'LFO2 Rate',
  oscAVolume: 'OSC1 Vol',
  oscBVolume: 'OSC2 Vol',
  oscAPulseWidth: 'OSC1 PW',
  oscBPulseWidth: 'OSC2 PW',
  noiseVolume: 'Noise',
  modulator1Volume: 'Mod1 Amt',
  modulator2Volume: 'Mod2 Amt',
  modulator1Feedback: 'Mod1 FB',
  modulator2Feedback: 'Mod2 FB',
  carrier1Feedback: 'Car1 FB',
  carrier2Feedback: 'Car2 FB',
  modFXRate: 'ModFX Rate',
  modFXDepth: 'ModFX Depth',
  delayRate: 'Delay Rate',
  delayFeedback: 'Delay FB',
  reverbAmount: 'Reverb',
  arpeggiatorRate: 'Arp Rate',
  stutterRate: 'Stutter',
  bitcrushAmount: 'Bitcrush',
  sampleRateReduction: 'SR Red',
  portamento: 'Porta',
}

function labelForDestination(destination: string): string {
  return DEST_LABELS[destination] ?? destination
}

function depthSign(depth: number): string {
  if (depth > 0) return '+' + depth
  return String(depth)
}

function onPillClick(route: Route) {
  emit('navigate', route.destination, route.paramKey)
}
</script>

<template>
  <div
    class="mod-source-panel flex flex-col gap-1.5"
    :data-source="sourceId"
    :data-testid="`mod-source-${sourceId}`"
  >
    <header
      v-if="!compact"
      class="flex items-center gap-2"
    >
      <span
        class="inline-block h-2.5 w-2.5 rounded-full"
        :style="{ backgroundColor: color.light }"
      ></span>
      <span
        class="text-xs font-semibold uppercase tracking-wide"
        :style="{ color: color.light }"
      >
        {{ sourceLabel }}
      </span>
      <span class="text-[10px] text-slate-400 dark:text-slate-500">
        {{ routes.length }}
        <span>route<span v-if="routes.length !== 1">s</span></span>
      </span>
    </header>

    <div
      v-if="routes.length === 0"
      class="text-[10px] italic text-slate-400 dark:text-slate-500"
      data-testid="no-routes"
    >
      unused
    </div>
    <div
      v-else
      class="flex flex-wrap gap-1"
      data-testid="routes"
    >
      <button
        v-for="route in routes"
        :key="route.destination"
        type="button"
        class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
        :style="{
          borderColor: color.light,
          color: color.light,
        }"
        :data-destination="route.destination"
        :title="`${sourceLabel} → ${route.destination} (${depthSign(route.depth)})`"
        @click="onPillClick(route)"
      >
        <span>&rarr;</span>
        <span>{{ labelForDestination(route.destination) }}</span>
        <span class="font-mono text-[9px] opacity-80">
          {{ depthSign(route.depth) }}
        </span>
      </button>
    </div>
  </div>
</template>
