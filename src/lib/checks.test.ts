import { describe, expect, it } from 'vitest'
import { CANADA_50X70, INDIA_2X2, INTL_35X45, US_PASSPORT } from '../config/photoSpecs'
import { expressionCheck, eyewearChecks, faceCountCheck, gazeCheck, gazeOffset, lightingCheck } from './checks'
import type { ExpressionScores } from './expression'
import type { Crop, Point } from './geometry'
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
  const analysis = (faces: DetectedFace[]): FaceAnalysis =>
    ({ faceCount: faces.length, faces, subject: 0 }) as unknown as FaceAnalysis
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
    const covered = light([null, null, null], [[149, 0.07], [156, 0.03], [117, 0.09]], [[168, 0.04], [171, 0.02], [150, 0.045]], [[168, 0.03], [153, 0.026], [138, 0.04]])
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
    mesh({ 33: { x: 0, y: 0 }, 133: { x: 30, y: 0 }, 468: { x: 15 + shift, y: 0 }, 362: { x: 60, y: 0 }, 263: { x: 90, y: 0 }, 473: { x: 75 + shift, y: 0 } })

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
