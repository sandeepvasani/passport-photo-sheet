import { rangeTarget, type PhotoSpec } from '../config/photoSpecs'

export interface Point {
  x: number
  y: number
}

/**
 * Where the passport photo frame sits on the source image.
 * (cx, cy) is the frame centre in source pixels, `angle` the rotation of the
 * frame's x-axis in source coordinates (radians), and `pxPerMm` how many source
 * pixels map to one millimetre of the finished photo.
 */
export interface Crop {
  cx: number
  cy: number
  angle: number
  pxPerMm: number
}

/** Key facial reference points in source pixel coordinates. */
export interface Markers {
  crown: Point
  chin: Point
  /** Eye that appears on the left of the image. */
  eyeLeft: Point
  /** Eye that appears on the right of the image. */
  eyeRight: Point
  /** Face width across the cheeks at ear level, in source pixels (from the face mesh). */
  faceWidthPx?: number
}

export interface Measurements {
  headHeightMm: number
  eyeFromBottomMm: number
  topMarginMm: number
  chinFromBottomMm: number
  /** Horizontal offset of the eye midpoint from the frame centre (+ = right). */
  centerOffsetMm: number
  /** Face width in the finished photo, when the face mesh provided it. */
  faceWidthMm?: number
  /** Residual tilt of the eye line in the finished photo (degrees, + = clockwise). */
  tiltDeg: number
}

/** 2-D affine transform in canvas `setTransform(a, b, c, d, e, f)` order. */
export type Affine = [number, number, number, number, number, number]

export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export function axes(angle: number) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { ux: { x: cos, y: sin }, uy: { x: -sin, y: cos } }
}

/** Source pixel → millimetres within the finished photo (origin top-left). */
export function sourceToFrame(p: Point, crop: Crop, spec: PhotoSpec): Point {
  const { ux, uy } = axes(crop.angle)
  const dx = p.x - crop.cx
  const dy = p.y - crop.cy
  return {
    x: (dx * ux.x + dy * ux.y) / crop.pxPerMm + spec.widthMm / 2,
    y: (dx * uy.x + dy * uy.y) / crop.pxPerMm + spec.heightMm / 2,
  }
}

/** Millimetres within the finished photo → source pixel. */
export function frameToSource(q: Point, crop: Crop, spec: PhotoSpec): Point {
  const { ux, uy } = axes(crop.angle)
  const u = (q.x - spec.widthMm / 2) * crop.pxPerMm
  const v = (q.y - spec.heightMm / 2) * crop.pxPerMm
  return { x: crop.cx + u * ux.x + v * uy.x, y: crop.cy + u * ux.y + v * uy.y }
}

/**
 * Transform that draws the source image so the frame lands at
 * (offsetX, offsetY) with `outPxPerMm` output pixels per millimetre.
 */
export function sourceToOutputTransform(crop: Crop, spec: PhotoSpec, outPxPerMm: number, offsetX = 0, offsetY = 0): Affine {
  const s = outPxPerMm / crop.pxPerMm
  const cos = Math.cos(crop.angle)
  const sin = Math.sin(crop.angle)
  const a = s * cos
  const b = -s * sin
  const c = s * sin
  const d = s * cos
  const e = -(a * crop.cx + c * crop.cy) + (spec.widthMm / 2) * outPxPerMm + offsetX
  const f = -(b * crop.cx + d * crop.cy) + (spec.heightMm / 2) * outPxPerMm + offsetY
  return [a, b, c, d, e, f]
}

export function measure(markers: Markers, crop: Crop, spec: PhotoSpec): Measurements {
  const crown = sourceToFrame(markers.crown, crop, spec)
  const chin = sourceToFrame(markers.chin, crop, spec)
  const eL = sourceToFrame(markers.eyeLeft, crop, spec)
  const eR = sourceToFrame(markers.eyeRight, crop, spec)
  const eyes = midpoint(eL, eR)
  return {
    headHeightMm: chin.y - crown.y,
    eyeFromBottomMm: spec.heightMm - eyes.y,
    topMarginMm: crown.y,
    chinFromBottomMm: spec.heightMm - chin.y,
    centerOffsetMm: eyes.x - spec.widthMm / 2,
    faceWidthMm: markers.faceWidthPx ? markers.faceWidthPx / crop.pxPerMm : undefined,
    tiltDeg: (Math.atan2(eR.y - eL.y, eR.x - eL.x) * 180) / Math.PI,
  }
}

export function eyeLineAngle(markers: Markers): number {
  const { eyeLeft: l, eyeRight: r } = markers
  return Math.atan2(r.y - l.y, r.x - l.x)
}

/**
 * Computes the crop that levels the eyes, centres the face and picks the head
 * size / vertical position closest to the spec's targets while respecting
 * every hard range. With `image`, it also keeps as much of the frame inside the
 * photo as the ranges allow (close-up selfies leave little room around the head).
 */
export function autoFit(markers: Markers, spec: PhotoSpec, image?: { width: number; height: number }): Crop {
  const angle = eyeLineAngle(markers)
  const { uy } = axes(angle)
  const eyes = midpoint(markers.eyeLeft, markers.eyeRight)
  const along = (p: Point) => (p.x - eyes.x) * uy.x + (p.y - eyes.y) * uy.y
  const crownB = along(markers.crown)
  const chinB = along(markers.chin)
  const headPx = Math.max(1, chinB - crownB)
  // Fraction of the head (crown→chin) that sits above the eye line.
  const k = Math.min(0.9, Math.max(0.1, -crownB / headPx))

  const H = spec.heightMm
  let head = spec.headHeightMm
  if (spec.faceWidthMm && markers.faceWidthPx) {
    // The face width sets the size: keep the head heights that put this face's width in range.
    const ratio = markers.faceWidthPx / headPx
    const w = spec.faceWidthMm
    const min = Math.max(head.min, w.min / ratio)
    const max = Math.min(head.max, w.max / ratio)
    if (min < max) head = { min, max, target: Math.min(max, Math.max(min, rangeTarget(w) / ratio)) }
  }
  const headTarget = rangeTarget(head)
  // An eye line with only a minimum is a constraint, not a position to aim for.
  const eyeR = spec.eyeFromBottomMm && Number.isFinite(spec.eyeFromBottomMm.max) ? spec.eyeFromBottomMm : undefined
  const eyeMin = spec.eyeFromBottomMm && !eyeR ? spec.eyeFromBottomMm.min : undefined
  const topR = spec.topMarginMm
  const minTop = topR?.min ?? 1

  const cropFor = (headMm: number, eyeV: number): Crop => {
    const pxPerMm = headPx / headMm
    // Eyes sit on the vertical centre line at height eyeV.
    const offset = (eyeV - H / 2) * pxPerMm
    return { cx: eyes.x - offset * uy.x, cy: eyes.y - offset * uy.y, angle, pxPerMm }
  }

  // Search slightly inside each range, so small marker errors can't push the result out of spec.
  const inset = (r: { min: number; max: number }, t: number) => {
    const m = (r.max - r.min) * 0.04
    return r.min + m + (r.max - r.min - 2 * m) * t
  }

  let best = { cost: Infinity, headMm: headTarget, eyeV: H / 2 }
  const steps = 48
  for (let i = 0; i <= steps; i++) {
    const headMm = inset(head, i / steps)
    for (let j = 0; j <= steps; j++) {
      let eyeV: number
      let posCost: number
      if (eyeR) {
        const eb = inset(eyeR, j / steps)
        eyeV = H - eb
        posCost = ((eb - rangeTarget(eyeR)) / (eyeR.max - eyeR.min)) ** 2
      } else if (topR) {
        const t = spec.topMarginRequired ? inset(topR, j / steps) : topR.min + ((topR.max - topR.min) * j) / steps
        eyeV = t + k * headMm
        posCost = ((t - rangeTarget(topR)) / (topR.max - topR.min)) ** 2
      } else {
        eyeV = H / 2
        posCost = 0
      }
      const crownV = eyeV - k * headMm
      const chinV = eyeV + (1 - k) * headMm
      let cost = ((headMm - headTarget) / (head.max - head.min)) ** 2 + posCost
      if (crownV < minTop) cost += 50 + 50 * (minTop - crownV) ** 2
      if (topR && crownV > topR.max) cost += 5 * (crownV - topR.max) ** 2
      if (chinV > H) cost += 100
      if (eyeMin !== undefined && H - eyeV < eyeMin + 0.2) cost += 50 + 50 * (eyeMin + 0.2 - (H - eyeV)) ** 2
      // Blank frame area outweighs any preference for mid-range values.
      if (image && cost < best.cost) cost += 10 * overhangMm(cropFor(headMm, eyeV), spec, image.width, image.height)
      if (cost < best.cost) best = { cost, headMm, eyeV }
    }
  }

  return cropFor(best.headMm, best.eyeV)
}

/** How far (mm of finished photo, summed over the four image edges) the frame reaches past the photo. */
export function overhangMm(crop: Crop, spec: PhotoSpec, imgW: number, imgH: number): number {
  const corners = [
    { x: 0, y: 0 },
    { x: spec.widthMm, y: 0 },
    { x: 0, y: spec.heightMm },
    { x: spec.widthMm, y: spec.heightMm },
  ].map((q) => frameToSource(q, crop, spec))
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  const over =
    Math.max(0, -Math.min(...xs)) +
    Math.max(0, Math.max(...xs) - imgW) +
    Math.max(0, -Math.min(...ys)) +
    Math.max(0, Math.max(...ys) - imgH)
  return over / crop.pxPerMm
}

/** Fraction of the frame (0–1) that falls outside the source image, sampled on a grid. */
export function uncoveredFraction(crop: Crop, spec: PhotoSpec, imgW: number, imgH: number, n = 24): number {
  let outside = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = frameToSource({ x: ((i + 0.5) / n) * spec.widthMm, y: ((j + 0.5) / n) * spec.heightMm }, crop, spec)
      if (p.x < 0 || p.y < 0 || p.x > imgW || p.y > imgH) outside++
    }
  }
  return outside / (n * n)
}

/** Rotates and scales a crop about a fixed source point. */
export function transformCropAbout(crop: Crop, pivot: Point, scale: number, dAngle: number): Crop {
  const cos = Math.cos(dAngle)
  const sin = Math.sin(dAngle)
  const dx = crop.cx - pivot.x
  const dy = crop.cy - pivot.y
  // Zooming in (scale > 1) shrinks the frame on the source, so the centre moves toward the pivot.
  const rx = (dx * cos - dy * sin) / scale
  const ry = (dx * sin + dy * cos) / scale
  return {
    cx: pivot.x + rx,
    cy: pivot.y + ry,
    angle: crop.angle + dAngle,
    pxPerMm: crop.pxPerMm / scale,
  }
}
