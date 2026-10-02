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
  /** Infinity when only a minimum is given. */
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
  /** Smallest file accepted, in bytes. */
  minBytes?: number
  /** The photo only goes into an online form: no print sheet (its shape may not be a print size). */
  uploadOnly?: boolean
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
  /** The head height is only a guide (warning), because another rule (face width) sets the size. */
  headHeightGuideline?: boolean
  /** Face width across the cheeks at ear level; when set, auto-fit sizes the head to it. */
  faceWidthMm?: Range
  /** Eye line measured up from the bottom edge of the photo. */
  eyeFromBottomMm?: Range
  /** Whether the eye line is an official requirement (fail) or only a positioning guideline (warning). */
  eyeLineRequired?: boolean
  /** Space between the top of the head and the top edge (a guideline, unless topMarginRequired). */
  topMarginMm?: Range
  topMarginRequired?: boolean
  backgrounds: BackgroundSwatch[]
  /** Darkest average background luminance (0–255) that still reads as "light / white". */
  backgroundMinLuminance: number
  glasses: 'forbidden' | 'discouraged' | 'allowed'
  /** Spec-specific wording for the glasses rule: the summary on the Upload step, and the warning when glasses are detected. */
  glassesNote?: { summary: string; detected: string }
  /** Black-and-white photos are accepted as well as colour. */
  allowsBlackAndWhite?: boolean
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
  label: 'India Visa / OCI',
  sizeLabel: '2 × 2 in',
  countries: 'Indian visa and OCI card applications',
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
    prompt: 'Applying for a passport, PCC, passport surrender or GEP instead? Those now need a 630 × 810 px photo uploaded on the Passport Seva portal.',
  },
}

export const INDIA_ONLINE: PhotoSpec = {
  ...INDIA_2X2,
  id: 'in-online',
  label: 'India Passport (Passport Seva)',
  sizeLabel: '35 × 45 mm',
  countries: 'Passport, PCC, surrender and GEP: upload on the Passport Seva portal',
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
    'OCI card and visa applications still use 2 × 2 in photos: use the India Visa / OCI type for those.',
    INDIA_2X2.notes[1],
  ],
  sourceUrl: 'https://mportal.passportindia.gov.in/pdf/Guidelines_for_ICAO_Compliant_Photographs_for_Passport_Applications.pdf',
  digital: { widthPx: 630, heightPx: 810, maxBytes: 250_000 },
  related: { specId: 'in-2x2', prompt: 'Applying for an OCI card or Indian visa instead? Those still use 2 × 2 in photos.' },
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
  related: { specId: 'ca-visa', prompt: 'Applying for a Canadian visitor visa instead? That uses 35 × 45 mm photos.' },
}

export const CANADA_VISA: PhotoSpec = {
  id: 'ca-visa',
  label: 'Canada Visa',
  sizeLabel: '35 × 45 mm',
  countries: 'Canadian visitor visa (temporary resident visa)',
  displayUnit: 'mm',
  // The frame must be at least 35 × 45 mm; this is that size.
  widthMm: 35,
  heightMm: 45,
  // Chin to crown. Canada measures to the top of the head, not the hair, so measuring
  // to the top of the hair (as this app does) errs on the side of a smaller head.
  headHeightMm: { min: 31, max: 36 },
  // Not specified beyond "include the top of the shoulders"; this keeps the shoulders in frame.
  topMarginMm: { min: 2, max: 6, target: 4 },
  backgrounds: [WHITE, { id: 'lightgrey', label: 'Light grey', color: '#ededed' }],
  backgroundMinLuminance: 205,
  glasses: 'allowed',
  allowsBlackAndWhite: true,
  expression: 'neutral',
  editingPolicy: 'Canada’s visa photo rules say digital photos must not be altered in any way.',
  defaultPrintSizeId: '4x6',
  attestations: [
    RECENT,
    {
      id: 'glasses',
      label: 'If I wear glasses: non-tinted prescription lenses, no reflections, and the frames don’t cover my eyes',
    },
    { id: 'headwear', label: 'No head covering, unless worn for religious reasons with my full face visible' },
    FACE_VISIBLE,
    NO_FILTERS,
  ],
  notes: [
    'Send two identical photos with your application (and two for each family member applying with you), printed on quality photographic paper.',
    'This is for paper applications. Online applications may have their own rules for uploaded photos.',
  ],
  sourceUrl:
    'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/temporary-resident-visa-application-photograph-specifications.html',
  related: { specId: 'ca-50x70', prompt: 'Applying for a Canadian passport instead? That needs 50 × 70 mm photos.' },
}

const CHINA_SOURCE = 'https://us.china-embassy.gov.cn/eng/lsfw/zj/qz2021/201612/W020210801080249838040.jpg'

const CHINA_COMMON = {
  displayUnit: 'mm',
  backgrounds: [WHITE],
  backgroundMinLuminance: 222,
  glasses: 'allowed',
  expression: 'neutral',
  editingPolicy: 'China’s requirements ask for a white or near-white background and natural skin tones, and don’t allow damage or impurities in the photo.',
  defaultPrintSizeId: '4x6',
  attestations: [
    RECENT,
    { id: 'glasses', label: 'If I wear glasses: lenses not tinted, no glare or shadows, and the frames don’t cover my eyes' },
    { id: 'ears', label: 'Both ears are visible' },
    { id: 'headwear', label: 'No hat or head covering, unless worn for religious reasons without hiding any facial features' },
    FACE_VISIBLE,
    NO_FILTERS,
  ],
} satisfies Partial<PhotoSpec>

export const CHINA_VISA: PhotoSpec = {
  ...CHINA_COMMON,
  id: 'cn-visa',
  label: 'China Visa',
  sizeLabel: '33 × 48 mm',
  countries: 'Printed photo for the Chinese visa application form',
  widthMm: 33,
  heightMm: 48,
  headHeightMm: { min: 28, max: 33 },
  faceWidthMm: { min: 15, max: 22 },
  // With the head 28–33 mm, this also leaves the required 7 mm or more below the chin.
  topMarginMm: { min: 3, max: 5 },
  topMarginRequired: true,
  notes: ['The background must be white or close to white, with no border around the photo.'],
  sourceUrl: CHINA_SOURCE,
  related: { specId: 'cn-visa-upload', prompt: 'Applying online? The online form needs a digital photo (420 × 560 px, 40–120 KB).' },
}

// The digital rules are given in pixels for a 354 × 472 px photo; they're converted to
// a 33 × 44 mm frame of the same 3:4 shape (10.73 px per mm at that size).
const CN_PX = 354 / 33

export const CHINA_VISA_UPLOAD: PhotoSpec = {
  ...CHINA_COMMON,
  id: 'cn-visa-upload',
  label: 'China Visa Upload',
  sizeLabel: '3:4',
  countries: 'Digital photo for the Chinese online visa application',
  widthMm: 33,
  heightMm: 44,
  // Not given for the digital photo; face width sets the size, so this is only a guide.
  headHeightMm: { min: 28, max: 37 },
  headHeightGuideline: true,
  // "Face width at 205 pixels ± 14 pixels".
  faceWidthMm: { min: round2(191 / CN_PX), max: round2(219 / CN_PX), target: round2(205 / CN_PX) },
  // "10–70 pixels" from the top edge to the crown.
  topMarginMm: { min: round2(10 / CN_PX), max: round2(70 / CN_PX) },
  topMarginRequired: true,
  // "> 256 pixels" from the bottom edge to the eye line.
  eyeFromBottomMm: { min: round2(256 / CN_PX), max: Infinity },
  eyeLineRequired: true,
  notes: [
    'Upload the downloaded file as it is. It’s already 420 × 560 pixels and 40–120 KB; opening and re-saving it in another app can change both.',
    'When hair is very high, it may be cut off at the top of the digital photo, as long as the face is the right size.',
  ],
  sourceUrl: CHINA_SOURCE,
  digital: { widthPx: 420, heightPx: 560, minBytes: 40 * 1024, maxBytes: 120_000, uploadOnly: true },
  related: { specId: 'cn-visa', prompt: 'Need the printed photo for the application form too (33 × 48 mm)?' },
}

export const PHOTO_SPECS: PhotoSpec[] = [US_PASSPORT, INDIA_2X2, INDIA_ONLINE, INTL_35X45, CANADA_50X70, CANADA_VISA, CHINA_VISA, CHINA_VISA_UPLOAD]

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export function rangeTarget(r: Range): number {
  return r.target ?? (r.min + r.max) / 2
}

export function formatLength(mm: number, unit: PhotoSpec['displayUnit']): string {
  return unit === 'in' ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`
}

export function formatRange(r: Range, unit: PhotoSpec['displayUnit']): string {
  if (unit === 'in') {
    return Number.isFinite(r.max) ? `${formatInches(r.min)}–${formatInches(r.max)} in` : `at least ${formatInches(r.min)} in`
  }
  return Number.isFinite(r.max) ? `${r.min}–${r.max} mm` : `at least ${r.min} mm`
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
