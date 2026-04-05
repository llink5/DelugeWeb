// SSD1306 / SH1106-compatible OLED controller simulation.
//
// Drives a 128×N framebuffer in SSD1306 page format: one byte per column
// per 8-pixel-tall page, bits ordered LSB = topmost pixel.
//
// The controller receives a stream of (isCommand, byte) pairs mirroring
// the SPI/I2C protocol of the real chip. Command bytes change state
// (addressing mode, cursor, contrast…); data bytes write to the
// framebuffer at the current cursor position.
//
// Supported commands (subset that covers the Deluge init sequence and
// typical framebuffer updates):
//   0x00..0x0F  Set column address low nibble
//   0x10..0x1F  Set column address high nibble
//   0x20        Set memory addressing mode (data byte follows)
//   0x21        Set column address range (2 data bytes)
//   0x22        Set page address range (2 data bytes)
//   0x40..0x7F  Set display start line
//   0x81        Contrast (data byte follows)
//   0xA0 / 0xA1 Segment remap
//   0xA4 / 0xA5 Entire display on/off (keeps GDDRAM contents)
//   0xA6 / 0xA7 Normal / inverse
//   0xA8        Multiplex ratio (data byte follows)
//   0xAE / 0xAF Display off / on
//   0xB0..0xB7  Set page start (page addressing mode)
//   0xC0 / 0xC8 COM scan direction
//   0xD3        Display offset (data byte follows)
//   0xD5        Clock divide / oscillator frequency (data byte follows)
//   0xD9        Pre-charge period (data byte follows)
//   0xDA        COM pins config (data byte follows)
//   0xDB        VCOM deselect level (data byte follows)
//   0xFD        Command lock (data byte follows)
//
// Other commands fall back to "expect N follow-up data bytes then ignore".

const WIDTH = 128
const DEFAULT_HEIGHT = 64
const PAGE_HEIGHT = 8

type AddrMode = 'horizontal' | 'vertical' | 'page'

export interface OledControllerOptions {
  /** Display height in pixels. Defaults to 64 (8 pages). */
  height?: number
  /** Called after the framebuffer changes so the UI can redraw. */
  onFramebufferUpdate?: (framebuffer: Uint8Array) => void
}

export class OledController {
  readonly width = WIDTH
  readonly height: number
  readonly pages: number
  readonly framebuffer: Uint8Array

  private addrMode: AddrMode = 'page'
  private columnStart = 0
  private columnEnd = WIDTH - 1
  private pageStart = 0
  private pageEnd: number
  private cursorCol = 0
  private cursorPage = 0
  private displayOn = false
  private inverse = false
  private allOn = false
  private onFramebufferUpdate?: (fb: Uint8Array) => void

  /** Bytes remaining for a multi-byte command sequence. */
  private expectingDataBytes = 0
  /** Callback that consumes the follow-up data byte(s). */
  private dataConsumer: ((byte: number) => void) | null = null

  constructor(options: OledControllerOptions = {}) {
    this.height = options.height ?? DEFAULT_HEIGHT
    this.pages = this.height / PAGE_HEIGHT
    this.pageEnd = this.pages - 1
    this.framebuffer = new Uint8Array(WIDTH * this.pages)
    this.onFramebufferUpdate = options.onFramebufferUpdate
  }

  /** Replace the framebuffer-update callback. */
  setOnUpdate(fn?: (fb: Uint8Array) => void): void {
    this.onFramebufferUpdate = fn
  }

  /** Clear the framebuffer and reset addressing state. */
  reset(): void {
    this.framebuffer.fill(0)
    this.addrMode = 'page'
    this.columnStart = 0
    this.columnEnd = WIDTH - 1
    this.pageStart = 0
    this.pageEnd = this.pages - 1
    this.cursorCol = 0
    this.cursorPage = 0
    this.displayOn = false
    this.inverse = false
    this.allOn = false
    this.expectingDataBytes = 0
    this.dataConsumer = null
    this.notify()
  }

  // ---------------------------------------------------------------------------
  // Public byte feed
  // ---------------------------------------------------------------------------

  writeCommand(byte: number): void {
    const b = byte & 0xff
    if (this.expectingDataBytes > 0 && this.dataConsumer) {
      this.dataConsumer(b)
      this.expectingDataBytes--
      if (this.expectingDataBytes === 0) this.dataConsumer = null
      return
    }
    this.decodeCommand(b)
  }

  writeData(byte: number): void {
    const b = byte & 0xff
    const idx = this.cursorPage * WIDTH + this.cursorCol
    if (idx < this.framebuffer.length) this.framebuffer[idx] = b
    this.advanceCursor()
    this.notify()
  }

  /** Feed a whole chunk of data bytes sequentially. */
  writeDataBlock(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) {
      const idx = this.cursorPage * WIDTH + this.cursorCol
      if (idx < this.framebuffer.length) this.framebuffer[idx] = bytes[i]
      this.advanceCursor()
    }
    this.notify()
  }

  /** True when the display has been turned on (command 0xAF). */
  get on(): boolean { return this.displayOn }
  get inverted(): boolean { return this.inverse }
  get entireOn(): boolean { return this.allOn }
  get cursor(): { col: number; page: number } {
    return { col: this.cursorCol, page: this.cursorPage }
  }

  // ---------------------------------------------------------------------------
  // Command decoding
  // ---------------------------------------------------------------------------

  private decodeCommand(b: number): void {
    // Single-byte set-column commands (page addressing mode)
    if (b >= 0x00 && b <= 0x0f) {
      this.cursorCol = (this.cursorCol & 0xf0) | (b & 0x0f)
      return
    }
    if (b >= 0x10 && b <= 0x1f) {
      this.cursorCol = (this.cursorCol & 0x0f) | ((b & 0x0f) << 4)
      return
    }
    if (b >= 0x40 && b <= 0x7f) {
      // Set display start line — not modelled beyond acceptance.
      return
    }
    if (b >= 0xb0 && b <= 0xb7) {
      this.cursorPage = b & 0x07
      if (this.cursorPage >= this.pages) this.cursorPage = this.pages - 1
      return
    }

    switch (b) {
      case 0x20: // Set addressing mode
        this.expectingDataBytes = 1
        this.dataConsumer = (mode) => {
          if (mode === 0x00) this.addrMode = 'horizontal'
          else if (mode === 0x01) this.addrMode = 'vertical'
          else this.addrMode = 'page'
        }
        return
      case 0x21: // Set column address (start, end)
        this.expectingDataBytes = 2
        this.dataConsumer = ((start: number, end?: number) => {
          if (end === undefined) {
            this.columnStart = start & 0x7f
            this.cursorCol = this.columnStart
            // Next byte is the end — wrap in a new closure
            this.dataConsumer = (e) => {
              this.columnEnd = e & 0x7f
            }
          } else {
            this.columnEnd = end & 0x7f
          }
        }) as (b: number) => void
        return
      case 0x22: // Set page address (start, end)
        this.expectingDataBytes = 2
        this.dataConsumer = ((start: number) => {
          this.pageStart = start & 0x07
          this.cursorPage = this.pageStart
          this.dataConsumer = (e) => {
            this.pageEnd = e & 0x07
          }
        }) as (b: number) => void
        return
      case 0x81: // Contrast
        this.expectingDataBytes = 1
        this.dataConsumer = () => {
          /* contrast — not modelled */
        }
        return
      case 0xa0:
      case 0xa1: // segment remap — visual flip, not modelled
        return
      case 0xa4: this.allOn = false; return
      case 0xa5: this.allOn = true; this.notify(); return
      case 0xa6: this.inverse = false; this.notify(); return
      case 0xa7: this.inverse = true; this.notify(); return
      case 0xa8: // Multiplex ratio
        this.expectingDataBytes = 1
        this.dataConsumer = () => {}
        return
      case 0xae: this.displayOn = false; this.notify(); return
      case 0xaf: this.displayOn = true; this.notify(); return
      case 0xc0:
      case 0xc8:
        return // COM scan direction
      case 0xd3: // Display offset
      case 0xd5: // Clock divide
      case 0xd9: // Pre-charge
      case 0xda: // COM pins
      case 0xdb: // VCOM deselect
      case 0xfd: // Command lock
        this.expectingDataBytes = 1
        this.dataConsumer = () => {}
        return
    }
    // Unrecognised command — ignore.
  }

  // ---------------------------------------------------------------------------
  // Cursor advancement
  // ---------------------------------------------------------------------------

  private advanceCursor(): void {
    if (this.addrMode === 'page') {
      this.cursorCol++
      if (this.cursorCol > this.columnEnd) this.cursorCol = this.columnStart
      return
    }
    if (this.addrMode === 'horizontal') {
      this.cursorCol++
      if (this.cursorCol > this.columnEnd) {
        this.cursorCol = this.columnStart
        this.cursorPage++
        if (this.cursorPage > this.pageEnd) this.cursorPage = this.pageStart
      }
      return
    }
    // vertical
    this.cursorPage++
    if (this.cursorPage > this.pageEnd) {
      this.cursorPage = this.pageStart
      this.cursorCol++
      if (this.cursorCol > this.columnEnd) this.cursorCol = this.columnStart
    }
  }

  private notify(): void {
    if (this.onFramebufferUpdate) {
      try {
        this.onFramebufferUpdate(this.framebuffer)
      } catch {
        /* ignore callback errors */
      }
    }
  }
}
