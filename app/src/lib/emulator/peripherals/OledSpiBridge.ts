// OLED-over-SPI bridge.
//
// Connects one RSPI channel to an OledController. The SSD1306/SH1106 OLED
// uses an external D/C pin to distinguish command bytes from data bytes;
// on the Deluge, that pin is toggled by the PIC microcontroller or a GPIO
// write, so the bridge exposes `setDataMode(bool)` that emulator code can
// drive from whichever signal source it has wired up.
//
// Default mode is command (matches power-on: firmware sends init commands
// first). After init, the firmware pulls D/C high once and leaves it —
// the rest of runtime is pure framebuffer data. See oled.c oledMainInit()
// in the firmware source.

import type { OledController } from './OledController'
import type { RspiStub } from './rspi'

export interface OledSpiBridgeOptions {
  /** The SPI channel the OLED is wired to (Deluge default = 0). */
  channel: number
  /** Whether the OLED starts in data mode (default false — command). */
  initialDataMode?: boolean
  /**
   * Auto-switch to data mode after this many command bytes have been
   * transferred. 0 = disabled (manual control only). Matches the Deluge
   * init sequence length so firmware runs without PIC emulation.
   */
  autoDataModeAfterCommands?: number
}

export class OledSpiBridge {
  private readonly channel: number
  private dataMode: boolean
  private readonly autoDataAfter: number
  private commandsSeen = 0
  private previousTxCallback: ((ch: number, b: number) => void) | null = null

  constructor(
    private readonly rspi: RspiStub,
    private readonly oled: OledController,
    options: OledSpiBridgeOptions,
  ) {
    this.channel = options.channel
    this.dataMode = options.initialDataMode ?? false
    this.autoDataAfter = options.autoDataModeAfterCommands ?? 0
  }

  /** Attach to the RSPI stub's byte-transmit stream. */
  attach(): void {
    this.rspi.onTransmit((ch, byte) => {
      if (ch !== this.channel) {
        // Give the previously-installed handler a chance at other channels.
        if (this.previousTxCallback) this.previousTxCallback(ch, byte)
        return
      }
      if (this.dataMode) {
        this.oled.writeData(byte)
      } else {
        this.oled.writeCommand(byte)
        this.commandsSeen++
        if (
          this.autoDataAfter > 0 &&
          this.commandsSeen >= this.autoDataAfter
        ) {
          this.dataMode = true
        }
      }
    })
  }

  /** Detach: removes our transmit handler. */
  detach(): void {
    this.rspi.onTransmit(null)
  }

  /** Set current D/C pin state. true = data, false = command. */
  setDataMode(dataMode: boolean): void {
    this.dataMode = dataMode
    if (!dataMode) this.commandsSeen = 0
  }

  /** Return current D/C pin state. */
  isDataMode(): boolean {
    return this.dataMode
  }

  /** Command bytes seen since last switch to command mode. */
  get commandCount(): number {
    return this.commandsSeen
  }
}
