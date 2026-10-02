import type { PhotoSpec } from '../config/photoSpecs'
import { createCanvas, ctx2d } from './image'
import type { SheetLayout } from './layout'

export interface SheetOptions {
  cutGuides: boolean
}

/** Draws the print sheet: photos tiled per `layout`, cut guides, and a scale bar when space allows. */
export function renderSheet(
  photo: HTMLCanvasElement,
  layout: SheetLayout,
  spec: PhotoSpec,
  opts: SheetOptions,
  dpi: number,
): HTMLCanvasElement {
  const k = dpi / 25.4
  const W = Math.round(layout.sheetWmm * k)
  const H = Math.round(layout.sheetHmm * k)
  const canvas = createCanvas(W, H)
  const ctx = ctx2d(canvas)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.imageSmoothingQuality = 'high'

  const px = layout.cells.map((c) => {
    const x = Math.round(c.x * k)
    const y = Math.round(c.y * k)
    return { x, y, w: Math.round((c.x + c.w) * k) - x, h: Math.round((c.y + c.h) * k) - y, rotated: c.rotated }
  })

  for (const c of px) {
    if (c.rotated) {
      ctx.save()
      ctx.translate(c.x + c.w, c.y)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(photo, 0, 0, c.h, c.w)
      ctx.restore()
    } else {
      ctx.drawImage(photo, c.x, c.y, c.w, c.h)
    }
  }

  const line = Math.max(1, Math.round(dpi / 300))
  const free = layout.freeBottom
  const showScaleBar = free.h >= 6
  if (opts.cutGuides) {
    ctx.strokeStyle = '#a8a8a8'
    ctx.lineWidth = line
    for (const c of px) ctx.strokeRect(c.x + line / 2, c.y + line / 2, c.w - line, c.h - line)

    // Crop marks running from each cut line out to the paper edge, for use with a trimmer.
    if (layout.marginMm >= 2) {
      const xs = new Set(px.flatMap((c) => [c.x, c.x + c.w]))
      const ys = new Set(px.flatMap((c) => [c.y, c.y + c.h]))
      const top = Math.min(...px.map((c) => c.y))
      const bottom = Math.max(...px.map((c) => c.y + c.h))
      const left = Math.min(...px.map((c) => c.x))
      const right = Math.max(...px.map((c) => c.x + c.w))
      const gap = Math.round(0.8 * k)
      ctx.beginPath()
      for (const x of xs) {
        ctx.moveTo(x, 0)
        ctx.lineTo(x, top - gap)
        // The scale bar's label sits below the photos; the top marks already show these cuts.
        if (!showScaleBar) {
          ctx.moveTo(x, bottom + gap)
          ctx.lineTo(x, Math.min(H, bottom + gap + 3 * k))
        }
      }
      for (const y of ys) {
        ctx.moveTo(0, y)
        ctx.lineTo(left - gap, y)
        ctx.moveTo(right + gap, y)
        ctx.lineTo(W, y)
      }
      ctx.stroke()
    }
  }

  // Scale bar so the user can confirm the lab printed at 100%.
  if (showScaleBar) {
    const barMm = spec.displayUnit === 'in' ? 25.4 : 25
    const barLabel = spec.displayUnit === 'in' ? '1 inch' : '25 mm'
    const cy = (free.y + free.h / 2) * k
    const x0 = Math.max(layout.marginMm, 4) * k
    const x1 = x0 + barMm * k
    const tick = 1.2 * k
    ctx.strokeStyle = '#333'
    ctx.lineWidth = Math.max(1, Math.round(0.25 * k))
    ctx.beginPath()
    ctx.moveTo(x0, cy)
    ctx.lineTo(x1, cy)
    ctx.moveTo(x0, cy - tick)
    ctx.lineTo(x0, cy + tick)
    ctx.moveTo(x1, cy - tick)
    ctx.lineTo(x1, cy + tick)
    ctx.stroke()
    ctx.fillStyle = '#333'
    ctx.font = `${Math.round(2.2 * k)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
    ctx.textBaseline = 'middle'
    const name = spec.label.includes(spec.sizeLabel) ? spec.label : `${spec.label} ${spec.sizeLabel}`
    const text = `← should measure exactly ${barLabel}  ·  ${name}  ·  cut along the grey lines`
    ctx.fillText(text, x1 + 2 * k, cy, W - x1 - 4 * k)
  }
  return canvas
}
