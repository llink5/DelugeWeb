<script setup lang="ts">
// A card containing a group of related parameter knobs.
// Used for OSC1, OSC2, LPF, HPF, AMP and similar synth modules.
// Each module has a title, an optional mode/type selector, and a slot for
// the knob row(s) and any module-specific controls.

defineProps<{
  title: string
  mode?: string
  /** When set, renders a <select> for mode selection */
  modeOptions?: { value: string; label: string }[]
  accentClass?: string
}>()

defineEmits<{
  'update:mode': [value: string]
}>()
</script>

<template>
  <section
    class="engine-module flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800"
    :data-module="title.toLowerCase().replace(/\s+/g, '-')"
  >
    <header class="flex items-center justify-between gap-2">
      <h3
        class="text-xs font-semibold uppercase tracking-wider"
        :class="accentClass ?? 'text-slate-600 dark:text-slate-300'"
      >
        {{ title }}
      </h3>
      <select
        v-if="modeOptions && modeOptions.length"
        :value="mode"
        class="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-900"
        @change="(e) => $emit('update:mode', (e.target as HTMLSelectElement).value)"
      >
        <option v-for="opt in modeOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </header>
    <div class="flex flex-wrap items-start gap-3">
      <slot />
    </div>
  </section>
</template>
