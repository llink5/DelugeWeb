// Main-thread ↔ Worker protocol for the emulator.
//
// Messages are plain JSON (with ArrayBuffer transfer when appropriate). Every
// request carries a `seq` number; every reply carries the same seq back so
// the main thread can correlate async responses. Unsolicited events from the
// worker (log, displayUpdate, audioBuffer, …) don't carry a seq.

export type Seq = number

// ---------------------------------------------------------------------------
// Main → Worker requests
// ---------------------------------------------------------------------------

export type EmulatorRequest =
  | { type: 'init'; seq: Seq }
  | { type: 'loadElf'; seq: Seq; elf: ArrayBuffer }
  | {
      type: 'loadFirmware'
      seq: Seq
      firmware: ArrayBuffer
      /** Override the auto-detected load address (bin format only). */
      loadAddress?: number
    }
  | { type: 'start'; seq: Seq }
  | { type: 'stop'; seq: Seq }
  | { type: 'step'; seq: Seq; instructions: number }
  | { type: 'reset'; seq: Seq }
  | { type: 'readMem'; seq: Seq; address: number; length: number }
  | { type: 'writeMem'; seq: Seq; address: number; data: ArrayBuffer }
  | { type: 'getRegisters'; seq: Seq }
  | { type: 'setBreakpoint'; seq: Seq; address: number; oneShot?: boolean; label?: string }
  | { type: 'clearBreakpoint'; seq: Seq; id: number }
  | { type: 'listBreakpoints'; seq: Seq }
  | { type: 'searchSymbols'; seq: Seq; query: string; max?: number; typeFilter?: 'func' | 'object' | 'other' }
  | { type: 'resolveAddress'; seq: Seq; address: number }
  | { type: 'disassemble'; seq: Seq; address: number; count: number }
  | { type: 'readStruct'; seq: Seq; typeName: string; address: number }
  | { type: 'listStructs'; seq: Seq }
  | { type: 'saveSnapshot'; seq: Seq; name: string }
  | { type: 'loadSnapshot'; seq: Seq; name: string }
  | {
      /** Inject bytes into the simulated PIC UART RX stream. Each byte
       *  is queued on SCIF1's RX FIFO and pulled into picRxBuffer via
       *  DMAC channel 12 on the next pump. */
      type: 'injectPicBytes'
      seq: Seq
      bytes: number[]
    }
  | {
      /** Attach a disk image (FAT32) to the SDHI peripheral. */
      type: 'attachSdImage'
      seq: Seq
      image: ArrayBuffer
    }

// ---------------------------------------------------------------------------
// Worker → Main replies (correlated by seq)
// ---------------------------------------------------------------------------

export interface EmulatorReplyBase {
  replyTo: Seq
  ok: boolean
  error?: string
}

export interface SymbolHitDto {
  name: string
  address: number
  size: number
  type: 'func' | 'object' | 'other'
}

export interface ResolvedAddressDto {
  name: string
  address: number
  size: number
  type: 'func' | 'object' | 'other'
  offset: number
}

export interface DisassembledLine {
  address: number
  text: string
}

export interface BreakpointDto {
  id: number
  address: number
  label?: string
  oneShot: boolean
  hits: number
  enabled: boolean
}

export interface StructFieldDto {
  name: string
  offset: number
  type: string
  raw: number
  display: string
  pointsTo?: { typeName: string; address: number }
}

export type EmulatorReply =
  | (EmulatorReplyBase & { type: 'ready' })
  | (EmulatorReplyBase & { type: 'elfLoaded'; entry: number; symbolCount: number })
  | (EmulatorReplyBase & {
      type: 'firmwareLoaded'
      /** Format detected — 'elf' or 'bin'. */
      format: 'elf' | 'bin'
      /** Address the firmware was placed at. */
      loadAddress: number
      /** Program counter after reset vector decoding. */
      entry: number
      /** Number of symbols (0 for bin images). */
      symbolCount: number
    })
  | (EmulatorReplyBase & { type: 'started' })
  | (EmulatorReplyBase & { type: 'stopped'; reason: string; pc: number })
  | (EmulatorReplyBase & { type: 'stepped'; executed: number; pc: number })
  | (EmulatorReplyBase & { type: 'reset' })
  | (EmulatorReplyBase & { type: 'memData'; data: ArrayBuffer })
  | (EmulatorReplyBase & { type: 'memWritten' })
  | (EmulatorReplyBase & { type: 'registers'; registers: Record<string, number> })
  | (EmulatorReplyBase & { type: 'breakpointSet'; breakpoint?: BreakpointDto })
  | (EmulatorReplyBase & { type: 'breakpointCleared' })
  | (EmulatorReplyBase & { type: 'breakpointList'; breakpoints: BreakpointDto[] })
  | (EmulatorReplyBase & { type: 'symbolResults'; hits: SymbolHitDto[] })
  | (EmulatorReplyBase & { type: 'addressResolved'; resolved?: ResolvedAddressDto })
  | (EmulatorReplyBase & { type: 'disassembly'; lines: DisassembledLine[] })
  | (EmulatorReplyBase & { type: 'structFields'; fields: StructFieldDto[] })
  | (EmulatorReplyBase & { type: 'structList'; structs: string[] })
  | (EmulatorReplyBase & { type: 'snapshotSaved' })
  | (EmulatorReplyBase & { type: 'snapshotLoaded' })
  | (EmulatorReplyBase & { type: 'picBytesInjected'; delivered: number })
  | (EmulatorReplyBase & { type: 'sdImageAttached'; sectors: number })

// ---------------------------------------------------------------------------
// Worker → Main unsolicited events (no seq)
// ---------------------------------------------------------------------------

export type EmulatorEvent =
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'breakpointHit'; address: number; registers: Record<string, number> }
  | { type: 'displayUpdate'; framebuffer: ArrayBuffer }
  | { type: 'audioBuffer'; samples: ArrayBuffer; channels: 1 | 2 }
  | { type: 'ledUpdate'; colors: ArrayBuffer }
  | { type: 'stats'; mips: number; bufferFill: number; underruns: number }

export type WorkerToMain = EmulatorReply | EmulatorEvent

/** Type guard for replies (have `replyTo`). */
export function isReply(msg: WorkerToMain): msg is EmulatorReply {
  return 'replyTo' in msg
}

/** Type guard for unsolicited events. */
export function isEvent(msg: WorkerToMain): msg is EmulatorEvent {
  return !('replyTo' in msg)
}
