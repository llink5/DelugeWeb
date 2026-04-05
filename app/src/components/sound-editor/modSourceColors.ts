// Fixed colour palette for modulation source indicators.
// Light/dark variants are chosen for sufficient contrast against the card
// background in both themes. Light variants are used throughout; the dark
// variants are exposed for callers that theme their output.

export interface ModSourceColor {
  light: string
  dark: string
}

export const MOD_SOURCE_COLORS: Record<string, ModSourceColor> = {
  envelope1: { light: '#D85A30', dark: '#F0997B' },
  envelope2: { light: '#D4537E', dark: '#ED93B1' },
  lfo1: { light: '#378ADD', dark: '#85B7EB' },
  lfo2: { light: '#1D9E75', dark: '#5DCAA5' },
  velocity: { light: '#BA7517', dark: '#FAC775' },
  note: { light: '#7F77DD', dark: '#AFA9EC' },
  sidechain: { light: '#888780', dark: '#B4B2A9' },
  compressor: { light: '#888780', dark: '#B4B2A9' },
  aftertouch: { light: '#E24B4A', dark: '#F09595' },
  random: { light: '#639922', dark: '#97C459' },
}

const FALLBACK: ModSourceColor = { light: '#64748B', dark: '#94A3B8' }

export function colorForSource(sourceId: string): ModSourceColor {
  return MOD_SOURCE_COLORS[sourceId] ?? FALLBACK
}

export function labelForSource(sourceId: string): string {
  const labels: Record<string, string> = {
    envelope1: 'Env 1',
    envelope2: 'Env 2',
    lfo1: 'LFO 1',
    lfo2: 'LFO 2',
    velocity: 'Velocity',
    note: 'Note',
    sidechain: 'Sidechain',
    compressor: 'Sidechain',
    aftertouch: 'Aftertouch',
    random: 'Random',
  }
  return labels[sourceId] ?? sourceId
}
