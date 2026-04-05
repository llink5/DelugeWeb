// Build a FAT32 filesystem image entirely in memory.
//
// The returned Uint8Array is a complete disk image (boot sector, FSInfo,
// two FAT copies, data area) that can be served to emulated firmware
// reading 512-byte sectors through FatFS.
//
// Supported: short 8.3 uppercase file names, arbitrary directory depth,
// files spanning any number of clusters. Not supported: long file names,
// fragmentation-sensitive allocation, timestamps other than the fixed
// epoch written into every entry.

const SECTOR_SIZE = 512
const DIR_ENTRY_SIZE = 32
const FAT_ENTRY_SIZE = 4
const NUM_FATS = 2
const RESERVED_SECTORS = 32
const ROOT_CLUSTER = 2
const EOC = 0x0fffffff
const MEDIA_DESCRIPTOR = 0xf8
const ATTR_DIR = 0x10
const ATTR_FILE = 0x20
const MAX_DIR_ENTRIES = 65535

// Fixed DOS timestamp used for every entry (2024-01-01 00:00:00).
const FIXED_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1
const FIXED_TIME = 0

export interface Fat32Entry {
  /** Absolute path starting with /, e.g. "/SYNTHS/DEFAULT.XML". */
  path: string
  /** File contents, or undefined for directory-only entries. */
  content?: Uint8Array
}

export interface Fat32BuilderOptions {
  /** Image size in MiB. Default 64. Minimum 33. */
  sizeMiB?: number
  /** Volume label (max 11 chars, ASCII). Default "DELUGE". */
  label?: string
}

interface DirNode {
  /** 8.3 short name, empty string for the root. */
  shortName: string
  /** Uppercase original name segments for child lookup. */
  childName: string
  children: Map<string, DirNode>
  isFile: boolean
  content?: Uint8Array
  /** Cluster assigned during layout. 0 = unassigned. */
  cluster: number
  parent: DirNode | null
}

/**
 * Build a FAT32 filesystem image populated with the given entries.
 * Directories are auto-created from the paths of their children.
 *
 * Throws if: any file is too big to fit, more than 65,535 entries per
 * directory, path contains characters invalid in 8.3 short names.
 */
export function buildFat32Image(
  entries: Fat32Entry[],
  options: Fat32BuilderOptions = {},
): Uint8Array {
  const sizeMiB = options.sizeMiB ?? 64
  if (sizeMiB < 33) throw new Error('Fat32Builder: sizeMiB must be at least 33')
  const label = formatVolumeLabel(options.label ?? 'DELUGE')

  const totalSectors = sizeMiB * 1024 * 1024 / SECTOR_SIZE
  const sectorsPerCluster = pickSectorsPerCluster(sizeMiB)
  const clusterBytes = sectorsPerCluster * SECTOR_SIZE

  // Iteratively size the FAT: more data clusters → larger FAT → fewer
  // data clusters. Converge by recomputing until stable.
  let sectorsPerFat = 1
  for (let i = 0; i < 8; i++) {
    const dataSectors = totalSectors - RESERVED_SECTORS - NUM_FATS * sectorsPerFat
    const dataClusters = Math.floor(dataSectors / sectorsPerCluster)
    const fatEntries = dataClusters + 2
    const next = Math.ceil(fatEntries * FAT_ENTRY_SIZE / SECTOR_SIZE)
    if (next === sectorsPerFat) break
    sectorsPerFat = next
  }
  const dataStartSector = RESERVED_SECTORS + NUM_FATS * sectorsPerFat
  const totalDataClusters = Math.floor((totalSectors - dataStartSector) / sectorsPerCluster)

  const image = new Uint8Array(totalSectors * SECTOR_SIZE)

  // Build directory tree from paths, then lay out clusters.
  const root = makeRoot()
  for (const entry of entries) insertEntry(root, entry)

  const clusterChains: number[][] = []
  assignClusters(root, clusterChains, clusterBytes, totalDataClusters)

  writeBootSector(image, {
    sectorsPerCluster,
    sectorsPerFat,
    totalSectors,
    label,
  })
  writeFsInfo(image)
  writeBackupBootSector(image, {
    sectorsPerCluster,
    sectorsPerFat,
    totalSectors,
    label,
  })
  writeFats(image, clusterChains, sectorsPerFat)
  writeDataArea(image, root, dataStartSector, sectorsPerCluster, label)

  return image
}

// ---------------------------------------------------------------------------
// Cluster sizing
// ---------------------------------------------------------------------------

function pickSectorsPerCluster(sizeMiB: number): number {
  if (sizeMiB <= 64) return 8 // 4 KiB
  if (sizeMiB <= 128) return 16 // 8 KiB
  if (sizeMiB <= 256) return 32 // 16 KiB
  return 64 // 32 KiB
}

// ---------------------------------------------------------------------------
// Tree construction
// ---------------------------------------------------------------------------

function makeRoot(): DirNode {
  return {
    shortName: '',
    childName: '',
    children: new Map(),
    isFile: false,
    cluster: 0,
    parent: null,
  }
}

function insertEntry(root: DirNode, entry: Fat32Entry): void {
  if (!entry.path.startsWith('/')) {
    throw new Error(`Fat32Builder: path must start with /: ${entry.path}`)
  }
  const parts = entry.path.split('/').filter((p) => p.length > 0)
  if (parts.length === 0) return
  let dir = root
  for (let i = 0; i < parts.length - 1; i++) {
    dir = ensureChild(dir, parts[i], false)
  }
  const leafName = parts[parts.length - 1]
  const isFile = entry.content !== undefined
  const leaf = ensureChild(dir, leafName, isFile)
  if (isFile) leaf.content = entry.content
}

function ensureChild(dir: DirNode, name: string, isFile: boolean): DirNode {
  const key = name.toUpperCase()
  const existing = dir.children.get(key)
  if (existing) return existing
  const node: DirNode = {
    shortName: toShortName(name),
    childName: key,
    children: new Map(),
    isFile,
    cluster: 0,
    parent: dir,
  }
  dir.children.set(key, node)
  return node
}

// ---------------------------------------------------------------------------
// 8.3 name conversion
// ---------------------------------------------------------------------------

function toShortName(name: string): string {
  const upper = name.toUpperCase()
  const dot = upper.lastIndexOf('.')
  const base = dot === -1 ? upper : upper.slice(0, dot)
  const ext = dot === -1 ? '' : upper.slice(dot + 1)
  if (base.length === 0 || base.length > 8) {
    throw new Error(`Fat32Builder: name does not fit 8.3: ${name}`)
  }
  if (ext.length > 3) {
    throw new Error(`Fat32Builder: extension too long for 8.3: ${name}`)
  }
  validate83Chars(base, name)
  validate83Chars(ext, name)
  return base.padEnd(8, ' ') + ext.padEnd(3, ' ')
}

function validate83Chars(part: string, fullName: string): void {
  for (let i = 0; i < part.length; i++) {
    const code = part.charCodeAt(i)
    const c = part[i]
    const ok =
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      c === '_' ||
      c === '-' ||
      c === '$' ||
      c === '~' ||
      c === '!' ||
      c === '#' ||
      c === '%' ||
      c === '&' ||
      c === '(' ||
      c === ')' ||
      c === '@' ||
      c === "'" ||
      c === '^' ||
      c === '{' ||
      c === '}'
    if (!ok) {
      throw new Error(`Fat32Builder: invalid 8.3 character in ${fullName}`)
    }
  }
}

function formatVolumeLabel(label: string): string {
  const upper = label.toUpperCase().slice(0, 11)
  for (let i = 0; i < upper.length; i++) {
    if (upper.charCodeAt(i) > 0x7e || upper.charCodeAt(i) < 0x20) {
      throw new Error('Fat32Builder: volume label must be printable ASCII')
    }
  }
  return upper.padEnd(11, ' ')
}

// ---------------------------------------------------------------------------
// Cluster allocation
// ---------------------------------------------------------------------------

function assignClusters(
  root: DirNode,
  chains: number[][],
  clusterBytes: number,
  totalDataClusters: number,
): void {
  // Cluster 2 is reserved for the root directory; it always gets a single
  // cluster regardless of entry count (grow logic below if needed).
  let next = ROOT_CLUSTER
  const allocChain = (clustersNeeded: number): number[] => {
    const chain: number[] = []
    for (let i = 0; i < clustersNeeded; i++) {
      chain.push(next++)
    }
    return chain
  }

  // First: allocate root cluster chain.
  const rootEntryCount = root.children.size + 1 // +1 for volume label entry
  const rootClusters = Math.max(1, Math.ceil((rootEntryCount * DIR_ENTRY_SIZE) / clusterBytes))
  if (rootEntryCount - 1 > MAX_DIR_ENTRIES) {
    throw new Error('Fat32Builder: root directory exceeds 65535 entries')
  }
  const rootChain = allocChain(rootClusters)
  root.cluster = rootChain[0]
  chains.push(rootChain)

  // Then walk the tree depth-first to assign clusters to everything else.
  const walk = (dir: DirNode): void => {
    for (const child of dir.children.values()) {
      if (child.isFile) {
        const size = child.content!.length
        const n = size === 0 ? 0 : Math.ceil(size / clusterBytes)
        if (n === 0) {
          child.cluster = 0
          continue
        }
        const chain = allocChain(n)
        child.cluster = chain[0]
        chains.push(chain)
      } else {
        const entryCount = child.children.size + 2 // "." and ".."
        if (entryCount - 2 > MAX_DIR_ENTRIES) {
          throw new Error(`Fat32Builder: directory ${child.childName} exceeds 65535 entries`)
        }
        const n = Math.max(1, Math.ceil((entryCount * DIR_ENTRY_SIZE) / clusterBytes))
        const chain = allocChain(n)
        child.cluster = chain[0]
        chains.push(chain)
        walk(child)
      }
    }
  }
  walk(root)

  const used = next - ROOT_CLUSTER
  if (used > totalDataClusters) {
    throw new Error('Fat32Builder: content does not fit in image')
  }
}

// ---------------------------------------------------------------------------
// Boot sector / FSInfo
// ---------------------------------------------------------------------------

interface BpbParams {
  sectorsPerCluster: number
  sectorsPerFat: number
  totalSectors: number
  label: string
}

function writeBootSector(image: Uint8Array, p: BpbParams): void {
  writeBpbAt(image, 0, p)
}

function writeBackupBootSector(image: Uint8Array, p: BpbParams): void {
  writeBpbAt(image, 6 * SECTOR_SIZE, p)
}

function writeBpbAt(image: Uint8Array, offset: number, p: BpbParams): void {
  const view = new DataView(image.buffer, image.byteOffset + offset, SECTOR_SIZE)
  image[offset + 0] = 0xeb
  image[offset + 1] = 0x3c
  image[offset + 2] = 0x90
  writeAscii(image, offset + 3, 'MSDOS5.0', 8)
  view.setUint16(11, SECTOR_SIZE, true)
  image[offset + 13] = p.sectorsPerCluster
  view.setUint16(14, RESERVED_SECTORS, true)
  image[offset + 16] = NUM_FATS
  view.setUint16(17, 0, true)
  view.setUint16(19, 0, true)
  image[offset + 21] = MEDIA_DESCRIPTOR
  view.setUint16(22, 0, true)
  view.setUint16(24, 63, true)
  view.setUint16(26, 255, true)
  view.setUint32(28, 0, true)
  view.setUint32(32, p.totalSectors >>> 0, true)
  view.setUint32(36, p.sectorsPerFat >>> 0, true)
  view.setUint16(40, 0, true)
  view.setUint16(42, 0, true)
  view.setUint32(44, ROOT_CLUSTER, true)
  view.setUint16(48, 1, true)
  view.setUint16(50, 6, true)
  for (let i = 52; i < 64; i++) image[offset + i] = 0
  image[offset + 64] = 0x80
  image[offset + 65] = 0
  image[offset + 66] = 0x29
  view.setUint32(67, 0x12345678, true)
  writeAscii(image, offset + 71, p.label, 11)
  writeAscii(image, offset + 82, 'FAT32   ', 8)
  image[offset + 510] = 0x55
  image[offset + 511] = 0xaa
}

function writeFsInfo(image: Uint8Array): void {
  const offset = SECTOR_SIZE
  const view = new DataView(image.buffer, image.byteOffset + offset, SECTOR_SIZE)
  view.setUint32(0, 0x41615252, true)
  view.setUint32(484, 0x61417272, true)
  view.setUint32(488, 0xffffffff, true)
  view.setUint32(492, 0xffffffff, true)
  image[offset + 510] = 0x55
  image[offset + 511] = 0xaa
}

// ---------------------------------------------------------------------------
// FAT tables
// ---------------------------------------------------------------------------

function writeFats(image: Uint8Array, chains: number[][], sectorsPerFat: number): void {
  const fat0 = RESERVED_SECTORS * SECTOR_SIZE
  const fat1 = fat0 + sectorsPerFat * SECTOR_SIZE
  const writeEntry = (offset: number, idx: number, value: number): void => {
    const view = new DataView(image.buffer, image.byteOffset + offset + idx * FAT_ENTRY_SIZE, 4)
    view.setUint32(0, value >>> 0, true)
  }
  const writeAll = (base: number): void => {
    writeEntry(base, 0, 0x0ffffff8)
    writeEntry(base, 1, 0x0fffffff)
    for (const chain of chains) {
      for (let i = 0; i < chain.length; i++) {
        const here = chain[i]
        const next = i < chain.length - 1 ? chain[i + 1] : EOC
        writeEntry(base, here, next)
      }
    }
  }
  writeAll(fat0)
  writeAll(fat1)
}

// ---------------------------------------------------------------------------
// Data area
// ---------------------------------------------------------------------------

function writeDataArea(
  image: Uint8Array,
  root: DirNode,
  dataStartSector: number,
  sectorsPerCluster: number,
  label: string,
): void {
  const clusterBytes = sectorsPerCluster * SECTOR_SIZE
  const clusterOffset = (cluster: number): number =>
    (dataStartSector + (cluster - ROOT_CLUSTER) * sectorsPerCluster) * SECTOR_SIZE

  const writeDirectory = (dir: DirNode, isRoot: boolean): void => {
    const baseCluster = dir.cluster
    const entries: Uint8Array[] = []
    if (isRoot) {
      entries.push(makeVolumeLabelEntry(label))
    } else {
      entries.push(makeDotEntry('.', dir.cluster))
      const parentCluster = dir.parent && dir.parent.cluster !== root.cluster ? dir.parent.cluster : 0
      entries.push(makeDotEntry('..', parentCluster))
    }
    for (const child of dir.children.values()) {
      entries.push(makeChildEntry(child))
    }
    let cluster = baseCluster
    let offset = clusterOffset(cluster)
    let written = 0
    for (const e of entries) {
      if (written + DIR_ENTRY_SIZE > clusterBytes) {
        cluster++
        offset = clusterOffset(cluster)
        written = 0
      }
      image.set(e, offset + written)
      written += DIR_ENTRY_SIZE
    }
    for (const child of dir.children.values()) {
      if (child.isFile) {
        if (child.cluster !== 0 && child.content) {
          image.set(child.content, clusterOffset(child.cluster))
        }
      } else {
        writeDirectory(child, false)
      }
    }
  }
  writeDirectory(root, true)
}

function makeChildEntry(node: DirNode): Uint8Array {
  const attr = node.isFile ? ATTR_FILE : ATTR_DIR
  const size = node.isFile ? (node.content?.length ?? 0) : 0
  return makeDirEntry(node.shortName, attr, node.cluster, size)
}

function makeDotEntry(name: '.' | '..', cluster: number): Uint8Array {
  const padded = name.padEnd(11, ' ')
  return makeDirEntry(padded, ATTR_DIR, cluster, 0)
}

function makeVolumeLabelEntry(label: string): Uint8Array {
  return makeDirEntry(label, 0x08, 0, 0)
}

function makeDirEntry(
  name11: string,
  attr: number,
  cluster: number,
  size: number,
): Uint8Array {
  const buf = new Uint8Array(DIR_ENTRY_SIZE)
  const view = new DataView(buf.buffer)
  for (let i = 0; i < 11; i++) buf[i] = name11.charCodeAt(i)
  buf[11] = attr
  buf[12] = 0
  buf[13] = 0
  view.setUint16(14, FIXED_TIME, true)
  view.setUint16(16, FIXED_DATE, true)
  view.setUint16(18, FIXED_DATE, true)
  view.setUint16(20, (cluster >>> 16) & 0xffff, true)
  view.setUint16(22, FIXED_TIME, true)
  view.setUint16(24, FIXED_DATE, true)
  view.setUint16(26, cluster & 0xffff, true)
  view.setUint32(28, size >>> 0, true)
  return buf
}

function writeAscii(image: Uint8Array, offset: number, text: string, length: number): void {
  for (let i = 0; i < length; i++) {
    image[offset + i] = i < text.length ? text.charCodeAt(i) : 0x20
  }
}
