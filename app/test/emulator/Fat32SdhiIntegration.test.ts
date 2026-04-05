// End-to-end: build a FAT32 image, attach it to SDHI, read back through
// the peripheral. Verifies the BPB structure is intact after round-tripping
// through the emulator's SDHI block-read path.

import { describe, test, expect } from 'vitest'
import { runWorker } from '@/lib/emulator/EmulatorWorker'
import { buildFat32Image } from '@/lib/storage/Fat32Builder'
import type { EmulatorRequest, WorkerToMain } from '@/lib/emulator/protocol'

async function setup() {
  const messages: WorkerToMain[] = []
  const { handle, state } = runWorker({
    post: (msg) => messages.push(msg),
    listen: () => {},
  })
  await handle({ type: 'init', seq: 1 } as EmulatorRequest)
  return { messages, handle, state }
}

describe('FAT32 image → SDHI → CMD17 round-trip', () => {
  test('sector 0 contains a valid FAT32 boot sector after attach + read', async () => {
    const { handle, state } = await setup()
    const image = buildFat32Image(
      [
        { path: '/SYNTHS' },
        { path: '/SYNTHS/HELLO.XML', content: new TextEncoder().encode('hi') },
      ],
      { sizeMiB: 33, label: 'DELUGE' },
    )
    // Attach image
    const ab = new ArrayBuffer(image.byteLength)
    new Uint8Array(ab).set(image)
    await handle({
      type: 'attachSdImage',
      seq: 2,
      image: ab,
    } as EmulatorRequest)

    // Issue CMD17 for sector 0
    const m = state.core.memory
    m.write16(0xe804e800 + 0x04, 0) // SD_ARG0
    m.write16(0xe804e800 + 0x06, 0) // SD_ARG1
    m.write16(0xe804e800 + 0x00, 17) // SD_CMD

    // Read 128 32-bit words from SD_BUF0
    const bytes = new Uint8Array(512)
    for (let i = 0; i < 128; i++) {
      const w = m.read32(0xe804e800 + 0x30) >>> 0
      bytes[i * 4] = w & 0xff
      bytes[i * 4 + 1] = (w >>> 8) & 0xff
      bytes[i * 4 + 2] = (w >>> 16) & 0xff
      bytes[i * 4 + 3] = (w >>> 24) & 0xff
    }

    // Boot sector signature 0x55AA at bytes 510-511
    expect(bytes[510]).toBe(0x55)
    expect(bytes[511]).toBe(0xaa)
    // OEM name "MSDOS5.0"
    const oem = Array.from(bytes.subarray(3, 11))
      .map((b) => String.fromCharCode(b))
      .join('')
    expect(oem).toBe('MSDOS5.0')
    // Bytes per sector = 512 (LE)
    expect(bytes[11] | (bytes[12] << 8)).toBe(512)
    // Filesystem type "FAT32   "
    const fsType = Array.from(bytes.subarray(82, 90))
      .map((b) => String.fromCharCode(b))
      .join('')
    expect(fsType).toBe('FAT32   ')
  })

  test('FAT[0] has media descriptor 0xF8 at sector 32', async () => {
    const { handle, state } = await setup()
    const image = buildFat32Image([], { sizeMiB: 33 })
    const ab = new ArrayBuffer(image.byteLength)
    new Uint8Array(ab).set(image)
    await handle({
      type: 'attachSdImage',
      seq: 2,
      image: ab,
    } as EmulatorRequest)

    // Sector 32 is the start of the first FAT
    const m = state.core.memory
    m.write16(0xe804e800 + 0x04, 32)
    m.write16(0xe804e800 + 0x00, 17)
    const fat0 = m.read32(0xe804e800 + 0x30) >>> 0
    expect(fat0).toBe(0x0ffffff8)
    const fat1 = m.read32(0xe804e800 + 0x30) >>> 0
    expect(fat1).toBe(0x0fffffff)
    // FAT[2] is root dir EOC
    const fat2 = m.read32(0xe804e800 + 0x30) >>> 0
    expect(fat2).toBe(0x0fffffff)
  })
})
