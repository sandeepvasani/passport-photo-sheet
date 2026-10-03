/**
 * Portrait matting with MODNet (Apache-2.0, https://github.com/ZHKKKe/MODNet),
 * run in the browser through ONNX Runtime Web. Produces a soft alpha matte that
 * keeps fine hair detail the 256×256 selfie segmenter misses. Only loaded when
 * the user replaces the background.
 */
import type { PhotoSpec } from '../config/photoSpecs'
import { frameToSource, type Crop } from './geometry'
import { createCanvas, ctx2d, releaseCanvas, type LoadedImage } from './image'
import { clampRect, makeMaskLayer, type MaskLayer } from './mask'
import { modelLoader } from './onnx'

const MODEL_FILE = 'modnet_fp16.onnx'
/** Network input size range (longest side); MODNet expects multiples of 32. */
const MIN_SIDE = 512
const MAX_SIDE = 768
/** Matte pixels per finished-photo pixel to aim for, and the minimum before re-running. */
const TARGET_DENSITY = 0.7
const MIN_DENSITY = 0.45
const OUT_PX_PER_MM = 300 / 25.4

/** Loads MODNet on first use. */
export const loadMatteModel = modelLoader(MODEL_FILE)

const roundTo32 = (v: number) => Math.max(32, Math.round(v / 32) * 32)

/** Bounding box (source pixels) of the photo frame, grown by `grow` around its centre. */
function frameBounds(crop: Crop, spec: PhotoSpec, grow: number): MaskLayer['rect'] {
  const pts = [
    { x: 0, y: 0 },
    { x: spec.widthMm, y: 0 },
    { x: 0, y: spec.heightMm },
    { x: spec.widthMm, y: spec.heightMm },
  ].map((p) => frameToSource(p, crop, spec))
  const x0 = Math.min(...pts.map((p) => p.x))
  const x1 = Math.max(...pts.map((p) => p.x))
  const y0 = Math.min(...pts.map((p) => p.y))
  const y1 = Math.max(...pts.map((p) => p.y))
  const w = (x1 - x0) * grow
  const h = (y1 - y0) * grow
  return { x: (x0 + x1 - w) / 2, y: (y0 + y1 - h) / 2, w, h }
}

/** Whether an existing matte still covers the frame at enough resolution for this crop. */
export function matteCovers(layer: MaskLayer, crop: Crop, spec: PhotoSpec, image: LoadedImage): boolean {
  const need = clampRect(frameBounds(crop, spec, 1.05), image.width, image.height)
  const r = layer.rect
  const inside = need.x >= r.x - 1 && need.y >= r.y - 1 && need.x + need.w <= r.x + r.w + 1 && need.y + need.h <= r.y + r.h + 1
  const density = layer.w / r.w / (OUT_PX_PER_MM / crop.pxPerMm)
  return inside && density >= MIN_DENSITY
}

// Inference calls are serialised; ONNX Runtime sessions don't support concurrent runs.
let queue: Promise<unknown> = Promise.resolve()

/**
 * Runs MODNet on the frame plus surrounding context (which it needs to judge
 * what is person) and returns the matte as a mask layer.
 */
export function portraitMatte(image: LoadedImage, crop: Crop, spec: PhotoSpec): Promise<MaskLayer> {
  const run = queue.then(() => runMatte(image, crop, spec))
  queue = run.catch(() => undefined)
  return run
}

async function runMatte(image: LoadedImage, crop: Crop, spec: PhotoSpec): Promise<MaskLayer> {
  const { session, ort } = await loadMatteModel()
  const rect = clampRect(frameBounds(crop, spec, 1.35), image.width, image.height)
  const outPx = (Math.max(rect.w, rect.h) * OUT_PX_PER_MM) / crop.pxPerMm
  const side = Math.min(MAX_SIDE, Math.max(MIN_SIDE, roundTo32(outPx * TARGET_DENSITY)))
  const scale = side / Math.max(rect.w, rect.h)
  const w = roundTo32(rect.w * scale)
  const h = roundTo32(rect.h * scale)

  const input = createCanvas(w, h)
  const ictx = ctx2d(input)
  ictx.imageSmoothingQuality = 'high'
  ictx.drawImage(image.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h)
  const px = ictx.getImageData(0, 0, w, h).data
  releaseCanvas(input)

  // NCHW float32, normalised to [-1, 1] (mean 0.5, std 0.5).
  const n = w * h
  const tensor = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    tensor[i] = px[i * 4] / 127.5 - 1
    tensor[n + i] = px[i * 4 + 1] / 127.5 - 1
    tensor[2 * n + i] = px[i * 4 + 2] / 127.5 - 1
  }
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, h, w]) }
  const results = await session.run(feeds)
  const out = results[session.outputNames[0]]
  const [, , oh, ow] = out.dims as number[]
  const data = new Float32Array(out.data as Float32Array)
  out.dispose?.()
  return makeMaskLayer(data, ow, oh, rect, 'matte')
}
