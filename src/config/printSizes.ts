/**
 * Standard photo print sizes offered by photo labs, pharmacies and online print
 * services. Inch sizes are the norm in North America; most other countries use
 * metric sizes, which are close to but not the same as their inch counterparts
 * (10 × 15 cm is 1.6% smaller than 4 × 6 in), so both are offered.
 * Dimensions are portrait (width ≤ height); the layout engine rotates photos as needed.
 */
export interface PrintSize {
  id: string
  /** Label including its unit, e.g. "4 × 6 in" or "10 × 15 cm". */
  label: string
  unit: 'in' | 'cm'
  widthIn: number
  heightIn: number
}

const inches = (id: string, w: number, h: number, label = `${w} × ${h}`): PrintSize => ({
  id,
  label: `${label} in`,
  unit: 'in',
  widthIn: w,
  heightIn: h,
})

const cm = (w: number, h: number): PrintSize => ({
  id: `${w}x${h}cm`,
  label: `${w} × ${h} cm`,
  unit: 'cm',
  widthIn: w / 2.54,
  heightIn: h / 2.54,
})

export const PRINT_SIZES: PrintSize[] = [
  inches('4x4', 4, 4),
  inches('4x5.3', 4, 16 / 3, '4 × 5.3'),
  inches('4x6', 4, 6),
  inches('5x7', 5, 7),
  inches('6x8', 6, 8),
  inches('8x8', 8, 8),
  inches('8x10', 8, 10),
  cm(10, 15),
  cm(13, 18),
  cm(15, 20),
  cm(20, 30),
]

export const DEFAULT_PRINT_SIZE_ID = '4x6'

/** Print resolution used for every exported file (the standard for photo labs). */
export const PRINT_DPI = 300
