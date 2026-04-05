import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import OledDisplay from '@/components/hardware/OledDisplay.vue'

interface CanvasCall {
  method: string
  args: unknown[]
}

// Minimal canvas context spy so we can assert what was drawn without relying
// on real canvas rendering (jsdom doesn't implement it).
function stubCanvasContext(): CanvasCall[] {
  const calls: CanvasCall[] = []
  const ctx = {
    fillStyle: '',
    fillRect: (...args: unknown[]) => calls.push({ method: 'fillRect', args }),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(HTMLCanvasElement.prototype as any).getContext = vi.fn(() => ctx)
  return calls
}

beforeEach(() => {
  // Attach a fresh stub before each test
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('OledDisplay rendering', () => {
  test('canvas dimensions scale with pixelSize and pages', () => {
    stubCanvasContext()
    const fb = new Uint8Array(768)
    const wrapper = mount(OledDisplay, {
      props: { framebuffer: fb, pixelSize: 4, pages: 6 },
    })
    const canvas = wrapper.find('canvas').element as HTMLCanvasElement
    expect(canvas.width).toBe(128 * 4) // 512
    expect(canvas.height).toBe(6 * 8 * 4) // 192
  })

  test('default pixelSize of 5 and 6 pages gives 640×240', () => {
    stubCanvasContext()
    const fb = new Uint8Array(768)
    const wrapper = mount(OledDisplay, { props: { framebuffer: fb, dots: 0 } })
    const canvas = wrapper.find('canvas').element as HTMLCanvasElement
    expect(canvas.width).toBe(640)
    expect(canvas.height).toBe(240)
  })

  test('empty framebuffer fills only background', () => {
    const calls = stubCanvasContext()
    const fb = new Uint8Array(768)
    mount(OledDisplay, { props: { framebuffer: fb } })
    // Exactly one fillRect should be issued for the background
    const fillRects = calls.filter((c) => c.method === 'fillRect')
    expect(fillRects).toHaveLength(1)
    expect(fillRects[0].args[0]).toBe(0) // x
    expect(fillRects[0].args[1]).toBe(0) // y
  })

  test('single ON pixel produces background + one pixel rect', () => {
    const calls = stubCanvasContext()
    const fb = new Uint8Array(768)
    // Page 0, column 0, bit 0 → pixel at (0,0)
    fb[0] = 0x01
    mount(OledDisplay, { props: { framebuffer: fb } })
    const fillRects = calls.filter((c) => c.method === 'fillRect')
    expect(fillRects).toHaveLength(2) // background + one pixel
    const pixel = fillRects[1]
    expect(pixel.args[0]).toBeCloseTo(0.5, 5) // pixelSize=5 → x=0*5+0.5
    expect(pixel.args[1]).toBeCloseTo(0.5, 5)
  })

  test('full byte produces 8 vertical pixels', () => {
    const calls = stubCanvasContext()
    const fb = new Uint8Array(768)
    fb[0] = 0xff // all 8 bits of page 0 col 0
    mount(OledDisplay, { props: { framebuffer: fb } })
    const fillRects = calls.filter((c) => c.method === 'fillRect')
    expect(fillRects).toHaveLength(9) // background + 8 pixels
  })

  test('framebuffer prop change triggers redraw', async () => {
    const calls = stubCanvasContext()
    const fb = new Uint8Array(768)
    const wrapper = mount(OledDisplay, { props: { framebuffer: fb } })
    const countAfterMount = calls.length
    const next = new Uint8Array(768)
    next[0] = 0x01
    await wrapper.setProps({ framebuffer: next })
    expect(calls.length).toBeGreaterThan(countAfterMount)
  })
})

describe('OledDisplay addressing', () => {
  test('page N column C targets y = N*8*pixelSize', () => {
    const calls = stubCanvasContext()
    const fb = new Uint8Array(768)
    // Page 2, col 0, bit 0 → y = 16 pixels = 80 on canvas
    fb[2 * 128] = 0x01
    mount(OledDisplay, { props: { framebuffer: fb, pixelSize: 5 } })
    const pixel = calls.filter((c) => c.method === 'fillRect')[1]
    expect(pixel.args[1]).toBeCloseTo(80.5, 5)
  })

  test('bit 7 is drawn below bit 0', () => {
    const calls = stubCanvasContext()
    const fb = new Uint8Array(768)
    fb[0] = 0x80 // bit 7 only
    mount(OledDisplay, { props: { framebuffer: fb, pixelSize: 5 } })
    const pixel = calls.filter((c) => c.method === 'fillRect')[1]
    // bit 7 → row 7 inside page 0 → y = 35.5
    expect(pixel.args[1]).toBeCloseTo(35.5, 5)
  })
})
