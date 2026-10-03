import { FaceLandmarker, FilesetResolver, ImageSegmenter, type Matrix } from '@mediapipe/tasks-vision'
import { midpoint, type Markers, type Point } from './geometry'
import { createCanvas, ctx2d, downscale, releaseCanvas, type LoadedImage } from './image'
import { clampRect, makeMaskLayer, type MaskLayer } from './mask'

export type { MaskLayer } from './mask'

export interface FaceAnalysis {
  faceCount: number
  /** Every face found, largest first. */
  faces: DetectedFace[]
  /** Index into `faces` of the person the photo is for. */
  subject: number
  /** 478 face-mesh landmarks of the main face, in working-image pixels. */
  landmarks: Point[]
  /** Detected reference points, or null when no face was found. */
  markers: Markers | null
  blendshapes: Record<string, number>
  /** Head rotation in degrees (left/right and up/down). */
  pose: { yaw: number; pitch: number } | null
  /** Coarse full-image mask first, then a sharper one around the head. */
  masks: MaskLayer[]
  /** The hair reaches the edge of the original photo, so the crown may be cut off. */
  crownAtImageEdge: boolean
  /** Glasses, reflections and tint around the eyes; null when no face was found. */
  eyewear: EyewearAnalysis | null
  /** Skin brightness across the face, for spotting shadows; null when no face was found. */
  lighting: LightingAnalysis | null
}

export type LightBand = 'forehead' | 'eyes' | 'cheeks' | 'jaw'
export type LightSide = 'left' | 'centre' | 'right'
export interface LightRegion {
  /** Median skin brightness, 0–255. */
  brightness: number
  /** Average fine grain relative to brightness: hair (beard, stubble) is grainy, shadows are smooth. */
  texture: number
}
/**
 * Skin measurements for each face region, or null where too little bare skin is
 * visible (head hair, glasses). Left and right are as seen in the photo.
 */
export type LightingAnalysis = Record<LightBand, Record<LightSide, LightRegion | null>>

export interface EyewearAnalysis {
  /** Glasses are probably being worn. */
  detected: boolean
  /** Share of the eye band the segmenter labels as an accessory (it labels glasses this way). */
  accessoryShare: number
  /** Strongest horizontal edge across the nose bridge, with the eyes scaled 100 px apart. */
  bridgeEdge: number
  /** Strongest horizontal edge under the eyes (the lower rim of frames), same scale. */
  rimEdge: number
  /** Share of the lens area (excluding the irises) that is blown-out white, as from a reflection. */
  glareShare: number
  /** Brightness of the lens area relative to the cheeks; well below 1 means tinted lenses. */
  lensBrightness: number
}

interface Models {
  face: FaceLandmarker
  segmenter: ImageSegmenter
}

// Face-mesh landmark indices.
const LM = {
  forehead: 10,
  chin: 152,
  faceLeft: 234,
  faceRight: 454,
  irisA: 468,
  irisB: 473,
  browCentre: 168,
  noseBridge: 6,
  cheekLeft: 50,
  cheekRight: 280,
}

const BASE = import.meta.env.BASE_URL

let modelsPromise: Promise<Models> | null = null

export function loadModels(): Promise<Models> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`)
      const [face, segmenter] = await Promise.all([
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: `${BASE}models/face_landmarker.task`, delegate: 'CPU' },
          runningMode: 'IMAGE',
          // Enough for a family or small group, so nobody else in the frame goes unnoticed.
          numFaces: 6,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        }),
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: `${BASE}models/selfie_multiclass_256x256.tflite`, delegate: 'CPU' },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        }),
      ])
      return { face, segmenter }
    })()
    // Allow a retry if loading failed (e.g. flaky network).
    modelsPromise.catch(() => (modelsPromise = null))
  }
  return modelsPromise
}

export interface DetectedFace {
  /** 478 face-mesh landmarks, in working-image pixels. */
  landmarks: Point[]
  blendshapes: Record<string, number>
  matrix?: Matrix
  area: number
  /** Bounding box of the landmarks (forehead to chin, cheek to cheek), working-image pixels. */
  box: { x: number; y: number; w: number; h: number }
}

function detectFaces(face: FaceLandmarker, src: HTMLCanvasElement, offset: Point, scale: number): DetectedFace[] {
  const result = face.detect(src)
  return result.faceLandmarks.map((lms, i) => {
    const landmarks = lms.map((l) => ({
      x: offset.x + (l.x * src.width) / scale,
      y: offset.y + (l.y * src.height) / scale,
    }))
    const xs = landmarks.map((p) => p.x)
    const ys = landmarks.map((p) => p.y)
    const blendshapes: Record<string, number> = {}
    for (const c of result.faceBlendshapes[i]?.categories ?? []) blendshapes[c.categoryName] = c.score
    return {
      landmarks,
      blendshapes,
      matrix: result.facialTransformationMatrixes[i],
      area: (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)),
      box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
    }
  })
}

function segmentRegion(segmenter: ImageSegmenter, image: LoadedImage, rect: MaskLayer['rect'], maxSide: number): MaskLayer {
  return segmentWithSkin(segmenter, image, rect, maxSide, false).person
}

/** Person mask for `rect`, plus (optionally) the segmenter's face-skin class as a second layer. */
function segmentWithSkin(
  segmenter: ImageSegmenter,
  image: LoadedImage,
  rect: MaskLayer['rect'],
  maxSide: number,
  withSkin: boolean,
): { person: MaskLayer; skin: MaskLayer | null } {
  const s = Math.min(1, maxSide / Math.max(rect.w, rect.h))
  const input = createCanvas(rect.w * s, rect.h * s)
  const ictx = ctx2d(input)
  ictx.imageSmoothingQuality = 'high'
  ictx.drawImage(image.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, input.width, input.height)

  const result = segmenter.segment(input)
  releaseCanvas(input)
  const labels = segmenter.getLabels()
  const bgMask = result.confidenceMasks?.[Math.max(0, labels.indexOf('background'))]
  if (!bgMask) {
    result.close()
    throw new Error('Segmentation returned no mask')
  }
  const w = bgMask.width
  const h = bgMask.height
  const bg = bgMask.getAsFloat32Array()
  const data = new Float32Array(w * h)
  for (let i = 0; i < data.length; i++) data[i] = 1 - bg[i]
  const skinIndex = labels.indexOf('face-skin')
  const skinMask = withSkin && skinIndex >= 0 ? result.confidenceMasks?.[skinIndex] : undefined
  const skin = skinMask ? makeMaskLayer(skinMask.getAsFloat32Array().slice(), w, h, rect, 'segmentation') : null
  result.close()
  return { person: makeMaskLayer(data, w, h, rect, 'segmentation'), skin }
}

/** Bilinear sample of a mask at a working-image point; null if outside the mask. */
function sampleMask(layer: MaskLayer, p: Point): number | null {
  const mx = ((p.x - layer.rect.x) / layer.rect.w) * layer.w - 0.5
  const my = ((p.y - layer.rect.y) / layer.rect.h) * layer.h - 0.5
  if (mx < 0 || my < 0 || mx > layer.w - 1 || my > layer.h - 1) return null
  const x0 = Math.floor(mx)
  const y0 = Math.floor(my)
  const x1 = Math.min(layer.w - 1, x0 + 1)
  const y1 = Math.min(layer.h - 1, y0 + 1)
  const fx = mx - x0
  const fy = my - y0
  const d = layer.data
  const top = d[y0 * layer.w + x0] * (1 - fx) + d[y0 * layer.w + x1] * fx
  const bot = d[y1 * layer.w + x0] * (1 - fx) + d[y1 * layer.w + x1] * fx
  return top * (1 - fy) + bot * fy
}

function sampleLayers(layers: MaskLayer[], p: Point): number | null {
  // Later layers are sharper; prefer them where they have coverage.
  for (let i = layers.length - 1; i >= 0; i--) {
    const v = sampleMask(layers[i], p)
    if (v !== null) return v
  }
  return null
}

/**
 * Finds the top of the head (including hair) by walking up from the forehead
 * along the face's vertical axis until the person mask ends.
 */
function findCrown(layers: MaskLayer[], lms: Point[], image: LoadedImage): { crown: Point; atEdge: boolean } {
  const forehead = lms[LM.forehead]
  const chin = lms[LM.chin]
  const faceH = Math.hypot(chin.x - forehead.x, chin.y - forehead.y)
  const faceW = Math.hypot(lms[LM.faceRight].x - lms[LM.faceLeft].x, lms[LM.faceRight].y - lms[LM.faceLeft].y)
  const a = lms[LM.irisA]
  const b = lms[LM.irisB]
  const [l, r] = a.x < b.x ? [a, b] : [b, a]
  const len = Math.hypot(r.x - l.x, r.y - l.y) || 1
  const ux = { x: (r.x - l.x) / len, y: (r.y - l.y) / len }
  const up = { x: ux.y, y: -ux.x }

  const step = Math.max(0.5, faceH / 300)
  const gap = faceH * 0.06
  const half = 0.35 * faceW
  let lastT = 0
  let atEdge = false
  for (let t = 0; t < faceH * 1.6; t += step) {
    const c = { x: forehead.x + up.x * t, y: forehead.y + up.y * t }
    if (c.x < 0 || c.y < 0 || c.x >= image.width || c.y >= image.height) {
      atEdge = t - lastT <= step * 2
      break
    }
    let hits = 0
    let total = 0
    for (let s = -6; s <= 6; s++) {
      const v = sampleLayers(layers, { x: c.x + (ux.x * half * s) / 6, y: c.y + (ux.y * half * s) / 6 })
      if (v === null) continue
      total++
      if (v > 0.5) hits++
    }
    if (total > 0 && hits >= Math.max(2, total * 0.15)) lastT = t
    else if (t - lastT > gap) break
  }
  return { crown: { x: forehead.x + up.x * lastT, y: forehead.y + up.y * lastT }, atEdge }
}

/**
 * Looks for glasses, lens reflections and tinted lenses. Works on a crop of the
 * eye region scaled so the pupils are 100 px apart, combining the segmenter's
 * accessory class with the straight horizontal edges that frames make.
 */
function analyzeEyewear(segmenter: ImageSegmenter, image: LoadedImage, lms: Point[]): EyewearAnalysis {
  const a = lms[LM.irisA]
  const b = lms[LM.irisB]
  const iod = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const s = 100 / iod
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const mid = midpoint(a, b)
  const W = 240
  const H = 140
  const crop = createCanvas(W, H)
  const ctx = ctx2d(crop)
  // Level the eyes so frame edges are horizontal in the crop.
  ctx.translate(W / 2, H / 2)
  ctx.scale(s, s)
  ctx.rotate(-angle)
  ctx.translate(-mid.x, -mid.y)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image.canvas, 0, 0)
  const px = ctx.getImageData(0, 0, W, H).data
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  const toCrop = (p: Point) => {
    const dx = (p.x - mid.x) * s
    const dy = (p.y - mid.y) * s
    return { x: W / 2 + dx * cos - dy * sin, y: H / 2 + dx * sin + dy * cos }
  }
  const gray = new Float32Array(W * H)
  for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]

  /** Mean |∂/∂y| along each row of a box; the strongest row. Frames make long straight edges. */
  const rowPeak = (x0: number, x1: number, y0: number, y1: number) => {
    let best = 0
    for (let y = Math.max(1, Math.round(y0)); y < Math.min(H - 1, Math.round(y1)); y++) {
      let sum = 0
      let n = 0
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x1)); x++) {
        sum += Math.abs(gray[(y + 1) * W + x] - gray[(y - 1) * W + x])
        n++
      }
      if (n) best = Math.max(best, sum / n)
    }
    return best
  }
  const eL = toCrop(a.x < b.x ? a : b)
  const eR = toCrop(a.x < b.x ? b : a)
  const brow = toCrop(lms[LM.browCentre])
  const bridge = toCrop(lms[LM.noseBridge])
  const bridgeEdge = rowPeak(eL.x + 25, eR.x - 25, brow.y, bridge.y + 8)
  const rimEdge = Math.min(rowPeak(eL.x - 30, eL.x + 30, eL.y + 18, eL.y + 50), rowPeak(eR.x - 30, eR.x + 30, eR.y + 18, eR.y + 50))

  const result = segmenter.segment(crop)
  releaseCanvas(crop)
  const othersIndex = segmenter.getLabels().indexOf('others')
  let accessoryShare = 0
  const mask = othersIndex >= 0 ? result.confidenceMasks?.[othersIndex] : undefined
  if (mask) {
    const d = mask.getAsFloat32Array()
    let hit = 0
    let total = 0
    for (let y = Math.round(eL.y - 25); y < eL.y + 40; y++) {
      for (let x = Math.round(eL.x - 40); x < eR.x + 40; x++) {
        const mx = Math.floor((x * mask.width) / W)
        const my = Math.floor((y * mask.height) / H)
        if (mx < 0 || my < 0 || mx >= mask.width || my >= mask.height) continue
        total++
        if (d[my * mask.width + mx] > 0.5) hit++
      }
    }
    accessoryShare = total ? hit / total : 0
  }
  result.close()

  // Lens areas: ellipses around each eye, minus the irises (their catchlights are natural).
  const irisR = (c: number) => ([1, 2, 3, 4].reduce((t, i) => t + Math.hypot(lms[c + i].x - lms[c].x, lms[c + i].y - lms[c].y), 0) / 4) * s
  const irises = [
    { c: toCrop(a), r: irisR(LM.irisA) * 1.3 },
    { c: toCrop(b), r: irisR(LM.irisB) * 1.3 },
  ]
  let lensN = 0
  let lensSum = 0
  let glare = 0
  for (const { c, r } of irises) {
    for (let y = Math.round(c.y - 30); y <= c.y + 30; y++) {
      for (let x = Math.round(c.x - 42); x <= c.x + 42; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue
        if (((x - c.x) / 42) ** 2 + ((y - c.y) / 30) ** 2 > 1) continue
        const i = y * W + x
        lensN++
        lensSum += gray[i]
        if ((x - c.x) ** 2 + (y - c.y) ** 2 <= r * r) continue
        const R = px[i * 4],
          G = px[i * 4 + 1],
          B = px[i * 4 + 2]
        if (gray[i] >= 240 && Math.max(R, G, B) - Math.min(R, G, B) <= 30) glare++
      }
    }
  }
  const patch = (p: Point) => {
    const c = toCrop(p)
    let sum = 0
    let n = 0
    for (let y = Math.round(c.y - 8); y <= c.y + 8; y++) {
      for (let x = Math.round(c.x - 8); x <= c.x + 8; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue
        sum += gray[y * W + x]
        n++
      }
    }
    return n ? sum / n : 0
  }
  const cheeks = (patch(lms[LM.cheekLeft]) + patch(lms[LM.cheekRight])) / 2
  const lensBrightness = cheeks > 0 && lensN > 0 ? lensSum / lensN / cheeks : 1
  return {
    detected: accessoryShare >= 0.02 || bridgeEdge >= 28 || rimEdge >= 40,
    accessoryShare,
    bridgeEdge,
    rimEdge,
    glareShare: lensN ? glare / lensN : 0,
    lensBrightness,
  }
}

// Face-mesh outlines used to find bare skin.
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
  234, 127, 162, 21, 54, 103, 67, 109,
]
const EYE_LEFT = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
const EYE_RIGHT = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
const BROW_LEFT = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]
const BROW_RIGHT = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]
const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]
const BROWS = [...BROW_LEFT, ...BROW_RIGHT]

/**
 * Measures how evenly the face is lit. Works on a levelled crop of the face, splits
 * it into forehead / eye area / cheeks / jaw bands, each left / centre / right, and
 * measures the skin's median brightness and grain in each (eyes, brows, lips,
 * nostrils, head hair and glasses excluded).
 */
function measureLighting(image: LoadedImage, lms: Point[], skin: MaskLayer | null): LightingAnalysis {
  try {
    return analyzeLighting(image, lms, skin)
  } finally {
    releaseCanvas(skin?.canvas)
  }
}

function analyzeLighting(image: LoadedImage, lms: Point[], skin: MaskLayer | null): LightingAnalysis {
  const a = lms[LM.irisA]
  const b = lms[LM.irisB]
  const iod = Math.hypot(b.x - a.x, b.y - a.y) || 1
  // Work near the photo's own resolution (capped) so stubble stays grainy rather than
  // blurring into what looks like a shadow. Sizes below are in units of 1/100 of the
  // distance between the pupils.
  const u = Math.min(2.4, Math.max(1, iod / 100))
  const s = (100 * u) / iod
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const mid = midpoint(a, b)
  const W = Math.round(360 * u)
  const H = Math.round(420 * u)
  const eyeY = 170 * u
  const align = (ctx: CanvasRenderingContext2D) => {
    ctx.translate(W / 2, eyeY)
    ctx.scale(s, s)
    ctx.rotate(-angle)
    ctx.translate(-mid.x, -mid.y)
  }
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  const toCrop = (p: Point) => {
    const dx = (p.x - mid.x) * s
    const dy = (p.y - mid.y) * s
    return { x: W / 2 + dx * cos - dy * sin, y: eyeY + dx * sin + dy * cos }
  }

  const photo = createCanvas(W, H)
  const pctx = ctx2d(photo)
  align(pctx)
  pctx.imageSmoothingQuality = 'high'
  pctx.drawImage(image.canvas, 0, 0)
  const px = pctx.getImageData(0, 0, W, H).data

  // Where bare skin can be: inside the face outline, minus features (slightly enlarged).
  const valid = createCanvas(W, H)
  const vctx = ctx2d(valid)
  vctx.fillStyle = '#000'
  vctx.fillRect(0, 0, W, H)
  const poly = (idx: number[], grow: number, colour: string) => {
    const pts = idx.map((i) => toCrop(lms[i]))
    const cx = pts.reduce((t, p) => t + p.x, 0) / pts.length
    const cy = pts.reduce((t, p) => t + p.y, 0) / pts.length
    vctx.fillStyle = colour
    vctx.beginPath()
    pts.forEach((p, k) => {
      const x = cx + (p.x - cx) * grow
      const y = cy + (p.y - cy) * grow
      if (k) vctx.lineTo(x, y)
      else vctx.moveTo(x, y)
    })
    vctx.closePath()
    vctx.fill()
  }
  poly(FACE_OVAL, 0.94, '#fff')
  poly(EYE_LEFT, 1.5, '#000')
  poly(EYE_RIGHT, 1.5, '#000')
  poly(BROW_LEFT, 1.25, '#000')
  poly(BROW_RIGHT, 1.25, '#000')
  poly(LIPS, 1.15, '#000')
  vctx.fillStyle = '#000'
  for (const [i, r] of [
    [2, 14],
    [98, 10],
    [327, 10],
  ] as const) {
    const c = toCrop(lms[i])
    vctx.beginPath()
    vctx.arc(c.x, c.y, r * u, 0, Math.PI * 2)
    vctx.fill()
  }
  const vd = vctx.getImageData(0, 0, W, H).data

  // Face-skin class from the segmenter (drops head hair and glasses frames, but not beards).
  let sd: Uint8ClampedArray | null = null
  if (skin) {
    const sk = createCanvas(W, H)
    const sctx = ctx2d(sk)
    sctx.fillStyle = '#000'
    sctx.fillRect(0, 0, W, H)
    align(sctx)
    sctx.drawImage(skin.canvas, skin.rect.x, skin.rect.y, skin.rect.w, skin.rect.h)
    sd = sctx.getImageData(0, 0, W, H).data
    releaseCanvas(sk)
  }
  releaseCanvas(photo)
  releaseCanvas(valid)

  const lum = new Float32Array(W * H)
  const ok = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]
    ok[i] = vd[i * 4] >= 128 && (!sd || sd[i * 4] >= 128) ? 1 : 0
  }
  // Grain: how far each pixel strays from its 5×5 neighbourhood, relative to it, counted
  // only where the whole neighbourhood is skin so feature edges don't register.
  const R = 2
  const sumL = new Float64Array((W + 1) * (H + 1))
  const sumOk = new Int32Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let rowL = 0
    let rowOk = 0
    for (let x = 0; x < W; x++) {
      rowL += lum[y * W + x]
      rowOk += ok[y * W + x]
      sumL[(y + 1) * (W + 1) + x + 1] = sumL[y * (W + 1) + x + 1] + rowL
      sumOk[(y + 1) * (W + 1) + x + 1] = sumOk[y * (W + 1) + x + 1] + rowOk
    }
  }
  const box = (t: Float64Array | Int32Array, x: number, y: number) => {
    const x0 = x - R
    const y0 = y - R
    const x1 = x + R + 1
    const y1 = y + R + 1
    return t[y1 * (W + 1) + x1] - t[y0 * (W + 1) + x1] - t[y1 * (W + 1) + x0] + t[y0 * (W + 1) + x0]
  }
  const area = (2 * R + 1) ** 2

  const top = toCrop(lms[LM.forehead]).y
  const browTop = Math.min(...BROWS.map((i) => toCrop(lms[i]).y))
  const underEye = Math.max(toCrop(lms[145]).y, toCrop(lms[374]).y) + 12 * u
  const mouth = (toCrop(lms[61]).y + toCrop(lms[291]).y) / 2
  const chin = toCrop(lms[LM.chin]).y
  const midX = toCrop(lms[LM.browCentre]).x
  const bands: [LightBand, number, number][] = [
    ['forehead', top, browTop],
    ['eyes', browTop, underEye],
    ['cheeks', underEye, mouth],
    ['jaw', mouth, chin],
  ]
  const buckets: Record<string, { lum: number[]; grain: number; grainN: number }> = {}
  for (let y = 0; y < H; y++) {
    const band = bands.find(([, y0, y1]) => y >= y0 && y < y1)
    if (!band) continue
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (!ok[i]) continue
      const side: LightSide = x < midX - 30 * u ? 'left' : x > midX + 30 * u ? 'right' : 'centre'
      const bucket = (buckets[`${band[0]}:${side}`] ??= { lum: [], grain: 0, grainN: 0 })
      bucket.lum.push(lum[i])
      if (x >= R && y >= R && x < W - R && y < H - R && box(sumOk, x, y) === area) {
        const m = box(sumL, x, y) / area
        bucket.grain += Math.abs(lum[i] - m) / Math.max(m, 8)
        bucket.grainN++
      }
    }
  }
  const region = (b: (typeof buckets)[string] | undefined): LightRegion | null => {
    if (!b || b.lum.length < 120 * u * u) return null
    b.lum.sort((p, q) => p - q)
    return { brightness: b.lum[b.lum.length >> 1], texture: b.grainN ? b.grain / b.grainN : 0 }
  }
  const out = {} as LightingAnalysis
  for (const [band] of bands) {
    out[band] = {
      left: region(buckets[`${band}:left`]),
      centre: region(buckets[`${band}:centre`]),
      right: region(buckets[`${band}:right`]),
    }
  }
  return out
}

/** Yaw/pitch in degrees from the face transformation matrix (column-major 4×4). */
function poseFromMatrix(m: Matrix): { yaw: number; pitch: number } {
  const d = m.data
  const at = (row: number, col: number) => d[col * 4 + row]
  const n0 = Math.hypot(at(0, 0), at(1, 0), at(2, 0)) || 1
  const n1 = Math.hypot(at(0, 1), at(1, 1), at(2, 1)) || 1
  const n2 = Math.hypot(at(0, 2), at(1, 2), at(2, 2)) || 1
  const r20 = at(2, 0) / n0
  const r21 = at(2, 1) / n1
  const r22 = at(2, 2) / n2
  const deg = 180 / Math.PI
  return {
    yaw: Math.asin(Math.max(-1, Math.min(1, -r20))) * deg,
    pitch: Math.atan2(r21, r22) * deg,
  }
}

function personBounds(layer: MaskLayer): MaskLayer['rect'] | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -1,
    y1 = -1
  for (let y = 0; y < layer.h; y++) {
    for (let x = 0; x < layer.w; x++) {
      if (layer.data[y * layer.w + x] > 0.5) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const sx = layer.rect.w / layer.w
  const sy = layer.rect.h / layer.h
  return { x: layer.rect.x + x0 * sx, y: layer.rect.y + y0 * sy, w: (x1 - x0 + 1) * sx, h: (y1 - y0 + 1) * sy }
}

export async function analyzePhoto(image: LoadedImage): Promise<FaceAnalysis> {
  const { face, segmenter } = await loadModels()
  const full = segmentRegion(segmenter, image, { x: 0, y: 0, w: image.width, h: image.height }, 1024)

  const small = downscale(image.canvas, 1280)
  let faces = detectFaces(face, small.canvas, { x: 0, y: 0 }, small.scale)
  releaseCanvas(small.canvas)
  if (faces.length === 0) {
    // Small faces in large photos can be missed; retry on the person's upper body.
    const body = personBounds(full)
    if (body) {
      const side = Math.min(body.w, body.h) * 1.1
      const roi = clampRect({ x: body.x + body.w / 2 - side / 2, y: body.y - side * 0.1, w: side, h: side }, image.width, image.height)
      const crop = createCanvas(roi.w, roi.h)
      ctx2d(crop).drawImage(image.canvas, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h)
      const cropSmall = downscale(crop, 1280)
      faces = detectFaces(face, cropSmall.canvas, { x: roi.x, y: roi.y }, cropSmall.scale)
      releaseCanvas(crop)
      releaseCanvas(cropSmall.canvas)
    }
  }

  if (faces.length === 0) {
    return {
      faceCount: 0,
      faces: [],
      subject: 0,
      landmarks: [],
      markers: null,
      blendshapes: {},
      pose: null,
      masks: [full],
      crownAtImageEdge: false,
      eyewear: null,
      lighting: null,
    }
  }

  faces.sort((a, b) => b.area - a.area)
  return analyzeSubject(segmenter, image, full, faces, 0)
}

/** Re-runs the per-person analysis for another detected face, reusing the detection results. */
export async function selectSubject(image: LoadedImage, analysis: FaceAnalysis, subject: number): Promise<FaceAnalysis> {
  const { segmenter } = await loadModels()
  return analyzeSubject(segmenter, image, analysis.masks[0], analysis.faces, subject)
}

function analyzeSubject(
  segmenter: ImageSegmenter,
  image: LoadedImage,
  full: MaskLayer,
  faces: DetectedFace[],
  subject: number,
): FaceAnalysis {
  const main = faces[subject]
  const lms = main.landmarks
  const forehead = lms[LM.forehead]
  const chin = lms[LM.chin]
  const faceH = Math.hypot(chin.x - forehead.x, chin.y - forehead.y)
  const eyes = midpoint(lms[LM.irisA], lms[LM.irisB])

  // Sharper mask around head and shoulders (the model works at 256×256 internally).
  const roi = clampRect({ x: eyes.x - faceH * 2.2, y: eyes.y - faceH * 2, w: faceH * 4.4, h: faceH * 4.6 }, image.width, image.height)
  const head = segmentWithSkin(segmenter, image, roi, 768, true)
  const masks = [full, head.person]
  const { crown, atEdge } = findCrown(masks, lms, image)

  const a = lms[LM.irisA]
  const b = lms[LM.irisB]
  return {
    faceCount: faces.length,
    faces,
    subject,
    landmarks: lms,
    markers: {
      crown,
      chin,
      eyeLeft: a.x < b.x ? a : b,
      eyeRight: a.x < b.x ? b : a,
      faceWidthPx: Math.hypot(lms[LM.faceRight].x - lms[LM.faceLeft].x, lms[LM.faceRight].y - lms[LM.faceLeft].y),
    },
    blendshapes: main.blendshapes,
    pose: main.matrix ? poseFromMatrix(main.matrix) : null,
    masks,
    crownAtImageEdge: atEdge,
    eyewear: analyzeEyewear(segmenter, image, lms),
    lighting: measureLighting(image, lms, head.skin),
  }
}
