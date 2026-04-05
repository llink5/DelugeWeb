// Sample format conversions.
//
// Deluge audio hardware writes interleaved signed 16-bit PCM at 44.1 kHz.
// Web Audio works in 32-bit floats normalised to [-1.0, +1.0]. The helpers
// here convert between the two without allocating on the hot path when
// callers pass a pre-sized destination.

const INT16_SCALE = 1 / 32768

/** Int16 → Float32 conversion, in-place if `out` is supplied. */
export function int16ToFloat32(
  src: Int16Array,
  out?: Float32Array,
): Float32Array {
  const dst = out && out.length >= src.length ? out : new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) {
    dst[i] = src[i] * INT16_SCALE
  }
  return dst
}

/** Float32 → Int16 with clipping to [-32768, 32767]. */
export function float32ToInt16(
  src: Float32Array,
  out?: Int16Array,
): Int16Array {
  const dst = out && out.length >= src.length ? out : new Int16Array(src.length)
  for (let i = 0; i < src.length; i++) {
    let s = src[i]
    if (s > 1) s = 1
    else if (s < -1) s = -1
    dst[i] = (s < 0 ? s * 32768 : s * 32767) | 0
  }
  return dst
}

/** Int32 sign-extended 24-bit (low 24 bits) → Float32. */
export function int24ToFloat32(
  src: Int32Array,
  out?: Float32Array,
): Float32Array {
  const dst = out && out.length >= src.length ? out : new Float32Array(src.length)
  const scale = 1 / 0x800000
  for (let i = 0; i < src.length; i++) {
    let v = src[i] & 0xffffff
    if (v & 0x800000) v -= 0x1000000
    dst[i] = v * scale
  }
  return dst
}

/**
 * De-interleave a stereo Float32 buffer into two separate mono channels.
 * Web Audio APIs usually want channels as separate Float32Arrays.
 */
export function deinterleaveStereo(
  src: Float32Array,
  left?: Float32Array,
  right?: Float32Array,
): { left: Float32Array; right: Float32Array } {
  const frames = src.length >>> 1
  const L =
    left && left.length >= frames ? left : new Float32Array(frames)
  const R =
    right && right.length >= frames ? right : new Float32Array(frames)
  for (let i = 0, s = 0; i < frames; i++, s += 2) {
    L[i] = src[s]
    R[i] = src[s + 1]
  }
  return { left: L, right: R }
}
