import { describe, test, expect } from 'vitest'
import { RspiStub, RSPI_CHANNEL_STRIDE } from '@/lib/emulator/peripherals/rspi'
import { OledController } from '@/lib/emulator/peripherals/OledController'
import { OledSpiBridge } from '@/lib/emulator/peripherals/OledSpiBridge'

const OFF_SPDR = 0x04
function spdrFor(channel: number): number {
  return channel * RSPI_CHANNEL_STRIDE + OFF_SPDR
}

describe('OledSpiBridge', () => {
  test('routes command bytes when in command mode (default)', () => {
    const rspi = new RspiStub()
    const oled = new OledController()
    const bridge = new OledSpiBridge(rspi, oled, { channel: 0 })
    bridge.attach()
    rspi.write8(spdrFor(0), 0xaf) // Display ON
    expect(oled.on).toBe(true)
  })

  test('routes data bytes when switched to data mode', () => {
    const rspi = new RspiStub()
    const oled = new OledController()
    const bridge = new OledSpiBridge(rspi, oled, { channel: 0 })
    bridge.attach()
    // Put cursor at page 0, col 0 via command bytes first
    rspi.write8(spdrFor(0), 0xb0) // page 0
    rspi.write8(spdrFor(0), 0x00) // low col nibble 0
    rspi.write8(spdrFor(0), 0x10) // high col nibble 0
    bridge.setDataMode(true)
    rspi.write8(spdrFor(0), 0x5a)
    expect(oled.framebuffer[0]).toBe(0x5a)
  })

  test('only reacts to its configured channel', () => {
    const rspi = new RspiStub()
    const oled = new OledController()
    const bridge = new OledSpiBridge(rspi, oled, { channel: 0 })
    bridge.attach()
    rspi.write8(spdrFor(1), 0xaf) // different channel
    expect(oled.on).toBe(false)
  })

  test('Deluge init sequence turns display on via SPI writes', () => {
    const rspi = new RspiStub()
    const oled = new OledController()
    const bridge = new OledSpiBridge(rspi, oled, { channel: 0 })
    bridge.attach()
    // This is the exact sequence from oled.c::oledMainInit
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
    for (const b of seq) rspi.write8(spdrFor(0), b)
    expect(oled.on).toBe(true)
    expect(oled.inverted).toBe(false)
  })

  test('autoDataModeAfterCommands flips after N command bytes', () => {
    const rspi = new RspiStub()
    const oled = new OledController()
    const bridge = new OledSpiBridge(rspi, oled, {
      channel: 0,
      autoDataModeAfterCommands: 27,
    })
    bridge.attach()
    // Deluge init = 27 command bytes
    const seq = [
      0xfd, 0x12, 0xae, 0x81, 0xff, 0xa4, 0xa6, 0x00, 0x10, 0x20, 0x00,
      0x40, 0xa0, 0xa8, 0x3f, 0xc0, 0xd3, 0x00, 0xda, 0x12, 0xd5, 0xf0,
      0xd9, 0xa2, 0xdb, 0x34, 0xaf,
    ]
    for (const b of seq) rspi.write8(spdrFor(0), b)
    expect(bridge.isDataMode()).toBe(true)
    expect(oled.on).toBe(true)
    // Next byte is framebuffer data
    rspi.write8(spdrFor(0), 0xcc)
    expect(oled.framebuffer[0]).toBe(0xcc)
  })

  test('framebuffer update after init + D/C switch to data', () => {
    const rspi = new RspiStub()
    const oled = new OledController()
    const bridge = new OledSpiBridge(rspi, oled, { channel: 0 })
    bridge.attach()

    // Set horizontal addressing mode, col range 0..127, page range 0..7
    // then cursor (pages auto-reset to 0,0 on range set).
    const initCmds = [
      0x20, 0x00, // horizontal
      0x21, 0x00, 0x7f,
      0x22, 0x00, 0x07,
    ]
    for (const b of initCmds) rspi.write8(spdrFor(0), b)

    bridge.setDataMode(true)
    // Write 1024 bytes (full 128×64 framebuffer in page mode)
    for (let i = 0; i < 1024; i++) {
      rspi.write8(spdrFor(0), i & 0xff)
    }
    // Spot check
    expect(oled.framebuffer[0]).toBe(0)
    expect(oled.framebuffer[127]).toBe(127)
    expect(oled.framebuffer[128]).toBe(128 & 0xff)
    expect(oled.framebuffer[1023]).toBe(1023 & 0xff)
  })
})
