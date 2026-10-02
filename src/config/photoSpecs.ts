/**
 * Passport photo specifications. Each entry is pure data — add a country by
 * appending another object to PHOTO_SPECS.
 *
 * All measurements are in millimetres. "Head height" is measured from the
 * bottom of the chin to the top of the head (including hair), which is how the
 * US State Department, IRCC (Canada) and ICAO-based specs define it.
 */

export interface Range {
  min: number
  max: number
  /** Preferred value for auto-fit; defaults to the midpoint. */
  target?: number
}

export interface BackgroundSwatch {
  id: string
  label: string
  color: string
}

export interface Attestation {
  id: string
  label: string
}

/** File rules for uploading the photo to an online application form. */
export interface DigitalUpload {
  /** Exact size in pixels (same shape as the photo). */
  widthPx: number
  heightPx: number
  /** Largest file accepted, in bytes. */
  maxBytes: number
}

export interface PhotoSpec {
  id: string
  label: string
  sizeLabel: string
  countries: string
  /** Unit used when showing measurements to the user. */
  displayUnit: 'in' | 'mm'
  widthMm: number
  heightMm: number
  headHeightMm: Range
  /** Eye line measured up from the bottom edge of the photo. */
  eyeFromBottomMm?: Range
  /** Whether the eye line is an official requirement (fail) or only a positioning guideline (warning). */
  eyeLineRequired?: boolean
  /** Space between the top of the head and the top edge (layout guideline, warning only). */
  topMarginMm?: Range
  backgrounds: BackgroundSwatch[]
  /** Darkest average background luminance (0–255) that still reads as "light / white". */
  backgroundMinLuminance: number
  glasses: 'forbidden' | 'discouraged' | 'allowed'
  /** Spec-specific wording for the glasses rule: the summary on the Upload step, and the warning when glasses are detected. */
  glassesNote?: { summary: string; detected: string }
  /** Clothing must be coloured: white clothes blend into a white background. */
  requiresColouredClothing?: boolean
  /** Every spec needs the mouth closed; some also allow a smile. */
  expression: 'smile-mouth-closed' | 'neutral'
  /** Shown when the background has been replaced: the issuer's rule on edited photos. */
  editingPolicy: string
  /** Print size most people applying with this document can order locally (see printSizes.ts). */
  defaultPrintSizeId: string
  attestations: Attestation[]
  notes: string[]
  sourceUrl?: string
  /** When set, the digital download is made to these rules instead of at print resolution. */
  digital?: DigitalUpload
  /** Another photo type people applying with this one often need too. */
  related?: { specId: string; prompt: string }
}

const WHITE: BackgroundSwatch = { id: 'white', label: 'White', color: '#ffffff' }

const RECENT: Attestation = { id: 'recent', label: 'The photo was taken in the last 6 months' }
const NO_FILTERS: Attestation = {
  id: 'filters',
  label: 'No filters, retouching or AI edits to my face',
}
const HEADWEAR: Attestation = {
  id: 'headwear',
  label: 'No hat or head covering (unless worn daily for religious or medical reasons)',
}
const FACE_VISIBLE: Attestation = {
  id: 'face-visible',
  label: 'Nothing covers my face: no mask, and hair isn’t covering my eyes',
}

export const US_PASSPORT: PhotoSpec = {
  id: 'us-2x2',
  label: 'US Passport / Visa',
  sizeLabel: '2 × 2 in',
  countries: 'United States passport, passport card and visa',
  displayUnit: 'in',
  widthMm: 50.8,
  heightMm: 50.8,
  headHeightMm: { min: 25.4, max: 34.925 },
  // Not on the current State Department page, but the long-standing photo template uses it.
  eyeFromBottomMm: { min: 28.575, max: 34.925 },
  eyeLineRequired: false,
  topMarginMm: { min: 1.5, max: 12 },
  backgrounds: [WHITE, { id: 'offwhite', label: 'Off-white', color: '#f4f4f0' }],
  backgroundMinLuminance: 222,
  glasses: 'forbidden',
  expression: 'smile-mouth-closed',
  editingPolicy:
    'The State Department asks for the original, unedited photo. It says not to change photos with software, apps, filters or AI, lists a digitally replaced background as unacceptable, and checks photos for AI edits.',
  defaultPrintSizeId: '4x6',
  attestations: [
    RECENT,
    { id: 'glasses', label: 'I’m not wearing glasses, and none are resting on my head' },
    {
      id: 'headwear',
      label: 'No hat or head covering, unless worn daily for religious or medical reasons (include a signed statement)',
    },
    FACE_VISIBLE,
    { id: 'devices', label: 'No headphones, earbuds or wireless devices' },
    { id: 'attire', label: 'No uniform, uniform-like clothing or camouflage' },
    NO_FILTERS,
  ],
  notes: [
    'Glasses aren’t allowed, except with a signed note from your doctor.',
    'If your background isn’t plain white or off-white, the State Department’s advice is to fix it and take a new photo. Hanging a white sheet over a wall works well.',
    'Print on matte or glossy photo paper. Photocopies and scanned photos aren’t accepted.',
  ],
  sourceUrl: 'https://travel.state.gov/en/passports/apply/help/photos.html',
}

export const INDIA_2X2: PhotoSpec = {
  id: 'in-2x2',
  label: 'India Passport / Visa / OCI',
  sizeLabel: '2 × 2 in',
  countries: 'Indian passport, visa and OCI applications through VFS Global (USA)',
  displayUnit: 'in',
  widthMm: 50.8,
  heightMm: 50.8,
  headHeightMm: { min: 25.4, max: 34.925 },
  // The VFS sheet says "1 1/8 to 1 1/3 in"; 1 1/3 is the stricter reading and also satisfies 1 3/8.
  eyeFromBottomMm: { min: 28.575, max: 33.867 },
  eyeLineRequired: true,
  topMarginMm: { min: 1.5, max: 12 },
  backgrounds: [WHITE],
  backgroundMinLuminance: 222,
  glasses: 'allowed',
  requiresColouredClothing: true,
  expression: 'smile-mouth-closed',
  editingPolicy: 'India’s photo guidelines say not to retouch, enhance or soften the photo.',
  defaultPrintSizeId: '4x6',
  attestations: [
    RECENT,
    {
      id: 'glasses',
      label: 'If I wear glasses: clear lenses, no glare or reflections, and the frames don’t cover my eyes',
    },
    {
      id: 'headwear',
      label: 'No head covering, unless worn for religious reasons with the face visible from chin to forehead and both edges',
    },
    FACE_VISIBLE,
    { id: 'attire', label: 'Plain coloured clothing (for example a medium blue shirt), not patterned or pure white' },
    NO_FILTERS,
  ],
  notes: [
    'Print on thin photo paper. The print must be clear, with no visible pixels or dot patterns.',
    'Rules are relaxed for children under 10 (head size and eye position) and babies under one (eyes needn’t be open). The child must be alone in the photo, with the mouth closed.',
  ],
  sourceUrl: 'https://visa.vfsglobal.com/one-pager/india/united-states-of-america/passport-services/pdf/photo-specifiation.pdf',
  related: {
    specId: 'in-online',
    prompt: 'Applying for a passport, PCC, passport surrender or GEP? The Passport Seva portal also needs an uploaded 630 × 810 px photo.',
  },
}

export const INDIA_ONLINE: PhotoSpec = {
  ...INDIA_2X2,
  id: 'in-online',
  label: 'India Online Upload',
  sizeLabel: '35 × 45 mm',
  countries: 'Photo upload on the Passport Seva portal (GPSP 2.0) for passport, PCC, surrender and GEP applications: 630 × 810 px',
  displayUnit: 'mm',
  widthMm: 35,
  heightMm: 45,
  // "The face takes up 80–85% of the photograph", read as the head's share of the photo height.
  headHeightMm: { min: 36, max: 38.25, target: 37 },
  eyeFromBottomMm: undefined,
  eyeLineRequired: false,
  topMarginMm: { min: 1.5, max: 5, target: 3 },
  glasses: 'discouraged',
  glassesNote: {
    summary: 'Take them off (to avoid reflections)',
    detected: 'Glasses detected. India’s guidelines ask you to take glasses off to avoid reflections, so retake the photo without them.',
  },
  editingPolicy: 'India’s guidelines say the photo must be unaltered by computer software.',
  attestations: [
    RECENT,
    { id: 'glasses', label: 'I’m not wearing glasses' },
    { id: 'distance', label: 'Taken from about 1.5 m (5 ft) away, not as a close-up selfie' },
    {
      id: 'headwear',
      label: 'No head covering, unless worn for religious reasons with the face visible from chin to forehead and both edges',
    },
    FACE_VISIBLE,
    { id: 'attire', label: 'Plain coloured clothing (for example a medium blue shirt), not patterned or pure white' },
    NO_FILTERS,
  ],
  notes: [
    'Upload the downloaded file as it is. It’s already 630 × 810 pixels and under 250 KB; opening and re-saving it in another app can change both.',
    'This type is for the upload. If you also need printed photos, use the India Passport / Visa / OCI type (2 × 2 in).',
    INDIA_2X2.notes[1],
  ],
  sourceUrl: 'https://mportal.passportindia.gov.in/pdf/Guidelines_for_ICAO_Compliant_Photographs_for_Passport_Applications.pdf',
  digital: { widthPx: 630, heightPx: 810, maxBytes: 250_000 },
  related: { specId: 'in-2x2', prompt: 'Need printed 2 × 2 in photos too?' },
}

export const INTL_35X45: PhotoSpec = {
  id: 'intl-35x45',
  label: '35 × 45 mm Passport',
  sizeLabel: '35 × 45 mm',
  countries: 'UK, EU / Schengen, Australia and many others',
  displayUnit: 'mm',
  widthMm: 35,
  heightMm: 45,
  // Overlap of UK (29–34 mm), Schengen/ICAO (32–36 mm) and Australia (32–36 mm).
  headHeightMm: { min: 32, max: 34 },
  topMarginMm: { min: 2, max: 6, target: 4 },
  backgrounds: [
    { id: 'lightgrey', label: 'Light grey', color: '#e6e6e6' },
    WHITE,
    { id: 'cream', label: 'Cream', color: '#f3eee0' },
  ],
  backgroundMinLuminance: 195,
  glasses: 'discouraged',
  expression: 'neutral',
  editingPolicy: 'Most passport offices, including the UK’s and the Schengen countries’, require photos that haven’t been digitally altered.',
  defaultPrintSizeId: '10x15cm',
  attestations: [
    RECENT,
    {
      id: 'glasses',
      label: 'No glasses (or, where your country allows them: clear lenses, no glare, frames not covering the eyes)',
    },
    HEADWEAR,
    FACE_VISIBLE,
    NO_FILTERS,
  ],
  notes: [
    'Rules differ slightly between countries. This preset uses the head size that satisfies the UK, Schengen and Australian rules at the same time, but check your issuing authority before printing.',
    'Most countries require a neutral expression with the mouth closed.',
  ],
  sourceUrl: 'https://www.gov.uk/photos-for-passports',
}

export const CANADA_50X70: PhotoSpec = {
  id: 'ca-50x70',
  label: 'Canada Passport',
  sizeLabel: '50 × 70 mm',
  countries: 'Canadian passport',
  displayUnit: 'mm',
  widthMm: 50,
  heightMm: 70,
  headHeightMm: { min: 31, max: 36 },
  topMarginMm: { min: 6, max: 16, target: 11 },
  backgrounds: [WHITE, { id: 'lightgrey', label: 'Light grey', color: '#ededed' }],
  backgroundMinLuminance: 205,
  glasses: 'allowed',
  expression: 'neutral',
  editingPolicy: 'Canada requires photos that haven’t been digitally altered.',
  defaultPrintSizeId: '4x6',
  attestations: [
    RECENT,
    {
      id: 'glasses',
      label: 'If I wear glasses: no tinted lenses, no glare, eyes clearly visible',
    },
    HEADWEAR,
    FACE_VISIBLE,
    NO_FILTERS,
  ],
  notes: [
    'Paper applications need the photographer’s name, address and the date the photo was taken stamped on the back of one photo. Check whether a home-printed photo is accepted for your application.',
  ],
  sourceUrl:
    'https://www.canada.ca/en/immigration-refugees-citizenship/services/canadian-passports/photos.html',
}

export const PHOTO_SPECS: PhotoSpec[] = [US_PASSPORT, INDIA_2X2, INDIA_ONLINE, INTL_35X45, CANADA_50X70]

export function rangeTarget(r: Range): number {
  return r.target ?? (r.min + r.max) / 2
}

export function formatLength(mm: number, unit: PhotoSpec['displayUnit']): string {
  return unit === 'in' ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`
}

export function formatRange(r: Range, unit: PhotoSpec['displayUnit']): string {
  if (unit === 'in') {
    return `${formatInches(r.min)}–${formatInches(r.max)} in`
  }
  return `${r.min}–${r.max} mm`
}

/** Formats a length as fractional inches (e.g. 1⅜, 1⅓) when it lands on an eighth or a third. */
function formatInches(mm: number): string {
  const inches = mm / 25.4
  const whole = Math.floor(inches + 1e-6)
  const frac = inches - whole
  const fractions: [number, string][] = [
    [0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
    [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'],
  ]
  const match = fractions.find(([v]) => Math.abs(frac - v) < 0.002)
  if (!match) return inches.toFixed(2)
  return `${whole || (match[1] ? '' : '0')}${match[1]}`
}
