// PIC UART message decoder.
//
// The Deluge firmware doesn't drive pad LEDs, indicator LEDs, the 7-segment
// display or scroll animations directly — it talks to a separate PIC
// microcontroller over SCIF channel 1 (UART, 200 kHz for fast pad updates).
// Messages are defined in src/deluge/drivers/pic/pic.h. This decoder
// consumes the raw byte stream and maintains a reconstructed view of the
// UI state the PIC would be displaying.
//
// Message encoding (per PIC::Message enum):
//   1..9       SET_COLOUR_FOR_TWO_COLUMNS + idx — followed by 16 RGB
//              triples (48 bytes total) for the pair (x=idx*2, x=idx*2+1).
//              idx 8 is the sidebar (9th double-column).
//   10..17     SET_FLASH_COLOR + colour_idx
//   18         SET_DEBOUNCE_TIME + 1 byte
//   19         SET_REFRESH_TIME + 1 byte
//   20         SET_GOLD_KNOB_0_INDICATORS + 4 bytes
//   21         SET_GOLD_KNOB_1_INDICATORS + 4 bytes
//   22         RESEND_BUTTON_STATES (no payload)
//   23         SET_FLASH_LENGTH + 1 byte
//   24..151    SET_PAD_FLASHING + pad idx (24 + idx, idx in 0..127)
//   152..187   SET_LED_OFF + led idx (indicator LEDs)
//   188..223   SET_LED_ON + led idx
//   224        UPDATE_SEVEN_SEGMENT_DISPLAY + kNumericDisplayLength bytes
//   225        SET_UART_SPEED + 1 byte
//   228..235   SET_SCROLL_ROW + row idx (followed by RGB)
//   236..239   SET_SCROLL_{LEFT,RIGHT,RIGHT_FULL,LEFT_FULL}
//   240        DONE_SENDING_ROWS
//   241        SET_SCROLL_UP  + (kDisplayWidth+kSideBarWidth) RGB triples
//   242        SET_SCROLL_DOWN + same
//   243        SET_DIMMER_INTERVAL + 1 byte
//   244        SET_MIN_INTERRUPT_INTERVAL + 1 byte
//   245        REQUEST_FIRMWARE_VERSION
//   247        ENABLE_OLED
//   248        SELECT_OLED
//   249        DESELECT_OLED
//   250        SET_DC_LOW
//   251        SET_DC_HIGH
//
// The decoder is format-driven: a single top-level byte steers into a
// follow-up state machine that consumes the documented payload length.

// The Deluge's pad grid: 16 columns × 8 rows (main) + 2 columns × 8 rows
// (sidebar). The "column pair" index runs 0..8: 0..7 cover main pads,
// 8 covers the sidebar.
export const PIC_MAIN_COLS = 16
export const PIC_SIDE_COLS = 2
export const PIC_ROWS = 8
export const PIC_TOTAL_COLS = PIC_MAIN_COLS + PIC_SIDE_COLS
export const PIC_SEG_DIGITS = 4

export interface PicDecoderState {
  /** RGB pad colours, row-major: pad[col][row] = {r,g,b}. */
  pads: { r: number; g: number; b: number }[][]
  /** Indicator LED on/off states (idx 0..35 → SET_LED_ON 188+idx / SET_LED_OFF 152+idx). */
  indicatorLeds: boolean[]
  /** 7-segment display digits (4). */
  sevenSegment: number[]
  /** Brightness of the 8 indicator LEDs per gold knob (2 knobs × 4 leds). */
  goldKnobIndicators: [number[], number[]]
  /** Sidebar columns that form part of the 18-wide total. */
  sidebarIncluded: true
}

export type PicEvent =
  | {
      type: 'padColumn'
      leftCol: number
      rightCol: number
      colours: { r: number; g: number; b: number }[]
    }
  | { type: 'ledOn'; idx: number }
  | { type: 'ledOff'; idx: number }
  | { type: 'sevenSegment'; digits: number[] }
  | { type: 'goldKnobIndicator'; knob: 0 | 1; values: number[] }
  | { type: 'flashPad'; idx: number }
  | { type: 'oledEnable' }
  | { type: 'oledSelect' }
  | { type: 'oledDeselect' }
  | { type: 'oledDcLow' }
  | { type: 'oledDcHigh' }

type FollowUp = (b: number) => void

export class PicUartDecoder {
  readonly state: PicDecoderState
  private eventListener: ((event: PicEvent) => void) | null = null
  private pending: FollowUp | null = null
  private pendingRemaining = 0
  /** Scratch buffer for multi-byte payloads. */
  private buf: number[] = []
  /** Store which SET_COLOUR_FOR_TWO_COLUMNS idx is in-flight. */
  private columnPairIdx = -1
  /** Store which gold-knob is in-flight. */
  private knobIdx: 0 | 1 = 0

  constructor() {
    this.state = {
      pads: Array.from({ length: PIC_TOTAL_COLS }, () =>
        Array.from({ length: PIC_ROWS }, () => ({ r: 0, g: 0, b: 0 })),
      ),
      indicatorLeds: new Array<boolean>(36).fill(false),
      sevenSegment: [0, 0, 0, 0],
      goldKnobIndicators: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      sidebarIncluded: true,
    }
  }

  /** Subscribe to decoded events. Replaces any previous listener. */
  onEvent(cb: ((event: PicEvent) => void) | null): void {
    this.eventListener = cb
  }

  /** Feed a single byte from the SCIF FTDR stream. */
  feed(byte: number): void {
    const b = byte & 0xff
    if (this.pendingRemaining > 0 && this.pending) {
      this.pending(b)
      this.pendingRemaining--
      if (this.pendingRemaining === 0) this.pending = null
      return
    }
    this.decodeCommand(b)
  }

  private emit(event: PicEvent): void {
    if (this.eventListener) this.eventListener(event)
  }

  private decodeCommand(b: number): void {
    // SET_COLOUR_FOR_TWO_COLUMNS + idx: 1..9
    if (b >= 1 && b <= 9) {
      this.columnPairIdx = b - 1
      this.buf = []
      this.pendingRemaining = 48 // 16 RGB triples
      this.pending = (byte) => {
        this.buf.push(byte)
        if (this.buf.length === 48) this.commitPadColumns()
      }
      return
    }
    // SET_FLASH_COLOR + colour_idx: 10..17
    if (b >= 10 && b <= 17) {
      return
    }
    // SET_DEBOUNCE_TIME: 18 + 1 byte
    if (b === 18 || b === 19 || b === 23 || b === 225 || b === 243 || b === 244) {
      this.pendingRemaining = 1
      this.pending = () => {
        /* consumed */
      }
      return
    }
    // SET_GOLD_KNOB_0_INDICATORS: 20 + 4 bytes
    if (b === 20 || b === 21) {
      this.knobIdx = (b - 20) as 0 | 1
      this.buf = []
      this.pendingRemaining = 4
      this.pending = (byte) => {
        this.buf.push(byte)
        if (this.buf.length === 4) this.commitGoldKnob()
      }
      return
    }
    // RESEND_BUTTON_STATES: 22 (no payload)
    if (b === 22) {
      return
    }
    // SET_PAD_FLASHING: 24..151
    if (b >= 24 && b <= 151) {
      this.emit({ type: 'flashPad', idx: b - 24 })
      return
    }
    // SET_LED_OFF: 152..187
    if (b >= 152 && b <= 187) {
      const idx = b - 152
      if (idx < this.state.indicatorLeds.length) this.state.indicatorLeds[idx] = false
      this.emit({ type: 'ledOff', idx })
      return
    }
    // SET_LED_ON: 188..223
    if (b >= 188 && b <= 223) {
      const idx = b - 188
      if (idx < this.state.indicatorLeds.length) this.state.indicatorLeds[idx] = true
      this.emit({ type: 'ledOn', idx })
      return
    }
    // UPDATE_SEVEN_SEGMENT_DISPLAY: 224 + 4 bytes
    if (b === 224) {
      this.buf = []
      this.pendingRemaining = PIC_SEG_DIGITS
      this.pending = (byte) => {
        this.buf.push(byte)
        if (this.buf.length === PIC_SEG_DIGITS) {
          this.state.sevenSegment = [...this.buf]
          this.emit({ type: 'sevenSegment', digits: [...this.buf] })
        }
      }
      return
    }
    // SET_SCROLL_ROW: 228..235 + 3 bytes
    if (b >= 228 && b <= 235) {
      this.pendingRemaining = 3
      this.pending = () => {
        /* consumed */
      }
      return
    }
    // SET_SCROLL_{LEFT,RIGHT,RIGHT_FULL,LEFT_FULL}: 236..239
    if (b >= 236 && b <= 239) {
      return
    }
    // DONE_SENDING_ROWS: 240
    if (b === 240) return
    // SET_SCROLL_UP: 241 + (kDisplayWidth+kSideBarWidth)=18 × RGB = 54 bytes
    if (b === 241 || b === 242) {
      this.pendingRemaining = 54
      this.pending = () => {
        /* consumed */
      }
      return
    }
    // REQUEST_FIRMWARE_VERSION: 245
    if (b === 245) return
    // ENABLE_OLED: 247
    if (b === 247) {
      this.emit({ type: 'oledEnable' })
      return
    }
    // SELECT_OLED: 248
    if (b === 248) {
      this.emit({ type: 'oledSelect' })
      return
    }
    // DESELECT_OLED: 249
    if (b === 249) {
      this.emit({ type: 'oledDeselect' })
      return
    }
    // SET_DC_LOW: 250
    if (b === 250) {
      this.emit({ type: 'oledDcLow' })
      return
    }
    // SET_DC_HIGH: 251
    if (b === 251) {
      this.emit({ type: 'oledDcHigh' })
      return
    }
    // Unknown command — drop.
  }

  private commitPadColumns(): void {
    // 16 RGB triples: first 8 triples = left col, next 8 = right col.
    // Within a column, index 0 = y=0 (bottom-left on the Deluge).
    const pairIdx = this.columnPairIdx
    const leftCol = pairIdx * 2
    const rightCol = pairIdx * 2 + 1
    const colours: { r: number; g: number; b: number }[] = []
    for (let row = 0; row < PIC_ROWS; row++) {
      const offs = row * 3
      const c = { r: this.buf[offs], g: this.buf[offs + 1], b: this.buf[offs + 2] }
      colours.push(c)
      if (leftCol < PIC_TOTAL_COLS) this.state.pads[leftCol][row] = c
    }
    for (let row = 0; row < PIC_ROWS; row++) {
      const offs = (PIC_ROWS + row) * 3
      const c = { r: this.buf[offs], g: this.buf[offs + 1], b: this.buf[offs + 2] }
      colours.push(c)
      if (rightCol < PIC_TOTAL_COLS) this.state.pads[rightCol][row] = c
    }
    this.emit({ type: 'padColumn', leftCol, rightCol, colours })
  }

  private commitGoldKnob(): void {
    this.state.goldKnobIndicators[this.knobIdx] = [...this.buf]
    this.emit({
      type: 'goldKnobIndicator',
      knob: this.knobIdx,
      values: [...this.buf],
    })
  }

  /** Reset the decoder to an empty grid with no pending state. */
  reset(): void {
    for (const col of this.state.pads) {
      for (const c of col) {
        c.r = 0
        c.g = 0
        c.b = 0
      }
    }
    this.state.indicatorLeds.fill(false)
    this.state.sevenSegment = [0, 0, 0, 0]
    this.state.goldKnobIndicators = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
    this.pending = null
    this.pendingRemaining = 0
    this.buf = []
  }
}
