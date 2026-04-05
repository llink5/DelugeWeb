// Hot-reload orchestrator.
//
// The developer flow it's designed for: edit firmware → build → drop the
// fresh ELF onto the emulator → the debugger continues where it left off.
// Two reload modes are supported:
//
//   - `cold` : reset the CPU, load the ELF fresh, set PC to the entry point.
//              Fast to do but you pay for firmware boot every time.
//   - `warm` : look for a saved snapshot keyed by the ELF's SHA-256; if
//              present, reset the CPU, apply the ELF segments, *then* restore
//              the snapshot over the top so the CPU lands right where it was
//              last seen. Great for iterating on handlers without re-booting.
//
// The reload cycle is a sequence of existing DelugeEmulator requests, so
// this class carries no new worker state.

import type { DelugeEmulator } from './DelugeEmulator'
import { hashElf } from './snapshot/Snapshot'

export interface HotReloadOptions {
  /** 'cold' = reset + load; 'warm' = restore snapshot if we have one. */
  mode?: 'cold' | 'warm'
}

export interface HotReloadResult {
  elfHash: string
  snapshotRestored: boolean
  entry: number
  symbolCount: number
  durationMs: number
}

const SNAPSHOT_KEY_PREFIX = 'elf:'

export class HotReloader {
  constructor(private readonly emulator: DelugeEmulator) {}

  /**
   * Swap the loaded ELF. Returns details about what happened; throws if any
   * step in the cycle fails.
   */
  async reload(
    elf: ArrayBuffer,
    options: HotReloadOptions = {},
  ): Promise<HotReloadResult> {
    const mode = options.mode ?? 'warm'
    const t0 = now()

    // Hash BEFORE we transfer the buffer to the worker.
    const hash = await hashElf(elf)

    // Make sure any in-flight execution is stopped.
    await this.emulator.stop().catch(() => {
      /* stop may fail if never started — ignore */
    })

    // Reset wipes memory, CPU state, symbols. Needed so ELF segments land in
    // clean memory.
    await this.emulator.reset()

    // Need to give the worker a fresh copy of the buffer since loadElf
    // transfers ownership.
    const copy = new ArrayBuffer(elf.byteLength)
    new Uint8Array(copy).set(new Uint8Array(elf))

    const loadReply = await this.emulator.loadElf(copy)
    if (!loadReply.ok || loadReply.type !== 'elfLoaded') {
      throw new Error(loadReply.error ?? 'loadElf failed')
    }

    let snapshotRestored = false
    if (mode === 'warm') {
      const key = SNAPSHOT_KEY_PREFIX + hash
      try {
        const restoreReply = await this.emulator.loadSnapshot(key)
        if (restoreReply.ok && restoreReply.type === 'snapshotLoaded') {
          snapshotRestored = true
        }
      } catch {
        // Snapshot not found — fall through to cold-loaded state. Warm
        // reload is best-effort.
      }
    }

    return {
      elfHash: hash,
      snapshotRestored,
      entry: loadReply.entry,
      symbolCount: loadReply.symbolCount,
      durationMs: now() - t0,
    }
  }

  /**
   * Save a snapshot keyed by the ELF's SHA-256 so the next warm reload can
   * restore state instead of re-booting.
   */
  async saveCurrentAsSnapshotFor(elf: ArrayBuffer): Promise<string> {
    const hash = await hashElf(elf)
    const key = SNAPSHOT_KEY_PREFIX + hash
    const reply = await this.emulator.saveSnapshot(key)
    if (!reply.ok) {
      throw new Error(reply.error ?? 'saveSnapshot failed')
    }
    return hash
  }

  /** Convenience: check whether a warm reload would find a snapshot. */
  async hasSnapshotFor(elf: ArrayBuffer): Promise<boolean> {
    const hash = await hashElf(elf)
    const key = SNAPSHOT_KEY_PREFIX + hash
    // loadSnapshot is cheap-ish and nicely returns ok=false when missing,
    // but it also RESTORES if found — which we don't want. Use a
    // peek-by-round-trip instead by saving a throwaway and comparing.
    // For now, rely on the snapshot-list command once it's exposed.
    // As a placeholder, do a simple try/catch — callers that can't tolerate
    // side effects should avoid this method for now.
    try {
      const reply = await this.emulator.loadSnapshot(key)
      return reply.ok
    } catch {
      return false
    }
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
