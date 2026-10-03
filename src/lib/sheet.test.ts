import { describe, expect, it } from 'vitest'
import { INTL_35X45, US_PASSPORT } from '../config/photoSpecs'
import { scaleBarLabel } from './sheet'

describe('scaleBarLabel', () => {
  it('names the photo type and points to the cut lines', () => {
    expect(scaleBarLabel(US_PASSPORT, true)).toBe('← should measure exactly 1 inch  ·  US Passport / Visa 2 × 2 in  ·  cut along the grey lines')
    expect(scaleBarLabel(INTL_35X45, true)).toBe('← should measure exactly 25 mm  ·  35 × 45 mm Passport  ·  cut along the grey lines')
  })

  it('leaves out the cut lines when they aren’t drawn', () => {
    expect(scaleBarLabel(US_PASSPORT, false)).toBe('← should measure exactly 1 inch  ·  US Passport / Visa 2 × 2 in')
  })
})
