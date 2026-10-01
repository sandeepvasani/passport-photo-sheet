import { describe, expect, it } from 'vitest'
import { setJpegDpi } from './image'
import { boxMean, guidedFilter, keepConnected, replaceBackground } from './matting'

describe('boxMean', () => {
  it('matches a brute-force mean with edge normalisation', () => {
    const w = 7
    const h = 5
    const src = Float32Array.from({ length: w * h }, (_, i) => (i * 37) % 11)
    const r = 2
    const out = boxMean(src, w, h, r)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        let n = 0
        for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
          for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
            sum += src[yy * w + xx]
            n++
          }
        }
        expect(out[y * w + x]).toBeCloseTo(sum / n, 4)
      }
    }
  })
})

describe('guidedFilter', () => {
  it('snaps a blurry mask to a sharp edge in the guide image', () => {
    const w = 40
    const h = 10
    const n = w * h
    const guide = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) }
    const p = new Float32Array(n)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const v = x < 20 ? 0.9 : 0.2 // sharp edge at x = 20
        guide.r[i] = v
        guide.g[i] = v
        guide.b[i] = v
        p[i] = Math.min(1, Math.max(0, (26 - x) / 12)) // blurry ramp around the edge
      }
    }
    const q = guidedFilter(guide, p, w, h, 4, 1e-4)
    const row = 5 * w
    expect(q[row + 17] - q[row + 22]).toBeGreaterThan(p[row + 17] - p[row + 22])
  })
})

describe('replaceBackground', () => {
  it('paints background pixels and leaves the subject untouched', () => {
    const w = 4
    const h = 1
    const data = new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 255, 200, 100, 50, 255, 200, 100, 50, 255])
    const alpha = new Float32Array([0, 0, 1, 1])
    replaceBackground(data, alpha, w, h, [255, 255, 255], 1)
    expect([...data.slice(0, 3)]).toEqual([255, 255, 255])
    expect([...data.slice(8, 11)]).toEqual([200, 100, 50])
  })
})

describe('keepConnected', () => {
  it('removes blobs not connected to the seed but keeps the connected region', () => {
    const w = 10
    const h = 3
    const alpha = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (const x of [0, 1, 2]) alpha[y * w + x] = 1 // subject
      for (const x of [7, 8]) alpha[y * w + x] = 1 // stray blob
    }
    const out = keepConnected(alpha, w, h, 1, 1, 1)
    expect(out[1 * w + 1]).toBe(1)
    expect(out[1 * w + 8]).toBe(0)
  })

  it('leaves the matte untouched when the seed is not on the subject', () => {
    const alpha = new Float32Array([0, 0, 1, 1])
    expect(keepConnected(alpha, 4, 1, 0, 0, 1)).toBe(alpha)
  })
})

describe('setJpegDpi', () => {
  it('rewrites the JFIF density', () => {
    const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9])
    const out = setJpegDpi(jfif, 300)
    expect(out[13]).toBe(1)
    expect((out[14] << 8) | out[15]).toBe(300)
    expect((out[16] << 8) | out[17]).toBe(300)
  })

  it('inserts a JFIF segment when missing', () => {
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9])
    const out = setJpegDpi(bare, 300)
    expect(out.length).toBe(bare.length + 18)
    expect(String.fromCharCode(...out.subarray(6, 10))).toBe('JFIF')
    expect((out[14] << 8) | out[15]).toBe(300)
    expect([...out.subarray(20)]).toEqual([0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9])
  })
})
