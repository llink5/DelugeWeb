// Real-Worker entry point for the emulator.
//
// This file wires `runWorker` (defined in EmulatorWorker.ts) to the global
// `self.postMessage` / `addEventListener('message')` pair. It exists as a
// separate file so the worker logic can be imported and tested without
// triggering the Worker-side effects.
//
// Invoked from the main thread via:
//   new Worker(new URL('./EmulatorWorker.entry.ts', import.meta.url), { type: 'module' })

import { runWorker } from './EmulatorWorker'
import { IndexedDbSnapshotStore, InMemorySnapshotStore } from './snapshot/Snapshot'
import type { EmulatorRequest } from './protocol'

interface DedicatedWorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (evt: MessageEvent) => void): void
}

const worker = self as unknown as DedicatedWorkerLike

// Prefer IndexedDB for snapshots when available (browsers). Workers do
// have an `indexedDB` global, but it's worth guarding for future targets
// where the API is missing.
const snapshotStore =
  typeof indexedDB !== 'undefined'
    ? new IndexedDbSnapshotStore()
    : new InMemorySnapshotStore()

runWorker(
  {
    post: (msg, transfer) => {
      if (transfer && transfer.length > 0) {
        worker.postMessage(msg, transfer)
      } else {
        worker.postMessage(msg)
      }
    },
    listen: (handler) => {
      worker.addEventListener('message', (evt: MessageEvent) => {
        handler(evt.data as EmulatorRequest)
      })
    },
  },
  { snapshotStore },
)
