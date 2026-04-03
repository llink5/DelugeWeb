#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const firmwarePath = process.argv[2];
if (!firmwarePath || !fs.existsSync(firmwarePath)) {
  process.stderr.write(
    'Usage: node extract-parameters.js <path-to-DelugeFirmware>\n' +
    'The path must point to a cloned DelugeFirmware repository.\n'
  );
  process.exit(1);
}

function readFirmwareFile(relPath) {
  const full = path.resolve(firmwarePath, relPath);
  if (!fs.existsSync(full)) {
    process.stderr.write(`Warning: file not found: ${relPath}\n`);
    return '';
  }
  return fs.readFileSync(full, 'utf8');
}

// ---------------------------------------------------------------------------
// 1. Parse param.h – enum values with computed indices
// ---------------------------------------------------------------------------
const paramH = readFirmwareFile('src/deluge/modulation/params/param.h');

/**
 * Parse a C++ enum block and compute sequential indices.
 * Handles `FOO = BAR` assignments and plain sequential entries.
 * @param {Map<string,number>} [externalSymbols] - Previously resolved names from other enums
 * Returns Map<name, index>.
 */
function parseEnum(src, enumPattern, externalSymbols) {
  const m = src.match(enumPattern);
  if (!m) return new Map();
  const body = m[1];
  const entries = new Map();
  let idx = 0;
  const resolved = new Map(externalSymbols || []); // name -> numeric value

  for (const line of body.split('\n')) {
    const trimmed = line.replace(/\/\/.*/, '').trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    // Match: IDENTIFIER or IDENTIFIER = VALUE or IDENTIFIER = VALUE,
    const em = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*(?:=\s*([A-Za-z_0-9]+))?\s*,?\s*$/);
    if (!em) continue;
    const name = em[1];
    const assign = em[2];
    if (assign !== undefined) {
      if (/^\d+$/.test(assign)) {
        idx = parseInt(assign, 10);
      } else if (resolved.has(assign)) {
        idx = resolved.get(assign);
      }
      // else keep current idx
    }
    entries.set(name, idx);
    resolved.set(name, idx);
    idx++;
  }
  return entries;
}

const localParams = parseEnum(paramH, /enum\s+Local\s*:\s*ParamType\s*\{([^}]+)\}/s);
// Global params chain from LOCAL_LAST
const globalParams = parseEnum(paramH, /enum\s+Global\s*:\s*ParamType\s*\{([^}]+)\}/s, localParams);
const unpatchedShared = parseEnum(paramH, /enum\s+UnpatchedShared\s*:\s*ParamType\s*\{([^}]+)\}/s);
// UnpatchedSound and UnpatchedGlobal chain from UNPATCHED_NUM_SHARED
const unpatchedSound = parseEnum(paramH, /enum\s+UnpatchedSound\s*:\s*ParamType\s*\{([^}]+)\}/s, unpatchedShared);
const unpatchedGlobal = parseEnum(paramH, /enum\s+UnpatchedGlobal\s*:\s*ParamType\s*\{([^}]+)\}/s, unpatchedShared);

// Parse STATIC_START constant for static params
const staticStartMatch = paramH.match(/constexpr\s+ParamType\s+STATIC_START\s*=\s*(\d+)/);
const STATIC_START = staticStartMatch ? parseInt(staticStartMatch[1], 10) : 162;
const staticExternals = new Map([['STATIC_START', STATIC_START]]);
const staticParams = parseEnum(paramH, /enum\s+Static\s*:\s*ParamType\s*\{([^}]+)\}/s, staticExternals);

// UNPATCHED_START offset
const unpatchedStartMatch = paramH.match(/constexpr\s+ParamType\s+UNPATCHED_START\s*=\s*(\d+)/);
const UNPATCHED_START = unpatchedStartMatch ? parseInt(unpatchedStartMatch[1], 10) : 90;

// Sentinel markers to skip
const SKIP_IDS = new Set([
  'FIRST_LOCAL_NON_VOLUME', 'FIRST_LOCAL__HYBRID', 'FIRST_LOCAL_EXP',
  'LOCAL_LAST',
  'FIRST_GLOBAL', 'FIRST_GLOBAL_NON_VOLUME', 'FIRST_GLOBAL_HYBRID', 'FIRST_GLOBAL_EXP',
  'GLOBAL_NONE',
  'UNPATCHED_FIRST_ARP_PARAM', 'UNPATCHED_LAST_ARP_PARAM', 'UNPATCHED_NUM_SHARED',
  'UNPATCHED_SOUND_MAX_NUM', 'UNPATCHED_GLOBAL_MAX_NUM',
]);

// ---------------------------------------------------------------------------
// 2. Parse param.cpp – XML tag names from paramNameForFileConst()
// ---------------------------------------------------------------------------
const paramCpp = readFirmwareFile('src/deluge/modulation/params/param.cpp');

function extractCaseReturn(src) {
  const map = {};
  const re = /case\s+([A-Z_][A-Z0-9_]*)\s*:\s*\n\s*return\s+"([^"]+)"\s*;/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    map[m[1]] = m[2];
  }
  return map;
}

const xmlTagMap = extractCaseReturn(paramCpp);

// ---------------------------------------------------------------------------
// 3. Parse param.cpp – short names from getPatchedParamShortName()
// ---------------------------------------------------------------------------
function extractArrayInit(src, funcName) {
  const map = {};
  const fnMatch = src.match(new RegExp(funcName + '[\\s\\S]*?\\{([\\s\\S]*?)\\};', 'm'));
  if (!fnMatch) return map;
  const body = fnMatch[1];
  const re = /\[([A-Z_][A-Z0-9_]*)\]\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    map[m[1]] = m[2];
  }
  return map;
}

const shortNameMap = extractArrayInit(paramCpp, 'getPatchedParamShortName');

// ---------------------------------------------------------------------------
// 4. Parse param.cpp – l10n key mappings from display name functions
// ---------------------------------------------------------------------------
function extractL10nMapping(src, funcPattern) {
  const map = {};
  const fnMatch = src.match(funcPattern);
  if (!fnMatch) return map;
  const body = fnMatch[1];
  const re = /\[([A-Z_][A-Z0-9_]*(?:\s*-\s*[a-z]+)?)\]\s*=\s*(STRING_FOR_[A-Z_0-9]+)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const key = m[1].replace(/\s*-\s*\w+/, '').trim();
    map[key] = m[2];
  }
  return map;
}

const patchedDisplayL10n = extractL10nMapping(paramCpp,
  /getPatchedParamDisplayName[\s\S]*?static\s+l10n::String\s+const\s+NAMES\[GLOBAL_NONE\]\s*=\s*\{([\s\S]*?)\};/);

// Unpatched shared display names
const unpatchedSharedDisplayL10n = extractL10nMapping(paramCpp,
  /getParamDisplayName[\s\S]*?UNPATCHED_NUM_SHARED\]\s*=\s*\{([\s\S]*?)\};/);

// Unpatched sound display names
const unpatchedSoundDisplayL10n = extractL10nMapping(paramCpp,
  /UNPATCHED_SOUND[\s\S]*?UNPATCHED_SOUND_MAX_NUM\s*-\s*unc\]\s*=\s*\{([\s\S]*?)\};/);

// Unpatched global display names
const unpatchedGlobalDisplayL10n = extractL10nMapping(paramCpp,
  /UNPATCHED_GLOBAL[\s\S]*?UNPATCHED_GLOBAL_MAX_NUM\s*-\s*unc\]\s*=\s*\{([\s\S]*?)\};/);

// ---------------------------------------------------------------------------
// 5. Parse english.json – resolve l10n keys to display strings
// ---------------------------------------------------------------------------
const englishJson = readFirmwareFile('src/deluge/gui/l10n/english.json');
let l10nStrings = {};
try {
  const parsed = JSON.parse(englishJson);
  l10nStrings = parsed.strings || {};
} catch (e) {
  process.stderr.write('Warning: could not parse english.json\n');
}

function resolveL10n(key) {
  return l10nStrings[key] || null;
}

/**
 * Normalize display names: convert ALL_CAPS l10n strings to title case.
 * The firmware l10n has some entries like "BASS", "TREBLE", "DECIMATION" etc.
 */
function normalizeDisplayName(name) {
  if (!name) return name;
  // If entirely uppercase (and more than 1 char), title-case it
  if (name === name.toUpperCase() && name.length > 1 && !/\d/.test(name)) {
    return name.charAt(0) + name.slice(1).toLowerCase();
  }
  return name;
}

// Display name overrides for l10n-resolved names that need manual correction
const displayNameOverrides = {
  UNPATCHED_COMPRESSOR_THRESHOLD: 'Comp threshold',
  UNPATCHED_PAN: 'Master pan',
  UNPATCHED_TEMPO: 'Tempo',
};

// ---------------------------------------------------------------------------
// 6. Parse Sound::initParams() – default values
// ---------------------------------------------------------------------------
const soundCpp = readFirmwareFile('src/deluge/processing/sound/sound.cpp');

function extractDefaults(src) {
  const defaults = {};
  // Limit to initParams function body for Sound defaults
  const initMatch = src.match(/void\s+Sound::initParams\b[\s\S]*?\n\}/);
  const initBody = initMatch ? initMatch[0] : '';

  // Pattern: params[params::PARAM_NAME].setCurrentValueBasicForSetup(VALUE);
  const re1 = /params\[params::([A-Z_]+)\]\.setCurrentValueBasicForSetup\(\s*(-?\d+)\s*\)/g;
  let m;
  while ((m = re1.exec(initBody)) !== null) {
    const val = parseInt(m[2], 10);
    if (val === 2147483647) defaults[m[1]] = '2147483647 (max, full)';
    else if (val === -2147483648) defaults[m[1]] = '-2147483648 (off)';
    else if (val === 0) defaults[m[1]] = '0 (center)';
    else defaults[m[1]] = String(val);
  }
  // Pattern: getParamFromUserValue(params::PARAM_NAME, VALUE) – overrides raw value
  const re2 = /params\[params::([A-Z_]+)\]\.setCurrentValueBasicForSetup\(\s*getParamFromUserValue\(params::[A-Z_]+,\s*(\d+)\)\s*\)/g;
  while ((m = re2.exec(initBody)) !== null) {
    defaults[m[1]] = `getParamFromUserValue(${m[2]})`;
  }
  return defaults;
}

const defaultsMap = extractDefaults(soundCpp);

// ---------------------------------------------------------------------------
// 7. Bipolar detection from isParamBipolar / isParamPitch / isParamPan
// ---------------------------------------------------------------------------
const bipolarPatched = new Set();
// Pan params
bipolarPatched.add('LOCAL_PAN');
// Pitch params
['LOCAL_PITCH_ADJUST', 'LOCAL_OSC_A_PITCH_ADJUST', 'LOCAL_OSC_B_PITCH_ADJUST',
  'LOCAL_MODULATOR_0_PITCH_ADJUST', 'LOCAL_MODULATOR_1_PITCH_ADJUST'].forEach(p => bipolarPatched.add(p));

const bipolarUnpatched = new Set();
bipolarUnpatched.add('UNPATCHED_PAN');
bipolarUnpatched.add('UNPATCHED_PITCH_ADJUST');

// ---------------------------------------------------------------------------
// 8. Parse enum classes dynamically from firmware source files
// ---------------------------------------------------------------------------
const defsCxx = readFirmwareFile('src/definitions_cxx.hpp');
const filterConfigH = readFirmwareFile('src/deluge/model/mod_controllable/filters/filter_config.h');
const reverbHpp = readFirmwareFile('src/deluge/dsp/reverb/reverb.hpp');

function parseEnumClass(src, className) {
  const re = new RegExp(`enum\\s+class\\s+${className}[^{]*\\{([^}]+)\\}`, 's');
  const m = src.match(re);
  if (!m) return [];
  const values = [];
  let idx = 0;
  for (const line of m[1].split('\n')) {
    const trimmed = line.replace(/\/\/.*/, '').trim();
    const em = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*(?:=\s*(\d+))?\s*,?\s*$/);
    if (!em) continue;
    if (em[2] !== undefined) idx = parseInt(em[2], 10);
    values.push({ name: em[1], value: idx });
    idx++;
  }
  return values;
}

// Parse all relevant enum classes from source files
const allEnumClasses = {};
const enumSourceFiles = [
  { src: defsCxx, name: 'definitions_cxx.hpp' },
  { src: filterConfigH, name: 'filter_config.h' },
  { src: reverbHpp, name: 'reverb.hpp' },
];

// Scan for all `enum class X` definitions in the source files
for (const { src } of enumSourceFiles) {
  const re = /enum\s+class\s+(\w+)[^{]*\{([^}]+)\}/gs;
  let m;
  while ((m = re.exec(src)) !== null) {
    const className = m[1];
    const body = m[2];
    const values = [];
    let idx = 0;
    for (const line of body.split('\n')) {
      const trimmed = line.replace(/\/\/.*/, '').trim();
      const em = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*(?:=\s*(\d+))?\s*,?\s*$/);
      if (!em) continue;
      if (em[2] !== undefined) idx = parseInt(em[2], 10);
      values.push({ name: em[1], value: idx });
      idx++;
    }
    if (values.length > 0) {
      allEnumClasses[className] = values;
    }
  }
}

// Also parse Reverb::Model specifically (nested class)
const reverbModelEnum = parseEnumClass(reverbHpp, 'Model');
allEnumClasses['ReverbModel'] = reverbModelEnum;

// Convenient aliases for commonly used enums
const oscTypeEnum = allEnumClasses['OscType'] || [];
const lfoTypeEnum = allEnumClasses['LFOType'] || [];
const modFXTypeEnum = allEnumClasses['ModFXType'] || [];
const synthModeEnum = allEnumClasses['SynthMode'] || [];
const polyphonyModeEnum = allEnumClasses['PolyphonyMode'] || [];
const arpModeEnum = allEnumClasses['ArpMode'] || [];
const arpPresetEnum = allEnumClasses['ArpPreset'] || [];
const arpNoteModeEnum = allEnumClasses['ArpNoteMode'] || [];
const arpOctaveModeEnum = allEnumClasses['ArpOctaveMode'] || [];
const filterModeEnum = allEnumClasses['FilterMode'] || [];
const filterRouteEnum = allEnumClasses['FilterRoute'] || [];
const sampleRepeatModeEnum = allEnumClasses['SampleRepeatMode'] || [];
const voicePriorityEnum = allEnumClasses['VoicePriority'] || [];

// ---------------------------------------------------------------------------
// 8b. Parse getOptions() from Selection subclass .h files to get labels
// ---------------------------------------------------------------------------

/**
 * Parse STRING_FOR_* keys from a getOptions() method in a .h file.
 * Skips the SHORT branch, taking only FULL options.
 * Returns an array of STRING_FOR_* keys in order.
 */
function parseGetOptionsFromFile(relPath, opts) {
  const src = readFirmwareFile(relPath);
  if (!src) return [];

  // Find the getOptions method body. The closing brace is at one-tab indent level.
  const getOptMatch = src.match(/getOptions\s*\(\s*OptType\s+\w+\s*\)\s*override\s*\{([\s\S]*?)^\t\}/m);
  if (!getOptMatch) return [];

  const body = getOptMatch[1];

  // Check if there's an if/else branch for SHORT vs FULL
  // We want the FULL branch (not SHORT)
  // Pattern: if (... SHORT) { return { ... }; } return { ... };
  // Or: if (... HPF) { return { ... HPF options }; } return { ... LPF options };
  if (opts && opts.branchCondition) {
    // For filter mode, select the correct branch (e.g., HPF branch)
    // Use [\s\S]*? to match across parentheses in expressions like info.getSlot()
    const escapedCond = opts.branchCondition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const branchRe = new RegExp(
      `if\\s*\\([\\s\\S]*?${escapedCond}[\\s\\S]*?\\)\\s*\\{\\s*return\\s*\\{([\\s\\S]*?)\\};`,
      's'
    );
    const branchMatch = body.match(branchRe);
    if (branchMatch) {
      return extractStringForKeys(branchMatch[1]);
    }
  }

  // If there's an optType == SHORT branch, skip it and get the non-SHORT return
  if (body.includes('OptType::SHORT') || body.includes('shortOpt')) {
    // There's a SHORT branch. Find the FULL return block.
    // For files with `if (optType == SHORT) { return {...}; } return {...};`
    // The FULL return is the second (last) return statement.
    // For files with ternary in l10n::getView calls (shortOpt ? X : Y), take the non-short (Y) values.

    // Find all return blocks
    const returnBlocks = [];
    const allReturnRe = /return\s*\{([\s\S]*?)\};/g;
    let rm;
    while ((rm = allReturnRe.exec(body)) !== null) {
      returnBlocks.push(rm[1]);
    }

    // Use the last return block (which is the FULL options)
    if (returnBlocks.length > 0) {
      const lastBlock = returnBlocks[returnBlocks.length - 1];
      return extractStringForKeys(lastBlock);
    }
  }

  // No SHORT branch, just extract all STRING_FOR_* from the first complete return block
  // Handle conditionally-added options after the initial return block
  const allKeys = [];

  // First, get the initial vector/return (handles both `return {` and `options = {`)
  const initialReturnRe = /(?:return\s*\{|options\s*=\s*\{)([\s\S]*?)\};/s;
  const initialMatch = body.match(initialReturnRe);
  if (initialMatch) {
    allKeys.push(...extractStringForKeys(initialMatch[1]));
  }

  // Then look for additional emplace_back / push_back calls outside of else blocks
  // Split by if/else blocks to avoid picking up fallback entries
  // Strategy: remove else { ... } blocks, then scan for emplace_back/push_back
  const bodyWithoutElse = body.replace(/\belse\s*\{[^}]*\}/gs, '');
  const emplaceRe = /(?:emplace_back|push_back)\s*\(\s*l10n::getView\s*\(\s*(?:l10n::String::)?(STRING_FOR_\w+)\s*\)\s*\)/g;
  let em;
  while ((em = emplaceRe.exec(bodyWithoutElse)) !== null) {
    allKeys.push(em[1]);
  }

  return allKeys;
}

/**
 * Extract STRING_FOR_* keys from a block of code containing l10n::getView calls.
 * For ternary expressions like `shortOpt ? STRING_FOR_X_SHORT : STRING_FOR_X`,
 * always takes the non-short (full) version.
 */
function extractStringForKeys(block) {
  const keys = [];
  // Match l10n::getView calls. Handle various patterns:
  // 1. l10n::getView(STRING_FOR_X)
  // 2. l10n::getView(l10n::String::STRING_FOR_X)
  // 3. l10n::getView(shortOpt ? STRING_FOR_X_SHORT : STRING_FOR_X) -- take the full version
  // Match each l10n::getView(...) call and extract the STRING_FOR key
  const re = /l10n::getView\s*\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const arg = m[1].trim();
    // Handle ternary: shortOpt ? X : Y or optType == SHORT ? X : Y -- take the full (Y) version
    const ternaryMatch = arg.match(/\?\s*(?:l10n::String::)?(STRING_FOR_\w+)\s*:\s*(?:l10n::String::)?(STRING_FOR_\w+)/);
    if (ternaryMatch) {
      keys.push(ternaryMatch[2]); // take the non-short version
      continue;
    }
    // Simple: l10n::getView(STRING_FOR_X) or l10n::getView(l10n::String::STRING_FOR_X)
    const simpleMatch = arg.match(/(?:l10n::String::)?(STRING_FOR_\w+)/);
    if (simpleMatch) {
      keys.push(simpleMatch[1]);
    }
  }
  return keys;
}

/**
 * Parse getModNames() from global_effectable.cpp for ModFX type labels.
 */
function parseModFXLabels() {
  const src = readFirmwareFile('src/deluge/model/global_effectable/global_effectable.cpp');
  const fnMatch = src.match(/getModNames\s*\(\s*\)\s*\{([\s\S]*?)\};/s);
  if (!fnMatch) return [];
  return extractStringForKeys(fnMatch[1]);
}

// Parse labels for each Selection subclass
const menuItemBase = 'src/deluge/gui/menu_item';

const oscTypeKeys = parseGetOptionsFromFile(`${menuItemBase}/osc/type.h`);
const lfoTypeKeys = parseGetOptionsFromFile(`${menuItemBase}/lfo/type.h`);
const lpfModeKeys = parseGetOptionsFromFile(`${menuItemBase}/filter/mode.h`);
const hpfModeKeys = parseGetOptionsFromFile(`${menuItemBase}/filter/mode.h`, { branchCondition: 'FilterSlot::HPF' });
const synthModeKeys = parseGetOptionsFromFile(`${menuItemBase}/synth_mode.h`);
const arpModeKeys = parseGetOptionsFromFile(`${menuItemBase}/arpeggiator/mode.h`);
const arpPresetKeys = parseGetOptionsFromFile(`${menuItemBase}/arpeggiator/preset_mode.h`);
const arpNoteModeKeys = parseGetOptionsFromFile(`${menuItemBase}/arpeggiator/note_mode.h`);
const arpOctaveModeKeys = parseGetOptionsFromFile(`${menuItemBase}/arpeggiator/octave_mode.h`);
const polyphonyKeys = parseGetOptionsFromFile(`${menuItemBase}/voice/polyphony.h`);
const voicePriorityKeys = parseGetOptionsFromFile(`${menuItemBase}/voice/priority.h`);
const reverbModelKeys = parseGetOptionsFromFile(`${menuItemBase}/reverb/model.h`);
const delayPingPongKeys = parseGetOptionsFromFile(`${menuItemBase}/delay/ping_pong.h`);
const delayAnalogKeys = parseGetOptionsFromFile(`${menuItemBase}/delay/analog.h`);
const filterRouteKeys = parseGetOptionsFromFile(`${menuItemBase}/filter_route.h`);
const sampleRepeatKeys = parseGetOptionsFromFile(`${menuItemBase}/sample/repeat.h`);
const modFXTypeKeys = parseModFXLabels();

/**
 * Build enum values by pairing parsed enum members with resolved l10n labels.
 * @param {Array} parsedEnum - [{name, value}, ...]
 * @param {Array} l10nKeys - [STRING_FOR_*, ...] in display order
 * @returns {Array} [{value, label}, ...]
 */
/**
 * Normalize enum label: title-case ALL_CAPS strings from the firmware l10n,
 * but preserve mixed-case strings and strings with non-alpha characters.
 */
function normalizeEnumLabel(name) {
  if (!name) return name;
  // If not entirely uppercase (ignoring digits/symbols/spaces), it's already formatted
  const alphaOnly = name.replace(/[^A-Za-z]/g, '');
  if (alphaOnly.length === 0 || alphaOnly !== alphaOnly.toUpperCase()) return name;
  // Known abbreviations to preserve as-is (2 chars or less always kept)
  if (alphaOnly.length <= 2) return name;
  // If it contains non-letter, non-space chars (digits, &, >, etc.) — keep as-is
  if (/[^A-Z\s]/.test(name)) return name;
  // Title-case: first letter upper, rest lower
  return name.charAt(0) + name.slice(1).toLowerCase();
}

function buildEnumValuesFromKeys(parsedEnum, l10nKeys) {
  if (!l10nKeys || l10nKeys.length === 0) return [];
  return l10nKeys.map((key, index) => {
    const resolved = resolveL10n(key);
    const label = normalizeEnumLabel(resolved) || key.replace('STRING_FOR_', '').replace(/_/g, ' ');
    // Use the index as the value (matches enum order)
    const enumEntry = parsedEnum[index];
    const value = enumEntry ? enumEntry.value : index;
    return { value, label };
  });
}

// Build all enum label maps dynamically
const enumLabels = {
  OscType: buildEnumValuesFromKeys(oscTypeEnum, oscTypeKeys),
  LFOType: buildEnumValuesFromKeys(lfoTypeEnum, lfoTypeKeys),
  ModFXType: buildEnumValuesFromKeys(modFXTypeEnum, modFXTypeKeys),
  SynthMode: buildEnumValuesFromKeys(synthModeEnum, synthModeKeys),
  PolyphonyMode: buildEnumValuesFromKeys(polyphonyModeEnum, polyphonyKeys),
  ArpMode: buildEnumValuesFromKeys(arpModeEnum, arpModeKeys),
  ArpPreset: buildEnumValuesFromKeys(arpPresetEnum, arpPresetKeys),
  ArpNoteMode: buildEnumValuesFromKeys(arpNoteModeEnum, arpNoteModeKeys),
  ArpOctaveMode: buildEnumValuesFromKeys(arpOctaveModeEnum, arpOctaveModeKeys),
  FilterModeLPF: buildEnumValuesFromKeys(filterModeEnum, lpfModeKeys),
  FilterModeHPF: (() => {
    // HPF modes are a subset of FilterMode; the getOptions returns them in display order
    // Map to sequential values 0, 1, 2, 3...
    return hpfModeKeys.map((key, index) => {
      const resolved = resolveL10n(key);
      const label = normalizeDisplayName(resolved) || key.replace('STRING_FOR_', '').replace(/_/g, ' ');
      return { value: index, label };
    });
  })(),
  FilterRoute: buildEnumValuesFromKeys(filterRouteEnum, filterRouteKeys),
  SampleRepeatMode: buildEnumValuesFromKeys(sampleRepeatModeEnum, sampleRepeatKeys),
  VoicePriority: buildEnumValuesFromKeys(voicePriorityEnum, voicePriorityKeys),
  ReverbModel: buildEnumValuesFromKeys(reverbModelEnum, reverbModelKeys),
  DelayPingPong: buildEnumValuesFromKeys([{name:'OFF',value:0},{name:'ON',value:1}], delayPingPongKeys),
  DelayAnalog: buildEnumValuesFromKeys([{name:'DIGITAL',value:0},{name:'ANALOG',value:1}], delayAnalogKeys),
};

// ---------------------------------------------------------------------------
// 9. Category / description / menuPath derivation from param IDs
// ---------------------------------------------------------------------------
function categorizeParam(id) {
  if (/OSC_[AB]_|NOISE_|FOLD|oscType|oscillator|synthMode|sampleRepeat/.test(id)) return 'Oscillator';
  if (/MODULATOR_\d|CARRIER_\d/.test(id)) return 'Oscillator';
  if (/LPF_|HPF_|lpf|hpf|filter/.test(id)) return 'Filter';
  if (/ENV_\d/.test(id)) return 'Envelope';
  if (/LFO_|lfoType/.test(id)) return 'LFO';
  // Arpeggiator: must come before Effect to catch ARP_ and probability params
  if (/ARP_|arp|NOTE_PROBABILITY|REVERSE_PROBABILITY|SPREAD_VELOCITY/.test(id)) return 'Arpeggiator';
  // Portamento is the sole "Modulation" category param
  if (/PORTAMENTO/.test(id)) return 'Modulation';
  // GLOBAL_VOLUME_POST_REVERB_SEND is a Global volume param despite containing "REVERB"
  if (id === 'GLOBAL_VOLUME_POST_REVERB_SEND') return 'Global';
  // Effect: sidechain, delay, reverb, mod-fx, EQ, distortion, compressor, stutter
  if (/DELAY_|REVERB_|MOD_FX|modFX|BITCRUSH|SAMPLE_RATE_RED|BASS$|TREBLE$|BASS_FREQ|TREBLE_FREQ|STUTTER|SIDECHAIN|STATIC_|COMPRESSOR_|comp[A-Z]|clipping|delay|reverb/.test(id)) return 'Effect';
  if (/polyphon|voicePriority|[Uu]nison|maxVoice/.test(id)) return 'Voice';
  if (/VOLUME|PITCH_ADJUST|PAN$|TEMPO/.test(id)) return 'Global';
  return 'Global';
}

function deriveMenuPath(id, displayName) {
  // Oscillator params
  if (/LOCAL_OSC_A_/.test(id)) return `SOUND > OSC1 > ${menuSuffix(id)}`;
  if (/LOCAL_OSC_B_/.test(id)) return `SOUND > OSC2 > ${menuSuffix(id)}`;
  if (/LOCAL_MODULATOR_0_/.test(id)) return `SOUND > MOD1 > ${menuSuffix(id)}`;
  if (/LOCAL_MODULATOR_1_/.test(id)) return `SOUND > MOD2 > ${menuSuffix(id)}`;
  if (/LOCAL_CARRIER_0_/.test(id)) return 'SOUND > OSC1 > FEEDBACK';
  if (/LOCAL_CARRIER_1_/.test(id)) return 'SOUND > OSC2 > FEEDBACK';
  if (id === 'LOCAL_NOISE_VOLUME') return 'SOUND > MIXER > NOISE';
  if (id === 'LOCAL_FOLD') return 'SOUND > DISTORTION > WAVEFOLD';
  if (id === 'oscillatorSync') return 'SOUND > MIXER > OSC SYNC';
  if (/oscType_source0/.test(id)) return 'SOUND > OSC1 > TYPE';
  if (/oscType_source1/.test(id)) return 'SOUND > OSC2 > TYPE';
  if (id === 'synthMode') return 'SOUND > SYNTH MODE';
  if (id === 'sampleRepeatMode') return 'SOUND > SAMPLE > REPEAT MODE';

  // Filter
  if (/LOCAL_LPF_/.test(id)) return `SOUND > LPF > ${menuSuffix(id)}`;
  if (/LOCAL_HPF_/.test(id)) return `SOUND > HPF > ${menuSuffix(id)}`;
  if (id === 'lpfMode') return 'SOUND > LPF > MODE';
  if (id === 'hpfMode') return 'SOUND > HPF > MODE';
  if (id === 'filterRoute') return 'SOUND > FILTERS > ROUTING';
  if (/UNPATCHED_LPF_/.test(id)) return `KIT/SONG > LPF > ${menuSuffix(id)}`;
  if (/UNPATCHED_HPF_/.test(id)) return `KIT/SONG > HPF > ${menuSuffix(id)}`;

  // Envelope
  const envMatch = id.match(/LOCAL_ENV_(\d)_(\w+)/);
  if (envMatch) return `SOUND > ENV${parseInt(envMatch[1]) + 1} > ${envMatch[2].toUpperCase()}`;

  // LFO
  if (id === 'GLOBAL_LFO_FREQ_1') return 'SOUND > LFO1 > RATE';
  if (id === 'LOCAL_LFO_LOCAL_FREQ_1') return 'SOUND > LFO2 > RATE';
  if (id === 'GLOBAL_LFO_FREQ_2') return 'SOUND > LFO3 > RATE';
  if (id === 'LOCAL_LFO_LOCAL_FREQ_2') return 'SOUND > LFO4 > RATE';
  if (/lfoType_1/.test(id)) return 'SOUND > LFO1 > SHAPE';
  if (/lfoType_2/.test(id)) return 'SOUND > LFO2 > SHAPE';
  if (/lfoType_3/.test(id)) return 'SOUND > LFO3 > SHAPE';
  if (/lfoType_4/.test(id)) return 'SOUND > LFO4 > SHAPE';

  // Global
  if (id === 'LOCAL_VOLUME') return 'SOUND > LEVEL';
  if (id === 'LOCAL_PAN') return 'SOUND > PAN';
  if (id === 'LOCAL_PITCH_ADJUST') return 'SOUND > TRANSPOSE';
  if (id === 'GLOBAL_VOLUME_POST_FX') return 'SOUND > MASTER > VOLUME';
  if (id === 'GLOBAL_VOLUME_POST_REVERB_SEND') return 'SOUND > SIDECHAIN > LEVEL';
  if (id === 'UNPATCHED_PAN') return 'KIT/SONG > PAN';
  if (id === 'UNPATCHED_VOLUME') return 'KIT/SONG > LEVEL';
  if (id === 'UNPATCHED_PITCH_ADJUST') return 'KIT/SONG > TRANSPOSE';
  if (id === 'UNPATCHED_TEMPO') return 'SONG > TEMPO';

  // Effects - Delay
  if (id === 'GLOBAL_DELAY_FEEDBACK') return 'SOUND > DELAY > AMOUNT';
  if (id === 'GLOBAL_DELAY_RATE') return 'SOUND > DELAY > RATE';
  if (id === 'delaySyncLevel') return 'SOUND > DELAY > SYNC';
  if (id === 'delayPingPong') return 'SOUND > DELAY > PINGPONG';
  if (id === 'delayAnalog') return 'SOUND > DELAY > TYPE';

  // Effects - Reverb
  if (id === 'GLOBAL_REVERB_AMOUNT') return 'SOUND > REVERB > AMOUNT';
  if (/reverb/.test(id)) return `SONG > REVERB > ${id.replace('reverb', '').toUpperCase() || 'AMOUNT'}`;

  // Effects - Mod FX
  if (id === 'GLOBAL_MOD_FX_DEPTH') return 'SOUND > MOD-FX > DEPTH';
  if (id === 'GLOBAL_MOD_FX_RATE') return 'SOUND > MOD-FX > RATE';
  if (id === 'UNPATCHED_MOD_FX_OFFSET') return 'SOUND > MOD-FX > OFFSET';
  if (id === 'UNPATCHED_MOD_FX_FEEDBACK') return 'SOUND > MOD-FX > FEEDBACK';
  if (id === 'modFXType') return 'SOUND > MOD-FX > TYPE';
  if (id === 'UNPATCHED_MOD_FX_RATE_GLOBAL') return 'KIT/SONG > MOD-FX > RATE';
  if (id === 'UNPATCHED_MOD_FX_DEPTH_GLOBAL') return 'KIT/SONG > MOD-FX > DEPTH';

  // Effects - Distortion
  if (id === 'UNPATCHED_BITCRUSHING') return 'SOUND > DISTORTION > BITCRUSH';
  if (id === 'UNPATCHED_SAMPLE_RATE_REDUCTION') return 'SOUND > DISTORTION > DECIMATION';
  if (id === 'clippingAmount') return 'SOUND > DISTORTION > SATURATION';

  // Effects - EQ
  if (id === 'UNPATCHED_BASS') return 'SOUND > EQ > BASS';
  if (id === 'UNPATCHED_TREBLE') return 'SOUND > EQ > TREBLE';
  if (id === 'UNPATCHED_BASS_FREQ') return 'SOUND > EQ > BASS FREQ';
  if (id === 'UNPATCHED_TREBLE_FREQ') return 'SOUND > EQ > TREBLE FREQ';

  // Effects - Stutter/Sidechain
  if (id === 'UNPATCHED_STUTTER_RATE') return 'SOUND > STUTTER > RATE';
  if (id === 'UNPATCHED_SIDECHAIN_SHAPE') return 'SOUND > SIDECHAIN > SHAPE';
  if (id === 'UNPATCHED_COMPRESSOR_THRESHOLD') return 'SOUND > SIDECHAIN > THRESHOLD';
  if (id === 'STATIC_SIDECHAIN_ATTACK') return 'SOUND > SIDECHAIN > ATTACK';
  if (id === 'STATIC_SIDECHAIN_RELEASE') return 'SOUND > SIDECHAIN > RELEASE';
  if (id === 'STATIC_SIDECHAIN_VOLUME') return 'SONG > REVERB > SIDECHAIN';

  // Effects - Global unpatched
  if (id === 'UNPATCHED_DELAY_RATE') return 'KIT/SONG > DELAY > RATE';
  if (id === 'UNPATCHED_DELAY_AMOUNT') return 'KIT/SONG > DELAY > AMOUNT';
  if (id === 'UNPATCHED_REVERB_SEND_AMOUNT') return 'KIT/SONG > REVERB > AMOUNT';
  if (id === 'UNPATCHED_SIDECHAIN_VOLUME') return 'KIT/SONG > SIDECHAIN > VOLUME';

  // Effects - Compressor
  if (/^comp/.test(id)) return `SOUND > COMPRESSOR > ${id.replace('comp', '').toUpperCase()}`;

  // Arpeggiator
  if (id === 'GLOBAL_ARP_RATE') return 'SOUND > ARP > RATE';
  if (id === 'UNPATCHED_ARP_GATE') return 'SOUND > ARP > GATE';
  if (id === 'arpMode') return 'SOUND > ARP > MODE';
  if (id === 'arpPresetMode') return 'SOUND > ARP > PRESET';
  if (id === 'arpNoteMode') return 'SOUND > ARP > NOTE MODE';
  if (id === 'arpOctaveMode') return 'SOUND > ARP > OCTAVE MODE';
  if (id === 'arpOctaves') return 'SOUND > ARP > OCTAVES';
  if (/UNPATCHED_ARP_/.test(id)) return `SOUND > ARP > ${id.replace('UNPATCHED_ARP_', '').replace(/_/g, ' ')}`;
  if (id === 'UNPATCHED_NOTE_PROBABILITY') return 'SOUND > ARP > NOTE PROBABILITY';
  if (id === 'UNPATCHED_REVERSE_PROBABILITY') return 'SOUND > ARP > REVERSE PROBABILITY';
  if (id === 'UNPATCHED_SPREAD_VELOCITY') return 'SOUND > ARP > VELOCITY SPREAD';
  if (id === 'UNPATCHED_ARP_RATE_GLOBAL') return 'KIT > ARP > RATE';

  // Voice
  if (id === 'polyphonic') return 'SOUND > VOICE > POLYPHONY';
  if (id === 'voicePriority') return 'SOUND > VOICE > PRIORITY';
  if (id === 'numUnison') return 'SOUND > UNISON > NUMBER';
  if (id === 'unisonDetune') return 'SOUND > UNISON > DETUNE';
  if (id === 'unisonStereoSpread') return 'SOUND > UNISON > SPREAD';
  if (id === 'maxVoiceCount') return 'SOUND > VOICE > VOICE COUNT';

  // Portamento
  if (id === 'UNPATCHED_PORTAMENTO') return 'SOUND > PORTAMENTO';

  return displayName ? `SOUND > ${displayName.toUpperCase()}` : 'SOUND';
}

function menuSuffix(id) {
  if (/VOLUME/.test(id)) return 'LEVEL';
  if (/PITCH_ADJUST/.test(id)) return 'TRANSPOSE';
  if (/PHASE_WIDTH/.test(id)) return 'PULSE WIDTH';
  if (/WAVE_INDEX/.test(id)) return 'WAVE INDEX';
  if (/FEEDBACK/.test(id)) return 'FEEDBACK';
  if (/FREQ/.test(id)) return 'FREQUENCY';
  if (/RESONANCE|_RES/.test(id)) return 'RESONANCE';
  if (/MORPH/.test(id)) return 'MORPH';
  return id.split('_').pop();
}

function describeParam(id, displayName, category) {
  // Oscillator params
  const oscAMatch = id.match(/LOCAL_OSC_A_(\w+)/);
  if (oscAMatch) return describeOscParam(oscAMatch[1], 1);
  const oscBMatch = id.match(/LOCAL_OSC_B_(\w+)/);
  if (oscBMatch) return describeOscParam(oscBMatch[1], 2);

  const mod0Match = id.match(/LOCAL_MODULATOR_0_(\w+)/);
  if (mod0Match) return describeFMParam(mod0Match[1], 1);
  const mod1Match = id.match(/LOCAL_MODULATOR_1_(\w+)/);
  if (mod1Match) return describeFMParam(mod1Match[1], 2);

  if (id === 'LOCAL_CARRIER_0_FEEDBACK') return 'Feedback for oscillator 1 carrier';
  if (id === 'LOCAL_CARRIER_1_FEEDBACK') return 'Feedback for oscillator 2 carrier';
  if (id === 'LOCAL_NOISE_VOLUME') return 'Volume level of the noise oscillator';
  if (id === 'LOCAL_FOLD') return 'Wavefolder distortion amount';
  if (id === 'oscillatorSync') return 'Hard sync between oscillators';
  if (/oscType_source0/.test(id)) return 'Waveform type for oscillator 1';
  if (/oscType_source1/.test(id)) return 'Waveform type for oscillator 2';
  if (id === 'synthMode') return 'Synthesis engine mode';
  if (id === 'sampleRepeatMode') return 'Sample playback repeat mode';

  // Filter
  if (id === 'LOCAL_LPF_FREQ') return 'Low-pass filter cutoff frequency';
  if (id === 'LOCAL_LPF_RESONANCE') return 'Low-pass filter resonance';
  if (id === 'LOCAL_LPF_MORPH') return 'Low-pass filter morph parameter';
  if (id === 'LOCAL_HPF_FREQ') return 'High-pass filter cutoff frequency';
  if (id === 'LOCAL_HPF_RESONANCE') return 'High-pass filter resonance';
  if (id === 'LOCAL_HPF_MORPH') return 'High-pass filter morph parameter';
  if (id === 'lpfMode') return 'Low-pass filter mode/type';
  if (id === 'hpfMode') return 'High-pass filter mode/type';
  if (id === 'filterRoute') return 'Signal routing between LPF and HPF';
  if (/UNPATCHED_LPF_/.test(id)) return `Low-pass filter ${id.includes('RES') ? 'resonance' : id.includes('MORPH') ? 'morph' : 'frequency'} (Kit/Song level)`;
  if (/UNPATCHED_HPF_/.test(id)) return `High-pass filter ${id.includes('RES') ? 'resonance' : id.includes('MORPH') ? 'morph' : 'frequency'} (Kit/Song level)`;

  // Envelope
  const envMatch = id.match(/LOCAL_ENV_(\d)_(\w+)/);
  if (envMatch) {
    const envNum = parseInt(envMatch[1]) + 1;
    const stage = envMatch[2].toLowerCase();
    const stageDesc = stage === 'sustain' ? 'Sustain level' : `${stage.charAt(0).toUpperCase() + stage.slice(1)} time`;
    return `${stageDesc} of envelope ${envNum}`;
  }

  // LFO
  if (/GLOBAL_LFO_FREQ_1/.test(id)) return 'Rate of global LFO 1';
  if (/LOCAL_LFO_LOCAL_FREQ_1/.test(id)) return 'Rate of local LFO 2';
  if (/GLOBAL_LFO_FREQ_2/.test(id)) return 'Rate of global LFO 3';
  if (/LOCAL_LFO_LOCAL_FREQ_2/.test(id)) return 'Rate of local LFO 4';
  if (/lfoType_1/.test(id)) return 'Waveform shape of LFO 1';
  if (/lfoType_2/.test(id)) return 'Waveform shape of LFO 2';
  if (/lfoType_3/.test(id)) return 'Waveform shape of LFO 3';
  if (/lfoType_4/.test(id)) return 'Waveform shape of LFO 4';

  // Global
  if (id === 'LOCAL_VOLUME') return 'Master volume level';
  if (id === 'LOCAL_PAN') return 'Stereo pan position';
  if (id === 'LOCAL_PITCH_ADJUST') return 'Master pitch transpose';
  if (id === 'GLOBAL_VOLUME_POST_FX') return 'Volume level after effects chain';
  if (id === 'GLOBAL_VOLUME_POST_REVERB_SEND') return 'Sidechain ducking level';
  if (id === 'UNPATCHED_PAN') return 'Pan position (Kit/Song level)';
  if (id === 'UNPATCHED_VOLUME') return 'Master volume (Kit/Song level)';
  if (id === 'UNPATCHED_PITCH_ADJUST') return 'Master pitch (Kit/Song level)';
  if (id === 'UNPATCHED_TEMPO') return 'Tempo control (Song level)';

  // Effects
  if (id === 'GLOBAL_DELAY_FEEDBACK') return 'Delay feedback amount';
  if (id === 'GLOBAL_DELAY_RATE') return 'Delay time/rate';
  if (id === 'delaySyncLevel') return 'Delay sync to tempo division (even values only shown; triplet and dotted also available)';
  if (id === 'delayPingPong') return 'Enable stereo ping-pong delay';
  if (id === 'delayAnalog') return 'Delay character type';
  if (id === 'GLOBAL_REVERB_AMOUNT') return 'Reverb send amount';
  if (id === 'reverbRoomSize') return 'Reverb room size';
  if (id === 'reverbDamping') return 'Reverb high-frequency damping';
  if (id === 'reverbWidth') return 'Reverb stereo width';
  if (id === 'reverbPan') return 'Reverb pan position';
  if (id === 'reverbHPF') return 'Reverb high-pass filter';
  if (id === 'reverbLPF') return 'Reverb low-pass filter';
  if (id === 'reverbModel') return 'Reverb algorithm model';
  if (id === 'GLOBAL_MOD_FX_DEPTH') return 'Mod FX depth/intensity';
  if (id === 'GLOBAL_MOD_FX_RATE') return 'Mod FX rate/speed';
  if (id === 'UNPATCHED_MOD_FX_OFFSET') return 'Mod FX stereo offset';
  if (id === 'UNPATCHED_MOD_FX_FEEDBACK') return 'Mod FX feedback amount';
  if (id === 'modFXType') return 'Mod FX effect type';
  if (id === 'UNPATCHED_BITCRUSHING') return 'Bitcrusher effect amount';
  if (id === 'UNPATCHED_SAMPLE_RATE_REDUCTION') return 'Sample rate reduction (decimation) amount';
  if (id === 'clippingAmount') return 'Saturation/clipping distortion amount';
  if (id === 'UNPATCHED_BASS') return 'Bass EQ boost/cut';
  if (id === 'UNPATCHED_TREBLE') return 'Treble EQ boost/cut';
  if (id === 'UNPATCHED_BASS_FREQ') return 'Bass EQ center frequency';
  if (id === 'UNPATCHED_TREBLE_FREQ') return 'Treble EQ center frequency';
  if (id === 'UNPATCHED_STUTTER_RATE') return 'Stutter effect rate';
  if (id === 'UNPATCHED_SIDECHAIN_SHAPE') return 'Sidechain compressor envelope shape';
  if (id === 'UNPATCHED_COMPRESSOR_THRESHOLD') return 'Sidechain compressor threshold';
  if (id === 'STATIC_SIDECHAIN_ATTACK') return 'Sidechain compressor attack time';
  if (id === 'STATIC_SIDECHAIN_RELEASE') return 'Sidechain compressor release time';
  if (id === 'STATIC_SIDECHAIN_VOLUME') return 'Sidechain volume for reverb (song-level)';
  if (id === 'UNPATCHED_MOD_FX_RATE_GLOBAL') return 'Mod FX rate for global effectable (Kit/Song level)';
  if (id === 'UNPATCHED_MOD_FX_DEPTH_GLOBAL') return 'Mod FX depth for global effectable (Kit/Song level)';
  if (id === 'UNPATCHED_DELAY_RATE') return 'Delay rate (Kit/Song level)';
  if (id === 'UNPATCHED_DELAY_AMOUNT') return 'Delay amount (Kit/Song level)';
  if (id === 'UNPATCHED_REVERB_SEND_AMOUNT') return 'Reverb send amount (Kit/Song level)';
  if (id === 'UNPATCHED_SIDECHAIN_VOLUME') return 'Sidechain volume (Kit/Song level)';
  if (id === 'compRatio') return 'Audio compressor ratio';
  if (id === 'compAttack') return 'Audio compressor attack time';
  if (id === 'compRelease') return 'Audio compressor release time';
  if (id === 'compBlend') return 'Audio compressor dry/wet blend';
  if (id === 'compHPF') return 'Audio compressor sidechain high-pass filter';

  // Arpeggiator
  if (id === 'GLOBAL_ARP_RATE') return 'Arpeggiator rate';
  if (id === 'UNPATCHED_ARP_GATE') return 'Arpeggiator gate length';
  if (id === 'arpMode') return 'Arpeggiator on/off';
  if (id === 'arpPresetMode') return 'Arpeggiator preset pattern';
  if (id === 'arpNoteMode') return 'Arpeggiator note order mode';
  if (id === 'arpOctaveMode') return 'Octave traversal pattern for the arpeggiator';
  if (id === 'arpOctaves') return 'Number of octaves for the arpeggiator';
  if (id === 'UNPATCHED_ARP_RHYTHM') return 'Arpeggiator rhythm pattern';
  if (id === 'UNPATCHED_ARP_SEQUENCE_LENGTH') return 'Arpeggiator sequence length';
  if (id === 'UNPATCHED_ARP_CHORD_POLYPHONY') return 'Arpeggiator chord polyphony';
  if (id === 'UNPATCHED_ARP_RATCHET_AMOUNT') return 'Arpeggiator ratchet amount';
  if (id === 'UNPATCHED_NOTE_PROBABILITY') return 'Note trigger probability';
  if (id === 'UNPATCHED_REVERSE_PROBABILITY') return 'Probability of reversing note direction';
  if (id === 'UNPATCHED_ARP_BASS_PROBABILITY') return 'Arpeggiator bass note probability';
  if (id === 'UNPATCHED_ARP_SWAP_PROBABILITY') return 'Arpeggiator note swap probability';
  if (id === 'UNPATCHED_ARP_GLIDE_PROBABILITY') return 'Arpeggiator glide probability';
  if (id === 'UNPATCHED_ARP_CHORD_PROBABILITY') return 'Arpeggiator chord probability';
  if (id === 'UNPATCHED_ARP_RATCHET_PROBABILITY') return 'Arpeggiator ratchet probability';
  if (id === 'UNPATCHED_ARP_SPREAD_GATE') return 'Arpeggiator gate spread';
  if (id === 'UNPATCHED_ARP_SPREAD_OCTAVE') return 'Arpeggiator octave spread';
  if (id === 'UNPATCHED_SPREAD_VELOCITY') return 'Arpeggiator velocity spread';
  if (id === 'UNPATCHED_ARP_RATE_GLOBAL') return 'Arpeggiator rate for Kit level';

  // Voice
  if (id === 'polyphonic') return 'Polyphony mode for the sound';
  if (id === 'voicePriority') return 'Priority when stealing voices';
  if (id === 'numUnison') return 'Number of unison voices';
  if (id === 'unisonDetune') return 'Detune spread between unison voices';
  if (id === 'unisonStereoSpread') return 'Stereo spread of unison voices';
  if (id === 'maxVoiceCount') return 'Maximum number of simultaneous voices';

  // Portamento
  if (id === 'UNPATCHED_PORTAMENTO') return 'Portamento/glide time';

  return displayName || id;
}

function describeOscParam(suffix, num) {
  if (suffix === 'VOLUME') return `Volume level of oscillator ${num}`;
  if (suffix === 'PITCH_ADJUST') return `Pitch adjustment for oscillator ${num}`;
  if (suffix === 'PHASE_WIDTH') return `Pulse width of oscillator ${num} waveform`;
  if (suffix === 'WAVE_INDEX') return `Wavetable position for oscillator ${num}`;
  return `Oscillator ${num} ${suffix.toLowerCase().replace(/_/g, ' ')}`;
}

function describeFMParam(suffix, num) {
  if (suffix === 'VOLUME') return `Volume level of FM modulator ${num}`;
  if (suffix === 'PITCH_ADJUST') return `Pitch adjustment for FM modulator ${num}`;
  if (suffix === 'FEEDBACK') return `Feedback amount for FM modulator ${num}`;
  return `FM modulator ${num} ${suffix.toLowerCase().replace(/_/g, ' ')}`;
}

// ---------------------------------------------------------------------------
// 10. Build all parameter entries
// ---------------------------------------------------------------------------
const allParams = [];

function addPatchedParam(id, index) {
  if (SKIP_IDS.has(id)) return;

  const xmlTag = xmlTagMap[id] || null;
  const shortName = shortNameMap[id] || null;
  const l10nKey = patchedDisplayL10n[id];
  const displayName = displayNameOverrides[id]
    || normalizeDisplayName(l10nKey ? resolveL10n(l10nKey) : null)
    || shortName || id;
  const category = categorizeParam(id);
  const isBipolar = bipolarPatched.has(id) ? true : null;
  const defaultVal = defaultsMap[id] || null;

  allParams.push({
    id,
    xmlTag,
    displayName,
    shortName,
    type: 'integer',
    min: null,
    max: null,
    defaultValue: defaultVal,
    enumValues: null,
    unit: /PITCH/.test(id) ? 'semitones' : null,
    category,
    menuPath: deriveMenuPath(id, displayName),
    firmwareVersion: null,
    description: describeParam(id, displayName, category),
    kind: 'PATCHED',
    paramIndex: index,
    bipolar: isBipolar,
  });
}

function addUnpatchedParam(id, index, kind, l10nSource) {
  if (SKIP_IDS.has(id)) return;

  const xmlTag = xmlTagMap[id] || null;
  const l10nKey = l10nSource[id];
  const displayName = displayNameOverrides[id]
    || normalizeDisplayName(l10nKey ? resolveL10n(l10nKey) : null)
    || id;
  const category = categorizeParam(id);
  const isBipolar = bipolarUnpatched.has(id) ? true : null;
  const defaultVal = defaultsMap[id] || null;

  allParams.push({
    id,
    xmlTag,
    displayName,
    shortName: null,
    type: 'integer',
    min: null,
    max: null,
    defaultValue: defaultVal,
    enumValues: null,
    unit: null,
    category,
    menuPath: deriveMenuPath(id, displayName),
    firmwareVersion: null,
    description: describeParam(id, displayName, category),
    kind,
    paramIndex: index,
    bipolar: isBipolar,
  });
}

// Add LOCAL patched params
for (const [id, idx] of localParams) {
  addPatchedParam(id, idx);
}

// Add GLOBAL patched params
for (const [id, idx] of globalParams) {
  addPatchedParam(id, idx);
}

// Add UNPATCHED_SHARED params
for (const [id, idx] of unpatchedShared) {
  addUnpatchedParam(id, idx, 'UNPATCHED_SHARED', unpatchedSharedDisplayL10n);
}

// Add UNPATCHED_SOUND params
for (const [id, idx] of unpatchedSound) {
  addUnpatchedParam(id, idx, 'UNPATCHED_SOUND', unpatchedSoundDisplayL10n);
}

// Add UNPATCHED_GLOBAL params (with disambiguated IDs for shared namespace)
for (const [id, idx] of unpatchedGlobal) {
  if (SKIP_IDS.has(id)) continue;
  // Skip params already in shared (they have the same enum names at start)
  if (unpatchedShared.has(id)) continue;

  const xmlTag = xmlTagMap[id] || null;
  const l10nKey = unpatchedGlobalDisplayL10n[id];
  const displayName = displayNameOverrides[id]
    || normalizeDisplayName(l10nKey ? resolveL10n(l10nKey) : null)
    || id;
  const category = categorizeParam(id);
  const isBipolar = bipolarUnpatched.has(id) ? true : null;

  // Use disambiguated ID for globals that overlap with patched param names
  let outId = id;
  if (id === 'UNPATCHED_MOD_FX_RATE') outId = 'UNPATCHED_MOD_FX_RATE_GLOBAL';
  else if (id === 'UNPATCHED_MOD_FX_DEPTH') outId = 'UNPATCHED_MOD_FX_DEPTH_GLOBAL';
  else if (id === 'UNPATCHED_ARP_RATE') outId = 'UNPATCHED_ARP_RATE_GLOBAL';

  allParams.push({
    id: outId,
    xmlTag,
    displayName,
    shortName: null,
    type: 'integer',
    min: null,
    max: null,
    defaultValue: null,
    enumValues: null,
    unit: null,
    category,
    menuPath: deriveMenuPath(outId, displayName),
    firmwareVersion: null,
    description: describeParam(outId, displayName, category),
    kind: 'UNPATCHED_GLOBAL',
    paramIndex: idx,
    bipolar: isBipolar,
  });
}

// Add STATIC params
for (const [id, idx] of staticParams) {
  if (SKIP_IDS.has(id)) continue;
  allParams.push({
    id,
    xmlTag: null,
    displayName: id.replace(/^STATIC_/, '').replace(/_/g, ' ').toLowerCase()
      .replace(/^\w/, c => c.toUpperCase()),
    shortName: null,
    type: 'integer',
    min: null,
    max: null,
    defaultValue: null,
    enumValues: null,
    unit: null,
    category: 'Effect',
    menuPath: deriveMenuPath(id, null),
    firmwareVersion: null,
    description: describeParam(id, null, 'Effect'),
    kind: 'STATIC',
    paramIndex: idx,
    bipolar: null,
  });
}

// ---------------------------------------------------------------------------
// 11. Non-modulation params — dynamically parsed from g_menus.inc and menus.cpp
// ---------------------------------------------------------------------------

/**
 * Parse menu item declarations from g_menus.inc and menus.cpp to discover
 * non-modulation parameters. Returns an array of parameter objects.
 */
function parseNonModParams() {
  const gMenusSrc = readFirmwareFile('src/deluge/gui/menu_item/generate/g_menus.inc');
  const menusCppSrc = readFirmwareFile('src/deluge/gui/ui/menus.cpp');
  const combinedSrc = gMenusSrc + '\n' + menusCppSrc;

  const params = [];

  // Define the menu item type mappings
  // Each entry: { pattern, handler }
  // pattern matches class declarations in the source
  // handler returns parameter object(s) for that match

  // --- osc::Type ---
  // Pattern: osc::Type varName{STRING_FOR_*, STRING_FOR_*, N};
  const oscTypeRe = /osc::Type\s+(\w+)\{[^,]+,\s*[^,]+,\s*(\d+)\s*\}/g;
  let m;
  while ((m = oscTypeRe.exec(combinedSrc)) !== null) {
    const sourceId = parseInt(m[2], 10);
    const id = `oscType_source${sourceId}`;
    const oscNum = sourceId + 1;
    // Osc2 has a restricted set (no DX7, Input types)
    const ev = sourceId === 0 ? enumLabels.OscType : enumLabels.OscType.filter(e => e.value <= 7);
    params.push({
      id,
      xmlTag: 'type',
      displayName: `Osc${oscNum} type`,
      category: 'Oscillator',
      type: 'enum',
      enumValues: ev,
      menuPath: `SOUND > OSC${oscNum} > TYPE`,
      description: `Waveform type for oscillator ${oscNum}`,
    });
  }

  // --- lfo::Type ---
  // Pattern: lfo::Type varName{STRING_FOR_*, STRING_FOR_*, LFO_ID};
  const lfoTypeRe = /lfo::Type\s+(\w+)\{[^,]+,\s*[^,]+,\s*(\w+)\s*\}/g;
  const lfoIdMap = { LFO1_ID: 1, LFO2_ID: 2, LFO3_ID: 3, LFO4_ID: 4 };
  while ((m = lfoTypeRe.exec(combinedSrc)) !== null) {
    const lfoIdKey = m[2].trim();
    const lfoNum = lfoIdMap[lfoIdKey] || parseInt(lfoIdKey, 10) + 1;
    params.push({
      id: `lfoType_${lfoNum}`,
      xmlTag: null,
      displayName: `LFO${lfoNum} type`,
      category: 'LFO',
      type: 'enum',
      enumValues: enumLabels.LFOType,
      menuPath: `SOUND > LFO${lfoNum} > SHAPE`,
      description: `Waveform shape of LFO ${lfoNum}`,
      defaultValue: lfoNum <= 2 ? '0 (Sine)' : null,
    });
  }

  // --- filter::FilterModeSelection ---
  // Pattern: filter::FilterModeSelection varName{STRING_FOR_*, STRING_FOR_*, filter::FilterSlot::LPF/HPF};
  const filterModeRe = /filter::FilterModeSelection\s+(\w+)\{[^,]+,\s*[^,]+,\s*filter::FilterSlot::(\w+)\s*\}/g;
  while ((m = filterModeRe.exec(combinedSrc)) !== null) {
    const slot = m[2]; // LPF or HPF
    const isHpf = slot === 'HPF';
    params.push({
      id: isHpf ? 'hpfMode' : 'lpfMode',
      xmlTag: isHpf ? 'hpfMode' : 'lpfMode',
      displayName: isHpf ? 'HPF mode' : 'LPF mode',
      category: 'Filter',
      type: 'enum',
      enumValues: isHpf ? enumLabels.FilterModeHPF : enumLabels.FilterModeLPF,
      menuPath: isHpf ? 'SOUND > HPF > MODE' : 'SOUND > LPF > MODE',
      description: isHpf ? 'High-pass filter mode/type' : 'Low-pass filter mode/type',
      defaultValue: isHpf ? '2 (HPLadder)' : '1 (Transistor 24dB)',
    });
  }

  // --- FilterRouting ---
  // Pattern: FilterRouting varName{STRING_FOR_*};
  const filterRoutingRe = /FilterRouting\s+(\w+)\{/g;
  while ((m = filterRoutingRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'filterRoute',
      xmlTag: 'filterRoute',
      displayName: 'Filter routing',
      category: 'Filter',
      type: 'enum',
      enumValues: enumLabels.FilterRoute,
      menuPath: 'SOUND > FILTERS > ROUTING',
      description: 'Signal routing between LPF and HPF',
      defaultValue: '0 (HPF to LPF)',
    });
    break; // only one
  }

  // --- SynthModeSelection ---
  const synthModeRe = /SynthModeSelection\s+(\w+)\{/g;
  while ((m = synthModeRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'synthMode',
      xmlTag: 'type',
      displayName: 'Synth mode',
      category: 'Oscillator',
      type: 'enum',
      enumValues: enumLabels.SynthMode,
      menuPath: 'SOUND > SYNTH MODE',
      description: 'Synthesis engine mode',
      defaultValue: '0 (Subtractive)',
    });
    break;
  }

  // --- sample::Repeat ---
  // Pattern: sample::Repeat varName{STRING_FOR_*, STRING_FOR_*, N};
  // Only emit one entry (the concept), not per-osc instances
  const sampleRepeatRe = /sample::Repeat\s+(\w+)\{[^}]+\}/g;
  let sampleRepeatFound = false;
  while ((m = sampleRepeatRe.exec(combinedSrc)) !== null) {
    if (!sampleRepeatFound) {
      params.push({
        id: 'sampleRepeatMode',
        xmlTag: 'loopMode',
        displayName: 'Repeat mode',
        category: 'Oscillator',
        type: 'enum',
        enumValues: enumLabels.SampleRepeatMode,
        menuPath: 'SOUND > SAMPLE > REPEAT MODE',
        description: 'Sample playback repeat mode',
      });
      sampleRepeatFound = true;
    }
  }

  // --- osc::Sync (boolean toggle) ---
  const oscSyncRe = /osc::Sync\s+(\w+)\{/g;
  while ((m = oscSyncRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'oscillatorSync',
      xmlTag: 'oscillatorSync',
      displayName: 'Oscillator sync',
      category: 'Oscillator',
      type: 'boolean',
      menuPath: 'SOUND > MIXER > OSC SYNC',
      description: 'Hard sync between oscillators',
      defaultValue: 'false',
    });
    break;
  }

  // --- mod_fx::Type ---
  const modFXTypeRe = /mod_fx::Type\s+(\w+)\{/g;
  while ((m = modFXTypeRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'modFXType',
      xmlTag: 'modFXType',
      displayName: 'MOD-FX type',
      category: 'Effect',
      type: 'enum',
      enumValues: enumLabels.ModFXType,
      menuPath: 'SOUND > MOD-FX > TYPE',
      description: 'Mod FX effect type',
    });
    break;
  }

  // --- delay::PingPong ---
  const delayPPRe = /delay::PingPong\s+(\w+)\{/g;
  while ((m = delayPPRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'delayPingPong',
      xmlTag: 'pingPong',
      displayName: 'Delay pingpong',
      category: 'Effect',
      type: 'boolean',
      enumValues: enumLabels.DelayPingPong,
      menuPath: 'SOUND > DELAY > PINGPONG',
      description: 'Enable stereo ping-pong delay',
      defaultValue: 'false',
    });
    break;
  }

  // --- delay::Analog ---
  const delayAnalogRe = /delay::Analog\s+(\w+)\{/g;
  while ((m = delayAnalogRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'delayAnalog',
      xmlTag: 'analog',
      displayName: 'Delay type',
      category: 'Effect',
      type: 'enum',
      enumValues: enumLabels.DelayAnalog,
      menuPath: 'SOUND > DELAY > TYPE',
      description: 'Delay character type',
    });
    break;
  }

  // --- delay::Sync ---
  const delaySyncRe = /delay::Sync\s+(\w+)\{/g;
  while ((m = delaySyncRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'delaySyncLevel',
      xmlTag: null,
      displayName: 'Delay sync',
      category: 'Effect',
      type: 'enum',
      enumValues: [
        { value: 0, label: 'Off' }, { value: 1, label: '1/1' }, { value: 2, label: '1/2' },
        { value: 3, label: '1/4' }, { value: 4, label: '1/8' }, { value: 5, label: '1/16' },
        { value: 6, label: '1/32' }, { value: 7, label: '1/64' }, { value: 8, label: '1/128' },
        { value: 9, label: '1/256' },
      ],
      menuPath: 'SOUND > DELAY > SYNC',
      description: 'Delay sync to tempo division (even values only shown; triplet and dotted also available)',
    });
    break;
  }

  // --- reverb::Model ---
  const reverbModelRe = /reverb::Model\s+(\w+)\{/g;
  while ((m = reverbModelRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'reverbModel',
      xmlTag: 'model',
      displayName: 'Reverb model',
      category: 'Effect',
      type: 'enum',
      enumValues: enumLabels.ReverbModel,
      menuPath: 'SONG > REVERB > MODEL',
      description: 'Reverb algorithm model',
    });
    break;
  }

  // --- reverb::RoomSize, Damping, Width, Pan, HPF, LPF ---
  const reverbIntTypes = [
    { re: /reverb::RoomSize\s+(\w+)\{/, id: 'reverbRoomSize', xmlTag: 'roomSize', displayName: 'Room size', desc: 'Reverb room size', suffix: 'ROOMSIZE' },
    { re: /reverb::Damping\s+(\w+)\{/, id: 'reverbDamping', xmlTag: 'dampening', displayName: 'Damping', desc: 'Reverb high-frequency damping', suffix: 'DAMPING' },
    { re: /reverb::Width\s+(\w+)\{/, id: 'reverbWidth', xmlTag: 'width', displayName: 'Width', desc: 'Reverb stereo width', suffix: 'WIDTH' },
    { re: /reverb::Pan\s+(\w+)\{/, id: 'reverbPan', xmlTag: 'pan', displayName: 'Reverb pan', desc: 'Reverb pan position', suffix: 'PAN' },
    { re: /reverb::HPF\s+(\w+)\{/, id: 'reverbHPF', xmlTag: 'hpf', displayName: 'Reverb HPF', desc: 'Reverb high-pass filter', suffix: 'HPF' },
    { re: /reverb::LPF\s+(\w+)\{/, id: 'reverbLPF', xmlTag: 'lpf', displayName: 'Reverb LPF', desc: 'Reverb low-pass filter', suffix: 'LPF' },
  ];
  for (const rt of reverbIntTypes) {
    if (rt.re.test(combinedSrc)) {
      params.push({
        id: rt.id,
        xmlTag: rt.xmlTag,
        displayName: rt.displayName,
        category: 'Effect',
        type: 'integer',
        menuPath: `SONG > REVERB > ${rt.suffix}`,
        description: rt.desc,
      });
    }
  }

  // --- fx::Clipping ---
  const clippingRe = /fx::Clipping\s+(\w+)\{/g;
  while ((m = clippingRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'clippingAmount',
      xmlTag: 'clippingAmount',
      displayName: 'Saturation',
      category: 'Effect',
      type: 'integer',
      menuPath: 'SOUND > DISTORTION > SATURATION',
      description: 'Saturation/clipping distortion amount',
    });
    break;
  }

  // --- audio_compressor types ---
  const compTypes = [
    { re: /audio_compressor::Ratio\s+(\w+)\{/, id: 'compRatio', xmlTag: 'ratio', displayName: 'Comp ratio', desc: 'Audio compressor ratio', unit: ': 1' },
    { re: /audio_compressor::Attack\s+(\w+)\{/, id: 'compAttack', xmlTag: 'attack', displayName: 'Comp attack', desc: 'Audio compressor attack time', unit: 'ms' },
    { re: /audio_compressor::Release\s+(\w+)\{/, id: 'compRelease', xmlTag: 'release', displayName: 'Comp release', desc: 'Audio compressor release time', unit: 'ms' },
    { re: /audio_compressor::Blend\s+(\w+)\{/, id: 'compBlend', xmlTag: 'compBlend', displayName: 'Comp blend', desc: 'Audio compressor dry/wet blend' },
    { re: /audio_compressor::SideHPF\s+(\w+)\{/, id: 'compHPF', xmlTag: 'compHPF', displayName: 'Comp sidechain HPF', desc: 'Audio compressor sidechain high-pass filter' },
  ];
  for (const ct of compTypes) {
    if (ct.re.test(combinedSrc)) {
      params.push({
        id: ct.id,
        xmlTag: ct.xmlTag,
        displayName: ct.displayName,
        category: 'Effect',
        type: 'decimal',
        unit: ct.unit || null,
        menuPath: `SOUND > COMPRESSOR > ${ct.id.replace('comp', '').toUpperCase()}`,
        description: ct.desc,
      });
    }
  }

  // --- arpeggiator::Mode ---
  const arpModeRe = /arpeggiator::Mode\s+(\w+)\{/g;
  while ((m = arpModeRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'arpMode',
      xmlTag: 'arpMode',
      displayName: 'Arp enabled',
      category: 'Arpeggiator',
      type: 'enum',
      enumValues: enumLabels.ArpMode,
      menuPath: 'SOUND > ARP > MODE',
      description: 'Arpeggiator on/off',
      defaultValue: '0 (Off)',
    });
    break;
  }

  // --- arpeggiator::PresetMode ---
  const arpPresetRe = /arpeggiator::PresetMode\s+(\w+)\{/g;
  while ((m = arpPresetRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'arpPresetMode',
      xmlTag: null,
      displayName: 'Arp preset',
      category: 'Arpeggiator',
      type: 'enum',
      enumValues: enumLabels.ArpPreset,
      menuPath: 'SOUND > ARP > PRESET',
      description: 'Arpeggiator preset pattern',
      defaultValue: '0 (Off)',
    });
    break;
  }

  // --- arpeggiator::NoteMode ---
  const arpNoteRe = /arpeggiator::NoteMode\s+(\w+)\{/g;
  while ((m = arpNoteRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'arpNoteMode',
      xmlTag: 'noteMode',
      displayName: 'Arp note mode',
      category: 'Arpeggiator',
      type: 'enum',
      enumValues: enumLabels.ArpNoteMode,
      menuPath: 'SOUND > ARP > NOTE MODE',
      description: 'Arpeggiator note order mode',
    });
    break;
  }

  // --- arpeggiator::OctaveMode ---
  const arpOctModeRe = /arpeggiator::OctaveMode\s+(\w+)\{/g;
  while ((m = arpOctModeRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'arpOctaveMode',
      xmlTag: 'octaveMode',
      displayName: 'Arp octave mode',
      category: 'Arpeggiator',
      type: 'enum',
      enumValues: enumLabels.ArpOctaveMode,
      menuPath: 'SOUND > ARP > OCTAVE MODE',
      description: 'Octave traversal pattern for the arpeggiator',
    });
    break;
  }

  // --- arpeggiator::Octaves ---
  const arpOctRe = /arpeggiator::Octaves\s+(\w+)\{/g;
  while ((m = arpOctRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'arpOctaves',
      xmlTag: 'numOctaves',
      displayName: 'Arp octaves',
      category: 'Arpeggiator',
      type: 'integer',
      min: 1,
      max: 8,
      menuPath: 'SOUND > ARP > OCTAVES',
      description: 'Number of octaves for the arpeggiator',
      defaultValue: '2',
    });
    break;
  }

  // --- voice::PolyphonyType ---
  const polyRe = /voice::PolyphonyType\s+(\w+)\{/g;
  while ((m = polyRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'polyphonic',
      xmlTag: 'polyphonic',
      displayName: 'Polyphony',
      category: 'Voice',
      type: 'enum',
      enumValues: enumLabels.PolyphonyMode,
      menuPath: 'SOUND > VOICE > POLYPHONY',
      description: 'Polyphony mode for the sound',
      defaultValue: '1 (Polyphonic); 0 (Auto) for samples',
    });
    break;
  }

  // --- voice::Priority ---
  const priRe = /voice::Priority\s+(\w+)\{/g;
  while ((m = priRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'voicePriority',
      xmlTag: 'voicePriority',
      displayName: 'Voice priority',
      category: 'Voice',
      type: 'enum',
      enumValues: enumLabels.VoicePriority,
      menuPath: 'SOUND > VOICE > PRIORITY',
      description: 'Priority when stealing voices',
      defaultValue: '1 (Medium)',
    });
    break;
  }

  // --- voice::VoiceCount ---
  const vcRe = /voice::VoiceCount\s+(?:voice::)?(\w+)\{/g;
  while ((m = vcRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'maxVoiceCount',
      xmlTag: 'maxVoices',
      displayName: 'Max voices',
      category: 'Voice',
      type: 'integer',
      min: 1,
      max: 32,
      menuPath: 'SOUND > VOICE > VOICE COUNT',
      description: 'Maximum number of simultaneous voices',
      defaultValue: '8',
    });
    break;
  }

  // --- unison::CountToStereoSpread ---
  const unisonCountRe = /unison::CountToStereoSpread\s+(\w+)\{/g;
  while ((m = unisonCountRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'numUnison',
      xmlTag: null,
      displayName: 'Unison number',
      category: 'Voice',
      type: 'integer',
      min: 1,
      max: 8,
      menuPath: 'SOUND > UNISON > NUMBER',
      description: 'Number of unison voices',
      defaultValue: '1 (no unison); 4 for default synth',
    });
    break;
  }

  // --- unison::Detune ---
  const unisonDetuneRe = /unison::Detune\s+(\w+)\{/g;
  while ((m = unisonDetuneRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'unisonDetune',
      xmlTag: null,
      displayName: 'Unison detune',
      category: 'Voice',
      type: 'integer',
      min: 0,
      max: 50,
      menuPath: 'SOUND > UNISON > DETUNE',
      description: 'Detune spread between unison voices',
      defaultValue: '8; 10 for default synth',
    });
    break;
  }

  // --- unison::StereoSpread ---
  const unisonSpreadRe = /unison::StereoSpread\s+(?:unison::)?(\w+)\{/g;
  while ((m = unisonSpreadRe.exec(combinedSrc)) !== null) {
    params.push({
      id: 'unisonStereoSpread',
      xmlTag: null,
      displayName: 'Unison spread',
      category: 'Voice',
      type: 'integer',
      min: 0,
      max: 50,
      menuPath: 'SOUND > UNISON > SPREAD',
      description: 'Stereo spread of unison voices',
      defaultValue: '0',
    });
    break;
  }

  return params;
}

const nonModParams = parseNonModParams();

// Add non-modulation params
for (const p of nonModParams) {
  allParams.push({
    id: p.id,
    xmlTag: p.xmlTag || null,
    displayName: p.displayName,
    shortName: p.shortName || null,
    type: p.type,
    min: p.min || null,
    max: p.max || null,
    defaultValue: p.defaultValue || null,
    enumValues: p.enumValues || null,
    unit: p.unit || null,
    category: p.category,
    menuPath: p.menuPath,
    firmwareVersion: null,
    description: p.description,
    kind: p.kind || null,
    paramIndex: p.paramIndex || null,
    bipolar: p.bipolar || null,
  });
}

// ---------------------------------------------------------------------------
// 12. Sort and group by category, then displayName
// ---------------------------------------------------------------------------
const categoryOrder = [
  'Oscillator', 'Filter', 'Envelope', 'LFO', 'Global', 'Effect', 'Modulation', 'Arpeggiator', 'Voice'
];

allParams.sort((a, b) => {
  const catA = categoryOrder.indexOf(a.category);
  const catB = categoryOrder.indexOf(b.category);
  if (catA !== catB) return catA - catB;
  return a.displayName.localeCompare(b.displayName);
});

// Group by category
const grouped = {};
for (const p of allParams) {
  if (!grouped[p.category]) grouped[p.category] = [];
  grouped[p.category].push(p);
}

// Build category counts
const categoryCounts = {};
for (const [cat, params] of Object.entries(grouped)) {
  categoryCounts[cat] = params.length;
}

// Build field completeness stats
function countField(field) {
  let present = 0, nil = 0;
  for (const p of allParams) {
    if (p[field] !== null && p[field] !== undefined) present++;
    else nil++;
  }
  return { present, null: nil };
}

const totalParameters = allParams.length;
const completeEntries = allParams.filter(p =>
  p.id && p.displayName && p.type && p.category && p.menuPath && p.description &&
  p.xmlTag !== null && p.defaultValue !== null
).length;

// ---------------------------------------------------------------------------
// 13. Output
// ---------------------------------------------------------------------------
const output = {
  _metadata: {
    description: 'Deluge Firmware Parameter Database - extracted from source code',
    source: 'DelugeFirmware (Synthstrom Audible)',
    extractionMethod: 'Static analysis of C++ source code',
    totalParameters,
    categoryCounts,
    fieldCompleteness: {
      id: countField('id'),
      xmlTag: countField('xmlTag'),
      displayName: countField('displayName'),
      type: countField('type'),
      defaultValue: countField('defaultValue'),
      category: countField('category'),
      menuPath: countField('menuPath'),
      description: countField('description'),
    },
    completeEntries,
    incompleteEntries: totalParameters - completeEntries,
    notes: [
      'Parameter values use 32-bit fixed-point: -2147483648 (min/off) to 2147483647 (max)',
      'User-facing values (0-50) are converted via getParamFromUserValue()',
      'Patched params can be modulated via the mod matrix; unpatched cannot',
      'UNPATCHED_SHARED params are common to both Sound and GlobalEffectable',
      'UNPATCHED_GLOBAL params are only for Kit/Song level effects',
      'Enum values are exact firmware values from definitions_cxx.hpp',
    ],
  },
  parameters: grouped,
};

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
