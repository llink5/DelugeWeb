import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  installKeyboardShortcuts,
  _keyMaps,
} from '@/modules/virtual-hardware/KeyboardShortcuts'

function dispatchKey(type: 'keydown' | 'keyup', init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent(type, init))
}

let teardown: (() => void) | null = null

afterEach(() => {
  teardown?.()
  teardown = null
})

describe('KeyboardShortcuts — pads', () => {
  test('Q row maps to pad y=1', () => {
    const onPadPress = vi.fn()
    teardown = installKeyboardShortcuts({ onPadPress })
    dispatchKey('keydown', { key: 'q' })
    expect(onPadPress).toHaveBeenCalledWith(0, 1)
    dispatchKey('keydown', { key: 't' })
    expect(onPadPress).toHaveBeenCalledWith(4, 1)
  })

  test('number row maps to pad y=0', () => {
    const onPadPress = vi.fn()
    teardown = installKeyboardShortcuts({ onPadPress })
    dispatchKey('keydown', { key: '5' })
    expect(onPadPress).toHaveBeenCalledWith(4, 0)
  })

  test('keyup fires pad-release', () => {
    const onPadRelease = vi.fn()
    teardown = installKeyboardShortcuts({ onPadRelease })
    dispatchKey('keyup', { key: 'q' })
    expect(onPadRelease).toHaveBeenCalledWith(0, 1)
  })

  test('case insensitive — uppercase Q same as q', () => {
    const onPadPress = vi.fn()
    teardown = installKeyboardShortcuts({ onPadPress })
    dispatchKey('keydown', { key: 'Q' })
    expect(onPadPress).toHaveBeenCalledWith(0, 1)
  })
})

describe('KeyboardShortcuts — buttons', () => {
  test('Space maps to PLAY', () => {
    const onButtonPress = vi.fn()
    teardown = installKeyboardShortcuts({ onButtonPress })
    dispatchKey('keydown', { key: ' ' })
    expect(onButtonPress).toHaveBeenCalledWith('PLAY')
  })

  test('Shift+R maps to RECORD', () => {
    const onButtonPress = vi.fn()
    teardown = installKeyboardShortcuts({ onButtonPress })
    dispatchKey('keydown', { key: 'r', shiftKey: true })
    expect(onButtonPress).toHaveBeenCalledWith('RECORD')
  })

  test('Escape maps to BACK', () => {
    const onButtonPress = vi.fn()
    teardown = installKeyboardShortcuts({ onButtonPress })
    dispatchKey('keydown', { key: 'Escape' })
    expect(onButtonPress).toHaveBeenCalledWith('BACK')
  })
})

describe('KeyboardShortcuts — encoders', () => {
  test('ArrowRight turns X encoder +1', () => {
    const onEncoderTurn = vi.fn()
    teardown = installKeyboardShortcuts({ onEncoderTurn })
    dispatchKey('keydown', { key: 'ArrowRight' })
    expect(onEncoderTurn).toHaveBeenCalledWith('X_ENC', 1)
  })

  test('ArrowLeft turns X encoder -1', () => {
    const onEncoderTurn = vi.fn()
    teardown = installKeyboardShortcuts({ onEncoderTurn })
    dispatchKey('keydown', { key: 'ArrowLeft' })
    expect(onEncoderTurn).toHaveBeenCalledWith('X_ENC', -1)
  })

  test('ArrowUp / ArrowDown drive Y encoder', () => {
    const onEncoderTurn = vi.fn()
    teardown = installKeyboardShortcuts({ onEncoderTurn })
    dispatchKey('keydown', { key: 'ArrowUp' })
    dispatchKey('keydown', { key: 'ArrowDown' })
    expect(onEncoderTurn).toHaveBeenNthCalledWith(1, 'Y_ENC', 1)
    expect(onEncoderTurn).toHaveBeenNthCalledWith(2, 'Y_ENC', -1)
  })
})

describe('KeyboardShortcuts — repeat prevention', () => {
  test('holding a key only fires press once', () => {
    const onPadPress = vi.fn()
    teardown = installKeyboardShortcuts({ onPadPress })
    dispatchKey('keydown', { key: 'q' })
    dispatchKey('keydown', { key: 'q' })
    dispatchKey('keydown', { key: 'q' })
    expect(onPadPress).toHaveBeenCalledTimes(1)
  })

  test('keyup clears the held set so subsequent press fires', () => {
    const onPadPress = vi.fn()
    teardown = installKeyboardShortcuts({ onPadPress })
    dispatchKey('keydown', { key: 'q' })
    dispatchKey('keyup', { key: 'q' })
    dispatchKey('keydown', { key: 'q' })
    expect(onPadPress).toHaveBeenCalledTimes(2)
  })
})

describe('KeyboardShortcuts teardown', () => {
  test('teardown removes listeners', () => {
    const onPadPress = vi.fn()
    const uninstall = installKeyboardShortcuts({ onPadPress })
    uninstall()
    dispatchKey('keydown', { key: 'q' })
    expect(onPadPress).not.toHaveBeenCalled()
  })
})

describe('KeyboardShortcuts maps', () => {
  test('pad map covers all 40 keys', () => {
    expect(_keyMaps.pad.size).toBe(40)
  })
  test('each pad row has 10 entries', () => {
    const rows = new Map<number, number>()
    for (const [, [, y]] of _keyMaps.pad) {
      rows.set(y, (rows.get(y) ?? 0) + 1)
    }
    expect(rows.size).toBe(4)
    for (const count of rows.values()) expect(count).toBe(10)
  })
})
