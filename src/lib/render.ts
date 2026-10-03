import type { PhotoSpec } from '../config/photoSpecs'
import { sourceToFrame, sourceToOutputTransform, type Crop, type Point } from './geometry'
import { createCanvas, ctx2d, releaseCanvas, type LoadedImage } from './image'
import { hexToRgb, refineMatte, type RefineInput } from './matting'
import type { MaskLayer } from './mask'

export interface BackgroundSettings {
  mode: 'original' | 'replace'
  color: string
  /** Edge-refinement radius in pixels at 300 DPI. */
  feather: number
  /** −1 (tighten around the subject) … +1 (expand into the background). */
  expand: number
}

export interface RenderedPhoto {
  canvas: HTMLCanvasElement
  /** Refined person matte at output resolution (0 = background, 1 = person). */
  alpha: Float32Array
  width: number
  height: number
  /** Output pixels per millimetre. */
  pxPerMm: number
}

/** A render that a newer one replaced before it started; its result isn't needed. */
export class Superseded extends Error {
  constructor() {
    super('Replaced by a newer render')
  }
}

interface Refined {
  rgba: Uint8ClampedArray<ArrayBuffer>
  alpha: Float32Array
}

// The edge refinement runs in a worker, one job at a time. undefined: not started yet; null: unavailable.
let worker: Worker | null | undefined
let call: { id: number; resolve: (r: Refined) => void; reject: (e: Error) => void } | null = null
let lastId = 0
let running = false
const queue: { input: RefineInput; replaceable: boolean; resolve: (r: Refined) => void; reject: (e: Error) => void }[] = []

/** Thrown when the worker itself can't run, so the job is done on the main thread instead. */
class WorkerUnavailable extends Error {}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./refine.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; error?: string } & Refined>) => {
      if (!call || e.data.id !== call.id) return
      const { resolve, reject } = call
      call = null
      if (e.data.error) reject(new Error(e.data.error))
      else resolve({ rgba: e.data.rgba, alpha: e.data.alpha })
    }
    worker.onerror = (e) => {
      // It didn't load (an old browser, say): do the work on the main thread from now on.
      e.preventDefault()
      worker = null
      call?.reject(new WorkerUnavailable())
      call = null
    }
  } catch {
    worker = null
  }
  return worker
}

async function runJob(input: RefineInput): Promise<Refined> {
  const w = getWorker()
  if (w) {
    try {
      // Copied rather than transferred, so the input is still here if the worker fails.
      return await new Promise<Refined>((resolve, reject) => {
        call = { id: ++lastId, resolve, reject }
        w.postMessage({ id: call.id, input })
      })
    } catch (err) {
      if (!(err instanceof WorkerUnavailable)) throw err
    }
  }
  return { rgba: input.rgba, alpha: refineMatte(input) }
}

/**
 * Refines off the main thread. A `replaceable` job (a render for the screen) that hasn't
 * started yet is dropped for a newer one, say while a slider moves, and rejects with Superseded.
 */
function refine(input: RefineInput, replaceable: boolean): Promise<Refined> {
  return new Promise((resolve, reject) => {
    if (replaceable) {
      for (const job of queue.filter((j) => j.replaceable)) {
        queue.splice(queue.indexOf(job), 1)
        job.reject(new Superseded())
      }
    }
    queue.push({ input, replaceable, resolve, reject })
    pump()
  })
}

function pump() {
  const job = running ? undefined : queue.shift()
  if (!job) return
  running = true
  runJob(job.input)
    .then(job.resolve, job.reject)
    .finally(() => {
      running = false
      pump()
    })
}

/**
 * Renders the finished passport photo at `dpi`, optionally replacing the background.
 * `subject` (source pixels, e.g. between the eyes) anchors the matte so only the
 * region connected to the person is kept. With `replaceable` (renders for the screen), it
 * rejects with Superseded if a newer replaceable render is asked for before it starts.
 */
export async function renderPhoto(
  image: LoadedImage,
  masks: MaskLayer[],
  crop: Crop,
  spec: PhotoSpec,
  bg: BackgroundSettings,
  dpi: number,
  subject?: Point,
  { replaceable = false } = {},
): Promise<RenderedPhoto> {
  const k = dpi / 25.4
  const W = Math.round(spec.widthMm * k)
  const H = Math.round(spec.heightMm * k)
  const T = sourceToOutputTransform(crop, spec, k)

  const canvas = createCanvas(W, H)
  const ctx = ctx2d(canvas)
  ctx.fillStyle = bg.mode === 'replace' ? bg.color : '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.setTransform(...T)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image.canvas, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  // Coarse matte, resampled through the same transform; later layers are sharper.
  const maskCanvas = createCanvas(W, H)
  const mctx = ctx2d(maskCanvas)
  mctx.fillStyle = '#000'
  mctx.fillRect(0, 0, W, H)
  mctx.setTransform(...T)
  mctx.imageSmoothingEnabled = true
  mctx.imageSmoothingQuality = 'high'
  for (const layer of masks) {
    mctx.drawImage(layer.canvas, layer.rect.x, layer.rect.y, layer.rect.w, layer.rect.h)
  }
  const md = mctx.getImageData(0, 0, W, H).data
  releaseCanvas(maskCanvas)
  const coarse = new Float32Array(W * H)
  for (let i = 0; i < coarse.length; i++) coarse[i] = md[i * 4] / 255

  const s = subject && sourceToFrame(subject, crop, spec)
  let refined: Refined
  try {
    refined = await refine(
      {
        rgba: ctx.getImageData(0, 0, W, H).data,
        coarse,
        width: W,
        height: H,
        matte: masks.some((m) => m.kind === 'matte'),
        feather: bg.feather,
        scale: dpi / 300,
        expand: bg.expand,
        seed: s && { x: s.x * k, y: s.y * k },
        replaceWith: bg.mode === 'replace' ? hexToRgb(bg.color) : undefined,
      },
      replaceable,
    )
  } catch (err) {
    releaseCanvas(canvas)
    throw err
  }
  if (bg.mode === 'replace') ctx.putImageData(new ImageData(refined.rgba, W, H), 0, 0)
  return { canvas, alpha: refined.alpha, width: W, height: H, pxPerMm: k }
}

/** Draws just the cropped source (no matting) — used for quick previews. */
export function renderCrop(image: LoadedImage, crop: Crop, spec: PhotoSpec, pxPerMm: number): HTMLCanvasElement {
  const canvas = createCanvas(spec.widthMm * pxPerMm, spec.heightMm * pxPerMm)
  const ctx = ctx2d(canvas)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(...sourceToOutputTransform(crop, spec, pxPerMm))
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image.canvas, 0, 0)
  return canvas
}
