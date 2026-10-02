import { describe, expect, it } from 'vitest'
import { CANADA_50X70, INDIA_2X2, INTL_35X45, US_PASSPORT } from '../config/photoSpecs'
import { eyewearChecks, faceCountCheck } from './checks'
import type { Crop } from './geometry'
import type { DetectedFace, EyewearAnalysis, FaceAnalysis } from './vision'

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
