// Element ordering table for Deluge XML serialization.
// JavaScript does not guarantee key enumeration order, so we use this table
// to ensure XML elements are written in the order the Deluge firmware expects.
// Ported from downrush/viewScore/src/keyOrderTab.js

export const keyOrderTab: Record<string, string[]> = {
  song: [
    'previewNumPads', 'preview', 'inArrangementView', 'xScrollSongView',
    'xZoomSongView', 'arrangementAutoScrollOn', 'xScroll', 'xZoom',
    'yScrollSongView', 'yScrollArrangementView', 'xScrollArrangementView',
    'xZoomArrangementView', 'timePerTimerTick', 'timerTickFraction',
    'rootNote', 'inputTickMagnitude', 'swingAmount', 'swingInterval',
    'modeNotes', 'reverb', 'affectEntire', 'activeModFunction', 'lpfMode',
    'modFXType', 'delay', 'compressor', 'modFXCurrentParam',
    'currentFilterType', 'songParams', 'instruments', 'sessionClips',
    'sections', 'tracks', 'arrangementOnlyTracks',
  ],
  modeNotes: ['modeNote'],
  reverb: ['roomSize', 'dampening', 'width', 'pan', 'compressor'],
  compressor: ['syncLevel', 'attack', 'release', 'volume'],
  delay: ['rate', 'feedback', 'pingPong', 'analog', 'syncLevel'],
  songParams: [
    'delay', 'reverbAmount', 'volume', 'pan', 'lpf', 'hpf', 'modFXDepth',
    'modFXRate', 'stutterRate', 'sampleRateReduction', 'bitCrush',
    'equalizer', 'modFXOffset', 'modFXFeedback',
  ],
  lpf: ['frequency', 'resonance'],
  hpf: ['frequency', 'resonance'],
  equalizer: ['bass', 'treble', 'bassFrequency', 'trebleFrequency'],
  sections: ['section'],
  section: ['id', 'numRepeats'],
  tracks: ['track'],
  track: [
    'inKeyMode', 'yScroll', 'yScrollKeyboard', 'status', 'isPlaying',
    'isSoloing', 'playEnabledAtStart', 'trackLength', 'colourOffset',
    'crossScreenEditLevel', 'beingEdited', 'affectEntire',
    'activeModFunction', 'instrument', 'instrumentPresetSlot',
    'instrumentPresetSubSlot', 'arpeggiator', 'midiChannel', 'midiParams',
    'modKnobs', 'section', 'sound', 'soundParams', 'kit', 'kitParams',
    'noteRows',
  ],
  instrumentClip: [
    'inKeyMode', 'yScroll', 'yScrollKeyboard', 'affectEntire', 'status',
    'instrumentPresetSlot', 'instrumentPresetSubSlot', 'isPlaying',
    'isSoloing', 'isArmedForRecording', 'length', 'colourOffset',
    'crossScreenEditLevel', 'beingEdited', 'affectEntire',
    'activeModFunction', 'instrument', 'arpeggiator', 'midiChannel',
    'midiParams', 'modKnobs', 'section', 'sound', 'soundParams', 'kit',
    'kitParams', 'noteRows',
  ],
  instrument: ['referToTrackId'],
  modKnobs: ['modKnob'],
  modKnob: ['controlsParam', 'patchAmountFromSource', 'cc', 'value'],
  noteRows: ['noteRow'],
  noteRow: [
    'y', 'muted', 'colourOffset', 'drumIndex', 'soundParams', 'notes',
    'noteData', 'noteDataWithLift',
  ],
  notes: ['note'],
  note: ['length', 'velocity', 'pos'],
  kit: [
    'lpfMode', 'modFXType', 'delay', 'compressor', 'modFXCurrentParam',
    'currentFilterType', 'presetSlot', 'presetSubSlot', 'trackInstances',
    'clipInstances', 'defaultParams', 'soundSources', 'selectedDrumIndex',
  ],
  sound: [
    'presetSlot', 'presetSubSlot', 'trackInstances', 'clipInstances', 'name',
    'osc1', 'osc2', 'polyphonic', 'clippingAmount', 'voicePriority',
    'sideChainSend', 'lfo1', 'lfo2', 'mode', 'modulator1', 'modulator2',
    'transpose', 'unison', 'compressor', 'lpfMode', 'modFXType', 'delay',
    'arpeggiator', 'defaultParams', 'midiKnobs', 'modKnobs',
  ],
  osc1: [
    'type', 'transpose', 'cents', 'retrigPhase', 'loopMode', 'reversed',
    'timeStretchEnable', 'timeStretchAmount', 'linearInterpolation',
    'sampleRanges', 'fileName', 'zone',
  ],
  zone: ['startMilliseconds', 'endMilliseconds', 'startSamplePos', 'endSamplePos'],
  osc2: [
    'type', 'transpose', 'cents', 'oscillatorSync', 'retrigPhase', 'loopMode',
    'reversed', 'timeStretchEnable', 'timeStretchAmount', 'sampleRanges',
    'fileName', 'zone',
  ],
  lfo1: ['type', 'syncLevel'],
  lfo2: ['type'],
  unison: ['num', 'detune'],
  defaultParams: [
    'arpeggiatorGate', 'portamento', 'compressorShape', 'oscAVolume',
    'oscAPulseWidth', 'oscBVolume', 'oscBPulseWidth', 'noiseVolume', 'volume',
    'pan', 'lpfFrequency', 'lpfResonance', 'hpfFrequency', 'hpfResonance',
    'envelope1', 'envelope2', 'lfo1Rate', 'lfo2Rate', 'modulator1Amount',
    'modulator1Feedback', 'modulator2Amount', 'modulator2Feedback',
    'carrier1Feedback', 'carrier2Feedback', 'pitchAdjust', 'modFXRate',
    'modFXDepth', 'delayRate', 'delayFeedback', 'reverbAmount',
    'arpeggiatorRate', 'patchCables', 'stutterRate', 'sampleRateReduction',
    'bitCrush', 'modFXOffset', 'modFXFeedback', 'delay', 'lpf', 'hpf',
    'equalizer',
  ],
  envelope1: ['attack', 'decay', 'sustain', 'release'],
  envelope2: ['attack', 'decay', 'sustain', 'release'],
  patchCables: ['patchCable'],
  patchCable: ['source', 'destination', 'amount', 'rangeAdjustable'],
  kitParams: [
    'delay', 'reverbAmount', 'volume', 'pan', 'lpf', 'hpf', 'modFXDepth',
    'modFXRate', 'stutterRate', 'sampleRateReduction', 'bitCrush',
    'equalizer', 'modFXOffset', 'modFXFeedback',
  ],
  soundParams: [
    'arpeggiatorGate', 'portamento', 'compressorShape', 'oscAVolume',
    'oscAPulseWidth', 'oscBVolume', 'oscBPulseWidth', 'noiseVolume', 'volume',
    'pan', 'lpfFrequency', 'lpfResonance', 'hpfFrequency', 'hpfResonance',
    'envelope1', 'envelope2', 'lfo1Rate', 'lfo2Rate', 'modulator1Amount',
    'modulator1Feedback', 'modulator2Amount', 'modulator2Feedback',
    'carrier1Feedback', 'carrier2Feedback', 'pitchAdjust', 'modFXRate',
    'modFXDepth', 'delayRate', 'delayFeedback', 'reverbAmount',
    'arpeggiatorRate', 'patchCables', 'stutterRate', 'sampleRateReduction',
    'bitCrush', 'equalizer', 'modFXOffset', 'modFXFeedback',
  ],
  modulator1: ['transpose', 'cents', 'retrigPhase'],
  modulator2: ['transpose', 'cents', 'retrigPhase', 'toModulator1'],
  arpeggiator: ['mode', 'numOctaves', 'syncLevel'],
  midiOutput: ['channel', 'note'],
  midiChannel: ['channel', 'suffix'],
  cvChannel: ['channel'],
  audioTrack: [
    'name', 'inputChannel', 'isArmedForRecording', 'lpfMode', 'modFXType',
    'modFXCurrentParam', 'currentFilterType', 'delay', 'compressor',
  ],
  audioClip: [
    'trackName', 'filePath', 'startSamplePos', 'endSamplePos',
    'pitchSpeedIndependent', 'attack', 'priority', 'isPlaying', 'isSoloing',
    'isArmedForRecording', 'length=', 'colourOffset', 'section', 'params',
  ],
  params: [
    'reverbAmount', 'volume', 'pan', 'sidechainCompressorShape', 'modFXDepth',
    'modFXRate', 'stutterRate', 'sampleRateReduction', 'bitCrush',
    'modFXOffset', 'modFXFeedback', 'delay', 'lpf', 'hpf', 'equalizer',
  ],
  param: ['cc', 'value'],
}

// heteroArrays flags element names that should always create a JSON array
// for their sub-elements. Needed to handle mixed element types, e.g.
// <instruments> can contain both <sound> and <kit> children.
export const heteroArrays = new Set([
  'instruments',
  'soundSources',
  'sessionClips',
  'arrangementOnlyTracks',
])

// Elements whose children should NOT be encoded as XML attributes,
// even when they are scalar values.
export const dontEncodeAsAttributes = new Set([
  'midiKnobs',
])
