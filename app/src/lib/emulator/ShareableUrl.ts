// Shareable emulator configuration URLs.
//
// Encodes a minimal debugging session (ELF source, breakpoints, watches,
// optional autostart) into the URL hash so users can share a link that
// reproduces their setup.
//
// Hash format (URL-safe query-string style after the "#/..."):
//   #/emulator?elf=<url>&bp=<sym1,sym2,0xADDR>&watch=<sym,...>&start=1
//
// We deliberately keep the format human-readable instead of base64'ing a
// JSON blob — developers are the audience, and the URL often ends up in a
// chat message or bug tracker.

export interface EmulatorConfig {
  /** URL or local path to the ELF to load. */
  elf?: string
  /** Breakpoints to install on boot (symbol names or "0xADDR"). */
  breakpoints: string[]
  /** Watches to add on boot. */
  watches: string[]
  /** Autostart after ELF loads. */
  start: boolean
  /** Anchor disassembly at this address (symbol name or hex). */
  at?: string
}

export const EMPTY_CONFIG: EmulatorConfig = {
  breakpoints: [],
  watches: [],
  start: false,
}

/** Parse a list separated by commas, trimming whitespace and dropping empties. */
function parseList(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Re-encode a list for the URL. */
function encodeList(items: string[]): string {
  return items.map((s) => encodeURIComponent(s)).join(',')
}

/**
 * Parse the full hash string (typically `window.location.hash`) into an
 * EmulatorConfig. Handles both `#/emulator?...` and a bare `?...`.
 */
export function parseUrlHash(hash: string): EmulatorConfig {
  if (!hash) return { ...EMPTY_CONFIG }
  // Strip leading '#' and any path prefix up to '?'
  let q = hash
  if (q.startsWith('#')) q = q.slice(1)
  const queryAt = q.indexOf('?')
  if (queryAt >= 0) q = q.slice(queryAt + 1)
  const params = new URLSearchParams(q)

  const startParam = params.get('start')
  return {
    elf: params.get('elf') ?? undefined,
    breakpoints: parseList(params.get('bp')),
    watches: parseList(params.get('watch')),
    start: startParam === '1' || startParam === 'true',
    at: params.get('at') ?? undefined,
  }
}

/**
 * Serialize a config back to a URL-hash query string (without the leading
 * '?'). Empty fields are omitted so the URL stays short.
 */
export function configToQuery(config: EmulatorConfig): string {
  const parts: string[] = []
  if (config.elf) parts.push('elf=' + encodeURIComponent(config.elf))
  if (config.breakpoints.length > 0)
    parts.push('bp=' + encodeList(config.breakpoints))
  if (config.watches.length > 0)
    parts.push('watch=' + encodeList(config.watches))
  if (config.start) parts.push('start=1')
  if (config.at) parts.push('at=' + encodeURIComponent(config.at))
  return parts.join('&')
}

/**
 * Build a full shareable URL given a base URL and the config. Assumes the
 * app uses hash-based routing (#/emulator).
 */
export function buildShareableUrl(
  base: string,
  config: EmulatorConfig,
): string {
  const query = configToQuery(config)
  const suffix = query ? '#/emulator?' + query : '#/emulator'
  // Strip any trailing slash or hash from base
  const cleanBase = base.replace(/[#?].*$/, '').replace(/\/$/, '')
  return cleanBase + '/' + suffix
}

/**
 * Round-trip check: parse a URL, re-encode it, and compare. Useful for
 * tests and as a sanity validator before pushing a shared URL.
 */
export function normalize(config: EmulatorConfig): EmulatorConfig {
  return parseUrlHash('?' + configToQuery(config))
}
