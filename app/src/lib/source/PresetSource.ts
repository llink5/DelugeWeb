// Preset source abstraction.
//
// The editor has to work against two very different storage backends:
//   - `DelugeSource`: the physical device reached over USB MIDI SysEx
//   - `LocalSource`: browser file I/O for offline editing
//
// Callers (editor views, batch-ops tooling) depend only on this interface,
// so they never have to care which backend is active.

export type SourceType = 'deluge' | 'local'
export type PresetKind = 'synth' | 'kit' | 'song'

export interface SourceFileEntry {
  name: string
  path: string
  size: number
  isDirectory: boolean
}

export interface SourcePresetEntry {
  /** Display name, read from the XML `name` attribute or filename stem. */
  name: string
  /** Full path on SD card, or identifier for local blobs. */
  path: string
  type: PresetKind
  size: number
}

export interface PresetSource {
  readonly type: SourceType
  readonly connected: boolean

  /** List the contents of a folder. Returns `[]` for unsupported paths. */
  listFolder(path: string): Promise<SourceFileEntry[]>

  /** List all presets of the given kind. */
  listPresets(kind: PresetKind): Promise<SourcePresetEntry[]>

  /** Load raw XML for a preset path. */
  loadXml(path: string): Promise<string>

  /** Overwrite an existing preset at the given path. */
  saveXml(path: string, xml: string): Promise<void>

  /** Save to a new path, leaving the original untouched. */
  saveAs(path: string, xml: string): Promise<void>

  /** Delete a preset. Optional — not all backends support this. */
  deleteFile(path: string): Promise<void>

  /** Trigger a browser download of the given XML content. */
  downloadAsFile(filename: string, xml: string): void
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Inspect an XML string and determine which preset kind it describes.
 * Returns null if the root element isn't a known preset type.
 */
export function detectPresetKind(xml: string): PresetKind | null {
  // Cheap regex-based root detection avoids a full DOM parse just for typing.
  // We only care about the first opening element after the XML declaration.
  const match = xml.match(/<\s*(sound|kit|song)(\s|>|\/)/i)
  if (!match) return null
  const tag = match[1].toLowerCase()
  if (tag === 'sound') return 'synth'
  if (tag === 'kit') return 'kit'
  if (tag === 'song') return 'song'
  return null
}

/**
 * Strip an `.xml` / `.XML` suffix from a filename to produce a display name.
 */
export function stripXmlExtension(filename: string): string {
  return filename.replace(/\.xml$/i, '')
}
