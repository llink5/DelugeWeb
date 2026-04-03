// Synthstrom Deluge Preset Type Definitions
// Based on the Deluge XML format element hierarchy (keyOrderTab.js)

// ---------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------

/** Hex-encoded 32-bit value, e.g. "0x7FFFFFFF" */
export type HexValue = string;

// ---------------------------------------------------------------------------
// Low-level building blocks
// ---------------------------------------------------------------------------

export interface Zone {
	startMilliseconds?: string;
	endMilliseconds?: string;
	startSamplePos?: string;
	endSamplePos?: string;
}

export interface SampleRange {
	fileName?: string;
	zone?: Zone;
	rangeTopNote?: string;
	transpose?: string;
	cents?: string;
}

export interface Oscillator {
	type?: string;
	transpose?: string;
	cents?: string;
	retrigPhase?: string;
	loopMode?: string;
	reversed?: string;
	timeStretchEnable?: string;
	timeStretchAmount?: string;
	linearInterpolation?: string;
	oscillatorSync?: string;
	fileName?: string;
	zone?: Zone;
	sampleRanges?: SampleRange | SampleRange[];
}

export interface LFO {
	type?: string;
	syncLevel?: string;
}

export interface Modulator {
	transpose?: string;
	cents?: string;
	retrigPhase?: string;
	toModulator1?: string;
}

export interface Unison {
	num?: string;
	detune?: string;
}

export interface Envelope {
	attack?: HexValue;
	decay?: HexValue;
	sustain?: HexValue;
	release?: HexValue;
}

export interface Filter {
	frequency?: HexValue;
	resonance?: HexValue;
}

export interface Equalizer {
	bass?: string;
	treble?: string;
	bassFrequency?: string;
	trebleFrequency?: string;
}

export interface Delay {
	rate?: string;
	feedback?: string;
	pingPong?: string;
	analog?: string;
	syncLevel?: string;
}

export interface Compressor {
	syncLevel?: string;
	attack?: string;
	release?: string;
	volume?: string;
}

export interface Arpeggiator {
	mode?: string;
	numOctaves?: string;
	syncLevel?: string;
}

// ---------------------------------------------------------------------------
// Patch cable / modulation routing
// ---------------------------------------------------------------------------

export interface PatchCable {
	source?: string;
	destination?: string;
	amount?: string;
	rangeAdjustable?: string;
}

export interface PatchCables {
	patchCable?: PatchCable | PatchCable[];
}

// ---------------------------------------------------------------------------
// Mod knobs
// ---------------------------------------------------------------------------

export interface ModKnob {
	controlsParam?: string;
	patchAmountFromSource?: string;
	cc?: string;
	value?: string;
}

export interface ModKnobs {
	modKnob?: ModKnob | ModKnob[];
}

// ---------------------------------------------------------------------------
// Default / sound params
// ---------------------------------------------------------------------------

export interface DefaultParams {
	arpeggiatorGate?: HexValue;
	portamento?: HexValue;
	compressorShape?: HexValue;
	oscAVolume?: HexValue;
	oscAPulseWidth?: HexValue;
	oscBVolume?: HexValue;
	oscBPulseWidth?: HexValue;
	noiseVolume?: HexValue;
	volume?: HexValue;
	pan?: HexValue;
	lpfFrequency?: HexValue;
	lpfResonance?: HexValue;
	hpfFrequency?: HexValue;
	hpfResonance?: HexValue;
	envelope1?: Envelope;
	envelope2?: Envelope;
	lfo1Rate?: HexValue;
	lfo2Rate?: HexValue;
	modulator1Amount?: HexValue;
	modulator1Feedback?: HexValue;
	modulator2Amount?: HexValue;
	modulator2Feedback?: HexValue;
	carrier1Feedback?: HexValue;
	carrier2Feedback?: HexValue;
	pitchAdjust?: HexValue;
	modFXRate?: HexValue;
	modFXDepth?: HexValue;
	delayRate?: HexValue;
	delayFeedback?: HexValue;
	reverbAmount?: HexValue;
	arpeggiatorRate?: HexValue;
	patchCables?: PatchCables;
	stutterRate?: HexValue;
	sampleRateReduction?: HexValue;
	bitCrush?: HexValue;
	modFXOffset?: HexValue;
	modFXFeedback?: HexValue;
	delay?: Delay;
	lpf?: Filter;
	hpf?: Filter;
	equalizer?: Equalizer;
}

// ---------------------------------------------------------------------------
// Sound preset (synth voice / drum source)
// ---------------------------------------------------------------------------

export interface SoundPreset {
	_type: 'sound';
	presetSlot?: string;
	presetSubSlot?: string;
	name?: string;
	osc1?: Oscillator;
	osc2?: Oscillator;
	polyphonic?: string;
	clippingAmount?: string;
	voicePriority?: string;
	sideChainSend?: string;
	lfo1?: LFO;
	lfo2?: LFO;
	mode?: string;
	modulator1?: Modulator;
	modulator2?: Modulator;
	transpose?: string;
	unison?: Unison;
	compressor?: Compressor;
	lpfMode?: string;
	modFXType?: string;
	delay?: Delay;
	arpeggiator?: Arpeggiator;
	defaultParams?: DefaultParams;
	midiKnobs?: unknown;
	modKnobs?: ModKnobs;
	trackInstances?: unknown;
	clipInstances?: unknown;
}

// ---------------------------------------------------------------------------
// Kit preset
// ---------------------------------------------------------------------------

export interface KitPreset {
	_type: 'kit';
	lpfMode?: string;
	modFXType?: string;
	delay?: Delay;
	compressor?: Compressor;
	modFXCurrentParam?: string;
	currentFilterType?: string;
	presetSlot?: string;
	presetSubSlot?: string;
	trackInstances?: unknown;
	clipInstances?: unknown;
	defaultParams?: DefaultParams;
	soundSources?: SoundPreset[];
	selectedDrumIndex?: string;
}

// ---------------------------------------------------------------------------
// Notes & note rows
// ---------------------------------------------------------------------------

export interface Note {
	length?: string;
	velocity?: string;
	pos?: string;
}

export interface NoteRow {
	y?: string;
	muted?: string;
	colourOffset?: string;
	drumIndex?: string;
	soundParams?: DefaultParams;
	notes?: { note?: Note | Note[] };
	noteData?: string;
	noteDataWithLift?: string;
}

// ---------------------------------------------------------------------------
// Instrument clip
// ---------------------------------------------------------------------------

export interface InstrumentClip {
	inKeyMode?: string;
	yScroll?: string;
	yScrollKeyboard?: string;
	affectEntire?: string;
	status?: string;
	instrumentPresetSlot?: string;
	instrumentPresetSubSlot?: string;
	isPlaying?: string;
	isSoloing?: string;
	isArmedForRecording?: string;
	length?: string;
	colourOffset?: string;
	crossScreenEditLevel?: string;
	beingEdited?: string;
	activeModFunction?: string;
	instrument?: { referToTrackId?: string };
	arpeggiator?: Arpeggiator;
	midiChannel?: { channel?: string; suffix?: string };
	midiParams?: unknown;
	modKnobs?: ModKnobs;
	section?: string;
	sound?: SoundPreset;
	soundParams?: DefaultParams;
	kit?: KitPreset;
	kitParams?: DefaultParams;
	noteRows?: { noteRow?: NoteRow | NoteRow[] };
}

// ---------------------------------------------------------------------------
// Audio clip
// ---------------------------------------------------------------------------

export interface AudioClipParams {
	reverbAmount?: HexValue;
	volume?: HexValue;
	pan?: HexValue;
	sidechainCompressorShape?: HexValue;
	modFXDepth?: HexValue;
	modFXRate?: HexValue;
	stutterRate?: HexValue;
	sampleRateReduction?: HexValue;
	bitCrush?: HexValue;
	modFXOffset?: HexValue;
	modFXFeedback?: HexValue;
	delay?: Delay;
	lpf?: Filter;
	hpf?: Filter;
	equalizer?: Equalizer;
}

export interface AudioClip {
	trackName?: string;
	filePath?: string;
	startSamplePos?: string;
	endSamplePos?: string;
	pitchSpeedIndependent?: string;
	attack?: string;
	priority?: string;
	isPlaying?: string;
	isSoloing?: string;
	isArmedForRecording?: string;
	length?: string;
	colourOffset?: string;
	section?: string;
	params?: AudioClipParams;
}

// ---------------------------------------------------------------------------
// Audio track
// ---------------------------------------------------------------------------

export interface AudioTrack {
	name?: string;
	inputChannel?: string;
	isArmedForRecording?: string;
	lpfMode?: string;
	modFXType?: string;
	modFXCurrentParam?: string;
	currentFilterType?: string;
	delay?: Delay;
	compressor?: Compressor;
}

// ---------------------------------------------------------------------------
// MIDI types
// ---------------------------------------------------------------------------

export interface MidiOutput {
	channel?: string;
	note?: string;
}

export interface MidiChannel {
	channel?: string;
	suffix?: string;
}

export interface CvChannel {
	channel?: string;
}

// ---------------------------------------------------------------------------
// Reverb
// ---------------------------------------------------------------------------

export interface Reverb {
	roomSize?: string;
	dampening?: string;
	width?: string;
	pan?: string;
	compressor?: Compressor;
}

// ---------------------------------------------------------------------------
// Song-level params
// ---------------------------------------------------------------------------

export interface SongParams {
	delay?: Delay;
	reverbAmount?: HexValue;
	volume?: HexValue;
	pan?: HexValue;
	lpf?: Filter;
	hpf?: Filter;
	modFXDepth?: HexValue;
	modFXRate?: HexValue;
	stutterRate?: HexValue;
	sampleRateReduction?: HexValue;
	bitCrush?: HexValue;
	equalizer?: Equalizer;
	modFXOffset?: HexValue;
	modFXFeedback?: HexValue;
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export interface Section {
	id?: string;
	numRepeats?: string;
}

// ---------------------------------------------------------------------------
// Song
// ---------------------------------------------------------------------------

export interface Song {
	_type: 'song';
	previewNumPads?: string;
	preview?: string;
	inArrangementView?: string;
	xScrollSongView?: string;
	xZoomSongView?: string;
	arrangementAutoScrollOn?: string;
	xScroll?: string;
	xZoom?: string;
	yScrollSongView?: string;
	yScrollArrangementView?: string;
	xScrollArrangementView?: string;
	xZoomArrangementView?: string;
	timePerTimerTick?: string;
	timerTickFraction?: string;
	rootNote?: string;
	inputTickMagnitude?: string;
	swingAmount?: string;
	swingInterval?: string;
	modeNotes?: { modeNote?: string | string[] };
	reverb?: Reverb;
	affectEntire?: string;
	activeModFunction?: string;
	lpfMode?: string;
	modFXType?: string;
	delay?: Delay;
	compressor?: Compressor;
	modFXCurrentParam?: string;
	currentFilterType?: string;
	songParams?: SongParams;
	instruments?: (SoundPreset | KitPreset | MidiOutput | CvChannel)[];
	sessionClips?: (InstrumentClip | AudioClip)[];
	sections?: { section?: Section | Section[] };
	tracks?: { track?: InstrumentClip | InstrumentClip[] };
	arrangementOnlyTracks?: (AudioTrack | InstrumentClip)[];
}

// ---------------------------------------------------------------------------
// Union / discriminated types
// ---------------------------------------------------------------------------

export type Preset = SoundPreset | KitPreset | Song;

export type PresetType = 'SYNTHS' | 'KITS' | 'SONGS';

// ---------------------------------------------------------------------------
// App-level utility types
// ---------------------------------------------------------------------------

export interface PresetEntry {
	path: string;
	name: string;
	size?: number;
	date?: Date;
	isDir: boolean;
}

export interface PresetDiffEntry {
	path: string;
	kind: 'E' | 'N' | 'D' | 'A';
	oldVal?: unknown;
	newVal?: unknown;
}

export interface DirEntry {
	name: string;
	attr?: number;
	date?: number;
	time?: number;
	size?: number;
}
