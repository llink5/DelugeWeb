// Virtual HID — inject human-input events into the emulator's memory.
//
// On hardware the PIC microcontroller writes button/pad state into a fixed
// memory region that the firmware polls. The emulator simulates the PIC
// side: when the user presses a virtual button, we write to the same
// address the PIC would have written to. The firmware's polling loop
// picks it up and reacts.
//
// The actual memory addresses depend on the firmware build — they aren't
// exposed in a public header we can consume from here. VirtualHID accepts
// a pluggable `HIDMapping` so the caller (usually a Vue view) supplies
// them after reading the target firmware. A default mapping is provided
// for the Deluge's known layout where we have one.

import type { DelugeEmulator } from './DelugeEmulator'

export interface ButtonMapping {
  /** Byte address of the status byte. */
  address: number
  /** Bit within that byte (0..7). */
  bit: number
}

export interface PadMapping {
  /** Base address of the 16×8 pad state array (1 byte per pad). */
  baseAddress: number
  /** Row stride in bytes. Default = 16 (one byte per column). */
  stride?: number
}

export interface EncoderMapping {
  /** Byte address of a signed delta accumulator (8-bit signed). */
  deltaAddress: number
  /** Byte address of a button-style "pressed" flag. */
  pressAddress?: number
  /** Bit index within the press byte. */
  pressBit?: number
}

export interface HIDMapping {
  buttons: Record<string, ButtonMapping>
  pads?: PadMapping
  auditionPads?: PadMapping
  encoders?: Record<string, EncoderMapping>
}

/**
 * Default mapping — placeholder addresses in RAM. Real firmware addresses
 * are build-dependent; override this with values resolved against your
 * specific ELF.
 */
export const PLACEHOLDER_HID_MAPPING: HIDMapping = {
  buttons: {
    PLAY:       { address: 0x20200000, bit: 0 },
    RECORD:     { address: 0x20200000, bit: 1 },
    SHIFT:      { address: 0x20200000, bit: 2 },
    TAP_TEMPO:  { address: 0x20200000, bit: 3 },
    BACK:       { address: 0x20200001, bit: 0 },
    LOAD:       { address: 0x20200001, bit: 1 },
    SAVE:       { address: 0x20200001, bit: 2 },
    LEARN:      { address: 0x20200001, bit: 3 },
    SYNTH:      { address: 0x20200002, bit: 0 },
    KIT:        { address: 0x20200002, bit: 1 },
    MIDI:       { address: 0x20200002, bit: 2 },
    CV:         { address: 0x20200002, bit: 3 },
    KEYBOARD:   { address: 0x20200002, bit: 4 },
    SESSION_VIEW: { address: 0x20200003, bit: 0 },
    CLIP_VIEW:    { address: 0x20200003, bit: 1 },
    SCALE_MODE:   { address: 0x20200003, bit: 2 },
    CROSS_SCREEN_EDIT: { address: 0x20200003, bit: 3 },
    AFFECT_ENTIRE:     { address: 0x20200003, bit: 4 },
    SYNC_SCALING:      { address: 0x20200003, bit: 5 },
    TRIPLETS:          { address: 0x20200003, bit: 6 },
    X_ENC:      { address: 0x20200004, bit: 0 },
    Y_ENC:      { address: 0x20200004, bit: 1 },
    SELECT_ENC: { address: 0x20200004, bit: 2 },
    TEMPO_ENC:  { address: 0x20200004, bit: 3 },
  },
  pads: {
    baseAddress: 0x20200100,
    stride: 16,
  },
  auditionPads: {
    baseAddress: 0x20200180,
    stride: 1,
  },
  encoders: {
    X_ENC:      { deltaAddress: 0x20200008, pressAddress: 0x20200004, pressBit: 0 },
    Y_ENC:      { deltaAddress: 0x20200009, pressAddress: 0x20200004, pressBit: 1 },
    SELECT_ENC: { deltaAddress: 0x2020000a, pressAddress: 0x20200004, pressBit: 2 },
    TEMPO_ENC:  { deltaAddress: 0x2020000b, pressAddress: 0x20200004, pressBit: 3 },
  },
}

/**
 * A HID injector. All methods are async because they push writes through
 * the worker via DelugeEmulator's message protocol. Callers can batch by
 * awaiting `flush()` (where relevant in future).
 */
export class VirtualHID {
  constructor(
    private readonly emulator: DelugeEmulator,
    public mapping: HIDMapping = PLACEHOLDER_HID_MAPPING,
  ) {}

  /** Update the bit mask byte at `address` with `bit` set to `value` (0|1). */
  private async setBit(
    address: number,
    bit: number,
    value: 0 | 1,
  ): Promise<void> {
    // Read the current byte so we can flip just one bit.
    const reply = await this.emulator.readMem(address, 1)
    let current = 0
    if (reply.type === 'memData' && reply.ok) {
      current = new Uint8Array(reply.data)[0] ?? 0
    }
    const mask = 1 << (bit & 0x7)
    const next = value ? current | mask : current & ~mask
    const buf = new ArrayBuffer(1)
    new Uint8Array(buf)[0] = next & 0xff
    await this.emulator.writeMem(address, buf)
  }

  private async writeByte(address: number, value: number): Promise<void> {
    const buf = new ArrayBuffer(1)
    new Uint8Array(buf)[0] = value & 0xff
    await this.emulator.writeMem(address, buf)
  }

  private async writeSignedByte(address: number, value: number): Promise<void> {
    const clamped = Math.max(-128, Math.min(127, value | 0))
    const byte = clamped < 0 ? clamped + 256 : clamped
    await this.writeByte(address, byte)
  }

  // ---------------------------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------------------------

  async pressButton(id: string): Promise<void> {
    const m = this.mapping.buttons[id]
    if (!m) throw new Error(`Unknown button: ${id}`)
    await this.setBit(m.address, m.bit, 1)
  }

  async releaseButton(id: string): Promise<void> {
    const m = this.mapping.buttons[id]
    if (!m) throw new Error(`Unknown button: ${id}`)
    await this.setBit(m.address, m.bit, 0)
  }

  // ---------------------------------------------------------------------------
  // Pads — one byte per pad: 0 = released, 1..127 = velocity
  // ---------------------------------------------------------------------------

  async pressPad(x: number, y: number, velocity = 64): Promise<void> {
    const pads = this.mapping.pads
    if (!pads) throw new Error('No pad mapping configured')
    const stride = pads.stride ?? 16
    const addr = pads.baseAddress + y * stride + x
    await this.writeByte(addr, Math.max(1, Math.min(127, velocity | 0)))
  }

  async releasePad(x: number, y: number): Promise<void> {
    const pads = this.mapping.pads
    if (!pads) throw new Error('No pad mapping configured')
    const stride = pads.stride ?? 16
    const addr = pads.baseAddress + y * stride + x
    await this.writeByte(addr, 0)
  }

  async pressAuditionPad(row: number, velocity = 64): Promise<void> {
    const audition = this.mapping.auditionPads
    if (!audition) throw new Error('No audition pad mapping')
    const addr = audition.baseAddress + row * (audition.stride ?? 1)
    await this.writeByte(addr, Math.max(1, Math.min(127, velocity | 0)))
  }

  async releaseAuditionPad(row: number): Promise<void> {
    const audition = this.mapping.auditionPads
    if (!audition) throw new Error('No audition pad mapping')
    const addr = audition.baseAddress + row * (audition.stride ?? 1)
    await this.writeByte(addr, 0)
  }

  // ---------------------------------------------------------------------------
  // Encoders — cumulative signed delta, +1 or -1 per tick
  // ---------------------------------------------------------------------------

  async turnEncoder(id: string, delta: number): Promise<void> {
    const enc = this.mapping.encoders?.[id]
    if (!enc) throw new Error(`Unknown encoder: ${id}`)
    // Read + add + write. Firmware is expected to consume and zero the
    // delta itself, so we don't read-add-write atomically.
    const reply = await this.emulator.readMem(enc.deltaAddress, 1)
    let current = 0
    if (reply.type === 'memData' && reply.ok) {
      const b = new Uint8Array(reply.data)[0] ?? 0
      current = b > 127 ? b - 256 : b
    }
    await this.writeSignedByte(enc.deltaAddress, current + delta)
  }

  async pressEncoder(id: string): Promise<void> {
    const enc = this.mapping.encoders?.[id]
    if (!enc || enc.pressAddress === undefined || enc.pressBit === undefined) {
      throw new Error(`Encoder ${id} has no press mapping`)
    }
    await this.setBit(enc.pressAddress, enc.pressBit, 1)
  }

  async releaseEncoder(id: string): Promise<void> {
    const enc = this.mapping.encoders?.[id]
    if (!enc || enc.pressAddress === undefined || enc.pressBit === undefined) {
      throw new Error(`Encoder ${id} has no press mapping`)
    }
    await this.setBit(enc.pressAddress, enc.pressBit, 0)
  }
}
