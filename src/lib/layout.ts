import type { PhotoSpec } from '../config/photoSpecs'
import type { PrintSize } from '../config/printSizes'

export type LayoutMode = 'auto' | 'max' | 'safe'

/** Margin kept clear on every edge in "safe" mode, so printer trimming never touches a photo. */
export const SAFE_MARGIN_MM = 3.2

export interface Cell {
  /** Top-left corner and size on the sheet, in mm. */
  x: number
  y: number
  w: number
  h: number
  /** Photo rotated 90° to fit more on the sheet. */
  rotated: boolean
}

export interface SheetLayout {
  sheetWmm: number
  sheetHmm: number
  cells: Cell[]
  marginMm: number
  mode: Exclude<LayoutMode, 'auto'>
  /** Empty strip below the photos, usable for the label and scale bar. */
  freeBottom: { y: number; h: number }
}

const IN = 25.4
const EPS = 1e-6

interface Candidate {
  cells: Cell[]
  rotatedCount: number
}

function grid(x0: number, y0: number, availW: number, availH: number, w: number, h: number, rotated: boolean) {
  const cols = Math.floor((availW + EPS) / w)
  const rows = Math.floor((availH + EPS) / h)
  const cells: Cell[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells.push({ x: x0 + c * w, y: y0 + r * h, w, h, rotated })
  }
  return { cells, usedW: cols * w, usedH: rows * h }
}

/** Main grid in one orientation plus the leftover strip filled with the other orientation. */
function pack(availW: number, availH: number, pw: number, ph: number, rotated: boolean): Candidate[] {
  const main = grid(0, 0, availW, availH, pw, ph, rotated)
  const out: Candidate[] = [{ cells: main.cells, rotatedCount: rotated ? main.cells.length : 0 }]
  if (main.cells.length === 0) return out
  // Fill the strip below the grid with the photo turned the other way.
  const below = grid(0, main.usedH, availW, availH - main.usedH, ph, pw, !rotated)
  // Or fill the strip to the right.
  const right = grid(main.usedW, 0, availW - main.usedW, availH, ph, pw, !rotated)
  for (const extra of [below, right]) {
    if (extra.cells.length === 0) continue
    const cells = [...main.cells, ...extra.cells]
    out.push({ cells, rotatedCount: cells.filter((c) => c.rotated).length })
  }
  return out
}

function bestPack(spec: PhotoSpec, sheetW: number, sheetH: number, margin: number): Candidate {
  const availW = sheetW - 2 * margin
  const availH = sheetH - 2 * margin
  const candidates = [
    ...pack(availW, availH, spec.widthMm, spec.heightMm, false),
    ...pack(availW, availH, spec.heightMm, spec.widthMm, true),
  ]
  candidates.sort((a, b) => b.cells.length - a.cells.length || a.rotatedCount - b.rotatedCount)
  return candidates[0]
}

export function photosPerSheet(spec: PhotoSpec, print: PrintSize, mode: Exclude<LayoutMode, 'auto'>): number {
  const margin = mode === 'safe' ? SAFE_MARGIN_MM : 0
  return bestPack(spec, print.widthIn * IN, print.heightIn * IN, margin).cells.length
}

/** "auto" keeps safe margins whenever they don't cost any photos. */
export function resolveMode(spec: PhotoSpec, print: PrintSize, mode: LayoutMode): Exclude<LayoutMode, 'auto'> {
  if (mode !== 'auto') return mode
  return photosPerSheet(spec, print, 'safe') >= photosPerSheet(spec, print, 'max') ? 'safe' : 'max'
}

export function computeLayout(spec: PhotoSpec, print: PrintSize, requested: LayoutMode): SheetLayout {
  const mode = resolveMode(spec, print, requested)
  const sheetWmm = print.widthIn * IN
  const sheetHmm = print.heightIn * IN
  const margin = mode === 'safe' ? SAFE_MARGIN_MM : 0
  const { cells } = bestPack(spec, sheetWmm, sheetHmm, margin)

  // Centre the block horizontally, keep it at the top so spare space collects at the bottom.
  const right = Math.max(0, ...cells.map((c) => c.x + c.w))
  const bottom = Math.max(0, ...cells.map((c) => c.y + c.h))
  const dx = (sheetWmm - right) / 2
  const dy = margin
  const placed = cells.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy }))
  const blockBottom = bottom + dy
  return {
    sheetWmm,
    sheetHmm,
    cells: placed,
    marginMm: margin,
    mode,
    freeBottom: { y: blockBottom, h: sheetHmm - blockBottom },
  }
}
