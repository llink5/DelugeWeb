// Barrel shifter operations.
//
// Every ARM data-processing instruction feeds its second operand through one
// of four shift operations. Each produces a shifted value and a carry-out
// bit, both of which are consumed by the ALU and (conditionally) by the
// CPSR flag update.
//
// Two entry points:
//   - `applyShift` — "register-based" shift amount. Amount comes from the
//     low 8 bits of a register and is interpreted literally (amount 0 means
//     no shift, carry unchanged).
//   - `applyImmediateShift` — "immediate" shift amount. Amount 0 has special
//     meaning depending on the shift type (LSR #0 = LSR #32, ROR #0 = RRX).

export const SHIFT_LSL = 0
export const SHIFT_LSR = 1
export const SHIFT_ASR = 2
export const SHIFT_ROR = 3

export interface ShiftResult {
  value: number // 32-bit unsigned result
  carry: number // 0 or 1
}

/**
 * Apply a shift where `amount` comes from a register. Zero amount performs
 * no shift and leaves carry unchanged; amounts >= 32 saturate per the ARM
 * reference manual.
 */
export function applyShift(
  value: number,
  type: number,
  amount: number,
  carryIn: number,
): ShiftResult {
  value = value >>> 0
  // The low 8 bits of the shift register are what the CPU uses.
  amount = amount & 0xff

  if (amount === 0) {
    return { value, carry: carryIn & 1 }
  }

  switch (type) {
    case SHIFT_LSL: {
      if (amount >= 33) return { value: 0, carry: 0 }
      if (amount === 32) return { value: 0, carry: value & 1 }
      return {
        value: (value << amount) >>> 0,
        carry: (value >>> (32 - amount)) & 1,
      }
    }
    case SHIFT_LSR: {
      if (amount >= 33) return { value: 0, carry: 0 }
      if (amount === 32) return { value: 0, carry: (value >>> 31) & 1 }
      return {
        value: value >>> amount,
        carry: (value >>> (amount - 1)) & 1,
      }
    }
    case SHIFT_ASR: {
      if (amount >= 32) {
        const bit = (value >>> 31) & 1
        return { value: bit ? 0xffffffff : 0, carry: bit }
      }
      return {
        value: ((value | 0) >> amount) >>> 0,
        carry: (value >>> (amount - 1)) & 1,
      }
    }
    case SHIFT_ROR: {
      const a = amount & 0x1f
      if (a === 0) {
        // amount was a multiple of 32 — rotation yields value unchanged,
        // carry is the top bit.
        return { value, carry: (value >>> 31) & 1 }
      }
      const rotated = ((value >>> a) | (value << (32 - a))) >>> 0
      return { value: rotated, carry: (rotated >>> 31) & 1 }
    }
  }
  return { value, carry: carryIn & 1 }
}

/**
 * Apply a shift with an immediate amount (encoded in the instruction). Zero
 * amount has per-type special meanings used by the compiler.
 */
export function applyImmediateShift(
  value: number,
  type: number,
  amount: number,
  carryIn: number,
): ShiftResult {
  if (amount === 0) {
    switch (type) {
      case SHIFT_LSL:
        return { value: value >>> 0, carry: carryIn & 1 }
      case SHIFT_LSR:
        // LSR #0 encodes LSR #32.
        return { value: 0, carry: (value >>> 31) & 1 }
      case SHIFT_ASR: {
        const bit = (value >>> 31) & 1
        return { value: bit ? 0xffffffff : 0, carry: bit }
      }
      case SHIFT_ROR: {
        // ROR #0 encodes RRX: rotate right by one through the carry flag.
        const newC = value & 1
        return {
          value: (((value >>> 1) | ((carryIn & 1) << 31)) >>> 0) >>> 0,
          carry: newC,
        }
      }
    }
  }
  return applyShift(value, type, amount, carryIn)
}

/**
 * Expand a rotated-immediate operand (data-processing I=1 form). The operand
 * is an 8-bit value rotated right by 2×rot bits. Zero rotation leaves carry
 * unchanged; non-zero rotation sets carry to bit 31 of the result.
 */
export function expandRotatedImmediate(
  imm8: number,
  rotate: number,
  carryIn: number,
): ShiftResult {
  const shift = (rotate & 0xf) * 2
  if (shift === 0) {
    return { value: imm8 & 0xff, carry: carryIn & 1 }
  }
  const value =
    (((imm8 & 0xff) >>> shift) | ((imm8 & 0xff) << (32 - shift))) >>> 0
  return { value, carry: (value >>> 31) & 1 }
}
