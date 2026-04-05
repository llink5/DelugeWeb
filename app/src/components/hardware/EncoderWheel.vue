<script setup lang="ts">
// Rotary encoder with optional push-button behaviour.
//
// Mouse wheel → encoderTurn(delta). Drag vertically → continuous turn with
// per-pixel granularity. Click → press/release events.

import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    /** CSS size in pixels. */
    size?: number
    /** Rotation accumulated so far (for the visual indicator only). */
    rotation?: number
    /** Encoder can be pushed down. */
    pushable?: boolean
  }>(),
  {
    size: 60,
    rotation: 0,
    pushable: true,
  },
)

const emit = defineEmits<{
  turn: [delta: number]
  press: []
  release: []
}>()

const pressed = ref(false)
const dragging = ref(false)
let lastY = 0

function onWheel(ev: WheelEvent) {
  ev.preventDefault()
  emit('turn', ev.deltaY > 0 ? 1 : -1)
}

function onMouseDown(ev: MouseEvent) {
  if (props.pushable) {
    pressed.value = true
    emit('press')
  }
  dragging.value = true
  lastY = ev.clientY
  const move = (e: MouseEvent) => {
    const dy = e.clientY - lastY
    if (Math.abs(dy) >= 4) {
      emit('turn', dy > 0 ? 1 : -1)
      lastY = e.clientY
    }
  }
  const up = () => {
    dragging.value = false
    if (pressed.value) {
      pressed.value = false
      emit('release')
    }
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
</script>

<template>
  <div
    class="encoder flex flex-col items-center gap-1 select-none"
    data-testid="encoder-wheel"
    :data-pressed="pressed ? 'true' : undefined"
  >
    <div
      :style="{ width: size + 'px', height: size + 'px' }"
      class="relative cursor-pointer rounded-full bg-gradient-to-b from-slate-500 to-slate-800 shadow-inner"
      :class="pressed ? 'scale-95' : ''"
      @wheel.passive="onWheel"
      @mousedown="onMouseDown"
    >
      <!-- Rotation indicator -->
      <div
        class="absolute left-1/2 top-1 h-[40%] w-0.5 -translate-x-1/2 rounded-full bg-amber-300"
        :style="{ transformOrigin: `center ${size / 2 - 4}px`, transform: `rotate(${rotation * 10}deg) translateX(-50%)` }"
      ></div>
    </div>
    <span class="text-[10px] text-slate-400">{{ label }}</span>
  </div>
</template>
