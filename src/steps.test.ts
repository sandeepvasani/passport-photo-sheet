import { describe, expect, it } from 'vitest'
import { PHOTO_SPECS, US_PASSPORT } from './config/photoSpecs'
import { faceCountCheck, geometryChecks } from './lib/checks'
import type { Crop, Markers } from './lib/geometry'
import type { LoadedImage } from './lib/image'
import type { BackgroundSettings } from './lib/render'
import type { DetectedFace, FaceAnalysis } from './lib/vision'
import { fixStep } from './steps'

describe('fixStep', () => {
  it('sends every crop measurement to the Crop step, and resolution problems to Upload', () => {
    // A face tilted 10° in a 3000×4000 photo, and a crop that's off-centre, cuts off the
    // chin and reaches past the left edge, so every measurement reports.
    const t = (10 * Math.PI) / 180
    const at = (dx: number, dy: number) => ({ x: 1500 + dx * Math.cos(t) - dy * Math.sin(t), y: 1600 + dx * Math.sin(t) + dy * Math.cos(t) })
    const markers: Markers = { eyeLeft: at(-150, 0), eyeRight: at(150, 0), crown: at(0, -600), chin: at(0, 600), faceWidthPx: 800 }
    const crop: Crop = { cx: 200, cy: 1000, angle: 0, pxPerMm: 20 }
    const image = { width: 3000, height: 4000 } as LoadedImage
    const bg: BackgroundSettings = { mode: 'original', color: '#ffffff', feather: 5, expand: 0 }

    const ids = new Set(PHOTO_SPECS.flatMap((spec) => geometryChecks(spec, markers, crop, image, bg).map((r) => r.id)))
    expect([...ids]).toEqual(expect.arrayContaining(['head', 'face-width', 'eyes', 'top', 'chin', 'center', 'level', 'coverage']))
    for (const id of ids) expect(fixStep(id), id).toBe(id.endsWith('resolution') ? 'upload' : 'crop')
  })

  it('sends another person in the frame to the Crop step', () => {
    const face = (x: number): DetectedFace => ({ landmarks: [], blendshapes: {}, area: 1, box: { x, y: 400, w: 300, h: 360 } })
    const analysis = { faceCount: 2, faces: [face(1000), face(1450)], subject: 0 } as unknown as FaceAnalysis
    const r = faceCountCheck(analysis, { cx: 1150, cy: 600, angle: 0, pxPerMm: 20 }, US_PASSPORT)
    expect(r.status).toBe('fail')
    expect(fixStep(r.id)).toBe('crop')
  })

  it('sends background problems to the Background step', () => {
    expect(fixStep('background')).toBe('background')
    expect(fixStep('edited')).toBe('background')
  })

  it('sends problems that need a new photo to Upload', () => {
    for (const id of ['expression', 'eyes-open', 'gaze', 'glasses', 'crown-edge', 'shadows', 'focus']) expect(fixStep(id), id).toBe('upload')
  })
})
