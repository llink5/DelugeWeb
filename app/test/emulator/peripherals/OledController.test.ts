import { describe, test, expect, vi } from 'vitest'
import { OledController } from '@/lib/emulator/peripherals/OledController'

describe('OledController initial state', () => {
  test('128×64 framebuffer with 8 pages', () => {
    const o = new OledController()
    expect(o.width).toBe(128)
    expect(o.height).toBe(64)
    expect(o.pages).toBe(8)
    expect(o.framebuffer.length).toBe(128 * 8)
  })

  test('display starts off', () => {
    const o = new OledController()
    expect(o.on).toBe(false)
    expect(o.inverted).toBe(false)
  })

  test('custom height honoured', () => {
    const o = new OledController({ height: 48 })
    expect(o.pages).toBe(6)
    expect(o.framebuffer.length).toBe(128 * 6)
  })
})

describe('Display on/off commands', () => {
  test('0xAF turns display on', () => {
    const o = new OledController()
    o.writeCommand(0xaf)
    expect(o.on).toBe(true)
  })

  test('0xAE turns display off', () => {
    const o = new OledController()
    o.writeCommand(0xaf)
    o.writeCommand(0xae)
    expect(o.on).toBe(false)
  })
})

describe('Inverse display (0xA6 / 0xA7)', () => {
  test('0xA7 sets inverse', () => {
    const o = new OledController()
    o.writeCommand(0xa7)
    expect(o.inverted).toBe(true)
  })
  test('0xA6 clears inverse', () => {
    const o = new OledController()
    o.writeCommand(0xa7)
    o.writeCommand(0xa6)
    expect(o.inverted).toBe(false)
  })
})

describe('Cursor positioning (page mode)', () => {
  test('0xB2 sets page 2', () => {
    const o = new OledController()
    o.writeCommand(0xb2)
    expect(o.cursor.page).toBe(2)
  })

  test('column low-nibble 0x05 sets cursor column low bits', () => {
    const o = new OledController()
    o.writeCommand(0x05)
    expect(o.cursor.col).toBe(0x05)
  })

  test('column high-nibble 0x12 sets bits 4..7', () => {
    const o = new OledController()
    o.writeCommand(0x05)
    o.writeCommand(0x12)
    expect(o.cursor.col).toBe(0x25)
  })
})

describe('Data writes in page mode', () => {
  test('writeData places byte at cursor and advances column', () => {
    const o = new OledController()
    o.writeCommand(0xb1) // page 1
    o.writeCommand(0x00) // col low 0
    o.writeCommand(0x10) // col high 0
    o.writeData(0xaa)
    expect(o.framebuffer[1 * 128 + 0]).toBe(0xaa)
    expect(o.cursor.col).toBe(1)
  })

  test('writeDataBlock fills a row', () => {
    const o = new OledController()
    o.writeCommand(0xb0) // page 0
    o.writeCommand(0x00)
    o.writeCommand(0x10)
    const block = new Uint8Array(128)
    for (let i = 0; i < 128; i++) block[i] = i
    o.writeDataBlock(block)
    for (let i = 0; i < 128; i++) {
      expect(o.framebuffer[i]).toBe(i)
    }
  })

  test('column wraps back to start after reaching end', () => {
    const o = new OledController()
    o.writeCommand(0xb0)
    // Set column to 127
    o.writeCommand(0x0f)
    o.writeCommand(0x17) // high = 7 → col = 0x7F
    o.writeData(0x11)
    expect(o.framebuffer[127]).toBe(0x11)
    // Next write should wrap to column 0
    o.writeData(0x22)
    expect(o.framebuffer[0]).toBe(0x22)
  })
})

describe('Horizontal addressing mode', () => {
  test('advances row after reaching column end', () => {
    const o = new OledController()
    // Addressing mode = horizontal
    o.writeCommand(0x20)
    o.writeCommand(0x00)
    // Column range 0..3
    o.writeCommand(0x21)
    o.writeCommand(0x00)
    o.writeCommand(0x03)
    // Page range 0..1
    o.writeCommand(0x22)
    o.writeCommand(0x00)
    o.writeCommand(0x01)
    // Cursor should start at col=0 page=0 after 0x21/0x22
    o.writeData(0x01)
    o.writeData(0x02)
    o.writeData(0x03)
    o.writeData(0x04) // finishes row, page++
    o.writeData(0x05)
    expect(o.framebuffer[0]).toBe(0x01)
    expect(o.framebuffer[3]).toBe(0x04)
    expect(o.framebuffer[128 + 0]).toBe(0x05)
  })
})

describe('Deluge OLED init sequence', () => {
  test('turns the display on', () => {
    const o = new OledController()
    // Replay the exact init from oled.c
    const seq = [
      0xfd, 0x12,
      0xae,
      0x81, 0xff,
      0xa4,
      0xa6,
      0x00, 0x10,
      0x20, 0x00,
      0x40,
      0xa0,
      0xa8, 0x3f,
      0xc0,
      0xd3, 0x00,
      0xda, 0x12,
      0xd5, 0xf0,
      0xd9, 0xa2,
      0xdb, 0x34,
      0xaf,
    ]
    for (const b of seq) o.writeCommand(b)
    expect(o.on).toBe(true)
    expect(o.inverted).toBe(false)
  })
})

describe('Framebuffer-update callback', () => {
  test('fires on data write', () => {
    const cb = vi.fn()
    const o = new OledController({ onFramebufferUpdate: cb })
    o.writeCommand(0xb0)
    o.writeData(0xff)
    expect(cb).toHaveBeenCalled()
  })

  test('fires on display-state change', () => {
    const cb = vi.fn()
    const o = new OledController({ onFramebufferUpdate: cb })
    o.writeCommand(0xaf)
    expect(cb).toHaveBeenCalled()
  })
})

describe('reset', () => {
  test('zeroes the framebuffer and returns display to initial state', () => {
    const o = new OledController()
    o.writeCommand(0xaf)
    o.writeCommand(0xb2)
    o.writeData(0xff)
    o.reset()
    expect(o.on).toBe(false)
    expect(o.cursor).toEqual({ col: 0, page: 0 })
    expect(o.framebuffer.every((b) => b === 0)).toBe(true)
  })
})
