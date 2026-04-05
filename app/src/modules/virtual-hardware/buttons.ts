// Deluge hardware button layout.
//
// Button IDs match the names in the firmware's `deluge::hid::Button` enum
// (see DelugeFirmware/src/deluge/hid/button.h). Grouping here is purely
// visual — the real hardware has these buttons scattered across the device;
// we arrange them into logical rows for a desktop UI.

import type { HardwareButton } from '@/components/hardware/ButtonBar.vue'

export const TRANSPORT_BUTTONS: HardwareButton[] = [
  { id: 'PLAY', label: 'Play', hasLed: true, accent: 'primary' },
  { id: 'RECORD', label: 'Rec', hasLed: true, accent: 'danger' },
  { id: 'TAP_TEMPO', label: 'Tap', hasLed: true },
  { id: 'SHIFT', label: 'Shift', accent: 'mod' },
]

export const MODE_BUTTONS: HardwareButton[] = [
  { id: 'SESSION_VIEW', label: 'Session', hasLed: true },
  { id: 'CLIP_VIEW', label: 'Clip', hasLed: true },
  { id: 'SCALE_MODE', label: 'Scale', hasLed: true },
  { id: 'CROSS_SCREEN_EDIT', label: 'CrossScr', hasLed: true },
  { id: 'KEYBOARD', label: 'Keyboard', hasLed: true },
  { id: 'AFFECT_ENTIRE', label: 'Affect', hasLed: true },
]

export const INSTRUMENT_BUTTONS: HardwareButton[] = [
  { id: 'SYNTH', label: 'Synth', hasLed: true },
  { id: 'KIT', label: 'Kit', hasLed: true },
  { id: 'MIDI', label: 'MIDI', hasLed: true },
  { id: 'CV', label: 'CV', hasLed: true },
]

export const FILE_BUTTONS: HardwareButton[] = [
  { id: 'BACK', label: 'Back' },
  { id: 'LOAD', label: 'Load' },
  { id: 'SAVE', label: 'Save' },
  { id: 'LEARN', label: 'Learn', hasLed: true },
  { id: 'SYNC_SCALING', label: 'Sync' },
  { id: 'TRIPLETS', label: 'Triplets', hasLed: true },
]

export const ENCODER_BUTTONS: HardwareButton[] = [
  { id: 'X_ENC', label: '◀▶', accent: 'normal' },
  { id: 'Y_ENC', label: '▲▼', accent: 'normal' },
  { id: 'SELECT_ENC', label: 'Select', accent: 'normal' },
  { id: 'TEMPO_ENC', label: 'Tempo', accent: 'normal' },
]

export const ALL_BUTTONS: HardwareButton[] = [
  ...TRANSPORT_BUTTONS,
  ...MODE_BUTTONS,
  ...INSTRUMENT_BUTTONS,
  ...FILE_BUTTONS,
  ...ENCODER_BUTTONS,
]

/** Valid button IDs as a lookup set. */
export const BUTTON_IDS: ReadonlySet<string> = new Set(
  ALL_BUTTONS.map((b) => b.id),
)
