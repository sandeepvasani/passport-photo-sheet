export interface LoadedImage {
  /** Working copy (EXIF-rotated, capped at MAX_WORKING_SIDE). */
  canvas: HTMLCanvasElement
  width: number
  height: number
  /** Original pixels per working pixel (≥ 1). Used for the print-resolution check. */
  scaleToOriginal: number
  originalWidth: number
  originalHeight: number
  name: string
  /**
   * Smaller, GPU-friendly copy for the interactive editor. The working canvas
   * is kept CPU-side for fast pixel reads, which makes it slow to draw every frame.
   */
  preview: ImageBitmap | HTMLCanvasElement
}

/**
 * Largest working-image side. Phones get a smaller copy: iOS Safari caps the
 * total memory all canvases may use, and a 12 MP photo plus its copies gets close.
 * 3072 px still leaves the head several hundred pixels tall in a normal photo.
 */
const MAX_WORKING_SIDE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 3072 : 4096
/** Largest side of the editor preview: enough for a sharp ~1200 px editor canvas. */
const PREVIEW_SIDE = 2048

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

/**
 * Frees a canvas's pixel memory now rather than whenever it's garbage collected.
 * Matters on iOS Safari, where exceeding the total canvas memory cap makes new
 * canvases silently refuse to draw.
 */
export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return
  canvas.width = 0
  canvas.height = 0
}

export function releaseImage(image: LoadedImage): void {
  releaseCanvas(image.canvas)
  if (image.preview instanceof HTMLCanvasElement) releaseCanvas(image.preview)
  else image.preview.close()
}

export function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error(
      'Your browser ran out of memory for images. Close other tabs, reload the page and try again. A smaller photo can also help.',
    )
  }
  return ctx
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Some browsers can decode via <img> what createImageBitmap rejects.
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

export async function loadImageFile(file: File): Promise<LoadedImage> {
  let src: ImageBitmap | HTMLImageElement
  try {
    src = await decode(file)
  } catch {
    const heic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)
    throw new Error(
      heic
        ? 'This browser can’t open HEIC photos. Use Safari, or export the photo as JPEG (on iPhone: Settings → Camera → Formats → Most Compatible).'
        : 'That file couldn’t be opened as an image. Try a JPEG or PNG.',
    )
  }
  const ow = 'naturalWidth' in src ? src.naturalWidth : src.width
  const oh = 'naturalHeight' in src ? src.naturalHeight : src.height
  const scale = Math.min(1, MAX_WORKING_SIDE / Math.max(ow, oh))
  const canvas = createCanvas(ow * scale, oh * scale)
  const ctx = ctx2d(canvas)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
  if ('close' in src) src.close()
  const preview = await makePreview(canvas)
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    scaleToOriginal: ow / canvas.width,
    originalWidth: ow,
    originalHeight: oh,
    name: file.name,
    preview,
  }
}

async function makePreview(canvas: HTMLCanvasElement): Promise<ImageBitmap | HTMLCanvasElement> {
  const scale = Math.min(1, PREVIEW_SIDE / Math.max(canvas.width, canvas.height))
  const small = createCanvas(canvas.width * scale, canvas.height * scale)
  // Default (GPU-backed) context: this canvas is only ever drawn, never read.
  const ctx = small.getContext('2d')
  if (!ctx) return canvas
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, small.width, small.height)
  try {
    const bitmap = await createImageBitmap(small)
    releaseCanvas(small)
    return bitmap
  } catch {
    return small
  }
}

/** Returns a downscaled copy whose longest side is at most `maxSide`. */
export function downscale(
  src: CanvasImageSource & { width: number; height: number },
  maxSide: number,
): { canvas: HTMLCanvasElement; scale: number } {
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height))
  const canvas = createCanvas(src.width * scale, src.height * scale)
  const ctx = ctx2d(canvas)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
  return { canvas, scale: canvas.width / src.width }
}

/**
 * Writes the print resolution into the JPEG's JFIF header so photo labs and
 * image viewers report the intended physical size (e.g. 4×6 in at 300 DPI).
 */
export function setJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const isJfif =
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[3] === 0xe0 &&
    String.fromCharCode(...bytes.subarray(6, 11)) === 'JFIF\0'
  if (isJfif) {
    const out = bytes.slice()
    out[13] = 1 // units: dots per inch
    out[14] = dpi >> 8
    out[15] = dpi & 0xff
    out[16] = dpi >> 8
    out[17] = dpi & 0xff
    return out
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  // No JFIF segment: insert one right after the SOI marker.
  const app0 = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01,
    dpi >> 8, dpi & 0xff, dpi >> 8, dpi & 0xff, 0x00, 0x00,
  ])
  const out = new Uint8Array(bytes.length + app0.length)
  out.set(bytes.subarray(0, 2), 0)
  out.set(app0, 2)
  out.set(bytes.subarray(2), 2 + app0.length)
  return out
}

export async function canvasToJpeg(canvas: HTMLCanvasElement, dpi: number, quality = 0.95): Promise<Blob> {
  // toBlob gives null when the browser can't spare the memory (common with large sheets on phones).
  const error = 'Couldn’t create the image file. Your browser may be low on memory: close other tabs and try again.'
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(error))), 'image/jpeg', quality),
  )
  const bytes = setJpegDpi(new Uint8Array(await blob.arrayBuffer()), dpi)
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })
}

/**
 * A file-size limit in KB. Limits are stored in whichever unit makes them strictest
 * (a 40 KB minimum as 40 × 1,024 bytes, a 120 KB maximum as 120,000), so both show as round numbers.
 */
export function formatKb(bytes: number): number {
  return bytes % 1024 === 0 ? bytes / 1024 : Math.round(bytes / 1000)
}

/**
 * Encodes at the highest JPEG quality whose file fits in `maxBytes` (and, when given,
 * is at least `minBytes`). Throws when no quality gives a file in that range.
 */
export async function canvasToJpegSized(canvas: HTMLCanvasElement, dpi: number, maxBytes: number, minBytes = 0): Promise<Blob> {
  const kb = formatKb
  let blob = await canvasToJpeg(canvas, dpi, 0.95)
  if (blob.size < minBytes) {
    // Plain photos can come out too small: spend more bytes on quality.
    for (const q of [0.98, 1]) {
      blob = await canvasToJpeg(canvas, dpi, q)
      if (blob.size >= minBytes) break
    }
    if (blob.size < minBytes) throw new Error(`Couldn’t make the photo as large as ${kb(minBytes)} KB`)
    if (blob.size <= maxBytes) return blob
  }
  if (blob.size <= maxBytes) return blob
  let lo = 0.3
  let hi = 0.95
  let fits: Blob | null = null
  for (let i = 0; i < 7; i++) {
    const q = (lo + hi) / 2
    const b = await canvasToJpeg(canvas, dpi, q)
    if (b.size <= maxBytes) {
      fits = b
      lo = q
    } else {
      hi = q
    }
  }
  fits ??= await canvasToJpeg(canvas, dpi, lo)
  if (fits.size > maxBytes) throw new Error(`Couldn’t make the photo smaller than ${kb(maxBytes)} KB`)
  if (fits.size < minBytes) throw new Error(`Couldn’t fit the photo between ${kb(minBytes)} and ${kb(maxBytes)} KB`)
  return fits
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
