/**
 * Alpha-matte refinement and background replacement.
 *
 * The segmentation model produces a soft, low-resolution person mask. We snap
 * it to real image edges with a colour guided filter (He et al., 2010), then
 * estimate the local background colour so hair edges don't carry a halo of the
 * old background when composited onto the new one.
 */

/** Mean filter with a (2r+1)² window, normalised at the borders. Separable running sums. */
export function boxMean(src: Float32Array, w: number, h: number, r: number, out = new Float32Array(w * h)): Float32Array {
  const tmp = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let x = 0; x <= Math.min(r, w - 1); x++) sum += src[row + x]
    for (let x = 0; x < w; x++) {
      const lo = x - r - 1
      const hi = x + r
      if (x > 0) {
        if (hi < w) sum += src[row + hi]
        if (lo >= 0) sum -= src[row + lo]
      }
      tmp[row + x] = sum / (Math.min(w - 1, hi) - Math.max(0, x - r) + 1)
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = 0; y <= Math.min(r, h - 1); y++) sum += tmp[y * w + x]
    for (let y = 0; y < h; y++) {
      const lo = y - r - 1
      const hi = y + r
      if (y > 0) {
        if (hi < h) sum += tmp[hi * w + x]
        if (lo >= 0) sum -= tmp[lo * w + x]
      }
      out[y * w + x] = sum / (Math.min(h - 1, hi) - Math.max(0, y - r) + 1)
    }
  }
  return out
}

export interface RGBPlanes {
  r: Float32Array
  g: Float32Array
  b: Float32Array
}

/** Splits RGBA bytes into float planes scaled to 0–1. */
export function toPlanes(data: Uint8ClampedArray): RGBPlanes {
  const n = data.length / 4
  const r = new Float32Array(n)
  const g = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    r[i] = data[i * 4] / 255
    g[i] = data[i * 4 + 1] / 255
    b[i] = data[i * 4 + 2] / 255
  }
  return { r, g, b }
}

const mul = (a: Float32Array, b: Float32Array) => {
  const out = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] * b[i]
  return out
}

/** Colour guided filter: refines `p` (0–1) so its edges follow edges in guide image `I`. */
export function guidedFilter(I: RGBPlanes, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h
  const box = (a: Float32Array) => boxMean(a, w, h, r)
  const mR = box(I.r)
  const mG = box(I.g)
  const mB = box(I.b)
  const mP = box(p)
  const mRP = box(mul(I.r, p))
  const mGP = box(mul(I.g, p))
  const mBP = box(mul(I.b, p))
  const vRR = box(mul(I.r, I.r))
  const vRG = box(mul(I.r, I.g))
  const vRB = box(mul(I.r, I.b))
  const vGG = box(mul(I.g, I.g))
  const vGB = box(mul(I.g, I.b))
  const vBB = box(mul(I.b, I.b))

  const aR = new Float32Array(n)
  const aG = new Float32Array(n)
  const aB = new Float32Array(n)
  const bb = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const r0 = mR[i],
      g0 = mG[i],
      b0 = mB[i],
      p0 = mP[i]
    const cR = mRP[i] - r0 * p0
    const cG = mGP[i] - g0 * p0
    const cB = mBP[i] - b0 * p0
    const sRR = vRR[i] - r0 * r0 + eps
    const sRG = vRG[i] - r0 * g0
    const sRB = vRB[i] - r0 * b0
    const sGG = vGG[i] - g0 * g0 + eps
    const sGB = vGB[i] - g0 * b0
    const sBB = vBB[i] - b0 * b0 + eps
    // Inverse of the symmetric 3×3 covariance matrix via cofactors.
    const iRR = sGG * sBB - sGB * sGB
    const iRG = sGB * sRB - sRG * sBB
    const iRB = sRG * sGB - sGG * sRB
    const iGG = sRR * sBB - sRB * sRB
    const iGB = sRB * sRG - sRR * sGB
    const iBB = sRR * sGG - sRG * sRG
    const det = sRR * iRR + sRG * iRG + sRB * iRB
    const ar = (iRR * cR + iRG * cG + iRB * cB) / det
    const ag = (iRG * cR + iGG * cG + iGB * cB) / det
    const ab = (iRB * cR + iGB * cG + iBB * cB) / det
    aR[i] = ar
    aG[i] = ag
    aB[i] = ab
    bb[i] = p0 - ar * r0 - ag * g0 - ab * b0
  }
  const maR = box(aR)
  const maG = box(aG)
  const maB = box(aB)
  const mb = box(bb)
  const q = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    q[i] = maR[i] * I.r[i] + maG[i] * I.g[i] + maB[i] * I.b[i] + mb[i]
  }
  return q
}

/** Linear levels: values ≤ lo → 0, ≥ hi → 1. */
export function levels(a: Float32Array, lo: number, hi: number): Float32Array {
  const out = new Float32Array(a.length)
  const span = Math.max(1e-3, hi - lo)
  for (let i = 0; i < a.length; i++) out[i] = Math.min(1, Math.max(0, (a[i] - lo) / span))
  return out
}

/**
 * Composites the subject onto a flat background colour, in place.
 *
 * At soft edges the observed pixel is I = αF + (1-α)B_old. We estimate B_old
 * as the alpha-weighted local mean of background pixels, recover F, and
 * re-blend it over the new colour.
 */
export function replaceBackground(
  data: Uint8ClampedArray,
  alpha: Float32Array,
  w: number,
  h: number,
  bg: [number, number, number],
  radius: number,
): void {
  const n = w * h
  const inv = new Float32Array(n)
  for (let i = 0; i < n; i++) inv[i] = 1 - alpha[i]
  const wB = boxMean(inv, w, h, radius)
  const wF = boxMean(alpha, w, h, radius)
  const chan = (c: number) => {
    const v = new Float32Array(n)
    for (let i = 0; i < n; i++) v[i] = data[i * 4 + c]
    return v
  }
  const planes = [chan(0), chan(1), chan(2)]
  const bgMeans = planes.map((p) => boxMean(mul(p, inv), w, h, radius))
  const fgMeans = planes.map((p) => boxMean(mul(p, alpha), w, h, radius))
  for (let i = 0; i < n; i++) {
    const a = alpha[i]
    if (a >= 0.999) continue
    for (let c = 0; c < 3; c++) {
      let out: number
      if (a <= 0.001) {
        out = bg[c]
      } else {
        const I = planes[c][i]
        const Bold = wB[i] > 1e-4 ? bgMeans[c][i] / wB[i] : I
        let F: number
        if (a > 0.15) F = (I - (1 - a) * Bold) / a
        else F = wF[i] > 1e-4 ? fgMeans[c][i] / wF[i] : I
        F = Math.min(255, Math.max(0, F))
        out = a * F + (1 - a) * bg[c]
      }
      data[i * 4 + c] = out
    }
  }
}

/**
 * Zeroes matte regions not connected to `seed` (the face), removing stray
 * blobs the segmenter mislabels as "person". Soft edges within `radius` of
 * the kept region survive.
 */
export function keepConnected(alpha: Float32Array, w: number, h: number, seedX: number, seedY: number, radius: number): Float32Array {
  const sx = Math.round(seedX)
  const sy = Math.round(seedY)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || alpha[sy * w + sx] < 0.5) return alpha
  const inside = new Float32Array(w * h)
  const stack = [sy * w + sx]
  inside[stack[0]] = 1
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    const y = (i - x) / w
    const visit = (j: number) => {
      if (inside[j] === 0 && alpha[j] >= 0.3) {
        inside[j] = 1
        stack.push(j)
      }
    }
    if (x > 0) visit(i - 1)
    if (x < w - 1) visit(i + 1)
    if (y > 0) visit(i - w)
    if (y < h - 1) visit(i + w)
  }
  const near = boxMean(inside, w, h, radius)
  const out = new Float32Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = near[i] > 0 ? alpha[i] : 0
  return out
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** Everything the edge refinement needs, at the finished photo's resolution. */
export interface RefineInput {
  /** The cropped photo as RGBA; with `replaceWith`, it's composited onto that colour in place. */
  rgba: Uint8ClampedArray<ArrayBuffer>
  /** Person mask resampled to the photo (0–1). */
  coarse: Float32Array
  width: number
  height: number
  /** The mask includes a true alpha matte (MODNet), not only segmentation. */
  matte: boolean
  /** Edge-refinement radius in pixels at 300 DPI, and the photo's DPI ÷ 300. */
  feather: number
  scale: number
  /** −1 (tighten around the subject) … +1 (expand into the background). */
  expand: number
  /** A pixel on the person (between the eyes): only the region connected to it is kept. */
  seed?: { x: number; y: number }
  /** New background colour, when replacing it. */
  replaceWith?: [number, number, number]
}

/**
 * Snaps the person matte to the photo's edges and, with `replaceWith`, replaces the
 * background. Returns the matte. Pure, so it can run in a worker (see render.ts).
 */
export function refineMatte(input: RefineInput): Float32Array {
  const { rgba, coarse, width: W, height: H, feather, scale, seed, replaceWith } = input
  const shift = input.expand * 0.3
  let alpha: Float32Array
  let radius: number
  if (input.matte) {
    // A true matte already has soft hair edges: only snap it lightly to the
    // full-resolution image and trim faint noise, so thin strands survive.
    radius = Math.round(feather * 0.4 * scale)
    const refined = radius > 0 ? guidedFilter(toPlanes(rgba), coarse, W, H, radius, 1e-4) : coarse
    alpha = levels(refined, 0.05 - shift, 0.95 - shift)
  } else {
    // Coarse segmentation: snap edges to the image and harden the transition.
    radius = Math.max(1, Math.round(feather * scale))
    const refined = guidedFilter(toPlanes(rgba), coarse, W, H, radius, 2e-3)
    alpha = levels(refined, 0.25 - shift, 0.75 - shift)
  }
  if (seed) alpha = keepConnected(alpha, W, H, seed.x, seed.y, Math.max(2, radius * 2))
  if (replaceWith) replaceBackground(rgba, alpha, W, H, replaceWith, Math.max(8, radius * 3))
  return alpha
}
