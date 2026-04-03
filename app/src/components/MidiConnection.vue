<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { midi } from '@/lib/midi/connection'

const connected = ref(false)
const portName = ref('')
const connecting = ref(false)

let unsubscribe: (() => void) | null = null

onMounted(async () => {
  unsubscribe = midi.onConnectionChange((isConnected) => {
    connected.value = isConnected
    if (!isConnected) {
      portName.value = ''
    }
  })

  try {
    connecting.value = true
    const found = await midi.autoDetect()
    if (found) {
      connected.value = true
      const ports = await midi.listPorts()
      portName.value = ports.inputs[0]?.name ?? 'Deluge'
    }
  } catch {
    // autodetect failed silently
  } finally {
    connecting.value = false
  }
})

onUnmounted(() => {
  unsubscribe?.()
})

async function handleConnect() {
  try {
    connecting.value = true
    await midi.connect()
    connected.value = true
    const ports = await midi.listPorts()
    portName.value = ports.inputs[0]?.name ?? 'Deluge'
  } catch {
    connected.value = false
  } finally {
    connecting.value = false
  }
}

function handleDisconnect() {
  midi.disconnect()
  connected.value = false
  portName.value = ''
}
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- Status dot -->
    <span
      class="w-2 h-2 rounded-full shrink-0"
      :class="connected ? 'bg-emerald-400' : 'bg-red-400'"
    />

    <!-- Port name / status -->
    <span class="text-sm text-zinc-400">
      {{ connecting ? 'Connecting...' : connected ? portName || 'Connected' : 'Disconnected' }}
    </span>

    <!-- Action button -->
    <button
      v-if="!connected && !connecting"
      class="text-sm px-2.5 py-1 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition"
      @click="handleConnect"
    >
      Connect
    </button>
    <button
      v-else-if="connected"
      class="text-sm px-2.5 py-1 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition"
      @click="handleDisconnect"
    >
      Disconnect
    </button>
  </div>
</template>
