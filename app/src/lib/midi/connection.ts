import type { DirEntry } from '@/lib/types'

const MANUFACTURER_ID = [0x00, 0x21, 0x7b]
const DEVICE_ID = 0x01
const SYSEX_START = 0xf0
const SYSEX_END = 0xf7
const HEADER = [SYSEX_START, ...MANUFACTURER_ID, DEVICE_ID]
const DEFAULT_TIMEOUT = 10_000
const READ_BLOCK = 512
const WRITE_BLOCK = 512
const DIR_PAGE_SIZE = 20

class MidiConnection {
  private static instance: MidiConnection

  private midi: MIDIAccess | null = null
  private input: MIDIInput | null = null
  private output: MIDIOutput | null = null
  private connectionCallbacks = new Set<(connected: boolean) => void>()
  private msgSeqNumber = 1
  private callbacks = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private debugCallback: ((text: string) => void) | null = null
  private displayCallbacks = new Set<(type: 'oled' | '7seg', data: Uint8Array) => void>()
  private boundHandleMessage = this.handleMessage.bind(this)
  private boundStateChange = this.handleStateChange.bind(this)

  private constructor() {}

  static getInstance(): MidiConnection {
    if (!MidiConnection.instance) {
      MidiConnection.instance = new MidiConnection()
    }
    return MidiConnection.instance
  }

  // ── Connection management ──────────────────────────────────────────

  get isConnected(): boolean {
    return this.input !== null && this.output !== null
  }

  async connect(inputId?: string, outputId?: string): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      throw new Error('Web MIDI API not supported in this browser')
    }

    this.midi = await navigator.requestMIDIAccess({ sysex: true })
    this.midi.addEventListener('statechange', this.boundStateChange)

    if (inputId && outputId) {
      const inp = this.midi.inputs.get(inputId)
      const out = this.midi.outputs.get(outputId)
      if (!inp || !out) throw new Error('Specified MIDI ports not found')
      this.attachPorts(inp, out)
    } else {
      const found = await this.autoDetect()
      if (!found) throw new Error('No Deluge MIDI ports detected')
    }
  }

  disconnect(): void {
    if (this.input) {
      this.input.removeEventListener('midimessage', this.boundHandleMessage as EventListener)
      this.input = null
    }
    if (this.output) {
      this.output = null
    }
    if (this.midi) {
      this.midi.removeEventListener('statechange', this.boundStateChange)
      this.midi = null
    }
    for (const [seq, cb] of this.callbacks) {
      clearTimeout(cb.timer)
      cb.reject(new Error('Disconnected'))
    }
    this.callbacks.clear()
    this.debugCallback = null
    this.notifyConnection(false)
  }

  async autoDetect(): Promise<boolean> {
    if (!this.midi) {
      if (!navigator.requestMIDIAccess) return false
      this.midi = await navigator.requestMIDIAccess({ sysex: true })
      this.midi.addEventListener('statechange', this.boundStateChange)
    }

    let foundInput: MIDIInput | null = null
    let foundOutput: MIDIOutput | null = null

    for (const [, port] of this.midi.inputs) {
      if (port.name && port.name.toLowerCase().includes('deluge')) {
        foundInput = port
        break
      }
    }
    for (const [, port] of this.midi.outputs) {
      if (port.name && port.name.toLowerCase().includes('deluge')) {
        foundOutput = port
        break
      }
    }

    if (foundInput && foundOutput) {
      this.attachPorts(foundInput, foundOutput)
      return true
    }
    return false
  }

  async listPorts(): Promise<{ inputs: { id: string; name: string }[]; outputs: { id: string; name: string }[] }> {
    if (!this.midi) {
      if (!navigator.requestMIDIAccess) return { inputs: [], outputs: [] }
      this.midi = await navigator.requestMIDIAccess({ sysex: true })
    }
    const inputs: { id: string; name: string }[] = []
    const outputs: { id: string; name: string }[] = []
    for (const [id, port] of this.midi.inputs) {
      inputs.push({ id, name: port.name ?? 'Unknown' })
    }
    for (const [id, port] of this.midi.outputs) {
      outputs.push({ id, name: port.name ?? 'Unknown' })
    }
    return { inputs, outputs }
  }

  onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.connectionCallbacks.add(cb)
    return () => { this.connectionCallbacks.delete(cb) }
  }

  private attachPorts(inp: MIDIInput, out: MIDIOutput): void {
    if (this.input) {
      this.input.removeEventListener('midimessage', this.boundHandleMessage as EventListener)
    }
    this.input = inp
    this.output = out
    this.input.addEventListener('midimessage', this.boundHandleMessage as EventListener)
    this.notifyConnection(true)
  }

  private handleStateChange(evt: Event): void {
    const e = evt as MIDIConnectionEvent
    if (!e.port) return
    if (this.input && e.port.id === this.input.id && e.port.state === 'disconnected') {
      this.input = null
      this.output = null
      this.notifyConnection(false)
    }
  }

  private notifyConnection(connected: boolean): void {
    for (const cb of this.connectionCallbacks) {
      try { cb(connected) } catch { /* ignore */ }
    }
  }

  // ── SysEx send / receive ───────────────────────────────────────────

  private sendSysEx(bytes: number[]): void {
    if (!this.output) throw new Error('Not connected')
    this.output.send(new Uint8Array(bytes))
  }

  private handleMessage(evt: MIDIMessageEvent): void {
    const d = evt.data
    if (!d || d.length < 6 || d[0] !== SYSEX_START) return
    if (d[1] !== 0x00 || d[2] !== 0x21 || d[3] !== 0x7b || d[4] !== DEVICE_ID) return

    const cmd = d[5]

    // Debug text (0x03)
    if (cmd === 0x03) {
      if (this.debugCallback && d.length > 7) {
        const text = new TextDecoder().decode(d.slice(7, d.length - 1))
        this.debugCallback(text)
      }
      return
    }

    // Display data (0x02)
    if (cmd === 0x02) {
      const subType = d[6]
      const raw = new Uint8Array(d.buffer, d.byteOffset + 7, d.length - 8) // strip trailing 0xF7
      const type: 'oled' | '7seg' = subType === 0x01 ? '7seg' : 'oled'
      for (const cb of this.displayCallbacks) {
        try { cb(type, raw) } catch { /* ignore */ }
      }
      return
    }

    // JSON reply (0x04 request-ack, 0x05 response)
    if (cmd === 0x04 || cmd === 0x05) {
      if (d.length < 8) return
      const seq = d[6]
      const pending = this.callbacks.get(seq)
      if (!pending) return

      // Find JSON payload boundaries
      const jsonStart = 7
      let jsonEnd = d.length - 1 // before 0xF7
      let zeroX = -1

      // Locate first 0x00 separator (binary payload follows) or 0xF7 end
      for (let i = jsonStart; i < d.length - 1; i++) {
        if (d[i] === 0x00) {
          jsonEnd = i
          zeroX = i
          break
        }
      }

      const jsonBytes = d.slice(jsonStart, jsonEnd)
      let parsed: Record<string, unknown> = {}
      let verb = ''
      if (jsonBytes.length > 0) {
        try {
          const jsonStr = new TextDecoder().decode(jsonBytes)
          const obj = JSON.parse(jsonStr)
          verb = obj.verb ?? ''
          parsed = obj
        } catch {
          // malformed JSON
        }
      }

      // Extract binary payload after the 0x00 separator
      let raw: Uint8Array<ArrayBuffer> = new Uint8Array(0)
      if (zeroX >= 0 && zeroX + 1 < d.length - 1) {
        const packed = new Uint8Array(Array.from(d.slice(zeroX + 1, d.length - 1)))
        raw = MidiConnection.unpack7to8(packed, 0, packed.length) as Uint8Array<ArrayBuffer>
      }

      clearTimeout(pending.timer)
      this.callbacks.delete(seq)
      pending.resolve({ verb, data: parsed, raw, zeroX })
    }
  }

  private nextSeq(): number {
    const s = this.msgSeqNumber
    this.msgSeqNumber = this.msgSeqNumber >= 7 ? 1 : this.msgSeqNumber + 1
    return s
  }

  private sendJsonRequest(
    cmd: string,
    params: Record<string, unknown>,
    aux?: Uint8Array
  ): Promise<{ verb: string; data: Record<string, unknown>; raw: Uint8Array; zeroX: number }> {
    if (!this.output) return Promise.reject(new Error('Not connected'))

    const seq = this.nextSeq()
    const json = JSON.stringify({ verb: cmd, ...params })
    const jsonBytes = new TextEncoder().encode(json)

    const msg: number[] = [...HEADER, 0x04, seq]
    for (const b of jsonBytes) msg.push(b)

    if (aux && aux.length > 0) {
      msg.push(0x00)
      const packed = MidiConnection.pack8to7(aux, 0, aux.length)
      for (const b of packed) msg.push(b)
    }

    msg.push(SYSEX_END)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.callbacks.delete(seq)
        reject(new Error(`Timeout waiting for reply (seq=${seq})`))
      }, DEFAULT_TIMEOUT)

      this.callbacks.set(seq, { resolve, reject, timer })
      this.sendSysEx(msg)
    })
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastErr: Error | undefined
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn()
      } catch (e: any) {
        lastErr = e
        const msg = e?.message ?? ''
        if (!msg.includes('Timeout')) throw e // only retry timeouts
      }
    }
    throw lastErr
  }

  // ── 7-bit packing ─────────────────────────────────────────────────

  static pack8to7(src: Uint8Array, offset: number, len: number): Uint8Array {
    const out: number[] = []
    let i = 0
    while (i < len) {
      const chunk = Math.min(7, len - i)
      let highBits = 0
      const group: number[] = []
      for (let j = 0; j < chunk; j++) {
        const b = src[offset + i + j]
        if (b & 0x80) highBits |= 1 << j
        group.push(b & 0x7f)
      }
      out.push(highBits)
      for (const b of group) out.push(b)
      i += chunk
    }
    return new Uint8Array(out)
  }

  static unpack7to8(src: Uint8Array, srcOff: number, srcLen: number): Uint8Array {
    const out: number[] = []
    let i = 0
    while (i < srcLen) {
      const highBits = src[srcOff + i]
      i++
      const chunk = Math.min(7, srcLen - i)
      for (let j = 0; j < chunk; j++) {
        let b = src[srcOff + i + j]
        if (highBits & (1 << j)) b |= 0x80
        out.push(b)
      }
      i += chunk
    }
    return new Uint8Array(out)
  }

  // ── File operations ────────────────────────────────────────────────

  async readFile(path: string, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
    return this.withRetry(async () => {
      const openReply = await this.sendJsonRequest('open', { path })
      const fileHandle = (openReply.data as any).fh
      const fileSize = (openReply.data as any).size ?? 0
      if (fileHandle === undefined) throw new Error(`Failed to open file: ${path}`)

      const chunks: Uint8Array[] = []
      let bytesRead = 0

      try {
        while (bytesRead < fileSize) {
          const toRead = Math.min(READ_BLOCK, fileSize - bytesRead)
          const reply = await this.sendJsonRequest('read', { fh: fileHandle, len: toRead, addr: bytesRead })
          if (reply.raw.length === 0) break
          chunks.push(reply.raw)
          bytesRead += reply.raw.length
          if (onProgress) onProgress(bytesRead, fileSize)
        }
      } finally {
        await this.sendJsonRequest('close', { fh: fileHandle }).catch(() => {})
      }

      const result = new Uint8Array(bytesRead)
      let off = 0
      for (const c of chunks) {
        result.set(c, off)
        off += c.length
      }
      return result
    })
  }

  async writeFile(path: string, data: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<void> {
    return this.withRetry(async () => {
      const openReply = await this.sendJsonRequest('open', { path, write: 1 })
      const fileHandle = (openReply.data as any).fh
      if (fileHandle === undefined) throw new Error(`Failed to open file for writing: ${path}`)

      let bytesWritten = 0

      try {
        while (bytesWritten < data.length) {
          const toWrite = Math.min(WRITE_BLOCK, data.length - bytesWritten)
          const block = data.subarray(bytesWritten, bytesWritten + toWrite)
          await this.sendJsonRequest('write', { fh: fileHandle, addr: bytesWritten }, block)
          bytesWritten += toWrite
          if (onProgress) onProgress(bytesWritten, data.length)
        }
      } finally {
        await this.sendJsonRequest('close', { fh: fileHandle }).catch(() => {})
      }

      const { fdate, ftime } = MidiConnection.date2fdatetime()
      await this.sendJsonRequest('utime', { path, fdate, ftime }).catch(() => {})
    })
  }

  async listDir(path: string): Promise<DirEntry[]> {
    const entries: DirEntry[] = []
    let offset = 0

    while (true) {
      const reply = await this.sendJsonRequest('list', { path, offset, lines: DIR_PAGE_SIZE })
      const list: DirEntry[] = (reply.data as any).list ?? []
      if (list.length === 0) break
      for (const e of list) {
        entries.push({
          name: e.name,
          attr: e.attr,
          date: e.date,
          time: e.time,
          size: e.size,
        })
      }
      if (list.length < DIR_PAGE_SIZE) break
      offset += list.length
    }

    return entries
  }

  async deleteItem(path: string): Promise<void> {
    await this.sendJsonRequest('delete', { path })
  }

  async mkdir(path: string): Promise<void> {
    await this.sendJsonRequest('mkdir', { path })
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.sendJsonRequest('rename', { old: oldPath, new: newPath })
  }

  async recursiveDelete(path: string, isDir: boolean): Promise<void> {
    if (isDir) {
      const entries = await this.listDir(path)
      for (const entry of entries) {
        const childPath = path.endsWith('/') ? path + entry.name : path + '/' + entry.name
        const childIsDir = ((entry.attr ?? 0) & 0x10) !== 0
        await this.recursiveDelete(childPath, childIsDir)
      }
    }
    await this.deleteItem(path)
  }

  // ── Debug stream ───────────────────────────────────────────────────

  startDebugStream(callback: (text: string) => void): void {
    this.debugCallback = callback
    this.sendSysEx([SYSEX_START, ...MANUFACTURER_ID, DEVICE_ID, 0x03, 0x00, 0x01, SYSEX_END])
  }

  stopDebugStream(): void {
    this.sendSysEx([SYSEX_START, ...MANUFACTURER_ID, DEVICE_ID, 0x03, 0x00, 0x00, SYSEX_END])
    this.debugCallback = null
  }

  // ── Display commands ───────────────────────────────────────────────

  async requestOled(force = false): Promise<void> {
    this.sendSysEx([SYSEX_START, ...MANUFACTURER_ID, DEVICE_ID, 0x02, 0x00, force ? 0x03 : 0x01, SYSEX_END])
  }

  async request7Seg(): Promise<void> {
    this.sendSysEx([SYSEX_START, ...MANUFACTURER_ID, DEVICE_ID, 0x02, 0x01, 0x00, SYSEX_END])
  }

  onDisplayData(cb: (type: 'oled' | '7seg', data: Uint8Array) => void): () => void {
    this.displayCallbacks.add(cb)
    return () => { this.displayCallbacks.delete(cb) }
  }

  // ── RLE decode (for OLED display data) ─────────────────────────────

  static unpackRle(src: Uint8Array): Uint8Array {
    const out: number[] = []
    let i = 0

    while (i < src.length) {
      const header = src[i++]

      if (header < 64) {
        // DENSE block
        let size: number
        let offset: number

        if (header < 4) {
          size = 2; offset = 0
        } else if (header < 12) {
          size = 3; offset = 4
        } else if (header < 28) {
          size = 4; offset = 12
        } else if (header < 60) {
          size = 5; offset = 28
        } else {
          // header is 60-63, treat as size=5 block
          size = 5; offset = 28
        }

        const highbits = header - offset
        for (let j = 0; j < size && i < src.length; j++) {
          let b = src[i++]
          if (highbits & (1 << j)) b |= 0x80
          out.push(b)
        }
      } else {
        // REPETITION block
        let first = header - 64
        const high = first & 1
        let runlen = first >> 1

        if (runlen === 31 && i < src.length) {
          runlen = 31 + src[i++]
        }

        if (i >= src.length) break
        const value = src[i++] | (high ? 0x80 : 0)

        for (let j = 0; j < runlen; j++) {
          out.push(value)
        }
      }
    }

    return new Uint8Array(out)
  }

  // ── FAT32 date/time utilities ──────────────────────────────────────

  static fdatetime2Date(fdate: number, ftime: number): Date {
    const year = ((fdate >> 9) & 0x7f) + 1980
    const month = ((fdate >> 5) & 0x0f) - 1 // JS months are 0-based
    const day = fdate & 0x1f
    const hour = (ftime >> 11) & 0x1f
    const min = (ftime >> 5) & 0x3f
    const sec = (ftime & 0x1f) * 2
    return new Date(year, month, day, hour, min, sec)
  }

  static date2fdatetime(d?: Date): { fdate: number; ftime: number } {
    const dt = d ?? new Date()
    const year = dt.getFullYear() - 1980
    const month = dt.getMonth() + 1
    const day = dt.getDate()
    const hour = dt.getHours()
    const min = dt.getMinutes()
    const sec = Math.floor(dt.getSeconds() / 2)

    const fdate = ((year & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f)
    const ftime = ((hour & 0x1f) << 11) | ((min & 0x3f) << 5) | (sec & 0x1f)
    return { fdate, ftime }
  }
}

export const midi = MidiConnection.getInstance()
export { MidiConnection }
