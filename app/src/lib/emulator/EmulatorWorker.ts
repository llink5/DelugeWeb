// Emulator worker — runs inside a Web Worker.
//
// Responsibilities:
//   1. Own the ArmCpu backend.
//   2. Own the PeripheralBus and its stubs.
//   3. Parse incoming ELF binaries and copy segments into the core's memory.
//   4. Service main-thread requests via the protocol defined in protocol.ts.
//
// This module is a self-contained worker entry point: it wires message
// handlers as soon as it is imported, relying on the caller constructing it
// with `new Worker(new URL('./EmulatorWorker.ts', import.meta.url), { type: 'module' })`.
//
// The `runWorker()` export is also called by tests that need to exercise the
// handler logic without a real Worker — they pipe a fake postMessage/onmessage
// pair through `runWorker({ post, listen })`.

import { ArmCpu } from './cpu/ArmCpu'
import type { ArmCore } from './ArmCore'
import { MEMORY_REGIONS, backingRegion } from './MemoryMap'
import { parseElf, type ElfSymbol } from './ElfLoader'
import { parseBin, detectFirmwareFormat } from './BinLoader'
import {
  createBootPeripheralBus,
  type PeripheralBus,
} from './peripherals'
import { SymbolMap } from './symbols/SymbolMap'
import { BreakpointManager } from './symbols/BreakpointManager'
import { StructWalker } from './symbols/StructWalker'
import { DELUGE_STRUCTS } from './symbols/delugeStructs'
import { disassembleArm } from './symbols/disassembler'
import type { SsiStub } from './peripherals/ssi'
import type { RspiStub } from './peripherals/rspi'
import type { ScifStub } from './peripherals/scif'
import type { DmacStub } from './peripherals/dmac'
import type { SdhiStub } from './peripherals/sdhi'
import { OledController } from './peripherals/OledController'
import { OledSpiBridge } from './peripherals/OledSpiBridge'
import { PicUartDecoder } from './peripherals/PicUartDecoder'
import {
  captureSnapshot,
  deserializeSnapshot,
  InMemorySnapshotStore,
  restoreSnapshot,
  serializeSnapshot,
  type SnapshotStore,
} from './snapshot/Snapshot'
import type {
  EmulatorEvent,
  EmulatorReply,
  EmulatorRequest,
  WorkerToMain,
  BreakpointDto,
} from './protocol'

interface WorkerTransport {
  post: (msg: WorkerToMain, transfer?: Transferable[]) => void
  listen: (handler: (msg: EmulatorRequest) => void) => void
}

interface WorkerState {
  core: ArmCpu
  bus: PeripheralBus
  symbols: ElfSymbol[]
  symbolMap: SymbolMap
  breakpoints: BreakpointManager
  structWalker: StructWalker
  snapshotStore: SnapshotStore
  elfLoaded: boolean
  entry: number
  running: boolean
  /** Audio batching buffer (interleaved Int16 stereo). */
  audioBatch: Int16Array
  audioBatchFill: number
  /** OLED framebuffer owner and wiring to the RSPI stub. */
  oled: OledController
  oledBridge: OledSpiBridge | null
  oledDirty: boolean
  /** PIC UART decoder consuming SCIF1 FTDR writes. */
  picDecoder: PicUartDecoder
  /** Set when the pad grid or indicator LEDs have changed since last flush. */
  ledDirty: boolean
  /** Cached DMAC reference so the pump doesn't re-look-up on every step. */
  dmac: DmacStub | null
}

/** Stereo frames per audio chunk posted to the main thread. */
const AUDIO_BATCH_FRAMES = 128

function createState(snapshotStore?: SnapshotStore): WorkerState {
  const core = new ArmCpu()
  const symbolMap = new SymbolMap()
  const oled = new OledController()
  return {
    core,
    bus: createBootPeripheralBus(),
    symbols: [],
    symbolMap,
    breakpoints: new BreakpointManager(core, symbolMap),
    structWalker: new StructWalker(
      {
        read8: (a) => core.memory.read8(a),
        read16: (a) => core.memory.read16(a),
        read32: (a) => core.memory.read32(a),
      },
      DELUGE_STRUCTS,
    ),
    snapshotStore: snapshotStore ?? new InMemorySnapshotStore(),
    elfLoaded: false,
    entry: 0,
    running: false,
    audioBatch: new Int16Array(AUDIO_BATCH_FRAMES * 2),
    audioBatchFill: 0,
    oled,
    oledBridge: null,
    oledDirty: false,
    picDecoder: new PicUartDecoder(),
    ledDirty: false,
    dmac: null,
  }
}

/** Attach an audio-capture callback to the SSI stub on the bus. */
function wireSsiCapture(
  state: WorkerState,
  transport: WorkerTransport,
): void {
  // Find the SSI stub. It's always registered by createBootPeripheralBus, but
  // guard for custom bus configurations.
  const ssi = state.bus.list().find((s) => s.name === 'SSI') as
    | SsiStub
    | undefined
  if (!ssi) return
  ssi.onSamples((left, right) => {
    const fill = state.audioBatchFill
    state.audioBatch[fill * 2] = left
    state.audioBatch[fill * 2 + 1] = right
    state.audioBatchFill = fill + 1
    if (state.audioBatchFill >= AUDIO_BATCH_FRAMES) {
      flushAudio(state, transport)
    }
  })
}

/**
 * Wire the OLED framebuffer to the RSPI stub on the Deluge's SPI channel 0
 * and install a dirty flag so the step loop can emit throttled display
 * updates. Matches oled.c::oledMainInit (27-byte command sequence followed
 * by data-mode traffic once the firmware pulls D/C high via PIC UART).
 */
function wireOledCapture(state: WorkerState): void {
  const rspi = state.bus.list().find((s) => s.name === 'RSPI') as
    | RspiStub
    | undefined
  if (!rspi) return
  state.oled.setOnUpdate(() => {
    state.oledDirty = true
  })
  state.oledBridge = new OledSpiBridge(rspi, state.oled, {
    channel: 0,
    autoDataModeAfterCommands: 27,
  })
  state.oledBridge.attach()
}

/** Locate the DMAC stub on the bus and cache it for the pump. */
function wireDmac(state: WorkerState): void {
  state.dmac = (state.bus.list().find((s) => s.name === 'DMAC') as
    | DmacStub
    | undefined) ?? null
  // On transfer-end, raise the matching IRQ on the CPU's interrupt
  // controller. Deluge firmware registers DMA handlers per channel.
  state.dmac?.onChannelEnd((channel) => {
    state.core.interrupts.request(channel) // source = DMAC channel 0..15
  })
}

/**
 * Advance all running DMA channels via the supplied memory accessor.
 * The ArmCpu's memory interface routes peripheral addresses through the
 * PeripheralBus, so DMA to a UART FTDR, SPI SPDR or SSI FTDR lands at
 * the correct stub's write8/16/32.
 *
 * Chunk size: 4096 elements/channel per pump call. Pump is called several
 * times per step() (once per CPU instruction chunk), so effective per-step
 * bandwidth scales with the number of instructions executed.
 */
function pumpDma(state: WorkerState): void {
  if (!state.dmac) return
  state.dmac.pump(state.core.memory, 4096)
}

/** Number of CPU instructions executed between DMA pump calls. */
const CPU_CHUNK_SIZE = 10_000

/**
 * Run CPU instructions, interleaving DMA pump calls every CPU_CHUNK_SIZE
 * instructions so DMA progresses alongside execution. This keeps the
 * audio ring buffer draining at roughly CPU rate — no underruns as long
 * as firmware generates samples fast enough.
 */
function runWithInterleavedPump(
  state: WorkerState,
  maxInstructions: number,
): number {
  let remaining = maxInstructions
  let executed = 0
  do {
    const chunk = Math.min(CPU_CHUNK_SIZE, remaining)
    const n = chunk > 0 ? state.core.run(chunk) : 0
    executed += n
    pumpDma(state)
    if (chunk > 0 && n < chunk) break // CPU paused (breakpoint etc.)
    remaining -= chunk
  } while (remaining > 0)
  return executed
}

/**
 * Wire SCIF channel 1 (Deluge's UART_CHANNEL_PIC) to the PIC message
 * decoder. Every byte the firmware writes to SCIF1.FTDR feeds the
 * decoder, which maintains the reconstructed pad grid + indicator LED
 * state. A dirty flag lets the step loop batch updates.
 */
function wirePicCapture(state: WorkerState): void {
  const scif = state.bus.list().find((s) => s.name === 'SCIF') as
    | ScifStub
    | undefined
  if (!scif) return
  state.picDecoder.onEvent(() => {
    state.ledDirty = true
  })
  scif.onTransmit((ch, byte) => {
    if (ch !== 1) return // UART_CHANNEL_PIC
    state.picDecoder.feed(byte)
  })
}

function flushLeds(state: WorkerState, transport: WorkerTransport): void {
  if (!state.ledDirty) return
  // Pack pad colours into a row-major RGB888 buffer matching the layout
  // the PadGrid.vue component expects: buf[(y * cols + x) * 3 + {r,g,b}].
  // The Deluge hardware stores row 0 at the bottom of the grid, so we
  // flip vertically for the UI (y=0 = top row of the on-screen grid).
  const pads = state.picDecoder.state.pads
  const cols = pads.length // 18 = 16 main + 2 sidebar
  const rows = pads[0]?.length ?? 0 // 8
  const buf = new ArrayBuffer(cols * rows * 3)
  const view = new Uint8Array(buf)
  for (let uiRow = 0; uiRow < rows; uiRow++) {
    const deviceRow = rows - 1 - uiRow
    for (let col = 0; col < cols; col++) {
      const c = pads[col][deviceRow]
      const i = (uiRow * cols + col) * 3
      view[i] = c.r
      view[i + 1] = c.g
      view[i + 2] = c.b
    }
  }
  transport.post({ type: 'ledUpdate', colors: buf }, [buf])
  state.ledDirty = false
}

function flushDisplay(state: WorkerState, transport: WorkerTransport): void {
  if (!state.oledDirty) return
  // Copy into a fresh transferable ArrayBuffer.
  const src = state.oled.framebuffer
  const ab = new ArrayBuffer(src.byteLength)
  new Uint8Array(ab).set(src)
  transport.post({ type: 'displayUpdate', framebuffer: ab }, [ab])
  state.oledDirty = false
}

function flushAudio(state: WorkerState, transport: WorkerTransport): void {
  if (state.audioBatchFill === 0) return
  // Copy into a fresh transferable ArrayBuffer.
  const samples = state.audioBatch.subarray(0, state.audioBatchFill * 2)
  const ab = new ArrayBuffer(samples.byteLength)
  new Int16Array(ab).set(samples)
  transport.post(
    {
      type: 'audioBuffer',
      samples: ab,
      channels: 2,
    },
    [ab],
  )
  state.audioBatchFill = 0
}

/**
 * Register every peripheral stub with the ArmCpu so memory accesses in the
 * peripheral windows are routed to the correct stub.
 */
function wirePeripheralBus(core: ArmCpu, bus: PeripheralBus): void {
  for (const stub of bus.list()) {
    core.addPeripheralRegion(stub.baseAddr, stub.size, {
      read: (offset, width) => {
        if (width === 1) return stub.read8(offset)
        if (width === 2) return stub.read16(offset)
        return stub.read32(offset)
      },
      write: (offset, width, value) => {
        if (width === 1) stub.write8(offset, value)
        else if (width === 2) stub.write16(offset, value)
        else stub.write32(offset, value)
      },
    })
  }
}

function mapAllRegions(core: ArmCore): void {
  // Only map regions that have real storage; peripheral windows go through
  // the PeripheralBus instead. Aliased regions share the underlying buffer.
  const bufferByName = new Map<string, Uint8Array>()
  for (const r of MEMORY_REGIONS) {
    if (r.peripheral) continue
    const backing = backingRegion(r)
    let buf = bufferByName.get(backing.name)
    if (!buf) {
      buf = new Uint8Array(backing.size)
      bufferByName.set(backing.name, buf)
    }
    core.mapRegion({
      start: r.start,
      size: r.size,
      perms: r.perms,
      buffer: buf,
    })
  }
}

interface LoadResult {
  ok: boolean
  error?: string
  format: 'elf' | 'bin'
  loadAddress: number
  entry: number
  symbolCount: number
}

/** Force-ELF loader for the legacy `loadElf` command. */
function loadElfIntoState(
  state: WorkerState,
  transport: WorkerTransport,
  bytes: Uint8Array,
): LoadResult {
  try {
    const parsed = parseElf(bytes)
    for (const seg of parsed.loadable) {
      state.core.writeMemory(seg.vaddr, seg.data)
    }
    state.core.setPC(parsed.header.entry)
    state.symbols = parsed.symbols
    state.symbolMap = new SymbolMap(parsed.symbols)
    state.breakpoints = new BreakpointManager(state.core, state.symbolMap)
    state.breakpoints.onHit((bp) => {
      emit(transport, {
        type: 'breakpointHit',
        address: bp.address,
        registers: { ...state.core.getRegisters() },
      })
    })
    state.elfLoaded = true
    state.entry = parsed.header.entry
    log(
      transport,
      'info',
      `ELF loaded: entry=0x${parsed.header.entry.toString(16)}, ${parsed.symbols.length} symbols`,
    )
    return {
      ok: true,
      format: 'elf',
      loadAddress:
        parsed.loadable.length > 0 ? parsed.loadable[0].vaddr : parsed.header.entry,
      entry: parsed.header.entry,
      symbolCount: parsed.symbols.length,
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      format: 'elf',
      loadAddress: 0,
      entry: 0,
      symbolCount: 0,
    }
  }
}

/**
 * Load firmware of either format. Copies the image into emulator memory,
 * sets PC to the entry point, rebuilds the SymbolMap (empty for bin),
 * and reinstalls the breakpoint manager.
 */
function loadFirmwareIntoState(
  state: WorkerState,
  transport: WorkerTransport,
  bytes: Uint8Array,
  loadAddressOverride: number | undefined,
): LoadResult {
  try {
    const format = detectFirmwareFormat(bytes)
    let loadAddress = 0
    let entry = 0
    let symbols: ElfSymbol[] = []
    let segmentCount = 0

    if (format === 'elf') {
      const parsed = parseElf(bytes)
      for (const seg of parsed.loadable) {
        state.core.writeMemory(seg.vaddr, seg.data)
        segmentCount++
      }
      entry = parsed.header.entry
      symbols = parsed.symbols
      // Loading address isn't a single value for ELF; use the lowest segment.
      loadAddress = parsed.loadable.length > 0
        ? parsed.loadable[0].vaddr
        : entry
    } else {
      const fw = parseBin(bytes, { loadAddress: loadAddressOverride })
      state.core.writeMemory(fw.loadAddress, fw.data)
      segmentCount = 1
      entry = fw.entryPoint
      loadAddress = fw.loadAddress
    }

    state.core.setPC(entry)
    state.symbols = symbols
    state.symbolMap = new SymbolMap(symbols)
    state.breakpoints = new BreakpointManager(state.core, state.symbolMap)
    state.breakpoints.onHit((bp) => {
      emit(transport, {
        type: 'breakpointHit',
        address: bp.address,
        registers: { ...state.core.getRegisters() },
      })
    })
    state.elfLoaded = true
    state.entry = entry

    log(
      transport,
      'info',
      `Firmware loaded: format=${format}, load=0x${loadAddress.toString(16)}, entry=0x${entry.toString(16)}, ${symbols.length} symbols, ${segmentCount} segments`,
    )
    return {
      ok: true,
      format,
      loadAddress,
      entry,
      symbolCount: symbols.length,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      error: msg,
      format: 'bin',
      loadAddress: 0,
      entry: 0,
      symbolCount: 0,
    }
  }
}

function toBreakpointDto(bp: import('./symbols/BreakpointManager').Breakpoint): BreakpointDto {
  return {
    id: bp.id,
    address: bp.address,
    label: bp.label,
    oneShot: bp.oneShot,
    hits: bp.hits,
    enabled: bp.enabled,
  }
}

function reply(
  transport: WorkerTransport,
  r: EmulatorReply,
  transfer: Transferable[] = [],
): void {
  transport.post(r, transfer)
}

function emit(transport: WorkerTransport, e: EmulatorEvent): void {
  transport.post(e)
}

function log(transport: WorkerTransport, level: 'info' | 'warn' | 'error', message: string): void {
  emit(transport, { type: 'log', level, message })
}

/**
 * Wire the emulator handlers onto the given transport. Returns an async
 * function that processes a single incoming request — useful for tests.
 */
export function runWorker(
  transport: WorkerTransport,
  options: { snapshotStore?: SnapshotStore } = {},
): {
  state: WorkerState
  handle: (req: EmulatorRequest) => Promise<void>
} {
  const state = createState(options.snapshotStore)

  async function handle(req: EmulatorRequest): Promise<void> {
    try {
      switch (req.type) {
        case 'init': {
          mapAllRegions(state.core)
          wirePeripheralBus(state.core, state.bus)
          wireSsiCapture(state, transport)
          wireOledCapture(state)
          wirePicCapture(state)
          wireDmac(state)
          reply(transport, { type: 'ready', replyTo: req.seq, ok: true })
          log(transport, 'info', 'Emulator worker initialised (ArmCpu)')
          return
        }
        case 'loadElf': {
          // Legacy command — forces ELF parsing regardless of magic bytes.
          const result = loadElfIntoState(
            state,
            transport,
            new Uint8Array(req.elf),
          )
          reply(transport, {
            type: 'elfLoaded',
            replyTo: req.seq,
            ok: result.ok,
            error: result.error,
            entry: result.entry,
            symbolCount: result.symbolCount,
          })
          return
        }
        case 'loadFirmware': {
          const result = loadFirmwareIntoState(
            state,
            transport,
            new Uint8Array(req.firmware),
            req.loadAddress,
          )
          reply(transport, {
            type: 'firmwareLoaded',
            replyTo: req.seq,
            ok: result.ok,
            error: result.error,
            format: result.format,
            loadAddress: result.loadAddress,
            entry: result.entry,
            symbolCount: result.symbolCount,
          })
          return
        }
        case 'start': {
          if (!state.elfLoaded) {
            reply(transport, {
              type: 'started',
              replyTo: req.seq,
              ok: false,
              error: 'ELF not loaded',
            })
            return
          }
          state.running = true
          reply(transport, { type: 'started', replyTo: req.seq, ok: true })
          return
        }
        case 'stop': {
          state.running = false
          reply(transport, {
            type: 'stopped',
            replyTo: req.seq,
            ok: true,
            reason: 'user',
            pc: state.core.getRegisters().pc,
          })
          return
        }
        case 'step': {
          const executed = runWithInterleavedPump(state, req.instructions)
          // Make sure any partial audio batch reaches the main thread so the
          // UI fill-factor reading is current.
          flushAudio(state, transport)
          flushDisplay(state, transport)
          flushLeds(state, transport)
          reply(transport, {
            type: 'stepped',
            replyTo: req.seq,
            ok: true,
            executed,
            pc: state.core.getRegisters().pc,
          })
          return
        }
        case 'reset': {
          state.core.close()
          state.core = new ArmCpu()
          mapAllRegions(state.core)
          state.bus.reset()
          wirePeripheralBus(state.core, state.bus)
          wireSsiCapture(state, transport)
          state.oled.reset()
          state.oledDirty = false
          wireOledCapture(state)
          state.picDecoder.reset()
          state.ledDirty = false
          wirePicCapture(state)
          wireDmac(state)
          wireOledCapture(state)
          state.elfLoaded = false
          state.running = false
          state.symbols = []
          state.symbolMap = new SymbolMap()
          state.breakpoints = new BreakpointManager(state.core, state.symbolMap)
          state.structWalker = new StructWalker(
            {
              read8: (a) => state.core.memory.read8(a),
              read16: (a) => state.core.memory.read16(a),
              read32: (a) => state.core.memory.read32(a),
            },
            DELUGE_STRUCTS,
          )
          reply(transport, { type: 'reset', replyTo: req.seq, ok: true })
          return
        }
        case 'readMem': {
          const data = state.core.readMemory(req.address, req.length)
          // Copy into a fresh ArrayBuffer so we can safely transfer ownership
          // to the main thread (and so the type is always ArrayBuffer, never
          // SharedArrayBuffer, which readMemory could hand back).
          const ab = new ArrayBuffer(data.byteLength)
          new Uint8Array(ab).set(data)
          reply(
            transport,
            { type: 'memData', replyTo: req.seq, ok: true, data: ab },
            [ab],
          )
          return
        }
        case 'writeMem': {
          state.core.writeMemory(req.address, new Uint8Array(req.data))
          reply(transport, { type: 'memWritten', replyTo: req.seq, ok: true })
          return
        }
        case 'getRegisters': {
          const regs = state.core.getRegisters()
          reply(transport, {
            type: 'registers',
            replyTo: req.seq,
            ok: true,
            registers: { ...regs },
          })
          return
        }
        case 'setBreakpoint': {
          const bp = state.breakpoints.addByAddress(req.address, {
            oneShot: req.oneShot,
            label: req.label,
          })
          reply(transport, {
            type: 'breakpointSet',
            replyTo: req.seq,
            ok: true,
            breakpoint: toBreakpointDto(bp),
          })
          return
        }
        case 'clearBreakpoint': {
          state.breakpoints.remove(req.id)
          reply(transport, { type: 'breakpointCleared', replyTo: req.seq, ok: true })
          return
        }
        case 'listBreakpoints': {
          reply(transport, {
            type: 'breakpointList',
            replyTo: req.seq,
            ok: true,
            breakpoints: state.breakpoints.list().map(toBreakpointDto),
          })
          return
        }
        case 'searchSymbols': {
          const hits = state.symbolMap.search(
            req.query ?? '',
            req.max ?? 200,
            req.typeFilter,
          )
          reply(transport, {
            type: 'symbolResults',
            replyTo: req.seq,
            ok: true,
            hits: hits.map((h) => ({ ...h })),
          })
          return
        }
        case 'resolveAddress': {
          const r = state.symbolMap.resolve(req.address)
          reply(transport, {
            type: 'addressResolved',
            replyTo: req.seq,
            ok: true,
            resolved: r
              ? {
                  name: r.symbol.name,
                  address: r.symbol.address,
                  size: r.symbol.size,
                  type: r.symbol.type,
                  offset: r.offset,
                }
              : undefined,
          })
          return
        }
        case 'disassemble': {
          const lines = []
          for (let i = 0; i < req.count; i++) {
            const addr = (req.address + i * 4) >>> 0
            const word = state.core.memory.read32(addr)
            const d = disassembleArm(word, addr, state.symbolMap)
            lines.push({ address: d.address, text: d.text })
          }
          reply(transport, {
            type: 'disassembly',
            replyTo: req.seq,
            ok: true,
            lines,
          })
          return
        }
        case 'readStruct': {
          const fields = state.structWalker.read(req.typeName, req.address)
          if (!fields) {
            reply(transport, {
              type: 'structFields',
              replyTo: req.seq,
              ok: false,
              error: `Unknown struct: ${req.typeName}`,
              fields: [],
            })
            return
          }
          reply(transport, {
            type: 'structFields',
            replyTo: req.seq,
            ok: true,
            fields: fields.map((f) => ({
              name: f.name,
              offset: f.offset,
              type: f.type,
              raw: f.raw,
              display: f.display,
              pointsTo: f.pointsTo,
            })),
          })
          return
        }
        case 'listStructs': {
          reply(transport, {
            type: 'structList',
            replyTo: req.seq,
            ok: true,
            structs: state.structWalker.list(),
          })
          return
        }
        case 'saveSnapshot': {
          const snap = captureSnapshot(state.core)
          const buf = serializeSnapshot(snap)
          await state.snapshotStore.save(req.name, buf)
          reply(transport, {
            type: 'snapshotSaved',
            replyTo: req.seq,
            ok: true,
          })
          log(transport, 'info', `Snapshot '${req.name}' saved (${buf.byteLength} bytes)`)
          return
        }
        case 'attachSdImage': {
          const sdhi = state.bus.list().find((s) => s.name === 'SDHI') as
            | SdhiStub
            | undefined
          if (!sdhi) {
            reply(transport, {
              type: 'sdImageAttached',
              replyTo: req.seq,
              ok: false,
              error: 'SDHI stub not registered',
              sectors: 0,
            })
            return
          }
          sdhi.attachImage(new Uint8Array(req.image))
          reply(transport, {
            type: 'sdImageAttached',
            replyTo: req.seq,
            ok: true,
            sectors: sdhi.sectorCount,
          })
          log(
            transport,
            'info',
            `SD image attached: ${sdhi.sectorCount} sectors`,
          )
          return
        }
        case 'injectPicBytes': {
          // Enqueue each byte on SCIF1's RX FIFO then pump DMA channel 12
          // by one element per byte so it lands in picRxBuffer exactly
          // as if a real UART frame had arrived.
          const scif = state.bus.list().find((s) => s.name === 'SCIF') as
            | ScifStub
            | undefined
          let delivered = 0
          if (scif && state.dmac) {
            for (const b of req.bytes) {
              scif.enqueueRx(1, b & 0xff)
              const moved = state.dmac.pumpChannel(12, 1, state.core.memory)
              if (moved > 0) delivered++
            }
          }
          reply(transport, {
            type: 'picBytesInjected',
            replyTo: req.seq,
            ok: true,
            delivered,
          })
          return
        }
        case 'loadSnapshot': {
          const stored = await state.snapshotStore.load(req.name)
          if (!stored) {
            reply(transport, {
              type: 'snapshotLoaded',
              replyTo: req.seq,
              ok: false,
              error: `Snapshot not found: ${req.name}`,
            })
            return
          }
          const snap = deserializeSnapshot(stored.data)
          restoreSnapshot(state.core, snap)
          reply(transport, {
            type: 'snapshotLoaded',
            replyTo: req.seq,
            ok: true,
          })
          log(transport, 'info', `Snapshot '${req.name}' loaded`)
          return
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      transport.post({
        replyTo: req.seq,
        ok: false,
        type: 'ready', // generic failure reply
        error: msg,
      } as EmulatorReply)
      log(transport, 'error', msg)
    }
  }

  transport.listen((req) => {
    void handle(req)
  })

  return { state, handle }
}

// A dedicated worker entry file (EmulatorWorker.entry.ts) wires `runWorker`
// to the real `self.postMessage` / `self.addEventListener` pair. Keeping the
// self-wiring out of this file lets tests import `runWorker` without
// triggering Worker-side effects.
