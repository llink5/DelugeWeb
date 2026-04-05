<script setup lang="ts">
// Hardware button bar.
//
// Renders a row of labelled hardware buttons with optional LED indicators.
// The parent passes a static button definition list plus a `ledState` map
// that drives per-button LED colour/blink.

export interface HardwareButton {
  /** Stable ID the emulator / MIDI mapper uses. */
  id: string
  /** Label shown under the button. */
  label: string
  /** Button has an LED indicator. */
  hasLed?: boolean
  /** Visual hint: classic "shift" modifier, play button, etc. */
  accent?: 'normal' | 'primary' | 'danger' | 'mod'
}

export type LedState = 'off' | 'on' | 'blink'

defineProps<{
  buttons: HardwareButton[]
  /** Per-button LED state, keyed by button id. */
  ledState?: Record<string, LedState>
  /** Button IDs currently pressed. */
  pressed?: Set<string>
}>()

const emit = defineEmits<{
  'button-press': [id: string]
  'button-release': [id: string]
}>()

function onDown(id: string, ev: MouseEvent) {
  ev.preventDefault()
  emit('button-press', id)
}
function onUp(id: string) {
  emit('button-release', id)
}

const ACCENT_CLASSES: Record<NonNullable<HardwareButton['accent']>, string> = {
  normal:  'bg-slate-700 hover:bg-slate-600 text-slate-200',
  primary: 'bg-sky-700 hover:bg-sky-600 text-white',
  danger:  'bg-rose-700 hover:bg-rose-600 text-white',
  mod:     'bg-amber-700 hover:bg-amber-600 text-amber-100',
}
</script>

<template>
  <div
    class="button-bar flex flex-wrap items-start gap-2 p-2 select-none"
    data-testid="button-bar"
  >
    <button
      v-for="b in buttons"
      :key="b.id"
      type="button"
      :data-button-id="b.id"
      :data-pressed="pressed?.has(b.id) ? 'true' : undefined"
      :class="[
        'relative flex min-w-[52px] flex-col items-center gap-1 rounded px-2 py-1.5 text-[10px] font-medium transition-transform',
        ACCENT_CLASSES[b.accent ?? 'normal'],
        pressed?.has(b.id) ? 'scale-95 ring-1 ring-white/60' : '',
      ]"
      @mousedown="onDown(b.id, $event)"
      @mouseup="onUp(b.id)"
      @mouseleave="onUp(b.id)"
    >
      <span
        v-if="b.hasLed"
        :class="[
          'h-1.5 w-1.5 rounded-full',
          ledState?.[b.id] === 'on'
            ? 'bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.7)]'
            : ledState?.[b.id] === 'blink'
              ? 'bg-red-400 animate-pulse'
              : 'bg-slate-500',
        ]"
        :data-led-state="ledState?.[b.id] ?? 'off'"
      ></span>
      <span>{{ b.label }}</span>
    </button>
  </div>
</template>
