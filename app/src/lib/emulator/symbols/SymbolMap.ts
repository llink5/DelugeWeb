// Symbol index for the loaded ELF.
//
// Given the flat symbol list the ELF loader returns, SymbolMap builds two
// indices:
//   - `byName`  : O(1) lookup of a symbol by its (C++-mangled) name
//   - `sorted`  : function symbols sorted by address, binary-searched to
//                 resolve "what function contains address X?"
//
// Substring search over every symbol is exposed for the UI's symbol browser.

import type { ElfSymbol } from '../ElfLoader'

// Symbol type bits (STT_*) from ELF
const STT_NOTYPE = 0
const STT_OBJECT = 1
const STT_FUNC = 2

export interface SymbolHit {
  name: string
  address: number
  size: number
  type: 'func' | 'object' | 'other'
}

export interface ResolvedAddress {
  symbol: SymbolHit
  offset: number // bytes into the symbol
}

function symbolTypeLabel(t: number): SymbolHit['type'] {
  if (t === STT_FUNC) return 'func'
  if (t === STT_OBJECT) return 'object'
  return 'other'
}

export class SymbolMap {
  private byName = new Map<string, SymbolHit>()
  private sorted: SymbolHit[] = []

  constructor(symbols: Iterable<ElfSymbol> = []) {
    for (const s of symbols) this.add(s)
    this.sortIndex()
  }

  /** Insert a new symbol. Silent no-op for empty names or duplicates. */
  add(s: ElfSymbol): void {
    if (!s.name || this.byName.has(s.name)) return
    const hit: SymbolHit = {
      name: s.name,
      address: s.address >>> 0,
      size: s.size,
      type: symbolTypeLabel(s.type),
    }
    this.byName.set(s.name, hit)
    // Keep the sorted array in sync lazily — consumers call sortIndex() once
    // after the bulk load is complete.
    this.sorted.push(hit)
  }

  /** Sort the address-indexed table. Called automatically from the ctor. */
  sortIndex(): void {
    this.sorted.sort((a, b) => a.address - b.address)
  }

  /** Total symbol count. */
  get size(): number {
    return this.byName.size
  }

  /** Exact-name lookup. */
  lookup(name: string): SymbolHit | undefined {
    return this.byName.get(name)
  }

  /**
   * Resolve an address back to the symbol that contains it. When multiple
   * symbols share an address the first (lowest in sort order) wins.
   */
  resolve(address: number): ResolvedAddress | undefined {
    const addr = address >>> 0
    // Binary search for the last symbol with address <= addr.
    let lo = 0
    let hi = this.sorted.length - 1
    let best = -1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      if (this.sorted[mid].address <= addr) {
        best = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    if (best < 0) return undefined
    const symbol = this.sorted[best]
    const offset = addr - symbol.address
    if (symbol.size > 0 && offset >= symbol.size) return undefined
    return { symbol, offset }
  }

  /**
   * Substring search. Returns up to `max` matching symbols, ranked by whether
   * the query matches the start of the name (higher priority) before other
   * matches.
   */
  search(query: string, max = 100, typeFilter?: SymbolHit['type']): SymbolHit[] {
    if (!query) {
      const out: SymbolHit[] = []
      for (const s of this.sorted) {
        if (typeFilter && s.type !== typeFilter) continue
        out.push(s)
        if (out.length >= max) break
      }
      return out
    }
    const q = query.toLowerCase()
    const prefix: SymbolHit[] = []
    const substring: SymbolHit[] = []
    for (const s of this.sorted) {
      if (typeFilter && s.type !== typeFilter) continue
      const n = s.name.toLowerCase()
      const idx = n.indexOf(q)
      if (idx === 0) prefix.push(s)
      else if (idx > 0) substring.push(s)
      if (prefix.length + substring.length >= max * 2) break
    }
    return prefix.concat(substring).slice(0, max)
  }

  /** All symbols of a given type. */
  ofType(type: SymbolHit['type']): SymbolHit[] {
    return this.sorted.filter((s) => s.type === type)
  }

  /** Format an address as "name + offset" or the raw hex if unresolved. */
  formatAddress(address: number): string {
    const r = this.resolve(address)
    if (!r) return '0x' + (address >>> 0).toString(16).padStart(8, '0').toUpperCase()
    if (r.offset === 0) return r.symbol.name
    return `${r.symbol.name}+0x${r.offset.toString(16)}`
  }
}
