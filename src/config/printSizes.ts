/**
 * Walgreens "Prints & Enlargements" sizes (https://photo.walgreens.com/store/prints).
 * Dimensions are portrait (width ≤ height); the layout engine rotates photos as needed.
 */
export interface PrintSize {
  id: string
  label: string
  widthIn: number
  heightIn: number
}

export const PRINT_SIZES: PrintSize[] = [
  { id: '4x4', label: '4 × 4', widthIn: 4, heightIn: 4 },
  { id: '4x5.3', label: '4 × 5.3', widthIn: 4, heightIn: 16 / 3 },
  { id: '4x6', label: '4 × 6', widthIn: 4, heightIn: 6 },
  { id: '5x7', label: '5 × 7', widthIn: 5, heightIn: 7 },
  { id: '6x8', label: '6 × 8', widthIn: 6, heightIn: 8 },
  { id: '8x8', label: '8 × 8', widthIn: 8, heightIn: 8 },
  { id: '8x10', label: '8 × 10', widthIn: 8, heightIn: 10 },
]

export const DEFAULT_PRINT_SIZE_ID = '4x6'

/** Print resolution used for every exported file. */
export const PRINT_DPI = 300

export const WALGREENS_PRINTS_URL = 'https://photo.walgreens.com/store/prints'
