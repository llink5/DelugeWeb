// Emulator state snapshots.
//
// A snapshot captures every mapped memory region plus the CPU's register
// file at a moment in time. Firmware boot typically writes to roughly the
// whole SDRAM + SRAM regions, so snapshots can be sizeable (several tens of
// MB). We keep the in-memory form as plain Uint8Arrays and serialise to a
// single ArrayBuffer for storage.
//
// Persistence is pluggable via the SnapshotStore interface — there's an
// IndexedDB implementation for the real runtime and an in-memory fallback
// for tests / SSR.

import type { ArmCpu } from '../cpu/ArmCpu'
import type { ArmCoreRegisters } from '../ArmCore'

// Serialised snapshot schema. All multi-byte integers little-endian.
//
//   magic: "DLGE" (4 bytes)
//   version: u16
//   regionCount: u16
//   registers: 17 × u32 (r0..r15, cpsr)
//   for each region:
//     nameLen: u16
//     name: utf-8 bytes
//     base: u32
//     size: u32
//     data: size bytes
const SNAPSHOT_MAGIC = 0x45474c44 // "DLGE" little-endian
const SNAPSHOT_VERSION = 1

export interface RegionSnapshot {
  name: string
  base: number
  data: Uint8Array
}

export interface CpuSnapshot {
  registers: ArmCoreRegisters
  regions: RegionSnapshot[]
}

export interface SnapshotMetadata {
  name: string
  /** Number of bytes in the serialised representation. */
  size: number
  /** Unix milliseconds when saved. */
  timestamp: number
  /** Optional SHA-256 or similar binding the snapshot to a specific ELF. */
  elfHash?: string
}

export interface StoredSnapshot extends SnapshotMetadata {
  data: ArrayBuffer
}

/**
 * Capture the current CPU state into an in-memory snapshot. Each region's
 * bytes are copied (not aliased) so callers can keep running the emulator
 * without tainting the snapshot.
 */
export function captureSnapshot(cpu: ArmCpu): CpuSnapshot {
  const registers = cpu.getRegisters()
  const regions: RegionSnapshot[] = []
  for (const r of cpu.memory.listRegions()) {
    regions.push({
      name: r.perms + '@' + r.start.toString(16),
      base: r.start,
      data: new Uint8Array(r.buffer.subarray(0, r.size)),
    })
  }
  return { registers, regions }
}

/** Write a snapshot back into the CPU. Registers and region bytes both. */
export function restoreSnapshot(cpu: ArmCpu, snap: CpuSnapshot): void {
  cpu.setRegister('r0', snap.registers.r0)
  cpu.setRegister('r1', snap.registers.r1)
  cpu.setRegister('r2', snap.registers.r2)
  cpu.setRegister('r3', snap.registers.r3)
  cpu.setRegister('r4', snap.registers.r4)
  cpu.setRegister('r5', snap.registers.r5)
  cpu.setRegister('r6', snap.registers.r6)
  cpu.setRegister('r7', snap.registers.r7)
  cpu.setRegister('r8', snap.registers.r8)
  cpu.setRegister('r9', snap.registers.r9)
  cpu.setRegister('r10', snap.registers.r10)
  cpu.setRegister('r11', snap.registers.r11)
  cpu.setRegister('r12', snap.registers.r12)
  cpu.setRegister('sp', snap.registers.sp)
  cpu.setRegister('lr', snap.registers.lr)
  cpu.setRegister('pc', snap.registers.pc)
  cpu.setRegister('cpsr', snap.registers.cpsr)
  for (const region of snap.regions) {
    cpu.writeMemory(region.base, region.data)
  }
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

export function serializeSnapshot(snap: CpuSnapshot): ArrayBuffer {
  // Compute total size first.
  const nameBytes: Uint8Array[] = snap.regions.map((r) => encoder.encode(r.name))
  let total = 4 + 2 + 2 + 17 * 4 // magic + version + region count + registers
  for (let i = 0; i < snap.regions.length; i++) {
    total += 2 + nameBytes[i].length + 4 + 4 + snap.regions[i].data.length
  }
  const buf = new ArrayBuffer(total)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  let off = 0
  view.setUint32(off, SNAPSHOT_MAGIC, true); off += 4
  view.setUint16(off, SNAPSHOT_VERSION, true); off += 2
  view.setUint16(off, snap.regions.length, true); off += 2
  const regs = snap.regions.length // placeholder to silence lint
  void regs
  const r = snap.registers
  const regOrder: Array<keyof ArmCoreRegisters> = [
    'r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7',
    'r8', 'r9', 'r10', 'r11', 'r12', 'sp', 'lr', 'pc', 'cpsr',
  ]
  for (const name of regOrder) {
    view.setUint32(off, r[name] >>> 0, true); off += 4
  }
  for (let i = 0; i < snap.regions.length; i++) {
    const region = snap.regions[i]
    const nb = nameBytes[i]
    view.setUint16(off, nb.length, true); off += 2
    bytes.set(nb, off); off += nb.length
    view.setUint32(off, region.base >>> 0, true); off += 4
    view.setUint32(off, region.data.length, true); off += 4
    bytes.set(region.data, off); off += region.data.length
  }
  return buf
}

export function deserializeSnapshot(buf: ArrayBuffer): CpuSnapshot {
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  if (view.getUint32(0, true) !== SNAPSHOT_MAGIC) {
    throw new Error('Not a snapshot (bad magic)')
  }
  const version = view.getUint16(4, true)
  if (version !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported snapshot version: ${version}`)
  }
  const regionCount = view.getUint16(6, true)
  let off = 8
  const regOrder: Array<keyof ArmCoreRegisters> = [
    'r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7',
    'r8', 'r9', 'r10', 'r11', 'r12', 'sp', 'lr', 'pc', 'cpsr',
  ]
  const registers: Partial<ArmCoreRegisters> = {}
  for (const name of regOrder) {
    registers[name] = view.getUint32(off, true) >>> 0
    off += 4
  }
  const regions: RegionSnapshot[] = []
  for (let i = 0; i < regionCount; i++) {
    const nameLen = view.getUint16(off, true); off += 2
    const name = decoder.decode(bytes.subarray(off, off + nameLen)); off += nameLen
    const base = view.getUint32(off, true) >>> 0; off += 4
    const size = view.getUint32(off, true) >>> 0; off += 4
    const data = new Uint8Array(size)
    data.set(bytes.subarray(off, off + size)); off += size
    regions.push({ name, base, data })
  }
  return { registers: registers as ArmCoreRegisters, regions }
}

// ---------------------------------------------------------------------------
// SnapshotStore abstraction
// ---------------------------------------------------------------------------

export interface SnapshotStore {
  save(name: string, data: ArrayBuffer, metadata?: Partial<SnapshotMetadata>): Promise<void>
  load(name: string): Promise<StoredSnapshot | undefined>
  list(): Promise<SnapshotMetadata[]>
  delete(name: string): Promise<void>
}

/** In-memory implementation (tests + SSR fallback). */
export class InMemorySnapshotStore implements SnapshotStore {
  private entries = new Map<string, StoredSnapshot>()

  async save(
    name: string,
    data: ArrayBuffer,
    metadata?: Partial<SnapshotMetadata>,
  ): Promise<void> {
    // Copy the buffer so callers mutating theirs don't corrupt storage.
    const copy = new ArrayBuffer(data.byteLength)
    new Uint8Array(copy).set(new Uint8Array(data))
    this.entries.set(name, {
      name,
      size: data.byteLength,
      timestamp: metadata?.timestamp ?? Date.now(),
      elfHash: metadata?.elfHash,
      data: copy,
    })
  }

  async load(name: string): Promise<StoredSnapshot | undefined> {
    const stored = this.entries.get(name)
    if (!stored) return undefined
    // Clone the data so callers can't mutate our copy
    const copy = new ArrayBuffer(stored.data.byteLength)
    new Uint8Array(copy).set(new Uint8Array(stored.data))
    return { ...stored, data: copy }
  }

  async list(): Promise<SnapshotMetadata[]> {
    const out: SnapshotMetadata[] = []
    for (const e of this.entries.values()) {
      out.push({
        name: e.name,
        size: e.size,
        timestamp: e.timestamp,
        elfHash: e.elfHash,
      })
    }
    out.sort((a, b) => b.timestamp - a.timestamp)
    return out
  }

  async delete(name: string): Promise<void> {
    this.entries.delete(name)
  }

  /** Test-only: how many entries are stored. */
  get count(): number {
    return this.entries.size
  }
}

/**
 * IndexedDB-backed snapshot store. Uses a single object store "snapshots"
 * in the "DelugeEmulator" database, keyed by snapshot name.
 */
export class IndexedDbSnapshotStore implements SnapshotStore {
  private dbPromise: Promise<IDBDatabase> | null = null

  constructor(
    private readonly dbName = 'DelugeEmulator',
    private readonly storeName = 'snapshots',
  ) {}

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'name' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return this.dbPromise
  }

  private txAction<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return this.openDb().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(this.storeName, mode)
          const store = tx.objectStore(this.storeName)
          const req = action(store)
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        }),
    )
  }

  async save(
    name: string,
    data: ArrayBuffer,
    metadata?: Partial<SnapshotMetadata>,
  ): Promise<void> {
    const record: StoredSnapshot = {
      name,
      size: data.byteLength,
      timestamp: metadata?.timestamp ?? Date.now(),
      elfHash: metadata?.elfHash,
      data,
    }
    await this.txAction('readwrite', (store) => store.put(record))
  }

  async load(name: string): Promise<StoredSnapshot | undefined> {
    const result = await this.txAction<StoredSnapshot | undefined>(
      'readonly',
      (store) => store.get(name) as IDBRequest<StoredSnapshot | undefined>,
    )
    return result ?? undefined
  }

  async list(): Promise<SnapshotMetadata[]> {
    const all = await this.txAction<StoredSnapshot[]>('readonly', (store) =>
      store.getAll() as IDBRequest<StoredSnapshot[]>,
    )
    return all
      .map((e) => ({
        name: e.name,
        size: e.size,
        timestamp: e.timestamp,
        elfHash: e.elfHash,
      }))
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  async delete(name: string): Promise<void> {
    await this.txAction('readwrite', (store) => store.delete(name))
  }
}

/**
 * SHA-256 hash of an ELF buffer as a lowercase hex string. Used to key
 * snapshots so they can't be restored against the wrong ELF.
 */
export async function hashElf(buf: ArrayBuffer | Uint8Array): Promise<string> {
  // Pass a TypedArray rather than a bare ArrayBuffer — jsdom's SubtleCrypto
  // polyfill rejects ArrayBuffer instances that don't share its realm, but
  // accepts any TypedArray whose contents it can read. Browsers handle both
  // forms uniformly.
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
