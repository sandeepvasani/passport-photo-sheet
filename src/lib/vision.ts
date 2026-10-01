import { FaceLandmarker, FilesetResolver, ImageSegmenter, type Matrix } from '@mediapipe/tasks-vision'
import { midpoint, type Markers, type Point } from './geometry'
import { createCanvas, ctx2d, downscale, type LoadedImage } from './image'
import { clampRect, makeMaskLayer, type MaskLayer } from './mask'

export type { MaskLayer } from './mask'

export interface FaceAnalysis {
  faceCount: number
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
          numFaces: 3,
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

interface DetectedFace {
  landmarks: Point[]
  blendshapes: Record<string, number>
  matrix?: Matrix
  area: number
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
    }
  })
}

function segmentRegion(
  segmenter: ImageSegmenter,
  image: LoadedImage,
  rect: MaskLayer['rect'],
  maxSide: number,
): MaskLayer {
  const s = Math.min(1, maxSide / Math.max(rect.w, rect.h))
  const input = createCanvas(rect.w * s, rect.h * s)
  const ictx = ctx2d(input)
  ictx.imageSmoothingQuality = 'high'
  ictx.drawImage(image.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, input.width, input.height)

  const result = segmenter.segment(input)
  const bgIndex = Math.max(0, segmenter.getLabels().indexOf('background'))
  const bgMask = result.confidenceMasks?.[bgIndex]
  if (!bgMask) {
    result.close()
    throw new Error('Segmentation returned no mask')
  }
  const w = bgMask.width
  const h = bgMask.height
  const bg = bgMask.getAsFloat32Array()
  const data = new Float32Array(w * h)
  for (let i = 0; i < data.length; i++) data[i] = 1 - bg[i]
  result.close()
  return makeMaskLayer(data, w, h, rect, 'segmentation')
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
function findCrown(
  layers: MaskLayer[],
  lms: Point[],
  image: LoadedImage,
): { crown: Point; atEdge: boolean } {
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
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
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
  if (faces.length === 0) {
    // Small faces in large photos can be missed; retry on the person's upper body.
    const body = personBounds(full)
    if (body) {
      const side = Math.min(body.w, body.h) * 1.1
      const roi = clampRect(
        { x: body.x + body.w / 2 - side / 2, y: body.y - side * 0.1, w: side, h: side },
        image.width,
        image.height,
      )
      const crop = createCanvas(roi.w, roi.h)
      ctx2d(crop).drawImage(image.canvas, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h)
      const cropSmall = downscale(crop, 1280)
      faces = detectFaces(face, cropSmall.canvas, { x: roi.x, y: roi.y }, cropSmall.scale)
    }
  }

  if (faces.length === 0) {
    return {
      faceCount: 0,
      landmarks: [],
      markers: null,
      blendshapes: {},
      pose: null,
      masks: [full],
      crownAtImageEdge: false,
    }
  }

  faces.sort((a, b) => b.area - a.area)
  const main = faces[0]
  const lms = main.landmarks
  const forehead = lms[LM.forehead]
  const chin = lms[LM.chin]
  const faceH = Math.hypot(chin.x - forehead.x, chin.y - forehead.y)
  const eyes = midpoint(lms[LM.irisA], lms[LM.irisB])

  // Sharper mask around head and shoulders (the model works at 256×256 internally).
  const roi = clampRect(
    { x: eyes.x - faceH * 2.2, y: eyes.y - faceH * 2, w: faceH * 4.4, h: faceH * 4.6 },
    image.width,
    image.height,
  )
  const masks = [full, segmentRegion(segmenter, image, roi, 768)]
  const { crown, atEdge } = findCrown(masks, lms, image)

  const a = lms[LM.irisA]
  const b = lms[LM.irisB]
  return {
    faceCount: faces.length,
    landmarks: lms,
    markers: {
      crown,
      chin,
      eyeLeft: a.x < b.x ? a : b,
      eyeRight: a.x < b.x ? b : a,
    },
    blendshapes: main.blendshapes,
    pose: main.matrix ? poseFromMatrix(main.matrix) : null,
    masks,
    crownAtImageEdge: atEdge,
  }
}

/** Starting markers for manual placement when no face is detected. */
export function defaultMarkers(image: LoadedImage): Markers {
  const { width: w, height: h } = image
  const s = Math.min(w, h)
  return {
    crown: { x: w / 2, y: h * 0.4 - s * 0.3 },
    chin: { x: w / 2, y: h * 0.4 + s * 0.2 },
    eyeLeft: { x: w / 2 - s * 0.08, y: h * 0.4 },
    eyeRight: { x: w / 2 + s * 0.08, y: h * 0.4 },
  }
}
