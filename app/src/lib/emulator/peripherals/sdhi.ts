// SDHI (SD Host Interface) peripheral stub.
//
// The Deluge firmware stores presets/samples/songs on a FAT32 SD card,
// accessed through the RZ/A1L's SDHI peripheral (channel 1, SD_PORT=1).
// This stub implements the minimum register set needed to handle the
// firmware's init sequence and CMD17/CMD24 block read/write traffic.
//
// Register map (base 0xE804E800, from Renesas sd_cfg.h):
//   0x00  SD_CMD       16-bit  Command code (write to issue)
//   0x04  SD_ARG0      16-bit  Argument [15:0]
//   0x06  SD_ARG1      16-bit  Argument [31:16]
//   0x08  SD_STOP      16-bit  Data-stop control
//   0x0A  SD_SECCNT    16-bit  Block count
//   0x0C  SD_RESP0     16-bit  Response bits [15:0]
//   0x0E  SD_RESP1     16-bit  Response bits [31:16]
//   0x10  SD_RESP2     16-bit  Response [47:32]
//   0x12  SD_RESP3     16-bit  Response [63:48]
//   0x14  SD_RESP4     16-bit  Response [79:64]
//   0x16  SD_RESP5     16-bit  Response [95:80]
//   0x18  SD_RESP6     16-bit  Response [111:96]
//   0x1A  SD_RESP7     16-bit  Response [127:112]
//   0x1C  SD_INFO1     16-bit  Interrupt/status (write-to-clear)
//   0x1E  SD_INFO2     16-bit  Error/buffer-ready (write-to-clear)
//   0x20  SD_INFO1_MASK 16-bit
//   0x22  SD_INFO2_MASK 16-bit
//   0x24  SD_CLK_CTRL  16-bit  Clock control
//   0x26  SD_SIZE      16-bit  Block size (typically 0x0200)
//   0x28  SD_OPTION    16-bit  Timeout cycles
//   0x2C  SD_ERR_STS1  16-bit  Command/CRC errors
//   0x2E  SD_ERR_STS2  16-bit  Timeout errors
//   0x30  SD_BUF0      32-bit  FIFO/DMA data port
//   0x34  SDIO_MODE    16-bit
//   0x36  SDIO_INFO1   16-bit
//   0x38  SDIO_INFO1_MASK 16-bit
//   0xD8  CC_EXT_MODE  16-bit  DMA enable (bit 1)
//   0xE0  SOFT_RST     16-bit  Soft reset
//   0xE2  VERSION      16-bit  Hardware version
//   0xF0  EXT_SWAP     16-bit
//
// The stub is backed by a `Uint8Array` disk image. On CMD17/18 the stub
// asserts SD_INFO2.RE (buffer ready) so the DMAC pump pulls data from
// SD_BUF0 to the firmware's in-RAM read buffer. On CMD24/25 writes, the
// pump sends data the other direction.

import { BasePeripheralStub } from './PeripheralStub'

// Register offsets
const OFF_SD_CMD = 0x00
const OFF_SD_ARG0 = 0x04
const OFF_SD_ARG1 = 0x06
const OFF_SD_STOP = 0x08
const OFF_SD_SECCNT = 0x0a
const OFF_SD_RESP0 = 0x0c
const OFF_SD_INFO1 = 0x1c
const OFF_SD_INFO2 = 0x1e
const OFF_SD_INFO1_MASK = 0x20
const OFF_SD_INFO2_MASK = 0x22
const OFF_SD_CLK_CTRL = 0x24
const OFF_SD_SIZE = 0x26
const OFF_SD_OPTION = 0x28
const OFF_SD_BUF0 = 0x30
const OFF_CC_EXT_MODE = 0xd8
const OFF_SOFT_RST = 0xe0
const OFF_VERSION = 0xe2
const OFF_EXT_SWAP = 0xf0

// SD_INFO1 bits
const INFO1_RESP = 1 << 0
const INFO1_DATA_TRNS = 1 << 2
const INFO1_INS_CD = 1 << 4

// SD_INFO2 bits
const INFO2_RE = 1 << 8 // buffer ready for read (FIFO has data)
const INFO2_WE = 1 << 9 // buffer ready for write (FIFO has space)
const INFO2_SCLKDIVEN = 1 << 13 // bus idle
const INFO2_CBSY = 1 << 14 // command busy

// SD commands
const CMD_GO_IDLE_STATE = 0
const CMD_SEND_CSD = 9
const CMD_STOP_TRANSMISSION = 12
const CMD_SEND_STATUS = 13
const CMD_SET_BLOCKLEN = 16
const CMD_READ_SINGLE_BLOCK = 17
const CMD_READ_MULTIPLE_BLOCK = 18
const CMD_WRITE_SINGLE_BLOCK = 24
const CMD_WRITE_MULTIPLE_BLOCK = 25

const SDHI_BASE = 0xe804e800
const SDHI_SIZE = 0x100
const SECTOR_BYTES = 512

type TransferDirection = 'idle' | 'read' | 'write'

export class SdhiStub extends BasePeripheralStub {
  readonly name = 'SDHI'
  readonly baseAddr = SDHI_BASE
  readonly size = SDHI_SIZE

  /** Backing disk image. All sector reads/writes go here. */
  private image: Uint8Array = new Uint8Array(0)

  /** Direction of the in-flight transfer (CMD17/18 → read, CMD24/25 → write). */
  private direction: TransferDirection = 'idle'
  /** LBA of the current transfer's next sector. */
  private currentSector = 0
  /** Bytes remaining in the current sector. */
  private bytesInSector = 0
  /** Total sectors remaining (for multi-block transfers). */
  private sectorsRemaining = 0
  /** Staging buffer for one sector's worth of bytes. */
  private sectorBuf: Uint8Array = new Uint8Array(SECTOR_BYTES)
  /** Write-side byte cursor within the sector buffer. */
  private writeOffset = 0
  /** Read-side byte cursor within the sector buffer. */
  private readOffset = 0

  constructor() {
    super()
    this.reset()
  }

  /** Attach a disk image. Sector count = image.length / 512. */
  attachImage(image: Uint8Array): void {
    this.image = image
  }

  /** Number of 512-byte sectors backing the stub. */
  get sectorCount(): number {
    return (this.image.byteLength / SECTOR_BYTES) | 0
  }

  reset(): void {
    super.reset()
    this.direction = 'idle'
    this.currentSector = 0
    this.bytesInSector = 0
    this.sectorsRemaining = 0
    this.writeOffset = 0
    this.readOffset = 0
    // SD_INFO2 starts with bus-idle + write-buffer-ready asserted so the
    // firmware's "bus ready" poll completes immediately.
    super.write16(OFF_SD_INFO2, INFO2_SCLKDIVEN | INFO2_WE)
    super.write16(OFF_SD_INFO1_MASK, 0x031d)
    super.write16(OFF_SD_INFO2_MASK, 0x8b7f)
    super.write16(OFF_SD_OPTION, 0x00bd)
    super.write16(OFF_SD_SIZE, SECTOR_BYTES)
    super.write16(OFF_VERSION, 0x001a) // RZ/A1L SDHI v1.a
    // Signal card inserted — some drivers poll this.
    const info1 = super.read16(OFF_SD_INFO1) | INFO1_INS_CD
    super.write16(OFF_SD_INFO1, info1 & 0xffff)
  }

  // ---------------------------------------------------------------------------
  // Command handling (writes to SD_CMD trigger state transitions)
  // ---------------------------------------------------------------------------

  write16(offset: number, value: number): void {
    const local = offset & 0xff
    if (local === OFF_SD_INFO1) {
      // Writing to SD_INFO1 clears the bits that are set in `value` (W1C).
      const current = super.read16(OFF_SD_INFO1)
      super.write16(OFF_SD_INFO1, (current & ~(value & 0xffff)) & 0xffff)
      return
    }
    if (local === OFF_SD_INFO2) {
      const current = super.read16(OFF_SD_INFO2)
      super.write16(OFF_SD_INFO2, (current & ~(value & 0xffff)) & 0xffff)
      return
    }
    super.write16(offset, value)
    if (local === OFF_SD_CMD) this.issueCommand(value & 0xffff)
  }

  write32(offset: number, value: number): void {
    const local = offset & 0xff
    if (local === OFF_SD_BUF0) {
      this.pushWriteWord(value >>> 0)
      return
    }
    super.write32(offset, value)
  }

  read32(offset: number): number {
    const local = offset & 0xff
    if (local === OFF_SD_BUF0) {
      return this.popReadWord()
    }
    return super.read32(offset)
  }

  private issueCommand(cmd: number): void {
    // Command byte is low 6 bits. Upper bits of the 16-bit SD_CMD
    // carry transfer flags we ignore for now.
    const cmdIdx = cmd & 0x3f
    const argLo = super.read16(OFF_SD_ARG0)
    const argHi = super.read16(OFF_SD_ARG1)
    const arg = ((argHi << 16) | argLo) >>> 0
    const seccnt = super.read16(OFF_SD_SECCNT) || 1

    // Default R1-style response: status = 0, card state = transfer (4).
    this.writeResponse(0x00000900)

    switch (cmdIdx) {
      case CMD_GO_IDLE_STATE:
      case CMD_SEND_STATUS:
      case CMD_SET_BLOCKLEN:
        // Nothing to do — response already set.
        break
      case CMD_SEND_CSD: {
        // Minimal CSD that reports the card size.
        // C_SIZE field = sectorCount/1024 - 1 (SDHC formula).
        const csize = Math.max(0, (this.sectorCount >>> 10) - 1)
        const csd0 = (csize >>> 16) & 0xffff
        const csd1 = csize & 0xffff
        this.writeResponse((csd1 << 16) | csd0)
        break
      }
      case CMD_STOP_TRANSMISSION:
        this.direction = 'idle'
        this.sectorsRemaining = 0
        break
      case CMD_READ_SINGLE_BLOCK:
        this.beginRead(arg, 1)
        break
      case CMD_READ_MULTIPLE_BLOCK:
        this.beginRead(arg, seccnt)
        break
      case CMD_WRITE_SINGLE_BLOCK:
        this.beginWrite(arg, 1)
        break
      case CMD_WRITE_MULTIPLE_BLOCK:
        this.beginWrite(arg, seccnt)
        break
      default:
        // Unknown command — just ack it.
        break
    }

    // Mark response ready.
    const info1 = super.read16(OFF_SD_INFO1) | INFO1_RESP
    super.write16(OFF_SD_INFO1, info1 & 0xffff)
  }

  private writeResponse(r: number): void {
    super.write16(OFF_SD_RESP0, r & 0xffff)
    super.write16(OFF_SD_RESP0 + 2, (r >>> 16) & 0xffff)
  }

  // ---------------------------------------------------------------------------
  // Read path: load a sector into sectorBuf, expose via SD_BUF0 (32-bit)
  // ---------------------------------------------------------------------------

  private beginRead(lba: number, sectors: number): void {
    this.direction = 'read'
    this.currentSector = lba >>> 0
    this.sectorsRemaining = sectors
    this.loadNextSectorIntoBuf()
  }

  private loadNextSectorIntoBuf(): void {
    if (this.sectorsRemaining === 0) {
      this.direction = 'idle'
      return
    }
    const byteOffset = this.currentSector * SECTOR_BYTES
    if (byteOffset + SECTOR_BYTES <= this.image.byteLength) {
      this.sectorBuf.set(
        this.image.subarray(byteOffset, byteOffset + SECTOR_BYTES),
      )
    } else {
      this.sectorBuf.fill(0)
    }
    this.readOffset = 0
    this.bytesInSector = SECTOR_BYTES
    // Assert "buffer has data" so the DMAC pump pulls from SD_BUF0.
    const info2 = super.read16(OFF_SD_INFO2) | INFO2_RE
    super.write16(OFF_SD_INFO2, info2 & 0xffff)
  }

  private popReadWord(): number {
    if (this.direction !== 'read' || this.bytesInSector < 4) return 0
    const o = this.readOffset
    const value =
      (this.sectorBuf[o] |
        (this.sectorBuf[o + 1] << 8) |
        (this.sectorBuf[o + 2] << 16) |
        (this.sectorBuf[o + 3] << 24)) >>>
      0
    this.readOffset += 4
    this.bytesInSector -= 4
    if (this.bytesInSector === 0) this.finishReadSector()
    return value
  }

  private finishReadSector(): void {
    // De-assert RE until the next sector is ready.
    const info2 = super.read16(OFF_SD_INFO2) & ~INFO2_RE
    super.write16(OFF_SD_INFO2, info2 & 0xffff)
    this.currentSector++
    this.sectorsRemaining--
    if (this.sectorsRemaining > 0) {
      this.loadNextSectorIntoBuf()
    } else {
      this.direction = 'idle'
      // All-end flag
      const info1 = super.read16(OFF_SD_INFO1) | INFO1_DATA_TRNS
      super.write16(OFF_SD_INFO1, info1 & 0xffff)
    }
  }

  // ---------------------------------------------------------------------------
  // Write path: accept words via SD_BUF0, flush to the image each sector
  // ---------------------------------------------------------------------------

  private beginWrite(lba: number, sectors: number): void {
    this.direction = 'write'
    this.currentSector = lba >>> 0
    this.sectorsRemaining = sectors
    this.writeOffset = 0
    this.bytesInSector = SECTOR_BYTES
    // Assert WE so firmware/DMA pushes data to SD_BUF0.
    const info2 = super.read16(OFF_SD_INFO2) | INFO2_WE
    super.write16(OFF_SD_INFO2, info2 & 0xffff)
  }

  private pushWriteWord(word: number): void {
    if (this.direction !== 'write' || this.bytesInSector < 4) return
    const o = this.writeOffset
    this.sectorBuf[o] = word & 0xff
    this.sectorBuf[o + 1] = (word >>> 8) & 0xff
    this.sectorBuf[o + 2] = (word >>> 16) & 0xff
    this.sectorBuf[o + 3] = (word >>> 24) & 0xff
    this.writeOffset += 4
    this.bytesInSector -= 4
    if (this.bytesInSector === 0) this.flushWriteSector()
  }

  private flushWriteSector(): void {
    const byteOffset = this.currentSector * SECTOR_BYTES
    if (byteOffset + SECTOR_BYTES <= this.image.byteLength) {
      this.image.set(this.sectorBuf, byteOffset)
    }
    this.currentSector++
    this.sectorsRemaining--
    this.writeOffset = 0
    this.bytesInSector = SECTOR_BYTES
    if (this.sectorsRemaining === 0) {
      this.direction = 'idle'
      const info1 = super.read16(OFF_SD_INFO1) | INFO1_DATA_TRNS
      super.write16(OFF_SD_INFO1, info1 & 0xffff)
    }
  }
}

export const SDHI_REG_OFFSETS = {
  SD_CMD: OFF_SD_CMD,
  SD_ARG0: OFF_SD_ARG0,
  SD_ARG1: OFF_SD_ARG1,
  SD_STOP: OFF_SD_STOP,
  SD_SECCNT: OFF_SD_SECCNT,
  SD_RESP0: OFF_SD_RESP0,
  SD_INFO1: OFF_SD_INFO1,
  SD_INFO2: OFF_SD_INFO2,
  SD_SIZE: OFF_SD_SIZE,
  SD_OPTION: OFF_SD_OPTION,
  SD_BUF0: OFF_SD_BUF0,
  CC_EXT_MODE: OFF_CC_EXT_MODE,
  SOFT_RST: OFF_SOFT_RST,
  VERSION: OFF_VERSION,
  EXT_SWAP: OFF_EXT_SWAP,
} as const

export const SDHI_INFO1_BITS = {
  RESP: INFO1_RESP,
  DATA_TRNS: INFO1_DATA_TRNS,
  INS_CD: INFO1_INS_CD,
} as const

export const SDHI_INFO2_BITS = {
  RE: INFO2_RE,
  WE: INFO2_WE,
  SCLKDIVEN: INFO2_SCLKDIVEN,
  CBSY: INFO2_CBSY,
} as const

export const SDHI_BASE_ADDR = SDHI_BASE
