import { describe, expect, it } from 'vitest'
import { PHOTO_SPECS } from './photoSpecs'

describe('PHOTO_SPECS', () => {
  it('upload sizes have the same shape as the photo, so they render to the exact pixel size', () => {
    for (const spec of PHOTO_SPECS) {
      if (!spec.digital) continue
      const k = spec.digital.widthPx / spec.widthMm
      expect(Math.round(spec.widthMm * k)).toBe(spec.digital.widthPx)
      expect(Math.round(spec.heightMm * k)).toBe(spec.digital.heightPx)
    }
  })

  it('related photo types exist', () => {
    for (const spec of PHOTO_SPECS) {
      if (spec.related) expect(PHOTO_SPECS.map((s) => s.id)).toContain(spec.related.specId)
    }
  })
})
