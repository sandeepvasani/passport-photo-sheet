import { createCanvas, ctx2d } from './image'

/** Person-probability mask covering a rectangle of the working image. */
export interface MaskLayer {
  /** Mask as an opaque greyscale image, for drawing through canvas transforms. */
  canvas: HTMLCanvasElement
  data: Float32Array
  w: number
  h: number
  /** Area of the working image (in working pixels) the mask covers. */
  rect: { x: number; y: number; w: number; h: number }
  /** 'segmentation' masks are coarse and need edge snapping; 'matte' is a true alpha matte. */
  kind: 'segmentation' | 'matte'
}

export function makeMaskLayer(data: Float32Array, w: number, h: number, rect: MaskLayer['rect'], kind: MaskLayer['kind']): MaskLayer {
  const canvas = createCanvas(w, h)
  const ctx = ctx2d(canvas)
  const img = ctx.createImageData(w, h)
  for (let i = 0; i < data.length; i++) {
    const v = Math.round(Math.min(1, Math.max(0, data[i])) * 255)
    img.data[i * 4] = v
    img.data[i * 4 + 1] = v
    img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return { canvas, data, w, h, rect, kind }
}

export function clampRect(r: MaskLayer['rect'], W: number, H: number): MaskLayer['rect'] {
  const x = Math.max(0, Math.floor(r.x))
  const y = Math.max(0, Math.floor(r.y))
  return { x, y, w: Math.min(W, Math.ceil(r.x + r.w)) - x, h: Math.min(H, Math.ceil(r.y + r.h)) - y }
}
