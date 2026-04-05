// Audio capability detection.
//
// Callers can check which features are available before attempting to boot
// the AudioBridge. If `audioWorklet` is missing the bridge falls back to
// postMessage-only delivery; if `crossOriginIsolated` is false, the ring
// buffer allocates a plain ArrayBuffer instead of SharedArrayBuffer.

export interface AudioFeatures {
  audioContext: boolean
  audioWorklet: boolean
  sharedArrayBuffer: boolean
  crossOriginIsolated: boolean
}

export function detectAudioFeatures(): AudioFeatures {
  const win = typeof window !== 'undefined' ? window : undefined
  const audioContext =
    typeof AudioContext !== 'undefined' ||
    (typeof win !== 'undefined' && 'webkitAudioContext' in win)
  const audioWorklet =
    audioContext &&
    typeof AudioWorkletNode !== 'undefined'
  let sharedArrayBuffer = false
  if (typeof SharedArrayBuffer !== 'undefined') {
    try {
      new SharedArrayBuffer(8)
      sharedArrayBuffer = true
    } catch {
      sharedArrayBuffer = false
    }
  }
  const crossOriginIsolated =
    typeof win !== 'undefined' && (win as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
  return {
    audioContext,
    audioWorklet,
    sharedArrayBuffer,
    crossOriginIsolated,
  }
}

/** Human-readable summary for debugger UIs. */
export function audioFeatureSummary(features: AudioFeatures): string {
  const parts: string[] = []
  parts.push(features.audioContext ? 'AudioContext ✓' : 'AudioContext ✗')
  parts.push(features.audioWorklet ? 'AudioWorklet ✓' : 'AudioWorklet ✗')
  parts.push(
    features.sharedArrayBuffer ? 'SharedArrayBuffer ✓' : 'SharedArrayBuffer ✗',
  )
  parts.push(
    features.crossOriginIsolated ? 'COI ✓' : 'COI ✗ (install coi-serviceworker)',
  )
  return parts.join(' · ')
}
