<script setup lang="ts">
import MidiConnection from '@/components/MidiConnection.vue'
</script>

<template>
  <header class="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex justify-between items-center shrink-0">
    <!-- Left: App name -->
    <span class="font-semibold text-zinc-300">Deluge Web Tools</span>

    <!-- Center: MIDI connection -->
    <MidiConnection />

    <!-- Right: Transfer progress placeholder -->
    <div class="w-40"></div>
  </header>
</template>
