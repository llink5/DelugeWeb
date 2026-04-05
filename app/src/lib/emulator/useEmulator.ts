// Shared DelugeEmulator singleton composable.
//
// Booting the emulator worker is expensive — the entry bundle has to load
// and the ARM CPU has to finish an `init` round trip. Every view that needs
// the emulator connects to the same singleton here, so switching tabs in
// the UI doesn't respawn workers.
//
// The singleton is lazy: `useEmulator()` instantiates DelugeEmulator on
// first call but does NOT start a worker. Callers still have to invoke
// `ensureBooted()` to actually spawn the worker and send `init`.

import { ref, type Ref } from 'vue'
import { DelugeEmulator } from './DelugeEmulator'

interface EmulatorSingleton {
  emulator: DelugeEmulator
  booted: Ref<boolean>
  booting: Ref<boolean>
  ensureBooted(): Promise<void>
  shutdown(): void
}

let singleton: EmulatorSingleton | null = null

export function useEmulator(): EmulatorSingleton {
  if (singleton) return singleton

  const emulator = new DelugeEmulator()
  const booted = ref(false)
  const booting = ref(false)
  let bootPromise: Promise<void> | null = null

  async function ensureBooted(): Promise<void> {
    if (booted.value) return
    if (bootPromise) return bootPromise
    booting.value = true
    bootPromise = (async () => {
      const worker = new Worker(
        new URL('./EmulatorWorker.entry.ts', import.meta.url),
        { type: 'module' },
      )
      emulator.attachWorker(worker)
      const reply = await emulator.init()
      if (!reply.ok) {
        throw new Error(reply.error ?? 'init failed')
      }
      booted.value = true
    })().finally(() => {
      booting.value = false
    })
    return bootPromise
  }

  function shutdown(): void {
    emulator.dispose()
    booted.value = false
    bootPromise = null
    singleton = null
  }

  singleton = { emulator, booted, booting, ensureBooted, shutdown }
  return singleton
}
