import { describe, expect, it } from 'vitest'
import { CANADA_50X70, INDIA_2X2, INTL_35X45, PHOTO_SPECS, US_PASSPORT, formatRange } from '../config/photoSpecs'
import { autoFit, frameToSource, measure, sourceToFrame, sourceToOutputTransform, transformCropAbout, uncoveredFraction, type Markers } from './geometry'

/** A face in a 3000×4000 photo, head tilted by `tiltDeg`. */
function face(tiltDeg = 0, headPx = 1200, crownFraction = 0.5): Markers {
  const t = (tiltDeg * Math.PI) / 180
  const c = { x: 1500, y: 1600 }
  const rot = (dx: number, dy: number) => ({
    x: c.x + dx * Math.cos(t) - dy * Math.sin(t),
    y: c.y + dx * Math.sin(t) + dy * Math.cos(t),
  })
  return {
    eyeLeft: rot(-150, 0),
    eyeRight: rot(150, 0),
    crown: rot(0, -headPx * crownFraction),
    chin: rot(0, headPx * (1 - crownFraction)),
  }
}

describe('frame mapping', () => {
  it('round-trips source ↔ frame coordinates', () => {
    const crop = { cx: 1000, cy: 1200, angle: 0.2, pxPerMm: 23 }
    const p = { x: 873, y: 1411 }
    const back = frameToSource(sourceToFrame(p, crop, US_PASSPORT), crop, US_PASSPORT)
    expect(back.x).toBeCloseTo(p.x, 6)
    expect(back.y).toBeCloseTo(p.y, 6)
  })

  it('canvas transform matches sourceToFrame', () => {
    const crop = { cx: 1000, cy: 1200, angle: -0.15, pxPerMm: 20 }
    const k = 300 / 25.4
    const [a, b, c, d, e, f] = sourceToOutputTransform(crop, US_PASSPORT, k)
    const p = { x: 950, y: 1300 }
    const q = sourceToFrame(p, crop, US_PASSPORT)
    expect(a * p.x + c * p.y + e).toBeCloseTo(q.x * k, 6)
    expect(b * p.x + d * p.y + f).toBeCloseTo(q.y * k, 6)
  })
})

describe('autoFit', () => {
  for (const spec of PHOTO_SPECS) {
    for (const tilt of [0, 7, -12]) {
      for (const crownFraction of [0.45, 0.5, 0.58]) {
        it(`${spec.id}: tilt ${tilt}°, crown fraction ${crownFraction} lands inside every hard range`, () => {
          const m = face(tilt, 1200, crownFraction)
          const crop = autoFit(m, spec)
          const r = measure(m, crop, spec)
          expect(r.headHeightMm).toBeGreaterThanOrEqual(spec.headHeightMm.min - 1e-6)
          expect(r.headHeightMm).toBeLessThanOrEqual(spec.headHeightMm.max + 1e-6)
          if (spec.eyeFromBottomMm) {
            expect(r.eyeFromBottomMm).toBeGreaterThanOrEqual(spec.eyeFromBottomMm.min - 1e-6)
            expect(r.eyeFromBottomMm).toBeLessThanOrEqual(spec.eyeFromBottomMm.max + 1e-6)
          }
          expect(r.topMarginMm).toBeGreaterThan(0)
          expect(r.chinFromBottomMm).toBeGreaterThan(0)
          expect(Math.abs(r.centerOffsetMm)).toBeLessThan(1e-6)
          expect(Math.abs(r.tiltDeg)).toBeLessThan(1e-6)
        })
      }
    }
  }

  it('targets the middle of the US ranges for an average head', () => {
    const m = face(0, 1200, 0.5)
    const r = measure(m, autoFit(m, US_PASSPORT), US_PASSPORT)
    expect(r.headHeightMm).toBeCloseTo((25.4 + 34.925) / 2, 0)
    expect(r.eyeFromBottomMm).toBeCloseTo((28.575 + 34.925) / 2, 0)
  })

  it('uses the top-margin guideline when there is no eye range', () => {
    for (const spec of [INTL_35X45, CANADA_50X70]) {
      const m = face()
      const r = measure(m, autoFit(m, spec), spec)
      expect(r.topMarginMm).toBeGreaterThanOrEqual(spec.topMarginMm!.min - 1e-6)
      expect(r.topMarginMm).toBeLessThanOrEqual(spec.topMarginMm!.max + 1e-6)
    }
  })
})

describe('autoFit with a tight (selfie-like) photo', () => {
  // Head 600 px tall in a narrow 712 px wide photo: a mid-size head would need a ~1000 px wide frame.
  const tight = { width: 712, height: 950 }
  const m: Markers = {
    eyeLeft: { x: 306, y: 400 },
    eyeRight: { x: 406, y: 400 },
    crown: { x: 356, y: 100 },
    chin: { x: 356, y: 700 },
  }

  it('grows the head within the allowed range to keep the frame inside the photo', () => {
    const plain = autoFit(m, US_PASSPORT)
    const fitted = autoFit(m, US_PASSPORT, tight)
    expect(uncoveredFraction(fitted, US_PASSPORT, tight.width, tight.height)).toBeLessThan(
      uncoveredFraction(plain, US_PASSPORT, tight.width, tight.height),
    )
    const r = measure(m, fitted, US_PASSPORT)
    expect(r.headHeightMm).toBeLessThanOrEqual(US_PASSPORT.headHeightMm.max)
    expect(r.headHeightMm).toBeGreaterThan(measure(m, plain, US_PASSPORT).headHeightMm)
  })

  it('leaves well-framed photos at the mid-range targets', () => {
    const roomy = { width: 4000, height: 4000 }
    const shift = (p: { x: number; y: number }) => ({ x: p.x + 1600, y: p.y + 1600 })
    const centred: Markers = { eyeLeft: shift(m.eyeLeft), eyeRight: shift(m.eyeRight), crown: shift(m.crown), chin: shift(m.chin) }
    const a = measure(centred, autoFit(centred, US_PASSPORT), US_PASSPORT)
    const b = measure(centred, autoFit(centred, US_PASSPORT, roomy), US_PASSPORT)
    expect(b.headHeightMm).toBeCloseTo(a.headHeightMm, 6)
  })
})

describe('transformCropAbout', () => {
  it('keeps the pivot fixed in the frame while zooming and rotating', () => {
    const crop = { cx: 1500, cy: 1500, angle: 0.05, pxPerMm: 25 }
    const pivot = { x: 1440, y: 1390 }
    const before = sourceToFrame(pivot, crop, US_PASSPORT)
    const after = sourceToFrame(pivot, transformCropAbout(crop, pivot, 1.3, 0.1), US_PASSPORT)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('zooming in by 2× halves source pixels per mm', () => {
    const crop = { cx: 0, cy: 0, angle: 0, pxPerMm: 20 }
    expect(transformCropAbout(crop, { x: 0, y: 0 }, 2, 0).pxPerMm).toBe(10)
  })
})

describe('uncoveredFraction', () => {
  it('is 0 inside the image and > 0 past the edge', () => {
    const crop = { cx: 1500, cy: 2000, angle: 0, pxPerMm: 20 }
    expect(uncoveredFraction(crop, US_PASSPORT, 3000, 4000)).toBe(0)
    expect(uncoveredFraction({ ...crop, cx: 100 }, US_PASSPORT, 3000, 4000)).toBeGreaterThan(0.2)
  })
})

describe('formatRange', () => {
  it('shows US ranges as fractional inches', () => {
    expect(formatRange(US_PASSPORT.headHeightMm, 'in')).toBe('1–1⅜ in')
    expect(formatRange(US_PASSPORT.eyeFromBottomMm!, 'in')).toBe('1⅛–1⅜ in')
  })

  it('shows thirds of an inch', () => {
    expect(formatRange(INDIA_2X2.eyeFromBottomMm!, 'in')).toBe('1⅛–1⅓ in')
  })
})
