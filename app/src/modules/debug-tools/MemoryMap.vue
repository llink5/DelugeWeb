<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const emit = defineEmits<{
  (e: 'navigate-read', addr: number, len: number): void
  (e: 'navigate-pointer', addr: number): void
}>()

// ── Data ────────────────────────────────────────────────────────────

interface Region {
  name: string
  start: number
  end: number
  color: string
  description?: string
  readonly?: boolean
  pattern?: 'striped'
  children?: Region[]
}

interface Marker {
  name: string
  type: string
  region: string
  addr?: number
  description: string
}

const mainRegions: Region[] = [
  {
    name: 'SDRAM',
    start: 0x0c000000,
    end: 0x10000000,
    color: '#3b82f6',
    description: 'External SDRAM — 64 MB',
    children: [
      { name: '.sdram_text/data/rodata', start: 0x0c000000, end: 0x0c100000, color: '#3b82f6', description: 'SDRAM code + const data' },
      { name: '.sdram_bss', start: 0x0c100000, end: 0x0c200000, color: '#67e8f9', description: 'SDRAM BSS (midiEngine, etc.)' },
      { name: 'Stealable (Audio)', start: 0x0c200000, end: 0x0e000000, color: '#3b82f6', pattern: 'striped', description: 'Audio sample memory — stealable region' },
      { name: 'External Reserved', start: 0x0e000000, end: 0x0e200000, color: '#1e3a5f', description: 'Reserved external memory' },
      { name: 'External Small', start: 0x0e200000, end: 0x0e232000, color: '#1e3a5f', description: 'Small external allocations' },
      { name: 'Free', start: 0x0e232000, end: 0x10000000, color: '#3f3f46', description: 'Unallocated SDRAM' },
    ],
  },
  {
    name: 'SPI Flash',
    start: 0x18000000,
    end: 0x1a000000,
    color: '#f97316',
    description: 'SPI multi-I/O flash — 32 MB',
  },
  {
    name: 'Internal SRAM',
    start: 0x20000000,
    end: 0x20300000,
    color: '#22c55e',
    description: 'On-chip SRAM — 3 MB',
    children: [
      { name: '.frunk_bss', start: 0x20000000, end: 0x20020000, color: '#3f3f46', description: 'Early BSS — 128 KB' },
      { name: '.ttb_mmu1', start: 0x20020000, end: 0x20028000, color: '#ef4444', readonly: true, description: 'MMU L1 translation table — 32 KB' },
      { name: 'IRQ/FIQ/SVC/ABT Stacks', start: 0x20028000, end: 0x20030000, color: '#ef4444', readonly: true, description: 'Exception mode stacks — 32 KB' },
      { name: '.bss + .text + .rodata + .data', start: 0x20030000, end: 0x20200000, color: '#22c55e', description: 'Main firmware code + data — ~1.8 MB' },
      { name: '.heap', start: 0x20200000, end: 0x202f8000, color: '#86efac', description: 'Heap allocations — ~960 KB' },
      { name: '.program_stack', start: 0x202f8000, end: 0x20300000, color: '#ef4444', readonly: true, description: 'Program stack — 32 KB' },
    ],
  },
  {
    name: 'SDRAM Uncached',
    start: 0x4c000000,
    end: 0x50000000,
    color: '#1d4ed8',
    description: 'SDRAM uncached mirror — 64 MB (DMA-safe)',
  },
]

const markers: Marker[] = [
  { name: 'currentSong', type: 'Song*', region: 'heap', description: 'Global song pointer (deluge.cpp:94)' },
  { name: 'midiEngine', type: 'MidiEngine', region: 'sdram_bss', addr: 0x0c100000, description: 'MIDI engine singleton in SDRAM BSS' },
  { name: 'cvEngine', type: 'CVEngine', region: 'sram', addr: 0x20030000, description: 'CV engine in internal SRAM' },
]

// ── State ───────────────────────────────────────────────────────────

const expanded = ref<Set<string>>(new Set())
const tooltip = ref<{ text: string; x: number; y: number; lines: string[] } | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const isVertical = ref(false)
const zoomLevel = ref(1)
const panOffset = ref(0)

function checkLayout() {
  if (containerRef.value) {
    isVertical.value = containerRef.value.clientWidth < 640
  }
}

let resizeObs: ResizeObserver | null = null

onMounted(() => {
  checkLayout()
  if (containerRef.value) {
    resizeObs = new ResizeObserver(checkLayout)
    resizeObs.observe(containerRef.value)
  }
})

onUnmounted(() => {
  resizeObs?.disconnect()
})

// ── Layout computation ──────────────────────────────────────────────

const BLOCK_HEIGHT = 56
const DETAIL_HEIGHT = 40
const GAP = 3
const LABEL_MIN_WIDTH = 80
const MIN_BLOCK_WIDTH = 32
const VIEW_WIDTH = 1000
const PADDING = 16

interface BlockLayout {
  region: Region
  x: number
  y: number
  w: number
  h: number
  labelVisible: boolean
  isDetail: boolean
  parent?: Region
}

interface MarkerLayout {
  marker: Marker
  x: number
  y: number
  labelVisible: boolean
}

const layout = computed(() => {
  const blocks: BlockLayout[] = []
  const markerLayouts: MarkerLayout[] = []
  const usableWidth = (VIEW_WIDTH - PADDING * 2) * zoomLevel.value

  // Total size across all main regions (for proportional sizing)
  const totalSize = mainRegions.reduce((s, r) => s + (r.end - r.start), 0)

  // Calculate minimum widths needed
  const minTotal = mainRegions.length * MIN_BLOCK_WIDTH + (mainRegions.length - 1) * GAP
  const availableForProportional = Math.max(usableWidth - (mainRegions.length - 1) * GAP, minTotal)

  let mainAxis = PADDING - panOffset.value
  let maxY = 0

  for (let i = 0; i < mainRegions.length; i++) {
    const r = mainRegions[i]
    const size = r.end - r.start
    const rawW = (size / totalSize) * availableForProportional
    const w = Math.max(rawW, MIN_BLOCK_WIDTH)
    const y = PADDING
    const isExpanded = expanded.value.has(r.name) && r.children

    blocks.push({
      region: r,
      x: mainAxis,
      y,
      w,
      h: BLOCK_HEIGHT,
      labelVisible: w >= LABEL_MIN_WIDTH,
      isDetail: false,
    })

    // Detail rows
    if (isExpanded && r.children) {
      const detailY = y + BLOCK_HEIGHT + GAP
      const childTotal = r.children.reduce((s, c) => s + (c.end - c.start), 0)
      const childMinTotal = r.children.length * MIN_BLOCK_WIDTH + (r.children.length - 1) * GAP * 0.5
      const childAvail = Math.max(w - (r.children.length - 1) * GAP * 0.5, childMinTotal)

      let cx = mainAxis
      for (let j = 0; j < r.children.length; j++) {
        const c = r.children[j]
        const cSize = c.end - c.start
        const rawCW = (cSize / childTotal) * childAvail
        const cw = Math.max(rawCW, MIN_BLOCK_WIDTH)

        blocks.push({
          region: c,
          x: cx,
          y: detailY,
          w: cw,
          h: DETAIL_HEIGHT,
          labelVisible: cw >= LABEL_MIN_WIDTH,
          isDetail: true,
          parent: r,
        })

        cx += cw + GAP * 0.5
      }

      maxY = Math.max(maxY, detailY + DETAIL_HEIGHT)
    }

    maxY = Math.max(maxY, y + BLOCK_HEIGHT)
    mainAxis += w + GAP
  }

  // Markers — place inside their target region block
  // Each marker maps to a preferred sub-region and a fallback parent region
  const markerTargets: { marker: Marker; subName: string; parentName: string }[] = [
    { marker: markers[0], subName: '.heap', parentName: 'Internal SRAM' },
    { marker: markers[1], subName: '.sdram_bss', parentName: 'SDRAM' },
    { marker: markers[2], subName: '.bss + .text + .rodata + .data', parentName: 'Internal SRAM' },
  ]

  // Group markers by their target parent to offset them when collapsed
  const parentGroups = new Map<string, number>()

  for (const mt of markerTargets) {
    const subBlock = blocks.find(b => b.region.name === mt.subName && b.isDetail)
    const parentBlock = blocks.find(b => b.region.name === mt.parentName && !b.isDetail)

    let targetBlock: BlockLayout | undefined
    if (subBlock) {
      targetBlock = subBlock
    } else if (parentBlock) {
      targetBlock = parentBlock
    }

    if (targetBlock) {
      let mx: number
      let my: number

      if (subBlock) {
        // Expanded: place inside the sub-region, vertically centered
        mx = subBlock.x + 8
        my = subBlock.y + subBlock.h / 2
      } else {
        // Collapsed: place inside parent, horizontally offset per marker
        const groupIdx = parentGroups.get(mt.parentName) ?? 0
        parentGroups.set(mt.parentName, groupIdx + 1)
        mx = targetBlock.x + 8 + groupIdx * 60
        my = targetBlock.y + targetBlock.h - 10
      }

      // Check if there's enough space for a label (dot at mx, label needs ~50px to the right)
      const spaceRight = targetBlock.x + targetBlock.w - mx - 6
      const labelVisible = spaceRight >= 50

      markerLayouts.push({ marker: mt.marker, x: mx, y: my, labelVisible })
    }
  }

  const totalHeight = maxY + PADDING
  const totalWidth = mainAxis + PADDING + panOffset.value

  return { blocks, markers: markerLayouts, totalHeight, totalWidth }
})

// ── Vertical layout ─────────────────────────────────────────────────

const verticalLayout = computed(() => {
  const blocks: BlockLayout[] = []
  const markerLayouts: MarkerLayout[] = []
  const blockW = VIEW_WIDTH - PADDING * 2
  const totalSize = mainRegions.reduce((s, r) => s + (r.end - r.start), 0)

  let y = PADDING
  const ROW_H = 48
  const DETAIL_ROW_H = 36
  const ROW_GAP = 4

  for (const r of mainRegions) {
    blocks.push({
      region: r,
      x: PADDING,
      y,
      w: blockW,
      h: ROW_H,
      labelVisible: true,
      isDetail: false,
    })
    y += ROW_H + ROW_GAP

    if (expanded.value.has(r.name) && r.children) {
      const childTotal = r.children.reduce((s, c) => s + (c.end - c.start), 0)
      for (const c of r.children) {
        const cSize = c.end - c.start
        const fracH = Math.max((cSize / childTotal) * (r.children.length * DETAIL_ROW_H), DETAIL_ROW_H)
        blocks.push({
          region: c,
          x: PADDING + 16,
          y,
          w: blockW - 16,
          h: DETAIL_ROW_H,
          labelVisible: true,
          isDetail: true,
          parent: r,
        })
        y += DETAIL_ROW_H + 2
      }
      y += ROW_GAP
    }
  }

  // Markers in vertical mode — place inside their target blocks
  const vMarkerTargets: { marker: Marker; subName: string; parentName: string }[] = [
    { marker: markers[0], subName: '.heap', parentName: 'Internal SRAM' },
    { marker: markers[1], subName: '.sdram_bss', parentName: 'SDRAM' },
    { marker: markers[2], subName: '.bss + .text + .rodata + .data', parentName: 'Internal SRAM' },
  ]
  const vParentGroups = new Map<string, number>()

  for (const mt of vMarkerTargets) {
    const subBlock = blocks.find(b => b.region.name === mt.subName && b.isDetail)
    const parentBlock = blocks.find(b => b.region.name === mt.parentName && !b.isDetail)
    const targetBlock = subBlock ?? parentBlock

    if (targetBlock) {
      let mx: number, my: number
      if (subBlock) {
        mx = subBlock.x + 8
        my = subBlock.y + subBlock.h / 2
      } else {
        const groupIdx = vParentGroups.get(mt.parentName) ?? 0
        vParentGroups.set(mt.parentName, groupIdx + 1)
        mx = targetBlock.x + 8 + groupIdx * 70
        my = targetBlock.y + targetBlock.h - 10
      }
      markerLayouts.push({ marker: mt.marker, x: mx, y: my, labelVisible: true })
    }
  }

  return { blocks, markers: markerLayouts, totalHeight: y + PADDING, totalWidth: VIEW_WIDTH }
})

const activeLayout = computed(() => isVertical.value ? verticalLayout.value : layout.value)

// ── Interaction ─────────────────────────────────────────────────────

function toggleExpand(name: string) {
  if (expanded.value.has(name)) {
    expanded.value.delete(name)
  } else {
    expanded.value.add(name)
  }
  // Force reactivity
  expanded.value = new Set(expanded.value)
}

function onRegionClick(region: Region, isDetail: boolean, parent?: Region) {
  // If it has children, toggle expand
  if (!isDetail && region.children) {
    toggleExpand(region.name)
    return
  }
  // Navigate to read tab
  emit('navigate-read', region.start, 256)
}

function onMarkerClick(marker: Marker) {
  if (marker.addr !== undefined) {
    emit('navigate-pointer', marker.addr)
  } else {
    // For pointer-type markers without known addr, still navigate
    emit('navigate-pointer', 0)
  }
}

function showTooltip(evt: MouseEvent, region: Region) {
  const size = region.end - region.start
  const sizeStr = size >= 1048576
    ? `${(size / 1048576).toFixed(1)} MB`
    : size >= 1024
    ? `${(size / 1024).toFixed(0)} KB`
    : `${size} B`

  const lines = [
    region.name,
    `0x${region.start.toString(16).padStart(8, '0')} – 0x${region.end.toString(16).padStart(8, '0')}`,
    sizeStr,
  ]
  if (region.description) lines.push(region.description)
  if (region.readonly) lines.push('Read-only — write blocked by firmware')

  tooltip.value = {
    text: region.name,
    x: evt.clientX,
    y: evt.clientY,
    lines,
  }
}

function showMarkerTooltip(evt: MouseEvent, marker: Marker) {
  const lines = [
    `${marker.name}: ${marker.type}`,
    marker.description,
  ]
  if (marker.addr !== undefined) {
    lines.push(`@ 0x${marker.addr.toString(16).padStart(8, '0')}`)
  }
  tooltip.value = { text: marker.name, x: evt.clientX, y: evt.clientY, lines }
}

function hideTooltip() {
  tooltip.value = null
}

function onWheel(evt: WheelEvent) {
  evt.preventDefault()
  const delta = evt.deltaY > 0 ? -0.15 : 0.15
  zoomLevel.value = Math.max(1, Math.min(8, zoomLevel.value + delta))
}

function formatAddr(addr: number): string {
  return '0x' + addr.toString(16).padStart(8, '0')
}

function formatSize(start: number, end: number): string {
  const size = end - start
  if (size >= 1048576) return `${(size / 1048576).toFixed(size >= 10485760 ? 0 : 1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${size} B`
}

// SVG pattern ID for striped regions
const patternId = 'stripe-pattern'
</script>

<template>
  <div ref="containerRef" class="relative select-none">
    <!-- Zoom indicator -->
    <div v-if="zoomLevel > 1" class="absolute top-2 right-2 text-xs text-zinc-500 bg-zinc-900 rounded px-2 py-1 z-10">
      {{ zoomLevel.toFixed(1) }}x
      <button class="ml-2 text-zinc-400 hover:text-zinc-200" @click="zoomLevel = 1; panOffset = 0">Reset</button>
    </div>

    <!-- SVG map -->
    <div class="overflow-auto rounded-lg border border-zinc-800 bg-zinc-950" @wheel.prevent="onWheel">
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${activeLayout.totalWidth} ${activeLayout.totalHeight}`"
        :style="{ minWidth: isVertical ? '100%' : `${activeLayout.totalWidth}px`, minHeight: `${activeLayout.totalHeight}px` }"
        class="w-full"
        preserveAspectRatio="xMinYMin meet"
      >
        <defs>
          <!-- Stripe pattern for stealable region -->
          <pattern :id="patternId" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="#3b82f6" fill-opacity="0.3" />
            <line x1="0" y1="0" x2="0" y2="8" stroke="#3b82f6" stroke-width="3" stroke-opacity="0.6" />
          </pattern>
        </defs>

        <!-- Region blocks -->
        <g v-for="(b, idx) in activeLayout.blocks" :key="`block-${idx}`">
          <rect
            :x="b.x"
            :y="b.y"
            :width="b.w"
            :height="b.h"
            :rx="b.isDetail ? 4 : 6"
            :fill="b.region.pattern === 'striped' ? `url(#${patternId})` : b.region.color"
            :fill-opacity="b.region.pattern === 'striped' ? 1 : 0.25"
            :stroke="b.region.color"
            stroke-width="1.5"
            :stroke-opacity="0.6"
            class="cursor-pointer transition-all duration-150"
            :class="b.region.children && !b.isDetail ? 'hover:stroke-opacity-100' : ''"
            @click="onRegionClick(b.region, b.isDetail, b.parent)"
            @mouseenter="showTooltip($event, b.region)"
            @mouseleave="hideTooltip"
          />

          <!-- Expand indicator for regions with children -->
          <text
            v-if="b.region.children && !b.isDetail"
            :x="b.x + b.w - 12"
            :y="b.y + 14"
            font-size="10"
            fill="currentColor"
            class="text-zinc-500 pointer-events-none"
          >{{ expanded.has(b.region.name) ? '▾' : '▸' }}</text>

          <!-- Read-only badge -->
          <rect
            v-if="b.region.readonly"
            :x="b.x + b.w - 8"
            :y="b.y + 2"
            width="6"
            height="6"
            rx="3"
            fill="#ef4444"
            fill-opacity="0.8"
            class="pointer-events-none"
          />

          <!-- Label inside block -->
          <text
            v-if="b.labelVisible"
            :x="b.x + 8"
            :y="b.y + (b.h / 2) - 4"
            font-size="11"
            font-weight="600"
            fill="currentColor"
            class="text-zinc-200 pointer-events-none"
          >{{ b.region.name }}</text>

          <!-- Size sublabel -->
          <text
            v-if="b.labelVisible"
            :x="b.x + 8"
            :y="b.y + (b.h / 2) + 10"
            font-size="9"
            fill="currentColor"
            class="text-zinc-500 pointer-events-none"
          >{{ formatAddr(b.region.start) }} · {{ formatSize(b.region.start, b.region.end) }}</text>
        </g>

        <!-- Marker pins — small dots inside region blocks -->
        <g v-for="(m, idx) in activeLayout.markers" :key="`marker-${idx}`">
          <!-- Dot (6px diameter) -->
          <circle
            :cx="m.x"
            :cy="m.y"
            r="3"
            fill="#a78bfa"
            stroke="#7c3aed"
            stroke-width="1"
            class="cursor-pointer"
            @click="onMarkerClick(m.marker)"
            @mouseenter="showMarkerTooltip($event, m.marker)"
            @mouseleave="hideTooltip"
          />
          <!-- Inline label (only when space allows) -->
          <text
            v-if="m.labelVisible"
            :x="m.x + 6"
            :y="m.y + 3"
            font-size="8"
            font-weight="600"
            fill="#a78bfa"
            fill-opacity="0.9"
            class="pointer-events-none"
          >{{ m.marker.name }}</text>
        </g>
      </svg>
    </div>

    <!-- Tooltip -->
    <Teleport to="body">
      <div
        v-if="tooltip"
        class="fixed z-50 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl text-xs pointer-events-none max-w-xs"
        :style="{ left: tooltip.x + 12 + 'px', top: tooltip.y + 12 + 'px' }"
      >
        <div v-for="(line, i) in tooltip.lines" :key="i" :class="i === 0 ? 'font-semibold text-zinc-100 mb-1' : 'text-zinc-400'">
          {{ line }}
        </div>
      </div>
    </Teleport>

    <!-- Legend -->
    <div class="flex flex-wrap gap-4 mt-3 text-xs text-zinc-500">
      <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm bg-blue-500/40 border border-blue-500/60 inline-block"></span> SDRAM</span>
      <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm bg-orange-500/40 border border-orange-500/60 inline-block"></span> SPI Flash</span>
      <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm bg-green-500/40 border border-green-500/60 inline-block"></span> SRAM</span>
      <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm bg-red-500/40 border border-red-500/60 inline-block"></span> Read-only</span>
      <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm bg-purple-400/40 border border-purple-400/60 inline-block"></span> Object marker</span>
      <span class="text-zinc-600 ml-2">Scroll to zoom · Click region to read · Click pin to chase pointer</span>
    </div>
  </div>
</template>
