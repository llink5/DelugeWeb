// Peripheral stub barrel — RZ/A1L spec-compliant.
//
// Each peripheral module targets a specific chapter of the RZ/A1L Hardware
// Manual (R01UH0437EJ). Stubs expose the documented register addresses,
// reset values, and access widths; writing to a register is accepted and
// reads return the register's stored value (after reset) unless a status-
// bit hook overrides that behaviour.

export type { PeripheralStub } from './PeripheralStub'
export { BasePeripheralStub } from './PeripheralStub'
export type { PeripheralAccessLogger, PeripheralAccess } from './PeripheralBus'
export { PeripheralBus } from './PeripheralBus'

export { RegMapStub } from './RegMapStub'
export { RegisterMap } from './regs'
export type { RegisterDef, RegisterWidth } from './regs'

export { DmacStub } from './dmac'
export type { DmacMemoryAccessor } from './dmac'
export {
  SdhiStub,
  SDHI_BASE_ADDR,
  SDHI_REG_OFFSETS,
  SDHI_INFO1_BITS,
  SDHI_INFO2_BITS,
} from './sdhi'
export { CpgStub, DeepStandbyStub } from './cpg'
export { BscStub } from './bsc'
export { IntcIcrStub, IntcGicStub, IntcStub, createIntcStubs } from './intc'
export { OstmStub } from './ostm'
export { GpioStub } from './gpio'
export { SsiStub } from './ssi'
export type { SsiSampleCallback } from './ssi'
export { RspiStub, RSPI_BASE_ADDR, RSPI_CHANNEL_STRIDE, RSPI_CHANNEL_COUNT, RSPI_STATUS_BITS } from './rspi'
export type { RspiTxCallback } from './rspi'
export { OledController } from './OledController'
export type { OledControllerOptions } from './OledController'
export { OledSpiBridge } from './OledSpiBridge'
export type { OledSpiBridgeOptions } from './OledSpiBridge'
export {
  ScifStub,
  SCIF_BASE_ADDR,
  SCIF_CHANNEL_COUNT,
  SCIF_CHANNEL_STRIDE,
  SCIF_REG_OFFSETS,
  SCIF_STATUS_BITS,
} from './scif'
export type { ScifTxCallback } from './scif'
export {
  PicUartDecoder,
  PIC_MAIN_COLS,
  PIC_SIDE_COLS,
  PIC_ROWS,
  PIC_TOTAL_COLS,
  PIC_SEG_DIGITS,
} from './PicUartDecoder'
export type { PicDecoderState, PicEvent } from './PicUartDecoder'

import { CpgStub, DeepStandbyStub } from './cpg'
import { BscStub } from './bsc'
import { IntcIcrStub, IntcGicStub } from './intc'
import { OstmStub } from './ostm'
import { GpioStub } from './gpio'
import { SsiStub } from './ssi'
import { RspiStub } from './rspi'
import { ScifStub } from './scif'
import { DmacStub } from './dmac'
import { SdhiStub } from './sdhi'
import { PeripheralBus } from './PeripheralBus'

/**
 * Build a PeripheralBus populated with the full boot-time RZ/A1L stub set.
 * The stubs are spec-compliant — any firmware that touches CPG/BSC/INTC/
 * OSTM/GPIO registers within the documented address ranges will see
 * power-on reset values and can write over them.
 *
 * SSI is included because audio-producing firmware uses it; call sites
 * that don't need audio capture can drop that stub from the bus.
 */
export function createBootPeripheralBus(): PeripheralBus {
  const bus = new PeripheralBus()
  bus.register(new CpgStub())
  bus.register(new DeepStandbyStub())
  bus.register(new BscStub())
  bus.register(new IntcIcrStub())
  bus.register(new IntcGicStub())
  bus.register(new OstmStub())
  bus.register(new GpioStub())
  bus.register(new SsiStub())
  bus.register(new RspiStub())
  bus.register(new ScifStub())
  bus.register(new DmacStub())
  bus.register(new SdhiStub())
  return bus
}
