// Offline preset source backed by browser file I/O.
//
// The user drags XML files onto the drop zone (or picks them via a file
// chooser); we hold them in an in-memory registry and can serve them back to
// the editor. Saving triggers a download of the edited XML via a temporary
// `<a>` element — the app has no persistent storage by design.

import {
  detectPresetKind,
  stripXmlExtension,
  type PresetSource,
  type PresetKind,
  type SourceFileEntry,
  type SourcePresetEntry,
} from './PresetSource'

interface StoredPreset {
  name: string
  path: string
  kind: PresetKind
  xml: string
  size: number
}

export class LocalSource implements PresetSource {
  readonly type = 'local' as const
  readonly connected = true

  private readonly presets = new Map<string, StoredPreset>()

  // -------------------------------------------------------------------------
  // PresetSource
  // -------------------------------------------------------------------------

  async listFolder(_path: string): Promise<SourceFileEntry[]> {
    // Browsers don't expose a folder abstraction for user files.
    // The caller should use `listPresets()` for in-memory registry access.
    return []
  }

  async listPresets(kind: PresetKind): Promise<SourcePresetEntry[]> {
    const out: SourcePresetEntry[] = []
    for (const p of this.presets.values()) {
      if (p.kind !== kind) continue
      out.push({ name: p.name, path: p.path, type: p.kind, size: p.size })
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }

  async loadXml(path: string): Promise<string> {
    const preset = this.presets.get(path)
    if (!preset) throw new Error(`No preset loaded at path: ${path}`)
    return preset.xml
  }

  async saveXml(path: string, xml: string): Promise<void> {
    const existing = this.presets.get(path)
    if (!existing) throw new Error(`Cannot save: no preset registered at ${path}`)
    const kind = detectPresetKind(xml) ?? existing.kind
    this.presets.set(path, {
      ...existing,
      kind,
      xml,
      size: new Blob([xml]).size,
    })
    // Also push the new XML to the user's disk — local "save" always downloads.
    this.downloadAsFile(this.filenameFor(existing.name), xml)
  }

  async saveAs(path: string, xml: string): Promise<void> {
    const kind = detectPresetKind(xml)
    if (!kind) {
      throw new Error('Cannot save: XML is not a known preset type')
    }
    const name = stripXmlExtension(this.basename(path))
    this.presets.set(path, {
      name,
      path,
      kind,
      xml,
      size: new Blob([xml]).size,
    })
    this.downloadAsFile(this.filenameFor(name), xml)
  }

  async deleteFile(path: string): Promise<void> {
    this.presets.delete(path)
  }

  downloadAsFile(filename: string, xml: string): void {
    const blob = new Blob([xml], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = this.ensureXmlSuffix(filename)
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    // Revoke asynchronously so the download has a chance to start
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // -------------------------------------------------------------------------
  // LocalSource-specific API
  // -------------------------------------------------------------------------

  /**
   * Register an already-read XML string in the in-memory registry.
   * Returns the entry so callers can immediately pass the path back in to
   * `loadXml()`.
   */
  registerXml(filename: string, xml: string): SourcePresetEntry {
    const kind = detectPresetKind(xml)
    if (!kind) {
      throw new Error(`File "${filename}" is not a recognized Deluge preset`)
    }
    const name = stripXmlExtension(this.basename(filename))
    const path = this.uniquePathFor(filename)
    this.presets.set(path, {
      name,
      path,
      kind,
      xml,
      size: new Blob([xml]).size,
    })
    return { name, path, type: kind, size: new Blob([xml]).size }
  }

  /**
   * Read a `File` from the browser (e.g. from a drop event) and register it.
   */
  async loadFromFile(file: File): Promise<{ entry: SourcePresetEntry; xml: string }> {
    const xml = await file.text()
    const entry = this.registerXml(file.name, xml)
    return { entry, xml }
  }

  /** Remove a preset from the registry without downloading anything. */
  unregister(path: string): void {
    this.presets.delete(path)
  }

  /** Empty the in-memory registry. */
  clear(): void {
    this.presets.clear()
  }

  /** Number of presets currently held in memory. */
  get size(): number {
    return this.presets.size
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private basename(path: string): string {
    const slash = path.lastIndexOf('/')
    return slash >= 0 ? path.substring(slash + 1) : path
  }

  private filenameFor(name: string): string {
    return this.ensureXmlSuffix(name)
  }

  private ensureXmlSuffix(name: string): string {
    return name.toLowerCase().endsWith('.xml') ? name : `${name}.xml`
  }

  private uniquePathFor(filename: string): string {
    const base = this.basename(filename)
    if (!this.presets.has(base)) return base
    let i = 2
    while (this.presets.has(`${base} (${i})`)) i++
    return `${base} (${i})`
  }
}
