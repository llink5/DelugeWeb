import { describe, test, expect } from 'vitest'
import { DmacStub } from '@/lib/emulator/peripherals/dmac'

function channel(offset: number): number {
  return offset
}

function channelN(n: number, off: number): number {
  return n * 0x40 + off
}

describe('DmacStub reset values', () => {
  test('all per-channel registers start at 0', () => {
    const d = new DmacStub()
    for (let i = 0; i < 16; i++) {
      expect(d.read32(channelN(i, 0x00))).toBe(0) // N0SA
      expect(d.read32(channelN(i, 0x24))).toBe(0) // CHSTAT
      expect(d.read32(channelN(i, 0x28))).toBe(0) // CHCTRL reads as 0
    }
  })

  test('base address matches chapter 9 table 9.2', () => {
    const d = new DmacStub()
    expect(d.baseAddr).toBe(0xe8200000)
  })
})

describe('DmacStub channel register R/W', () => {
  test('N0SA / N0DA / N0TB are writable', () => {
    const d = new DmacStub()
    d.write32(channel(0x00), 0x20000000) // N0SA
    d.write32(channel(0x04), 0xe820b018) // N0DA
    d.write32(channel(0x08), 0x400) // N0TB
    expect(d.read32(0x00)).toBe(0x20000000)
    expect(d.read32(0x04)).toBe(0xe820b018)
    expect(d.read32(0x08)).toBe(0x400)
  })

  test('CHCTRL reads as 0 even after write', () => {
    const d = new DmacStub()
    d.write32(channel(0x28), 0xffffffff)
    expect(d.read32(0x28)).toBe(0)
  })

  test('CRSA / CRDA / CRTB are read-only from software', () => {
    const d = new DmacStub()
    d.write32(channel(0x18), 0xdeadbeef) // CRSA
    expect(d.read32(0x18)).toBe(0)
  })

  test('channels are independent', () => {
    const d = new DmacStub()
    d.write32(channelN(0, 0x00), 0x1000)
    d.write32(channelN(6, 0x00), 0x2000)
    d.write32(channelN(15, 0x00), 0x3000)
    expect(d.read32(channelN(0, 0x00))).toBe(0x1000)
    expect(d.read32(channelN(6, 0x00))).toBe(0x2000)
    expect(d.read32(channelN(15, 0x00))).toBe(0x3000)
  })
})

describe('DmacStub SETEN behaviour', () => {
  test('CHCTRL.SETEN loads CRSA/CRDA/CRTB from N0', () => {
    const d = new DmacStub()
    d.write32(channel(0x00), 0x20100000) // N0SA
    d.write32(channel(0x04), 0xe820b018) // N0DA
    d.write32(channel(0x08), 128) // N0TB
    d.write32(channel(0x28), 0x1) // CHCTRL.SETEN
    expect(d.read32(channel(0x18))).toBe(0x20100000) // CRSA
    expect(d.read32(channel(0x1c))).toBe(0xe820b018) // CRDA
    expect(d.read32(channel(0x20))).toBe(128) // CRTB
  })

  test('SETEN flips CHSTAT.EN and CHSTAT.TACT', () => {
    const d = new DmacStub()
    d.write32(channel(0x08), 128) // some N0TB so the channel is runnable
    d.write32(channel(0x28), 0x1) // SETEN
    const chstat = d.read32(channel(0x24))
    expect(chstat & 0x01).toBe(0x01) // EN
    expect(chstat & 0x04).toBe(0x04) // TACT
  })

  test('CHCTRL.CLREN stops the channel', () => {
    const d = new DmacStub()
    d.write32(channel(0x08), 128)
    d.write32(channel(0x28), 0x1) // SETEN
    d.write32(channel(0x28), 0x2) // CLREN
    expect(d.read32(channel(0x24)) & 0x01).toBe(0)
    expect(d.isChannelRunning(0)).toBe(false)
  })

  test('CHCTRL.SWRST clears the channel', () => {
    const d = new DmacStub()
    d.write32(channel(0x00), 0x1234)
    d.write32(channel(0x28), 0x8) // SWRST
    expect(d.read32(channel(0x00))).toBe(0)
  })
})

describe('DmacStub advanceChannel', () => {
  test('advance reads CRSA, decrements CRTB, advances CRSA', () => {
    const d = new DmacStub()
    d.write32(channel(0x00), 0x20000000)
    d.write32(channel(0x04), 0xe820b018)
    d.write32(channel(0x08), 100)
    d.write32(channel(0x28), 0x1) // SETEN
    const result = d.advanceChannel(0, 20)
    expect(result).toEqual({
      sourceAddr: 0x20000000,
      destAddr: 0xe820b018,
      bytes: 20,
    })
    expect(d.read32(0x18)).toBe(0x20000014) // CRSA advanced by 20
    expect(d.read32(0x20)).toBe(80) // CRTB decremented
  })

  test('advance caps at remaining CRTB', () => {
    const d = new DmacStub()
    d.write32(channel(0x08), 50)
    d.write32(channel(0x28), 0x1)
    const result = d.advanceChannel(0, 100)
    expect(result?.bytes).toBe(50)
  })

  test('advance returns null when channel not running', () => {
    const d = new DmacStub()
    expect(d.advanceChannel(0, 10)).toBeNull()
  })

  test('CRTB reaching 0 stops the channel and sets END/TC', () => {
    const d = new DmacStub()
    d.write32(channel(0x08), 10)
    d.write32(channel(0x28), 0x1)
    d.advanceChannel(0, 10)
    const chstat = d.read32(0x24)
    expect(chstat & 0x20).toBe(0x20) // END
    expect(chstat & 0x40).toBe(0x40) // TC
    expect(d.isChannelRunning(0)).toBe(false)
  })

  test('ping-pong between N0 and N1 descriptor pairs', () => {
    const d = new DmacStub()
    d.write32(0x00, 0x1000) // N0SA
    d.write32(0x08, 16) // N0TB
    d.write32(0x0c, 0x2000) // N1SA
    d.write32(0x14, 16) // N1TB
    d.write32(0x28, 0x1) // SETEN — loads N0
    d.advanceChannel(0, 16) // finishes N0, swaps to N1
    expect(d.read32(0x18)).toBe(0x2000) // CRSA now from N1
    expect(d.read32(0x20)).toBe(16)
    expect(d.isChannelRunning(0)).toBe(true)
  })

  test('CLREND clears the END status bit', () => {
    const d = new DmacStub()
    d.write32(0x08, 4)
    d.write32(0x28, 0x1)
    d.advanceChannel(0, 4)
    expect(d.read32(0x24) & 0x20).toBe(0x20) // END set
    d.write32(0x28, 0x20) // CLREND
    expect(d.read32(0x24) & 0x20).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// pump() — actually move bytes via a memory accessor
// ---------------------------------------------------------------------------

/**
 * Minimal DmacMemoryAccessor backed by a sparse Map. Enough for testing
 * byte/halfword/word transfers without wiring up the full ArmCpu Memory.
 */
function makeMem() {
  const store = new Map<number, number>()
  return {
    store,
    read8: (a: number) => store.get(a >>> 0) ?? 0,
    read16: (a: number) =>
      (store.get(a >>> 0) ?? 0) | ((store.get((a + 1) >>> 0) ?? 0) << 8),
    read32: (a: number) =>
      ((store.get(a >>> 0) ?? 0) |
        ((store.get((a + 1) >>> 0) ?? 0) << 8) |
        ((store.get((a + 2) >>> 0) ?? 0) << 16) |
        ((store.get((a + 3) >>> 0) ?? 0) << 24)) >>>
      0,
    write8: (a: number, v: number) => {
      store.set(a >>> 0, v & 0xff)
    },
    write16: (a: number, v: number) => {
      store.set(a >>> 0, v & 0xff)
      store.set((a + 1) >>> 0, (v >>> 8) & 0xff)
    },
    write32: (a: number, v: number) => {
      store.set(a >>> 0, v & 0xff)
      store.set((a + 1) >>> 0, (v >>> 8) & 0xff)
      store.set((a + 2) >>> 0, (v >>> 16) & 0xff)
      store.set((a + 3) >>> 0, (v >>> 24) & 0xff)
    },
  }
}

describe('DmacStub pump — byte transfers (src inc, dst fixed)', () => {
  test('transfers 4 bytes from RAM to a FIFO register', () => {
    const d = new DmacStub()
    const mem = makeMem()
    // Pre-fill source RAM with 4 bytes
    for (let i = 0; i < 4; i++) mem.write8(0x20000000 + i, 0x10 + i)
    // Program N0 descriptor: src=0x20000000, dst=0x20000100, tb=4
    d.write32(channelN(0, 0x00), 0x20000000) // N0SA
    d.write32(channelN(0, 0x04), 0x20000100) // N0DA
    d.write32(channelN(0, 0x08), 4) // N0TB
    // CHCFG: SDS=0 (8-bit src), DDS=0 (8-bit dst), SAD=0 (inc), DAD=1 (fixed)
    d.write32(channelN(0, 0x2c), 1 << 21)
    // Enable
    d.write32(channelN(0, 0x28), 0x1)

    const moved = d.pump(mem, 100)
    expect(moved).toBe(4)
    // Dst was fixed — only last byte remains
    expect(mem.read8(0x20000100)).toBe(0x13)
    // Channel has stopped (no N1 descriptor)
    expect(d.isChannelRunning(0)).toBe(false)
    // TC/END set
    expect(d.read32(channelN(0, 0x24)) & 0x60).toBe(0x60)
  })

  test('maxElementsPerChannel caps the transfer', () => {
    const d = new DmacStub()
    const mem = makeMem()
    for (let i = 0; i < 10; i++) mem.write8(0x30000000 + i, 0xa0 + i)
    d.write32(channelN(0, 0x00), 0x30000000)
    d.write32(channelN(0, 0x04), 0x30001000)
    d.write32(channelN(0, 0x08), 10)
    d.write32(channelN(0, 0x2c), 1 << 21) // dst fixed
    d.write32(channelN(0, 0x28), 0x1)

    expect(d.pump(mem, 3)).toBe(3)
    // Channel still running, crtb=7
    expect(d.read32(channelN(0, 0x20))).toBe(7)
    expect(d.isChannelRunning(0)).toBe(true)
    expect(d.pump(mem, 100)).toBe(7)
    expect(d.isChannelRunning(0)).toBe(false)
  })

  test('both src and dst incrementing — full memcpy', () => {
    const d = new DmacStub()
    const mem = makeMem()
    for (let i = 0; i < 8; i++) mem.write8(0x40000000 + i, 0x50 + i)
    d.write32(channelN(1, 0x00), 0x40000000)
    d.write32(channelN(1, 0x04), 0x40000080)
    d.write32(channelN(1, 0x08), 8)
    d.write32(channelN(1, 0x2c), 0) // no SAD, no DAD — both increment
    d.write32(channelN(1, 0x28), 0x1)

    expect(d.pump(mem, 100)).toBe(8)
    for (let i = 0; i < 8; i++) {
      expect(mem.read8(0x40000080 + i)).toBe(0x50 + i)
    }
  })

  test('ping-pong chain loops N0 ↔ N1 indefinitely (audio ring)', () => {
    const d = new DmacStub()
    const mem = makeMem()
    for (let i = 0; i < 2; i++) mem.write8(0x50000000 + i, i + 1)
    for (let i = 0; i < 2; i++) mem.write8(0x50000010 + i, i + 10)
    d.write32(channelN(2, 0x00), 0x50000000) // N0SA
    d.write32(channelN(2, 0x04), 0x50000100) // N0DA (fixed)
    d.write32(channelN(2, 0x08), 2) // N0TB
    d.write32(channelN(2, 0x0c), 0x50000010) // N1SA
    d.write32(channelN(2, 0x10), 0x50000100) // N1DA (fixed)
    d.write32(channelN(2, 0x14), 2) // N1TB
    d.write32(channelN(2, 0x2c), 1 << 21) // dst fixed
    d.write32(channelN(2, 0x28), 0x1)
    // Ring-buffer DMA loops forever — bound by maxElementsPerChannel.
    expect(d.pump(mem, 10)).toBe(10)
    expect(d.isChannelRunning(2)).toBe(true)
    expect(d.isChannelRunning(0)).toBe(false)
  })

  test('one-shot N0 → N1 → halt when follow-up descriptors cleared', () => {
    const d = new DmacStub()
    const mem = makeMem()
    for (let i = 0; i < 2; i++) mem.write8(0x51000000 + i, i + 1)
    for (let i = 0; i < 2; i++) mem.write8(0x51000010 + i, i + 10)
    d.write32(channelN(3, 0x00), 0x51000000)
    d.write32(channelN(3, 0x04), 0x51000100)
    d.write32(channelN(3, 0x08), 2)
    d.write32(channelN(3, 0x0c), 0x51000010)
    d.write32(channelN(3, 0x10), 0x51000100)
    d.write32(channelN(3, 0x14), 2)
    d.write32(channelN(3, 0x2c), 1 << 21)
    d.write32(channelN(3, 0x28), 0x1)
    // Pump first descriptor only (2 bytes) — chain swaps to N1.
    d.pump(mem, 2)
    // Emulate firmware resetting N0TB=0 and N1TB=0 before the final drain
    // so the chain lookup finds nothing and halts.
    d.write32(channelN(3, 0x08), 0)
    d.write32(channelN(3, 0x14), 0)
    d.pump(mem, 100)
    expect(d.isChannelRunning(3)).toBe(false)
  })
})

describe('DmacStub pump — 32-bit transfers (SSI audio)', () => {
  test('transfers a 32-bit word from RAM to a fixed register', () => {
    const d = new DmacStub()
    const mem = makeMem()
    mem.write32(0x60000000, 0x12345678)
    mem.write32(0x60000004, 0xdeadbeef)
    d.write32(channelN(6, 0x00), 0x60000000) // N0SA
    d.write32(channelN(6, 0x04), 0x60000200) // N0DA (peripheral)
    d.write32(channelN(6, 0x08), 8) // N0TB (two 32-bit words = 8 bytes)
    // SDS=2 (32-bit), DDS=2 (32-bit), SAD=0 (inc), DAD=1 (fixed)
    d.write32(channelN(6, 0x2c), (2 << 12) | (2 << 16) | (1 << 21))
    d.write32(channelN(6, 0x28), 0x1)

    expect(d.pump(mem, 100)).toBe(8)
    // Dest register was written twice, last word wins
    expect(mem.read32(0x60000200)).toBe(0xdeadbeef)
    expect(d.isChannelRunning(6)).toBe(false)
  })
})
