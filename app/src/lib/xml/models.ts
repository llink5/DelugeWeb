// Deluge object model classes.
// Each class corresponds to an XML element type that needs identity tracking
// (uniqueId) and polymorphic serialization (xmlName).
// Ported from downrush/viewScore/src/Classes.jsx

let _uid = 0

export class DRObject {
  uniqueId: string;
  [key: string]: unknown

  constructor(o?: Record<string, unknown>) {
    if (o) Object.assign(this, o)
    this.uniqueId = 'dr_' + (++_uid)
  }

  xmlName(): string {
    return 'DRObject'
  }
}

/** Factory that creates a DRObject subclass returning the given xmlName. */
function makeClass(name: string) {
  return class extends DRObject {
    xmlName() {
      return name
    }
  }
}

/** Lookup table: XML element name -> constructor for the corresponding class. */
export const nameToClassTab: Record<string, new (o?: Record<string, unknown>) => DRObject> = {}

for (const n of [
  'kit', 'sound', 'osc1', 'osc2', 'midiOutput',
  'cvChannel', 'midiChannel', 'audioTrack', 'audioClip', 'instrumentClip',
]) {
  nameToClassTab[n] = makeClass(n)
}
