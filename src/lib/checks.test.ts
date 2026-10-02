import { describe, expect, it } from 'vitest'
import { CANADA_50X70, INDIA_2X2, INTL_35X45, US_PASSPORT } from '../config/photoSpecs'
import { eyewearChecks, faceCountCheck, lightingCheck } from './checks'
import type { Crop } from './geometry'
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

// Median skin brightness (left, centre, right as seen in the photo) measured on the test photos.
type Row = [number | null, number | null, number | null]
const light = (forehead: Row, eyes: Row, cheeks: Row, jaw: Row): LightingAnalysis => {
  const side = ([left, centre, right]: Row) => ({ left, centre, right })
  return { forehead: side(forehead), eyes: side(eyes), cheeks: side(cheeks), jaw: side(jaw) }
}
const MEASURED = {
  portrait: light([194, 184, 174], [149, 156, 117], [168, 171, 150], [168, 153, 138]),
  nasa2: light([201, 209, 167], [170, 183, 129], [189, 173, 158], [184, 185, 142]),
  nasa3: light([190, 203, 166], [170, 167, 117], [169, 161, 138], [177, 172, 138]),
  twoPeople: light([197, 210, 162], [162, 185, 125], [189, 175, 155], [182, 183, 139]),
  nasa1: light([190, 187, 138], [159, 167, 110], [166, 164, 116], [162, 162, 111]),
  glassesThin: light([195, 189, 146], [139, 144, 112], [167, 143, 116], [171, 162, 115]),
  shadowSide: light([193, 162, 102], [148, 136, 70], [168, 149, 88], [169, 129, 80]),
  shadowForeheadSide: light([116, 178, 174], [149, 156, 117], [167, 171, 149], [168, 153, 138]),
  shadowBrim: light([136, 111, 119], [147, 156, 119], [168, 171, 150], [169, 152, 138]),
  shadowOverhead: light([191, 184, 172], [91, 138, 70], [160, 164, 141], [158, 89, 128]),
}

describe('lightingCheck', () => {
  it('passes evenly lit faces', () => {
    for (const l of [MEASURED.portrait, MEASURED.nasa2, MEASURED.nasa3, MEASURED.twoPeople]) {
      expect(lightingCheck(l)?.status).toBe('pass')
    }
  })

  it('flags light from one side and names the darker side', () => {
    for (const l of [MEASURED.nasa1, MEASURED.glassesThin, MEASURED.shadowSide]) {
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
    expect(r.detail).toContain('beard')
  })

  it('skips regions it could not measure', () => {
    const covered = light([null, null, null], [149, 156, 117], [168, 171, 150], [168, 153, 138])
    expect(lightingCheck(covered)?.status).toBe('pass')
    expect(lightingCheck(light([null, null, null], [null, null, null], [null, null, null], [null, null, null]))).toBeNull()
    expect(lightingCheck(null)).toBeNull()
  })
})
