import type { PhotoSpec } from '../config/photoSpecs'
import { sourceToFrame, sourceToOutputTransform, type Crop, type Point } from './geometry'
import { createCanvas, ctx2d, type LoadedImage } from './image'
import { guidedFilter, hexToRgb, keepConnected, levels, replaceBackground, toPlanes } from './matting'
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

/**
 * Renders the finished passport photo at `dpi`, optionally replacing the background.
 * `subject` (source pixels, e.g. between the eyes) anchors the matte so only the
 * region connected to the person is kept.
 */
export function renderPhoto(
  image: LoadedImage,
  masks: MaskLayer[],
  crop: Crop,
  spec: PhotoSpec,
  bg: BackgroundSettings,
  dpi: number,
  subject?: Point,
): RenderedPhoto {
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
  const coarse = new Float32Array(W * H)
  for (let i = 0; i < coarse.length; i++) coarse[i] = md[i * 4] / 255

  const img = ctx.getImageData(0, 0, W, H)
  const scale = dpi / 300
  const shift = bg.expand * 0.3
  let alpha: Float32Array
  let radius: number
  if (masks.some((m) => m.kind === 'matte')) {
    // A true matte already has soft hair edges: only snap it lightly to the
    // full-resolution image and trim faint noise, so thin strands survive.
    radius = Math.round(bg.feather * 0.4 * scale)
    const refined = radius > 0 ? guidedFilter(toPlanes(img.data), coarse, W, H, radius, 1e-4) : coarse
    alpha = levels(refined, 0.05 - shift, 0.95 - shift)
  } else {
    // Coarse segmentation: snap edges to the image and harden the transition.
    radius = Math.max(1, Math.round(bg.feather * scale))
    const refined = guidedFilter(toPlanes(img.data), coarse, W, H, radius, 2e-3)
    alpha = levels(refined, 0.25 - shift, 0.75 - shift)
  }
  if (subject) {
    const s = sourceToFrame(subject, crop, spec)
    alpha = keepConnected(alpha, W, H, s.x * k, s.y * k, Math.max(2, radius * 2))
  }

  if (bg.mode === 'replace') {
    replaceBackground(img.data, alpha, W, H, hexToRgb(bg.color), Math.max(8, radius * 3))
    ctx.putImageData(img, 0, 0)
  }
  return { canvas, alpha, width: W, height: H, pxPerMm: k }
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
