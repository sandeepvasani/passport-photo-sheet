import { describe, expect, it } from 'vitest'
import {
  CANADA_50X70,
  CHINA_VISA,
  CHINA_VISA_UPLOAD,
  INDIA_2X2,
  INTL_35X45,
  PHOTO_SPECS,
  US_PASSPORT,
  type PhotoSpec,
} from '../config/photoSpecs'
import {
  backgroundCheck,
  expressionCheck,
  eyewearChecks,
  faceCountCheck,
  gazeCheck,
  gazeOffset,
  geometryChecks,
  lightingCheck,
  retakeIssues,
  type CheckResult,
} from './checks'
import type { ExpressionScores } from './expression'
import { autoFit, midpoint, transformCropAbout, type Crop, type Markers, type Point } from './geometry'
import type { LoadedImage } from './image'
import type { BackgroundSettings, RenderedPhoto } from './render'
import type { DetectedFace, EyewearAnalysis, FaceAnalysis, LightingAnalysis } from './vision'

const none: EyewearAnalysis = { detected: false, accessoryShare: 0, bridgeEdge: 8, rimEdge: 8, glareShare: 0, lensBrightness: 0.85 }
const clear: EyewearAnalysis = { ...none, detected: true, accessoryShare: 0.1, rimEdge: 70 }
const status = (r: ReturnType<typeof eyewearChecks>, id: string) => r.find((c) => c.id === id)?.status

describe('eyewearChecks', () => {
  it('passes when no glasses are detected', () => {
    for (const spec of [US_PASSPORT, INDIA_2X2, INTL_35X45, CANADA_50X70]) {
      expect(status(eyewearChecks(spec, none), 'glasses')).toBe('pass')
    }
  })

  it('fails glasses for the US, warns for 35×45 and allows them for India and Canada', () => {
    expect(status(eyewearChecks(US_PASSPORT, clear), 'glasses')).toBe('fail')
    expect(status(eyewearChecks(INTL_35X45, clear), 'glasses')).toBe('warn')
    expect(status(eyewearChecks(INDIA_2X2, clear), 'glasses')).toBe('pass')
    expect(status(eyewearChecks(CANADA_50X70, clear), 'glasses')).toBe('pass')
  })

  it('flags glare and tinted lenses where glasses are allowed', () => {
    expect(status(eyewearChecks(INDIA_2X2, clear), 'glare')).toBe('pass')
    expect(status(eyewearChecks(INDIA_2X2, { ...clear, glareShare: 0.02 }), 'glare')).toBe('warn')
    expect(status(eyewearChecks(INDIA_2X2, { ...clear, glareShare: 0.055 }), 'glare')).toBe('fail')
    expect(status(eyewearChecks(CANADA_50X70, { ...clear, lensBrightness: 0.28 }), 'tint')).toBe('fail')
  })

  it('returns nothing when there is no face to analyse', () => {
    expect(eyewearChecks(US_PASSPORT, null)).toEqual([])
  })
})

describe('faceCountCheck', () => {
  const face = (x: number): DetectedFace => ({ landmarks: [], blendshapes: {}, area: 1, box: { x, y: 400, w: 300, h: 360 } })
  const analysis = (faces: DetectedFace[]): FaceAnalysis => ({ faceCount: faces.length, faces, subject: 0 }) as unknown as FaceAnalysis
  // Frame centred on the first face: 50.8 mm at 20 px/mm is ~1016 px wide.
  const crop: Crop = { cx: 1150, cy: 600, angle: 0, pxPerMm: 20 }

  it('passes with one person', () => {
    expect(faceCountCheck(analysis([face(1000)]), crop, US_PASSPORT).status).toBe('pass')
  })

  it('fails when another face is inside the frame', () => {
    expect(faceCountCheck(analysis([face(1000), face(1450)]), crop, US_PASSPORT).status).toBe('fail')
  })

  it('only warns when the other person is outside the frame', () => {
    expect(faceCountCheck(analysis([face(1000), face(3000)]), crop, US_PASSPORT).status).toBe('warn')
  })
})

// Skin [brightness, grain] per region (left, centre, right as seen in the photo), measured
// on the test photos and on public-domain official portraits from Wikimedia Commons.
type Cell = [number, number] | null
type Row = [Cell, Cell, Cell]
const light = (forehead: Row, eyes: Row, cheeks: Row, jaw: Row): LightingAnalysis => {
  const region = (c: Cell) => (c ? { brightness: c[0], texture: c[1] } : null)
  const side = ([left, centre, right]: Row) => ({ left: region(left), centre: region(centre), right: region(right) })
  return { forehead: side(forehead), eyes: side(eyes), cheeks: side(cheeks), jaw: side(jaw) }
}
// One photo per line reads best as a table.
// prettier-ignore
const MEASURED = {
  portrait: light([[194, 0.016], [184, 0.014], [174, 0.019]], [[149, 0.073], [156, 0.028], [117, 0.095]], [[168, 0.038], [171, 0.018], [150, 0.045]], [[168, 0.032], [153, 0.026], [138, 0.039]]),
  nasa1: light([[190, 0.009], [187, 0.009], [138, 0.011]], [[158, 0.027], [167, 0.012], [109, 0.035]], [[166, 0.013], [163, 0.014], [116, 0.015]], [[162, 0.012], [161, 0.013], [111, 0.017]]),
  nasa2: light([[200, 0.005], [209, 0.006], [167, 0.006]], [[170, 0.015], [184, 0.009], [129, 0.017]], [[189, 0.006], [173, 0.009], [158, 0.008]], [[184, 0.005], [185, 0.006], [143, 0.009]]),
  nasa3: light([[190, 0.013], [203, 0.009], [167, 0.017]], [[170, 0.019], [167, 0.017], [117, 0.023]], [[169, 0.016], [161, 0.018], [138, 0.018]], [[176, 0.014], [173, 0.015], [139, 0.020]]),
  selfie: light([[198, 0.005], [210, 0.005], [167, 0.006]], [[170, 0.018], [184, 0.009], [128, 0.018]], [[189, 0.005], [171, 0.010], [158, 0.007]], [[185, 0.005], [184, 0.006], [142, 0.009]]),
  moustache: light([[191, 0.006], [202, 0.006], [173, 0.009]], [[169, 0.018], [178, 0.013], [130, 0.019]], [[186, 0.011], [149, 0.016], [162, 0.012]], [[183, 0.007], [178, 0.006], [140, 0.012]]),
  greyBeardSideLit: light([[195, 0.005], [189, 0.006], [146, 0.007]], [[139, 0.040], [145, 0.035], [112, 0.027]], [[167, 0.024], [143, 0.032], [116, 0.027]], [[171, 0.038], [162, 0.059], [115, 0.052]]),
  studioSideLit: light([[223, 0.011], [211, 0.017], [148, 0.026]], [[177, 0.068], [186, 0.031], [102, 0.059]], [[200, 0.029], [196, 0.036], [111, 0.033]], [[194, 0.019], [159, 0.040], [106, 0.033]]),
  shadowSide: light([[193, 0.017], [162, 0.014], [102, 0.019]], [[148, 0.074], [136, 0.030], [70, 0.093]], [[168, 0.039], [149, 0.019], [88, 0.044]], [[169, 0.034], [129, 0.027], [80, 0.039]]),
  shadowOverhead: light([[191, 0.017], [184, 0.014], [172, 0.020]], [[91, 0.074], [138, 0.028], [70, 0.099]], [[160, 0.039], [164, 0.019], [141, 0.046]], [[158, 0.031], [89, 0.026], [128, 0.041]]),
  shadowBrim: light([[136, 0.017], [111, 0.014], [119, 0.020]], [[147, 0.074], [156, 0.030], [119, 0.094]], [[168, 0.039], [171, 0.019], [150, 0.047]], [[169, 0.032], [152, 0.027], [138, 0.041]]),
  shadowForeheadSide: light([[116, 0.016], [178, 0.014], [174, 0.020]], [[149, 0.073], [156, 0.030], [117, 0.098]], [[167, 0.038], [171, 0.019], [149, 0.046]], [[168, 0.032], [153, 0.027], [138, 0.040]]),
  darkBeard: light([[205, 0.011], [209, 0.010], [177, 0.015]], [[164, 0.043], [174, 0.020], [121, 0.041]], [[186, 0.034], [173, 0.044], [149, 0.040]], [[141, 0.105], [127, 0.109], [62, 0.133]]),
  fullBeard: light([[209, 0.016], [213, 0.012], [180, 0.024]], [[193, 0.029], [205, 0.020], [134, 0.045]], [[197, 0.026], [171, 0.056], [153, 0.044]], [[110, 0.128], [92, 0.149], [63, 0.149]]),
  heavyStubble: light([[165, 0.020], [174, 0.021], [186, 0.025]], [[124, 0.064], [151, 0.051], null], [[102, 0.089], [132, 0.075], [144, 0.089]], [[75, 0.173], [93, 0.135], [90, 0.210]]),
  goateeSideLit: light([[206, 0.012], [200, 0.015], [148, 0.022]], [[181, 0.050], [187, 0.021], [83, 0.068]], [[193, 0.021], [184, 0.022], [132, 0.038]], [[165, 0.122], [115, 0.187], [88, 0.131]]),
  shortBeardSideLit: light([[128, 0.064], [150, 0.041], [79, 0.063]], [[81, 0.095], [83, 0.083], [48, 0.115]], [[104, 0.079], [121, 0.061], [66, 0.081]], [[83, 0.092], [82, 0.101], [51, 0.096]]),
}

describe('lightingCheck', () => {
  it('passes evenly lit faces', () => {
    for (const l of [MEASURED.portrait, MEASURED.nasa2, MEASURED.nasa3, MEASURED.selfie, MEASURED.moustache]) {
      const r = lightingCheck(l)!
      expect(r.status).toBe('pass')
      expect(r.detail).not.toContain('beard')
    }
  })

  it('flags light from one side and names the darker side', () => {
    for (const l of [MEASURED.nasa1, MEASURED.studioSideLit, MEASURED.shadowSide, MEASURED.greyBeardSideLit]) {
      const r = lightingCheck(l)!
      expect(r.status).toBe('warn')
      expect(r.detail).toContain('right side of your face')
    }
  })

  it('flags a shadow over half the forehead', () => {
    const r = lightingCheck(MEASURED.shadowForeheadSide)!
    expect(r.status).toBe('warn')
    expect(r.detail).toContain('left side of your forehead')
  })

  it('flags a shaded forehead, such as from a hat brim', () => {
    const r = lightingCheck(MEASURED.shadowBrim)!
    expect(r.status).toBe('warn')
    expect(r.detail).toContain('on your forehead')
    expect(r.detail).not.toContain('side of')
  })

  it('flags light from above by the eye sockets and below the mouth', () => {
    const r = lightingCheck(MEASURED.shadowOverhead)!
    expect(r.status).toBe('warn')
    expect(r.detail).toContain('around your eyes and below your mouth')
  })

  it('doesn’t mistake a beard or heavy stubble for shadow', () => {
    for (const l of [MEASURED.darkBeard, MEASURED.fullBeard, MEASURED.heavyStubble]) {
      const r = lightingCheck(l)!
      expect(r.status).toBe('pass')
      expect(r.detail).toContain('beard area wasn’t checked')
    }
  })

  it('still flags side light on a bearded face, from the skin above the beard', () => {
    for (const l of [MEASURED.goateeSideLit, MEASURED.shortBeardSideLit]) {
      const r = lightingCheck(l)!
      expect(r.status).toBe('warn')
      expect(r.detail).toContain('right side of your face')
      expect(r.detail).not.toContain('below your mouth')
    }
  })

  it('only reports a dark chin together with shaded eye sockets', () => {
    // Even stubble too fine to look grainy: the chin alone is darker.
    const p = MEASURED.portrait
    const stubble: LightingAnalysis = { ...p, jaw: { ...p.jaw, centre: { brightness: 90, texture: 0.026 } } }
    expect(lightingCheck(stubble)?.status).toBe('pass')
  })

  it('skips regions it could not measure', () => {
    const covered = light(
      [null, null, null],
      [
        [149, 0.07],
        [156, 0.03],
        [117, 0.09],
      ],
      [
        [168, 0.04],
        [171, 0.02],
        [150, 0.045],
      ],
      [
        [168, 0.03],
        [153, 0.026],
        [138, 0.04],
      ],
    )
    expect(lightingCheck(covered)?.status).toBe('pass')
    expect(lightingCheck(light([null, null, null], [null, null, null], [null, null, null], [null, null, null]))).toBeNull()
    expect(lightingCheck(null)).toBeNull()
  })
})

// A face mesh with only the points the expression and gaze checks read.
function mesh(points: Record<number, Point>): Point[] {
  return Array.from({ length: 478 }, (_, i) => points[i] ?? { x: 0, y: 0 })
}
const closedMouth = mesh({ 13: { x: 50, y: 100 }, 14: { x: 50, y: 101 }, 61: { x: 0, y: 100 }, 291: { x: 100, y: 100 } })
const openMouth = mesh({ 13: { x: 50, y: 100 }, 14: { x: 50, y: 115 }, 61: { x: 0, y: 100 }, 291: { x: 100, y: 100 } })
// FER+ scores measured on test photos (neutral, happy, surprise, sad, anger, disgust, fear, contempt).
const fer = (v: number[]): ExpressionScores => {
  const [neutral, happy, surprise, sad, anger, disgust, fear, contempt] = v
  return { neutral, happy, surprise, sad, anger, disgust, fear, contempt }
}
const FER = {
  neutralFace: fer([0.89, 0, 0, 0, 0.09, 0, 0, 0.01]), // the highest non-neutral score on a neutral photo
  smiling: fer([0.03, 0.97, 0, 0, 0, 0, 0, 0]),
  scowl: fer([0.42, 0, 0, 0, 0.55, 0.01, 0, 0.01]),
  surprise: fer([0.2, 0, 0.71, 0.02, 0, 0, 0.06, 0]),
  terror: fer([0.05, 0, 0.28, 0.18, 0.01, 0.01, 0.47, 0]),
  grief: fer([0.32, 0, 0, 0.62, 0.02, 0.02, 0, 0.02]),
}
const relaxed = { mouthSmileLeft: 0.17, mouthSmileRight: 0.15, mouthPucker: 0 }

describe('retakeIssues', () => {
  // One person facing the camera with open eyes, no glasses and even light.
  const fine = {
    faceCount: 1,
    faces: [],
    subject: 0,
    landmarks: [],
    blendshapes: {},
    pose: { yaw: 2, pitch: 3 },
    crownAtImageEdge: false,
    eyewear: none,
    lighting: MEASURED.portrait,
  } as unknown as FaceAnalysis
  const crop: Crop = { cx: 0, cy: 0, angle: 0, pxPerMm: 20 }

  it('finds nothing in a photo that can be used', () => {
    expect(retakeIssues(fine, crop, US_PASSPORT, null)).toEqual([])
  })

  it('reports closed eyes, a turned head, hair at the top edge and shadows before the photo is cropped, failures first', () => {
    const analysis = {
      ...fine,
      blendshapes: { eyeBlinkLeft: 0.9 },
      pose: { yaw: 20, pitch: 0 },
      crownAtImageEdge: true,
      lighting: MEASURED.shadowSide,
    }
    const issues = retakeIssues(analysis, crop, US_PASSPORT, null)
    expect(issues.map((r) => [r.id, r.status])).toEqual([
      ['eyes-open', 'fail'],
      ['facing', 'fail'],
      ['crown-edge', 'warn'],
      ['shadows', 'warn'],
    ])
  })
})

describe('expressionCheck', () => {
  it('passes a relaxed face', () => {
    expect(expressionCheck(INTL_35X45, relaxed, closedMouth, FER.neutralFace).status).toBe('pass')
    expect(expressionCheck(US_PASSPORT, relaxed, closedMouth, FER.neutralFace).status).toBe('pass')
  })

  it('allows a closed-mouth smile only where the rules do', () => {
    const smile = { mouthSmileLeft: 0.96, mouthSmileRight: 0.93 }
    expect(expressionCheck(US_PASSPORT, smile, closedMouth, FER.smiling).status).toBe('pass')
    expect(expressionCheck(INTL_35X45, smile, closedMouth, FER.smiling).detail).toContain('smiling')
  })

  it('flags parted lips for every photo type', () => {
    expect(expressionCheck(US_PASSPORT, relaxed, openMouth, null).detail).toContain('lips look parted')
  })

  it('names frowns, raised eyebrows and sadness', () => {
    expect(expressionCheck(US_PASSPORT, relaxed, closedMouth, FER.scowl).detail).toContain('frowning')
    expect(expressionCheck(US_PASSPORT, relaxed, closedMouth, FER.surprise).detail).toContain('eyebrows look raised')
    expect(expressionCheck(US_PASSPORT, relaxed, closedMouth, FER.terror).detail).toContain('eyebrows look raised')
    expect(expressionCheck(US_PASSPORT, relaxed, closedMouth, FER.grief).detail).toContain('sad')
  })

  it('flags a pout, but not a moustache', () => {
    expect(expressionCheck(US_PASSPORT, { ...relaxed, mouthPucker: 0.96 }, closedMouth, FER.neutralFace).detail).toContain('duck face')
    expect(expressionCheck(US_PASSPORT, { ...relaxed, mouthPucker: 0.18 }, closedMouth, FER.neutralFace).status).toBe('pass')
  })

  it('still checks smiles and lips if the expression model can’t run', () => {
    expect(expressionCheck(INTL_35X45, relaxed, closedMouth, null).status).toBe('pass')
  })

  it('waits for the expression model, showing what it has found so far', () => {
    expect(expressionCheck(INTL_35X45, relaxed, closedMouth, 'pending').status).toBe('pending')
    const r = expressionCheck(INTL_35X45, relaxed, openMouth, 'pending')
    expect(r.status).toBe('pending')
    expect(r.detail).toContain('lips look parted')
  })
})

describe('gaze', () => {
  // Two eyes 30 px wide, irises at `shift` px from their centres.
  const eyes = (shift: number) =>
    mesh({
      33: { x: 0, y: 0 },
      133: { x: 30, y: 0 },
      468: { x: 15 + shift, y: 0 },
      362: { x: 60, y: 0 },
      263: { x: 90, y: 0 },
      473: { x: 75 + shift, y: 0 },
    })

  it('measures how far the irises sit from the middle of the eyes', () => {
    expect(gazeOffset(eyes(0))).toBeCloseTo(0, 6)
    expect(gazeOffset(eyes(6))).toBeCloseTo(0.2, 6)
    expect(gazeOffset(eyes(-6))).toBeCloseTo(-0.2, 6)
  })

  it('flags eyes turned away (0.22 on the looking-away example), not ones looking at the camera (at most 0.11)', () => {
    expect(gazeCheck(0.218).status).toBe('warn')
    expect(gazeCheck(-0.2).status).toBe('warn')
    expect(gazeCheck(0.109).status).toBe('pass')
  })
})

const original: BackgroundSettings = { mode: 'original', color: '#ffffff', feather: 5, expand: 0 }

describe('backgroundCheck', () => {
  type RGB = [number, number, number]
  /** A 100 × 100 photo of a person (the middle, below the top fifth) against `left` and `right` halves of background. */
  function photoOf(left: RGB, right = left, person = (x: number, y: number) => x >= 33 && x < 67 && y >= 20) {
    const w = 100
    const h = 100
    const alpha = new Float32Array(w * h)
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        alpha[i] = person(x, y) ? 1 : 0
        data.set([...(person(x, y) ? [150, 110, 90] : x < w / 2 ? left : right), 255], i * 4)
      }
    }
    return { photo: { width: w, height: h, alpha, canvas: null, pxPerMm: 1 } as unknown as RenderedPhoto, data }
  }
  const check = (p: ReturnType<typeof photoOf>, spec: PhotoSpec = US_PASSPORT, bg = original) => backgroundCheck(p.photo, p.data, spec, bg)

  it('passes a plain white background', () => {
    expect(check(photoOf([250, 250, 250])).status).toBe('pass')
  })

  it('fails a coloured or dark background', () => {
    expect(check(photoOf([120, 170, 230]))).toMatchObject({ status: 'fail', detail: expect.stringContaining('coloured') })
    expect(check(photoOf([150, 150, 150]))).toMatchObject({ status: 'fail', detail: expect.stringContaining('too dark') })
  })

  it('warns about a background a little too dark for the photo type', () => {
    // Light grey is fine for 35 × 45 mm photos, but a little dark for a US one.
    expect(check(photoOf([210, 210, 210]), US_PASSPORT)).toMatchObject({ status: 'warn', detail: expect.stringContaining('a little dark') })
    expect(check(photoOf([210, 210, 210]), INTL_35X45).status).toBe('pass')
  })

  it('warns when one side is darker, as with a shadow', () => {
    expect(check(photoOf([250, 250, 250], [225, 225, 225]))).toMatchObject({ status: 'warn', detail: expect.stringContaining('uneven') })
  })

  it('warns when too little background shows to judge', () => {
    expect(check(photoOf([250, 250, 250], undefined, () => true))).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('Too little'),
    })
  })

  it('passes a replaced background without measuring it', () => {
    expect(check(photoOf([120, 170, 230]), US_PASSPORT, { ...original, mode: 'replace' }).status).toBe('pass')
  })
})

describe('geometryChecks', () => {
  const image = { width: 3000, height: 4000 } as LoadedImage
  /** A face in a 3000 × 4000 photo, `headPx` from crown to chin, tilted by `tiltDeg`. */
  function face(tiltDeg = 0, headPx = 1200): Markers {
    const t = (tiltDeg * Math.PI) / 180
    const at = (dx: number, dy: number) => ({
      x: 1500 + dx * Math.cos(t) - dy * Math.sin(t),
      y: 1600 + dx * Math.sin(t) + dy * Math.cos(t),
    })
    const k = headPx / 1200
    return { eyeLeft: at(-150 * k, 0), eyeRight: at(150 * k, 0), crown: at(0, -600 * k), chin: at(0, 600 * k), faceWidthPx: 800 * k }
  }
  const run = (spec: PhotoSpec, m: Markers, crop: Crop, img = image, bg = original): Record<string, CheckResult> =>
    Object.fromEntries(geometryChecks(spec, m, crop, img, bg).map((r) => [r.id, r]))
  /** The auto-fitted crop moved by (dx, dy) mm of finished photo: the face then sits that far up and left. */
  const shifted = (spec: PhotoSpec, m: Markers, dx: number, dy: number): Crop => {
    const c = autoFit(m, spec, image)
    return { ...c, cx: c.cx + dx * c.pxPerMm, cy: c.cy + dy * c.pxPerMm }
  }

  it('passes every measurement for an auto-fitted crop', () => {
    for (const spec of PHOTO_SPECS) {
      const results = Object.values(run(spec, face(), autoFit(face(), spec, image)))
      expect(results.filter((r) => r.status !== 'pass').map((r) => `${spec.id} ${r.id}: ${r.detail}`)).toEqual([])
    }
  })

  it('fails a head outside the size range, and only warns where the size is a guideline', () => {
    for (const [spec, status] of [
      [US_PASSPORT, 'fail'],
      [CHINA_VISA_UPLOAD, 'warn'],
    ] as const) {
      const fit = autoFit(face(), spec, image)
      const small = transformCropAbout(fit, midpoint(face().eyeLeft, face().eyeRight), 0.75, 0)
      expect(run(spec, face(), small).head.status, spec.id).toBe(status)
    }
  })

  it('fails the eye line only where it is required', () => {
    expect(run(INDIA_2X2, face(), shifted(INDIA_2X2, face(), 0, 5)).eyes.status).toBe('fail')
    expect(run(US_PASSPORT, face(), shifted(US_PASSPORT, face(), 0, 5)).eyes.status).toBe('warn')
  })

  it('fails the space above the head only where it is required, and notes hair past the top edge', () => {
    expect(run(CHINA_VISA, face(), shifted(CHINA_VISA, face(), 0, 3)).top.status).toBe('fail')
    expect(run(US_PASSPORT, face(), shifted(US_PASSPORT, face(), 0, 10)).top).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('past the top edge'),
    })
  })

  it('fails a chin cut off at the bottom', () => {
    expect(run(US_PASSPORT, face(), shifted(US_PASSPORT, face(), 0, -20)).chin.status).toBe('fail')
  })

  it('warns about a face slightly off centre and fails one well off', () => {
    expect(run(US_PASSPORT, face(), shifted(US_PASSPORT, face(), 0.05 * 50.8, 0)).center.status).toBe('warn')
    expect(run(US_PASSPORT, face(), shifted(US_PASSPORT, face(), 0.1 * 50.8, 0)).center.status).toBe('fail')
  })

  it('warns about a slight tilt, fails a large one, and notes a head straightened from a tilt', () => {
    const fit = autoFit(face(), US_PASSPORT, image)
    const eyes = midpoint(face().eyeLeft, face().eyeRight)
    const tilted = (deg: number) => run(US_PASSPORT, face(), transformCropAbout(fit, eyes, 1, (deg * Math.PI) / 180)).level.status
    expect(tilted(4)).toBe('warn')
    expect(tilted(8)).toBe('fail')
    expect(run(US_PASSPORT, face(10), autoFit(face(10), US_PASSPORT, image)).level).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('straightened'),
    })
  })

  it('fails a frame that reaches past the photo, and only warns when the background is replaced', () => {
    // A photo too narrow for the 2 × 2 in frame around this head.
    const narrow = { width: 1800, height: 4000 } as LoadedImage
    const m: Markers = {
      ...face(),
      eyeLeft: { x: 750, y: 1600 },
      eyeRight: { x: 1050, y: 1600 },
      crown: { x: 900, y: 1000 },
      chin: { x: 900, y: 2200 },
    }
    const crop = autoFit(m, US_PASSPORT)
    expect(run(US_PASSPORT, m, crop, narrow).coverage.status).toBe('fail')
    expect(run(US_PASSPORT, m, crop, narrow, { ...original, mode: 'replace' }).coverage).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('filled with the background colour'),
    })
  })

  it('judges print resolution, and only the upload size for upload-only photos', () => {
    const dpi = (headPx: number) => run(US_PASSPORT, face(0, headPx), autoFit(face(0, headPx), US_PASSPORT, image)).resolution.status
    expect(dpi(1200)).toBe('pass')
    expect(dpi(300)).toBe('warn')
    expect(dpi(180)).toBe('fail')
    const upload = (headPx: number) => run(CHINA_VISA_UPLOAD, face(0, headPx), autoFit(face(0, headPx), CHINA_VISA_UPLOAD, image))
    expect(upload(1200).resolution).toBeUndefined()
    expect(upload(1200)['upload-resolution'].status).toBe('pass')
    expect(upload(300)['upload-resolution'].status).toBe('warn')
  })

  it('warns about a face width outside the range', () => {
    const crop = autoFit(face(), CHINA_VISA, image)
    expect(run(CHINA_VISA, face(), crop)['face-width'].status).toBe('pass')
    expect(run(CHINA_VISA, { ...face(), faceWidthPx: 400 }, crop)['face-width'].status).toBe('warn')
  })
})
