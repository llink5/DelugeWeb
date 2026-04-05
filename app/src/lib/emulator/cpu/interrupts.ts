// Minimal interrupt controller.
//
// Sits between the peripheral stubs and the CPU. Peripherals call
// `request(source)` when their interrupt line goes high; they clear it
// with `clear(source)` once the CPU's handler has serviced the request.
// The CPU's run loop calls `hasPending()` on each iteration and, when
// interrupts are unmasked, dispatches to the IRQ vector.
//
// `source` is an arbitrary small integer (we use the DMAC channel number
// and a handful of fixed IDs for UART RX / TX). A full GIC would map this
// to the 512-entry priority table at 0xE8201400; that's not needed for
// the firmware to function because the Deluge IRQ handler reads the
// pending vector from the GIC distributor via memory-mapped registers.

export const IRQ_SOURCE_DMAC_BASE = 0
/** DMAC channel N → source `IRQ_SOURCE_DMAC_BASE + N` (N in 0..15). */
export const IRQ_SOURCE_DMAC_END = 16
export const IRQ_SOURCE_OSTM = 32
export const IRQ_SOURCE_UART_PIC_RX = 48
export const IRQ_SOURCE_UART_PIC_TX = 49
export const IRQ_SOURCE_UART_MIDI_RX = 50
export const IRQ_SOURCE_UART_MIDI_TX = 51

export class InterruptController {
  /** Bitmap of pending interrupts (up to 64 sources). */
  private pendingLow = 0
  private pendingHigh = 0

  /** Signal that interrupt `source` is pending. */
  request(source: number): void {
    if (source < 0) return
    if (source < 32) {
      this.pendingLow = (this.pendingLow | (1 << source)) >>> 0
    } else if (source < 64) {
      this.pendingHigh = (this.pendingHigh | (1 << (source - 32))) >>> 0
    }
  }

  /** Clear interrupt `source` after the CPU has serviced it. */
  clear(source: number): void {
    if (source < 0) return
    if (source < 32) {
      this.pendingLow = (this.pendingLow & ~(1 << source)) >>> 0
    } else if (source < 64) {
      this.pendingHigh = (this.pendingHigh & ~(1 << (source - 32))) >>> 0
    }
  }

  /** True if any source has a pending interrupt. */
  hasPending(): boolean {
    return this.pendingLow !== 0 || this.pendingHigh !== 0
  }

  /** Return the lowest-numbered pending source, or -1 if none. */
  nextPending(): number {
    if (this.pendingLow !== 0) {
      for (let i = 0; i < 32; i++) {
        if (this.pendingLow & (1 << i)) return i
      }
    }
    if (this.pendingHigh !== 0) {
      for (let i = 0; i < 32; i++) {
        if (this.pendingHigh & (1 << i)) return i + 32
      }
    }
    return -1
  }

  /** Drop every pending bit. Used on CPU reset. */
  reset(): void {
    this.pendingLow = 0
    this.pendingHigh = 0
  }
}
