// Manually-authored approximate struct layouts for the Deluge firmware.
//
// These mirror the most-useful top-level classes for live debugging. Field
// offsets are compiler-dependent; real values come from the ELF's DWARF
// debug info when available. The layouts here are a reasonable starting
// point that the UI can surface; developers override specific fields when
// they verify against their build.

import type { StructDefinition } from './StructWalker'

// Song — top-level song state. The firmware keeps a global pointer
// `currentSong` pointing at the active instance.
export const Song: StructDefinition = {
  name: 'Song',
  size: 0x400,
  fields: [
    { name: 'vtable', offset: 0x00, type: 'ptr' },
    { name: 'firstClip', offset: 0x10, type: 'ptr', pointsTo: 'Clip' },
    { name: 'sessionClips', offset: 0x18, type: 'ptr' },
    { name: 'firstOutput', offset: 0x20, type: 'ptr', pointsTo: 'Output' },
    { name: 'tempoMagnitude', offset: 0x30, type: 'i32' },
    { name: 'swingAmount', offset: 0x34, type: 'i32' },
    { name: 'swingInterval', offset: 0x38, type: 'u8' },
    { name: 'rootNote', offset: 0x3c, type: 'i16' },
    { name: 'playbackState', offset: 0x40, type: 'u8' },
    { name: 'sectionCount', offset: 0x44, type: 'u8' },
  ],
}

// Sound — a synth voice instance
export const Sound: StructDefinition = {
  name: 'Sound',
  size: 0x800,
  fields: [
    { name: 'vtable', offset: 0x00, type: 'ptr' },
    { name: 'synthMode', offset: 0x10, type: 'u8' },
    { name: 'polyphonic', offset: 0x14, type: 'u8' },
    { name: 'transpose', offset: 0x18, type: 'i16' },
    { name: 'lpfMode', offset: 0x1c, type: 'u8' },
    { name: 'modFXType', offset: 0x20, type: 'u8' },
    { name: 'osc1', offset: 0x30, type: 'ptr', pointsTo: 'Oscillator' },
    { name: 'osc2', offset: 0x38, type: 'ptr', pointsTo: 'Oscillator' },
    { name: 'paramManager', offset: 0x40, type: 'ptr' },
    { name: 'numUnison', offset: 0x50, type: 'u8' },
    { name: 'unisonDetune', offset: 0x54, type: 'i16' },
  ],
}

// Oscillator — one of the two per-sound oscillators
export const Oscillator: StructDefinition = {
  name: 'Oscillator',
  size: 0x80,
  fields: [
    { name: 'vtable', offset: 0x00, type: 'ptr' },
    { name: 'type', offset: 0x08, type: 'u8' },
    { name: 'transpose', offset: 0x0c, type: 'i16' },
    { name: 'cents', offset: 0x10, type: 'i8' },
    { name: 'retrigPhase', offset: 0x14, type: 'i32' },
    { name: 'loopMode', offset: 0x18, type: 'u8' },
    { name: 'reversed', offset: 0x1c, type: 'bool' },
  ],
}

// Clip — a session clip (parent of InstrumentClip / AudioClip)
export const Clip: StructDefinition = {
  name: 'Clip',
  size: 0x200,
  fields: [
    { name: 'vtable', offset: 0x00, type: 'ptr' },
    { name: 'next', offset: 0x08, type: 'ptr', pointsTo: 'Clip' },
    { name: 'type', offset: 0x10, type: 'u8' },
    { name: 'length', offset: 0x14, type: 'i32' },
    { name: 'colourOffset', offset: 0x18, type: 'u8' },
    { name: 'section', offset: 0x1c, type: 'u8' },
    { name: 'output', offset: 0x20, type: 'ptr', pointsTo: 'Output' },
    { name: 'isPlaying', offset: 0x24, type: 'bool' },
    { name: 'isSoloing', offset: 0x25, type: 'bool' },
  ],
}

// Output — abstract output (MIDI/CV/Audio/Synth/Kit)
export const Output: StructDefinition = {
  name: 'Output',
  size: 0x100,
  fields: [
    { name: 'vtable', offset: 0x00, type: 'ptr' },
    { name: 'next', offset: 0x08, type: 'ptr', pointsTo: 'Output' },
    { name: 'type', offset: 0x10, type: 'u8' },
    { name: 'name', offset: 0x14, type: 'ptr' },
    { name: 'muted', offset: 0x18, type: 'bool' },
  ],
}

// MIDIEngine — the MIDI I/O subsystem
export const MidiEngine: StructDefinition = {
  name: 'MidiEngine',
  size: 0x80,
  fields: [
    { name: 'vtable', offset: 0x00, type: 'ptr' },
    { name: 'numDevices', offset: 0x08, type: 'u8' },
    { name: 'midiThru', offset: 0x0c, type: 'bool' },
    { name: 'midiClockOut', offset: 0x10, type: 'bool' },
    { name: 'lastStatusByte', offset: 0x14, type: 'u8' },
  ],
}

export const DELUGE_STRUCTS: StructDefinition[] = [
  Song,
  Sound,
  Oscillator,
  Clip,
  Output,
  MidiEngine,
]

/**
 * Known global symbol names the debugger should offer as entry points for
 * struct walking.
 */
export const KNOWN_GLOBALS: Array<{ symbol: string; type: string }> = [
  { symbol: 'currentSong', type: 'Song' },
  { symbol: 'midiEngine', type: 'MidiEngine' },
]
