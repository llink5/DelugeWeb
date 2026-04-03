// Preset Manager — Pure logic service (no Vue dependency)

import { midi } from '@/lib/midi'
import { parsePreset, serializePreset } from '@/lib/xml'
import { diff } from 'deep-diff'
import type { Preset, PresetEntry, PresetDiffEntry, PresetType, DirEntry } from '@/lib/types'

/** Root directories on the Deluge SD card for each preset type. */
const DIRS: Record<PresetType, string> = {
  SYNTHS: '/SYNTHS',
  KITS: '/KITS',
  SONGS: '/SONGS',
}

// ---------------------------------------------------------------------------
// Recursive directory walk
// ---------------------------------------------------------------------------

async function walkDir(basePath: string, entries: PresetEntry[]): Promise<void> {
  const listing: DirEntry[] = await midi.listDir(basePath)

  for (const entry of listing) {
    const fullPath = basePath.endsWith('/')
      ? basePath + entry.name
      : basePath + '/' + entry.name

    // Attribute bit 4 (0x10) indicates a directory in FAT32
    const isDir = entry.attr !== undefined && (Number(entry.attr) & 0x10) !== 0

    if (isDir) {
      await walkDir(fullPath, entries)
    } else if (entry.name.toLowerCase().endsWith('.xml')) {
      let date: Date | undefined
      if (entry.date !== undefined && entry.time !== undefined) {
        const fdate = Number(entry.date)
        const ftime = Number(entry.time)
        // Re-use the MidiConnection static helper via the class import
        const { MidiConnection } = await import('@/lib/midi')
        date = MidiConnection.fdatetime2Date(fdate, ftime)
      }

      entries.push({
        path: fullPath,
        name: entry.name,
        size: entry.size !== undefined ? Number(entry.size) : undefined,
        date,
        isDir: false,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Recursively scan the SD card directory for the given preset type and
 * return all .xml file entries found.
 */
export async function scanPresets(type: PresetType): Promise<PresetEntry[]> {
  const root = DIRS[type]
  const entries: PresetEntry[] = []
  await walkDir(root, entries)
  // Sort alphabetically by path
  entries.sort((a, b) => a.path.localeCompare(b.path))
  return entries
}

/**
 * Read and parse a preset file from the Deluge SD card.
 */
export async function loadPreset(
  path: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Preset> {
  const raw = await midi.readFile(path, onProgress)
  const xmlText = new TextDecoder().decode(raw)
  const { rootName, data } = parsePreset(xmlText)
  const typeMap: Record<string, string> = { sound: 'sound', kit: 'kit', song: 'song' }
  return { ...data, _type: typeMap[rootName] ?? 'song' } as unknown as Preset
}

/**
 * Serialize a preset and write it back to the Deluge SD card.
 */
export async function savePreset(
  path: string,
  preset: Preset,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const rootName = preset._type === 'sound' ? 'sound' : preset._type === 'kit' ? 'kit' : 'song'
  const { _type, ...data } = preset as unknown as Record<string, unknown>
  const xmlText = serializePreset(rootName, data)
  const encoded = new TextEncoder().encode(xmlText)
  await midi.writeFile(path, encoded, onProgress)
}

/**
 * Compute a flat list of differences between two presets using deep-diff.
 * Each entry contains the dotted path, the change kind, and old/new values.
 */
export function diffPresets(a: Preset, b: Preset): PresetDiffEntry[] {
  const diffs = diff(a, b)
  if (!diffs) return []

  return diffs.map((d) => {
    // Build a dotted path string from the diff descriptor
    const pathParts: string[] = []
    if (d.path) {
      for (const seg of d.path) {
        pathParts.push(String(seg))
      }
    }
    // For array changes, append the index
    if (d.kind === 'A' && d.index !== undefined) {
      pathParts.push(`[${d.index}]`)
    }

    const entry: PresetDiffEntry = {
      path: pathParts.join('.'),
      kind: d.kind as PresetDiffEntry['kind'],
    }

    switch (d.kind) {
      case 'E': // edited
        entry.oldVal = d.lhs
        entry.newVal = d.rhs
        break
      case 'N': // new (added in RHS)
        entry.newVal = d.rhs
        break
      case 'D': // deleted (present in LHS only)
        entry.oldVal = d.lhs
        break
      case 'A': // array change
        if (d.item) {
          entry.oldVal = (d.item as any).lhs
          entry.newVal = (d.item as any).rhs
        }
        break
    }

    return entry
  })
}
