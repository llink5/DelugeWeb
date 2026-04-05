// PIC input-message encoder.
//
// The Deluge firmware reads pad/button events as a UART stream of response
// bytes from the PIC microcontroller. This module encodes user events into
// the exact byte sequences the firmware expects, matching
// `Pad::toChar()` in firmware `src/deluge/hid/matrix/pad.cpp`:
//
//   value = 9 * y + (x / 2)
//   if (x % 2 == 1) value += 9 * kDisplayHeight = 72
//
// Valid pad values are 0..143 (kDisplayHeight * 2 * 9). The RX stream
// interleaves bytes with control codes:
//
//   byte 0..143      : pad/button id for a press (default velocity)
//   byte 144..179    : hardware button id for a press
//   byte 252         : NEXT_PAD_OFF — the next pad/button byte is a release
//   byte 254         : NO_PRESSES_HAPPENING — all inputs reset

import { PIC_ROWS } from './PicUartDecoder'

export const PIC_RESPONSE_NEXT_PAD_OFF = 252
export const PIC_RESPONSE_NO_PRESSES_HAPPENING = 254
export const PIC_PAD_MAX = 144 // exclusive upper bound

/**
 * Encode a pad address into its PIC response byte. Matches the firmware
 * formula in pad.cpp. Accepts x=0..17 (16 main + 2 sidebar) and y=0..7.
 */
export function encodePadByte(x: number, y: number): number {
  if (y < 0 || y >= PIC_ROWS) {
    throw new Error(`Pad y out of range: ${y}`)
  }
  if (x < 0 || x >= 18) {
    throw new Error(`Pad x out of range: ${x}`)
  }
  let value = 9 * y + ((x / 2) | 0)
  if ((x & 1) === 1) value += 9 * PIC_ROWS // +72
  return value & 0xff
}

/** Encode a pad-press event as a byte sequence (just the pad byte). */
export function encodePadPress(x: number, y: number): number[] {
  return [encodePadByte(x, y)]
}

/** Encode a pad-release event: NEXT_PAD_OFF followed by the pad byte. */
export function encodePadRelease(x: number, y: number): number[] {
  return [PIC_RESPONSE_NEXT_PAD_OFF, encodePadByte(x, y)]
}

/**
 * Reverse of `encodePadByte` — matches Pad::Pad(uint8_t) in pad.cpp.
 * Returns null if the byte isn't in the pad range.
 */
export function decodePadByte(byte: number): { x: number; y: number } | null {
  if (byte < 0 || byte >= PIC_PAD_MAX) return null
  let y = (byte / 9) | 0
  let x = (byte - y * 9) << 1
  if (y >= PIC_ROWS) {
    y -= PIC_ROWS
    x++
  }
  return { x, y }
}

// ---------------------------------------------------------------------------
// Hardware buttons (PIC bytes 144..179)
// ---------------------------------------------------------------------------
//
// Firmware formula: `byte = 9 * (y + kDisplayHeight*2) + x` where (x,y)
// is the button matrix coordinate. Values 0..8 for x, 0..3 for y puts
// every button into 144..179. Coords come from definitions_cxx.hpp's
// *ButtonCoord constants.

/** Encode a hardware button position to its PIC byte. */
export function encodeButtonByte(x: number, y: number): number {
  if (x < 0 || x > 8) throw new Error(`Button x out of range: ${x}`)
  if (y < 0 || y > 3) throw new Error(`Button y out of range: ${y}`)
  return 9 * (y + 2 * PIC_ROWS) + x
}

/** Named hardware buttons on the Deluge, with their PIC byte values. */
export const DELUGE_BUTTONS: Record<string, number> = {
  // Button matrix coords from src/definitions_cxx.hpp
  Y_ENC: encodeButtonByte(0, 0), // 144
  X_ENC: encodeButtonByte(0, 1), // 153
  MOD_ENCODER_0: encodeButtonByte(0, 2), // 162
  MOD_ENCODER_1: encodeButtonByte(0, 3), // 171
  AFFECT_ENTIRE: encodeButtonByte(3, 0), // 147
  SESSION_VIEW: encodeButtonByte(3, 1), // 156
  CLIP_VIEW: encodeButtonByte(3, 2), // 165
  KEYBOARD: encodeButtonByte(3, 3), // 174
  TEMPO_ENC: encodeButtonByte(4, 1), // 157
  SELECT_ENC: encodeButtonByte(4, 3), // 175
  SYNTH: encodeButtonByte(5, 0), // 149
  KIT: encodeButtonByte(5, 1), // 158
  MIDI: encodeButtonByte(5, 2), // 167
  CV: encodeButtonByte(5, 3), // 176
  SCALE_MODE: encodeButtonByte(6, 0), // 150
  LOAD: encodeButtonByte(6, 1), // 159
  CROSS_SCREEN_EDIT: encodeButtonByte(6, 2), // 168
  SAVE: encodeButtonByte(6, 3), // 177
  LEARN: encodeButtonByte(7, 0), // 151
  BACK: encodeButtonByte(7, 1), // 160
  SYNC_SCALING: encodeButtonByte(7, 2), // 169
  TAP_TEMPO: encodeButtonByte(7, 3), // 178
  SHIFT: encodeButtonByte(8, 0), // 152
  TRIPLETS: encodeButtonByte(8, 1), // 161
  RECORD: encodeButtonByte(8, 2), // 170
  PLAY: encodeButtonByte(8, 3), // 179
} as const

/** Encode a button press as a single-byte sequence. */
export function encodeButtonPress(buttonId: string): number[] {
  const byte = DELUGE_BUTTONS[buttonId]
  if (byte === undefined) throw new Error(`Unknown button: ${buttonId}`)
  return [byte]
}

/** Encode a button release: NEXT_PAD_OFF prefix + button byte. */
export function encodeButtonRelease(buttonId: string): number[] {
  const byte = DELUGE_BUTTONS[buttonId]
  if (byte === undefined) throw new Error(`Unknown button: ${buttonId}`)
  return [PIC_RESPONSE_NEXT_PAD_OFF, byte]
}
