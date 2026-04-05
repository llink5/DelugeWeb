import { describe, test, expect, vi } from 'vitest'
import {
  PicUartDecoder,
  PIC_TOTAL_COLS,
  PIC_ROWS,
} from '@/lib/emulator/peripherals/PicUartDecoder'

function feedBytes(d: PicUartDecoder, bytes: number[]): void {
  for (const b of bytes) d.feed(b)
}

describe('PicUartDecoder pad colour column update', () => {
  test('SET_COLOUR_FOR_TWO_COLUMNS idx=0 fills cols 0 and 1', () => {
    const d = new PicUartDecoder()
    const bytes: number[] = [1] // message header for idx=0 (cols 0 & 1)
    for (let row = 0; row < PIC_ROWS; row++) {
      bytes.push(10 + row, 20 + row, 30 + row) // left col RGB
    }
    for (let row = 0; row < PIC_ROWS; row++) {
      bytes.push(100 + row, 110 + row, 120 + row) // right col RGB
    }
    feedBytes(d, bytes)
    expect(d.state.pads[0][0]).toEqual({ r: 10, g: 20, b: 30 })
    expect(d.state.pads[0][7]).toEqual({ r: 17, g: 27, b: 37 })
    expect(d.state.pads[1][0]).toEqual({ r: 100, g: 110, b: 120 })
    expect(d.state.pads[1][7]).toEqual({ r: 107, g: 117, b: 127 })
  })

  test('idx=8 writes the sidebar columns', () => {
    const d = new PicUartDecoder()
    const bytes: number[] = [9] // 1 + 8 (column pair 8 = sidebar)
    for (let i = 0; i < 48; i++) bytes.push(i)
    feedBytes(d, bytes)
    // Sidebar cols are at 16 and 17 (kDisplayWidth + kSideBarWidth = 18)
    expect(d.state.pads[16][0]).toEqual({ r: 0, g: 1, b: 2 })
    expect(d.state.pads[17][0]).toEqual({ r: 24, g: 25, b: 26 })
  })

  test('emits padColumn event with the pair', () => {
    const d = new PicUartDecoder()
    const events: { leftCol: number; rightCol: number }[] = []
    d.onEvent((e) => {
      if (e.type === 'padColumn')
        events.push({ leftCol: e.leftCol, rightCol: e.rightCol })
    })
    const bytes = [3, ...new Array(48).fill(0)] // pair idx=2 → cols 4,5
    feedBytes(d, bytes)
    expect(events).toEqual([{ leftCol: 4, rightCol: 5 }])
  })

  test('all 18 columns covered by 9 pair messages', () => {
    expect(PIC_TOTAL_COLS).toBe(18)
  })
})

describe('PicUartDecoder indicator LEDs', () => {
  test('SET_LED_ON sets the indicator', () => {
    const d = new PicUartDecoder()
    d.feed(188) // SET_LED_ON + 0
    d.feed(188 + 5) // SET_LED_ON + 5
    expect(d.state.indicatorLeds[0]).toBe(true)
    expect(d.state.indicatorLeds[5]).toBe(true)
  })

  test('SET_LED_OFF clears the indicator', () => {
    const d = new PicUartDecoder()
    d.feed(188)
    d.feed(152) // SET_LED_OFF + 0
    expect(d.state.indicatorLeds[0]).toBe(false)
  })

  test('emits ledOn / ledOff events', () => {
    const d = new PicUartDecoder()
    const events: { type: string; idx: number }[] = []
    d.onEvent((e) => {
      if (e.type === 'ledOn' || e.type === 'ledOff') {
        events.push({ type: e.type, idx: e.idx })
      }
    })
    d.feed(188 + 3)
    d.feed(152 + 7)
    expect(events).toEqual([
      { type: 'ledOn', idx: 3 },
      { type: 'ledOff', idx: 7 },
    ])
  })
})

describe('PicUartDecoder 7-segment display', () => {
  test('UPDATE_SEVEN_SEGMENT_DISPLAY accepts 4 bytes', () => {
    const d = new PicUartDecoder()
    feedBytes(d, [224, 0x06, 0x5b, 0x4f, 0x66]) // "1234"
    expect(d.state.sevenSegment).toEqual([0x06, 0x5b, 0x4f, 0x66])
  })
})

describe('PicUartDecoder gold knob indicators', () => {
  test('SET_GOLD_KNOB_0_INDICATORS takes 4 bytes', () => {
    const d = new PicUartDecoder()
    feedBytes(d, [20, 10, 20, 30, 40])
    expect(d.state.goldKnobIndicators[0]).toEqual([10, 20, 30, 40])
  })
})

describe('PicUartDecoder OLED control', () => {
  test('SELECT_OLED and DESELECT_OLED fire events', () => {
    const d = new PicUartDecoder()
    const types: string[] = []
    d.onEvent((e) => types.push(e.type))
    d.feed(248) // SELECT
    d.feed(251) // SET_DC_HIGH
    d.feed(249) // DESELECT
    expect(types).toEqual(['oledSelect', 'oledDcHigh', 'oledDeselect'])
  })
})

describe('PicUartDecoder state-machine robustness', () => {
  test('unknown command bytes are ignored', () => {
    const d = new PicUartDecoder()
    d.feed(0) // NONE
    d.feed(255) // unknown
    // Should not get wedged — subsequent valid commands still decode
    d.feed(188)
    expect(d.state.indicatorLeds[0]).toBe(true)
  })

  test('reset clears everything', () => {
    const d = new PicUartDecoder()
    d.feed(188)
    d.feed(1)
    for (let i = 0; i < 48; i++) d.feed(i)
    d.reset()
    expect(d.state.indicatorLeds[0]).toBe(false)
    expect(d.state.pads[0][0]).toEqual({ r: 0, g: 0, b: 0 })
  })

  test('PIC::setColourForTwoColumns() byte stream decodes correctly', () => {
    // This is the exact encoding pic.h generates:
    //   send(SET_COLOUR_FOR_TWO_COLUMNS + idx)
    //   for each RGB triple: send(r), send(g), send(b)
    // where colours is a kDisplayHeight*2 array (16 colours).
    const d = new PicUartDecoder()
    const cb = vi.fn()
    d.onEvent((e) => {
      if (e.type === 'padColumn') cb(e.leftCol, e.rightCol, e.colours.length)
    })
    const idx = 4 // column pair 4 → cols 8,9
    const msg = [1 + idx] // SET_COLOUR_FOR_TWO_COLUMNS + 4
    for (let i = 0; i < 16; i++) {
      msg.push(200 + i, 100 + i, 50 + i)
    }
    feedBytes(d, msg)
    expect(cb).toHaveBeenCalledWith(8, 9, 16)
    expect(d.state.pads[8][0]).toEqual({ r: 200, g: 100, b: 50 })
    expect(d.state.pads[9][0]).toEqual({ r: 208, g: 108, b: 58 })
  })
})
