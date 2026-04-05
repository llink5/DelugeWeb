// ELF source loaders.
//
// Three ways to get an ELF binary into the emulator:
//   1. Local file picker    — user drops a file into the UI
//   2. Arbitrary URL         — fetch() the binary directly
//   3. GitHub release asset  — convenience URL builder for a repo
//
// Each returns an ArrayBuffer the worker's `loadElf` handler consumes.

export type ElfSourceKind = 'file' | 'url' | 'github-release'

export interface ElfSourceDescriptor {
  kind: ElfSourceKind
  label: string
  detail: string
}

/**
 * Read a File picked by the user and return its bytes.
 */
export async function loadElfFromFile(file: File): Promise<{
  buffer: ArrayBuffer
  descriptor: ElfSourceDescriptor
}> {
  const buffer = await file.arrayBuffer()
  return {
    buffer,
    descriptor: {
      kind: 'file',
      label: file.name,
      detail: `${file.size.toLocaleString()} bytes`,
    },
  }
}

/**
 * Fetch an ELF from an HTTP(S) URL. The target must allow CORS or be
 * same-origin. Returns an ArrayBuffer plus a descriptor for the UI.
 */
export async function loadElfFromUrl(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ buffer: ArrayBuffer; descriptor: ElfSourceDescriptor }> {
  const response = await fetchFn(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`)
  }
  const buffer = await response.arrayBuffer()
  return {
    buffer,
    descriptor: {
      kind: 'url',
      label: displayNameForUrl(url),
      detail: `${buffer.byteLength.toLocaleString()} bytes`,
    },
  }
}

/**
 * Build the direct-download URL for a GitHub Release asset.
 *
 *   `owner/repo@tag/asset.elf`
 *   → https://github.com/owner/repo/releases/download/tag/asset.elf
 */
export function buildGithubReleaseUrl(
  owner: string,
  repo: string,
  tag: string,
  asset: string,
): string {
  const enc = (s: string) => encodeURIComponent(s)
  return `https://github.com/${enc(owner)}/${enc(repo)}/releases/download/${enc(tag)}/${enc(asset)}`
}

/**
 * Parse a short-form spec into its parts:
 *   `owner/repo@tag/asset.elf` → { owner, repo, tag, asset }
 */
export function parseGithubReleaseSpec(spec: string): {
  owner: string
  repo: string
  tag: string
  asset: string
} | null {
  // Pattern: <owner>/<repo>@<tag>/<asset>
  const m = spec.match(/^([^/@\s]+)\/([^/@\s]+)@([^/\s]+)\/(.+)$/)
  if (!m) return null
  return { owner: m[1], repo: m[2], tag: m[3], asset: m[4] }
}

/**
 * Convenience: take a short-form spec and fetch the ELF directly.
 */
export async function loadElfFromGithubRelease(
  spec: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ buffer: ArrayBuffer; descriptor: ElfSourceDescriptor }> {
  const parsed = parseGithubReleaseSpec(spec)
  if (!parsed) {
    throw new Error(
      `Invalid GitHub release spec: "${spec}" (expected owner/repo@tag/asset)`,
    )
  }
  const url = buildGithubReleaseUrl(
    parsed.owner,
    parsed.repo,
    parsed.tag,
    parsed.asset,
  )
  const { buffer } = await loadElfFromUrl(url, fetchFn)
  return {
    buffer,
    descriptor: {
      kind: 'github-release',
      label: `${parsed.owner}/${parsed.repo}@${parsed.tag}`,
      detail: `${parsed.asset} · ${buffer.byteLength.toLocaleString()} bytes`,
    },
  }
}

/** Extract a displayable filename from a URL (last path segment). */
function displayNameForUrl(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop() ?? u.host
    return last
  } catch {
    return url
  }
}
