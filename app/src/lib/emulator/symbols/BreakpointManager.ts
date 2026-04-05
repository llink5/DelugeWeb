// Breakpoint manager.
//
// Tracks a list of breakpoints keyed by address, with optional symbol name
// labelling, hit counters, and a "one-shot" flag that auto-removes the
// breakpoint when it fires. Integrates with ArmCpu by installing a code
// hook at each breakpoint address.

import type { ArmCore, HookId } from '../ArmCore'
import type { SymbolMap } from './SymbolMap'

export interface Breakpoint {
  id: number
  address: number
  /** Symbol name, if the breakpoint was set by name. */
  label?: string
  oneShot: boolean
  hits: number
  enabled: boolean
}

interface InternalBreakpoint extends Breakpoint {
  hookId: HookId
}

export type BreakpointEventCallback = (bp: Breakpoint) => void

export class BreakpointManager {
  private breakpoints: InternalBreakpoint[] = []
  private nextId = 1
  private hitListeners = new Set<BreakpointEventCallback>()

  constructor(
    private readonly core: ArmCore,
    private readonly symbols?: SymbolMap,
  ) {}

  /** Install a breakpoint at a specific address. */
  addByAddress(
    address: number,
    options: { oneShot?: boolean; label?: string } = {},
  ): Breakpoint {
    const addr = address >>> 0
    const id = this.nextId++
    const hookId = this.core.addCodeHook(addr, () => this.onHit(id, addr))
    const bp: InternalBreakpoint = {
      id,
      address: addr,
      label: options.label,
      oneShot: options.oneShot ?? false,
      hits: 0,
      enabled: true,
      hookId,
    }
    this.breakpoints.push(bp)
    return toPublic(bp)
  }

  /**
   * Install a breakpoint by symbol name. Returns undefined if the symbol
   * is not known.
   */
  addByName(
    name: string,
    options: { oneShot?: boolean } = {},
  ): Breakpoint | undefined {
    if (!this.symbols) return undefined
    const sym = this.symbols.lookup(name)
    if (!sym) return undefined
    return this.addByAddress(sym.address, { ...options, label: name })
  }

  /** Remove a breakpoint by id. */
  remove(id: number): boolean {
    const idx = this.breakpoints.findIndex((b) => b.id === id)
    if (idx < 0) return false
    const bp = this.breakpoints[idx]
    this.core.removeHook(bp.hookId)
    this.breakpoints.splice(idx, 1)
    return true
  }

  /** Disable a breakpoint without removing it — the hook stays installed but is ignored. */
  disable(id: number): void {
    const bp = this.breakpoints.find((b) => b.id === id)
    if (bp) bp.enabled = false
  }

  enable(id: number): void {
    const bp = this.breakpoints.find((b) => b.id === id)
    if (bp) bp.enabled = true
  }

  /** Remove every breakpoint. */
  clear(): void {
    for (const bp of this.breakpoints) this.core.removeHook(bp.hookId)
    this.breakpoints = []
  }

  list(): Breakpoint[] {
    return this.breakpoints.map(toPublic)
  }

  /** Subscribe to breakpoint-hit notifications. Returns an unsubscribe fn. */
  onHit(listener: BreakpointEventCallback): () => void
  /** Internal overload called by the hook itself. */
  onHit(id: number, address: number): void
  onHit(
    arg: number | BreakpointEventCallback,
    address?: number,
  ): void | (() => void) {
    if (typeof arg === 'function') {
      this.hitListeners.add(arg)
      return () => this.hitListeners.delete(arg)
    }
    this.handleHit(arg as number, address! >>> 0)
  }

  // -------------------------------------------------------------------------
  // Internal hook handler
  // -------------------------------------------------------------------------

  private handleHit(id: number, _address: number): void {
    const bp = this.breakpoints.find((b) => b.id === id)
    if (!bp || !bp.enabled) return
    bp.hits++
    const snapshot = toPublic(bp)
    for (const listener of this.hitListeners) {
      try {
        listener(snapshot)
      } catch {
        /* ignore */
      }
    }
    if (bp.oneShot) this.remove(id)
  }
}

function toPublic(b: InternalBreakpoint): Breakpoint {
  const { hookId: _hookId, ...rest } = b
  void _hookId
  return { ...rest }
}
