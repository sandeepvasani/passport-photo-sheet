import { describe, expect, it } from 'vitest'
import { CANADA_50X70, INTL_35X45, PHOTO_SPECS, US_PASSPORT } from '../config/photoSpecs'
import { PRINT_SIZES, type PrintSize } from '../config/printSizes'
import { SAFE_MARGIN_MM, computeLayout, photosPerSheet, resolveMode } from './layout'

const size = (id: string): PrintSize => PRINT_SIZES.find((p) => p.id === id)!

describe('photosPerSheet', () => {
  it('fits six 2×2 photos edge-to-edge on a 4×6', () => {
    expect(photosPerSheet(US_PASSPORT, size('4x6'), 'max')).toBe(6)
  })

  it('fits eight 35×45 photos on a 4×6 by rotating them, even with margins', () => {
    expect(photosPerSheet(INTL_35X45, size('4x6'), 'max')).toBe(8)
    expect(photosPerSheet(INTL_35X45, size('4x6'), 'safe')).toBe(8)
  })

  it('fits four Canadian photos on a 4×6', () => {
    expect(photosPerSheet(CANADA_50X70, size('4x6'), 'max')).toBe(4)
  })

  it('fits six 2×2 photos with margins on a 5×7', () => {
    expect(photosPerSheet(US_PASSPORT, size('5x7'), 'safe')).toBe(6)
  })

  it('fits eight 35×45 photos on a 10 × 15 cm print', () => {
    expect(photosPerSheet(INTL_35X45, size('10x15cm'), 'max')).toBe(8)
    expect(photosPerSheet(INTL_35X45, size('10x15cm'), 'safe')).toBe(8)
  })

  it('fits six 2×2 photos on a 13 × 18 cm print', () => {
    expect(photosPerSheet(US_PASSPORT, size('13x18cm'), 'safe')).toBe(6)
  })

  it('fits twenty 2×2 photos on an 8×10', () => {
    expect(photosPerSheet(US_PASSPORT, size('8x10'), 'max')).toBe(20)
  })
})

describe('resolveMode', () => {
  it('auto keeps margins when they cost nothing', () => {
    expect(resolveMode(INTL_35X45, size('4x6'), 'auto')).toBe('safe')
  })
  it('auto goes edge-to-edge when margins would lose photos', () => {
    expect(resolveMode(US_PASSPORT, size('4x6'), 'auto')).toBe('max')
  })
})

describe('computeLayout', () => {
  for (const spec of PHOTO_SPECS) {
    for (const print of PRINT_SIZES) {
      for (const mode of ['max', 'safe'] as const) {
        it(`${spec.id} on ${print.id} (${mode}): cells stay on the sheet, inside margins, and never overlap`, () => {
          const l = computeLayout(spec, print, mode)
          const eps = 1e-6
          const margin = mode === 'safe' ? SAFE_MARGIN_MM : 0
          for (const c of l.cells) {
            expect(c.x).toBeGreaterThanOrEqual(margin - eps)
            expect(c.y).toBeGreaterThanOrEqual(margin - eps)
            expect(c.x + c.w).toBeLessThanOrEqual(l.sheetWmm - margin + eps)
            expect(c.y + c.h).toBeLessThanOrEqual(l.sheetHmm - margin + eps)
            const dims = [c.w, c.h].sort().join()
            expect(dims).toBe([spec.widthMm, spec.heightMm].sort().join())
          }
          for (let i = 0; i < l.cells.length; i++) {
            for (let j = i + 1; j < l.cells.length; j++) {
              const a = l.cells[i]
              const b = l.cells[j]
              const overlap = a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps
              expect(overlap).toBe(false)
            }
          }
        })
      }
    }
  }
})
