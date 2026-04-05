// Keyboard → Deluge control mapping.
//
// Installs global keydown/keyup listeners and translates them to pad or
// button events. Pads are driven by QWERTY rows so musicians can play
// melodic patterns from a laptop keyboard; transport and mode buttons use
// dedicated keys (Space=Play, R=Record, …).
//
// Each call returns a teardown function that removes the listeners.

export interface KeyboardHandlers {
  /** (col, row) in [0..15] × [0..7] */
  onPadPress?(x: number, y: number): void
  onPadRelease?(x: number, y: number): void
  onButtonPress?(id: string): void
  onButtonRelease?(id: string): void
  onEncoderTurn?(id: string, delta: number): void
}

// QWERTY rows map to pad rows (top row = y=0). Each entry maps a key to a
// column within that row.
const KEY_TO_PAD: ReadonlyMap<string, [number, number]> = new Map([
  // Row 0 (top) — number row
  ...(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const).map(
    (k, i) => [k, [i, 0]] as [string, [number, number]],
  ),
  // Row 1 — Q row
  ...(['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'] as const).map(
    (k, i) => [k, [i, 1]] as [string, [number, number]],
  ),
  // Row 2 — A row
  ...(['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'] as const).map(
    (k, i) => [k, [i, 2]] as [string, [number, number]],
  ),
  // Row 3 — Z row
  ...(['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'] as const).map(
    (k, i) => [k, [i, 3]] as [string, [number, number]],
  ),
])

// Named-key mapping for transport, modes, encoders.
const KEY_TO_BUTTON: ReadonlyMap<string, string> = new Map([
  [' ', 'PLAY'],
  ['Enter', 'SELECT_ENC'],
  ['Escape', 'BACK'],
  ['Backspace', 'BACK'],
  ['Shift', 'SHIFT'],
  ['Tab', 'CLIP_VIEW'],
])

// Arrow keys → encoder turns.
const KEY_TO_ENCODER_TURN: ReadonlyMap<string, [string, number]> = new Map([
  ['ArrowLeft',  ['X_ENC', -1]],
  ['ArrowRight', ['X_ENC',  1]],
  ['ArrowDown',  ['Y_ENC', -1]],
  ['ArrowUp',    ['Y_ENC',  1]],
])

// Shift+key → alternate buttons.
const SHIFTED_KEY_TO_BUTTON: ReadonlyMap<string, string> = new Map([
  ['r', 'RECORD'],
  ['R', 'RECORD'],
  ['p', 'PLAY'],
  ['P', 'PLAY'],
])

export function installKeyboardShortcuts(
  handlers: KeyboardHandlers,
  target: Window | HTMLElement = window,
): () => void {
  // Track held keys to prevent auto-repeat from firing multiple press events.
  const held = new Set<string>()

  const onKeyDown = (e: Event) => {
    const ev = e as KeyboardEvent
    if (held.has(ev.key)) return
    held.add(ev.key)

    // Prefer shifted-key mapping when Shift is held
    if (ev.shiftKey && SHIFTED_KEY_TO_BUTTON.has(ev.key)) {
      ev.preventDefault()
      handlers.onButtonPress?.(SHIFTED_KEY_TO_BUTTON.get(ev.key)!)
      return
    }
    if (KEY_TO_ENCODER_TURN.has(ev.key)) {
      ev.preventDefault()
      const [id, delta] = KEY_TO_ENCODER_TURN.get(ev.key)!
      handlers.onEncoderTurn?.(id, delta)
      return
    }
    const btnId = KEY_TO_BUTTON.get(ev.key)
    if (btnId) {
      ev.preventDefault()
      handlers.onButtonPress?.(btnId)
      return
    }
    const pad = KEY_TO_PAD.get(ev.key.toLowerCase())
    if (pad) {
      ev.preventDefault()
      handlers.onPadPress?.(pad[0], pad[1])
      return
    }
  }

  const onKeyUp = (e: Event) => {
    const ev = e as KeyboardEvent
    held.delete(ev.key)

    if (SHIFTED_KEY_TO_BUTTON.has(ev.key)) {
      handlers.onButtonRelease?.(SHIFTED_KEY_TO_BUTTON.get(ev.key)!)
      return
    }
    if (KEY_TO_ENCODER_TURN.has(ev.key)) return
    const btnId = KEY_TO_BUTTON.get(ev.key)
    if (btnId) {
      handlers.onButtonRelease?.(btnId)
      return
    }
    const pad = KEY_TO_PAD.get(ev.key.toLowerCase())
    if (pad) {
      handlers.onPadRelease?.(pad[0], pad[1])
      return
    }
  }

  // Accept both DOM EventTarget and Window
  const addListener = target.addEventListener.bind(
    target,
  ) as EventTarget['addEventListener']
  addListener('keydown', onKeyDown)
  addListener('keyup', onKeyUp)

  return () => {
    const removeListener = target.removeEventListener.bind(
      target,
    ) as EventTarget['removeEventListener']
    removeListener('keydown', onKeyDown)
    removeListener('keyup', onKeyUp)
    held.clear()
  }
}

// Exports for tests.
export const _keyMaps = {
  pad: KEY_TO_PAD,
  button: KEY_TO_BUTTON,
  encoder: KEY_TO_ENCODER_TURN,
  shifted: SHIFTED_KEY_TO_BUTTON,
}
