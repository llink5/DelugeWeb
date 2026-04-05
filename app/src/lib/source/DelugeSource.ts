// SysEx-backed preset source.
//
// Wraps the existing MidiConnection singleton so the editor can talk to a
// physically attached Deluge: list folders, read preset XML, write it back.
//
// The MidiConnection handles chunked transfers and retries internally; this
// class adds path conventions (SYNTHS / KITS / SONGS), text encoding, and
// preset-kind detection on top of the raw file API.

import { MidiConnection } from '@/lib/midi/connection'
import {
  detectPresetKind,
  stripXmlExtension,
  type PresetSource,
  type PresetKind,
  type SourceFileEntry,
  type SourcePresetEntry,
} from './PresetSource'

// FAT directory-entry attribute bits.
const ATTR_DIRECTORY = 0x10

/** Map a preset kind to its top-level SD-card folder. */
function folderFor(kind: PresetKind): string {
  if (kind === 'synth') return '/SYNTHS'
  if (kind === 'kit') return '/KITS'
  return '/SONGS'
}

/** Concatenate a folder path and filename with a single separator. */
function joinPath(folder: string, filename: string): string {
  if (folder.endsWith('/')) return folder + filename
  return folder + '/' + filename
}

export class DelugeSource implements PresetSource {
  readonly type = 'deluge' as const

  constructor(private readonly midi: MidiConnection = MidiConnection.getInstance()) {}

  get connected(): boolean {
    return this.midi.isConnected
  }

  // ---------------------------------------------------------------------------
  // PresetSource — folder listing
  // ---------------------------------------------------------------------------

  async listFolder(path: string): Promise<SourceFileEntry[]> {
    const raw = await this.midi.listDir(path)
    const out: SourceFileEntry[] = []
    for (const entry of raw) {
      if (!entry.name || entry.name === '.' || entry.name === '..') continue
      const isDir = ((entry.attr ?? 0) & ATTR_DIRECTORY) !== 0
      out.push({
        name: entry.name,
        path: joinPath(path, entry.name),
        size: entry.size ?? 0,
        isDirectory: isDir,
      })
    }
    // Stable: directories first, then alphabetical by name.
    out.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return out
  }

  async listPresets(kind: PresetKind): Promise<SourcePresetEntry[]> {
    const folder = folderFor(kind)
    let raw: SourceFileEntry[]
    try {
      raw = await this.listFolder(folder)
    } catch {
      return []
    }
    const out: SourcePresetEntry[] = []
    for (const entry of raw) {
      if (entry.isDirectory) continue
      if (!entry.name.toLowerCase().endsWith('.xml')) continue
      out.push({
        name: stripXmlExtension(entry.name),
        path: entry.path,
        type: kind,
        size: entry.size,
      })
    }
    return out
  }

  // ---------------------------------------------------------------------------
  // PresetSource — read / write
  // ---------------------------------------------------------------------------

  async loadXml(path: string): Promise<string> {
    const bytes = await this.midi.readFile(path)
    return new TextDecoder('utf-8').decode(bytes)
  }

  async saveXml(path: string, xml: string): Promise<void> {
    const bytes = new TextEncoder().encode(xml)
    await this.midi.writeFile(path, bytes)
  }

  async saveAs(path: string, xml: string): Promise<void> {
    // The device's `write` verb creates a new file when the path does not
    // exist, so the semantic for saveXml and saveAs is identical here.
    await this.saveXml(path, xml)
  }

  async deleteFile(path: string): Promise<void> {
    await this.midi.deleteItem(path)
  }

  downloadAsFile(filename: string, xml: string): void {
    const blob = new Blob([xml], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename.toLowerCase().endsWith('.xml') ? filename : `${filename}.xml`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // ---------------------------------------------------------------------------
  // Convenience
  // ---------------------------------------------------------------------------

  /**
   * Load a preset XML and return the entry + kind metadata alongside the raw
   * XML text. Useful for folder-tree browsers where the user double-clicks a
   * file — we need both to decide which editor view to open.
   */
  async loadEntry(
    path: string,
  ): Promise<{ entry: SourcePresetEntry; xml: string } | null> {
    const xml = await this.loadXml(path)
    const kind = detectPresetKind(xml)
    if (!kind) return null
    const slash = path.lastIndexOf('/')
    const name = stripXmlExtension(slash >= 0 ? path.substring(slash + 1) : path)
    const size = new Blob([xml]).size
    return {
      entry: { name, path, type: kind, size },
      xml,
    }
  }
}
