import { formatLength, formatRange, type PhotoSpec } from '../config/photoSpecs'
import { eyeLineAngle, measure, sourceToFrame, uncoveredFraction, type Crop, type Markers, type Point } from './geometry'
import { ctx2d, type LoadedImage } from './image'
import type { BackgroundSettings, RenderedPhoto } from './render'
import type { DetectedFace, EyewearAnalysis, FaceAnalysis } from './vision'

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface CheckResult {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

export interface CheckInput {
  spec: PhotoSpec
  image: LoadedImage
  analysis: FaceAnalysis
  markers: Markers
  crop: Crop
  bg: BackgroundSettings
  photo: RenderedPhoto
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

// Face-mesh landmark indices.
const LM_LIP_TOP = 13
const LM_LIP_BOTTOM = 14
const LM_MOUTH_LEFT = 61
const LM_MOUTH_RIGHT = 291
const LM_IRIS_A = 468
const LM_IRIS_B = 473
const LM_FOREHEAD = 10
const LM_CHIN = 152

/**
 * Share of the person's pixels below `fromY` (the shoulders and chest) that
 * are near-white; null when too little clothing is in the frame to judge.
 */
function whiteClothingFraction(photo: RenderedPhoto, data: Uint8ClampedArray, fromY: number): number | null {
  let white = 0
  let total = 0
  for (let y = Math.max(0, Math.ceil(fromY)); y < photo.height; y++) {
    for (let x = 0; x < photo.width; x++) {
      const i = y * photo.width + x
      if (photo.alpha[i] < 0.9) continue
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
      total++
      if (lum(r, g, b) > 205 && Math.max(r, g, b) - Math.min(r, g, b) < 25) white++
    }
  }
  return total > photo.width * photo.height * 0.03 ? white / total : null
}

/** Fraction of the pupil (inner half of the iris) that is saturated red. */
function redPupilFraction(photo: RenderedPhoto, data: Uint8ClampedArray, lms: Point[], center: number): number {
  const c = lms[center]
  const irisR = [1, 2, 3, 4].reduce((s, i) => s + Math.hypot(lms[center + i].x - c.x, lms[center + i].y - c.y), 0) / 4
  const r = irisR * 0.5
  let hits = 0
  let total = 0
  for (let y = Math.round(c.y - r); y <= c.y + r; y++) {
    for (let x = Math.round(c.x - r); x <= c.x + r; x++) {
      if (x < 0 || y < 0 || x >= photo.width || y >= photo.height) continue
      if ((x - c.x) ** 2 + (y - c.y) ** 2 > r * r) continue
      const i = (y * photo.width + x) * 4
      total++
      if (data[i] > 100 && data[i] > 1.6 * data[i + 1] && data[i] > 1.6 * data[i + 2]) hits++
    }
  }
  return total > 4 ? hits / total : 0
}

function inRange(v: number, r: { min: number; max: number }, tol = 0.05) {
  return v >= r.min - tol && v <= r.max + tol
}

/** Geometry checks only — cheap enough to run on every drag in the crop editor. */
export function geometryChecks(spec: PhotoSpec, markers: Markers, crop: Crop, image: LoadedImage, bg: BackgroundSettings): CheckResult[] {
  const m = measure(markers, crop, spec)
  const u = spec.displayUnit
  const out: CheckResult[] = []

  out.push({
    id: 'head',
    label: 'Head size (chin to top of hair)',
    status: inRange(m.headHeightMm, spec.headHeightMm) ? 'pass' : 'fail',
    detail: `${formatLength(m.headHeightMm, u)} — must be ${formatRange(spec.headHeightMm, u)}`,
  })

  if (spec.eyeFromBottomMm) {
    out.push({
      id: 'eyes',
      label: 'Eye height from bottom',
      status: inRange(m.eyeFromBottomMm, spec.eyeFromBottomMm) ? 'pass' : spec.eyeLineRequired ? 'fail' : 'warn',
      detail: spec.eyeLineRequired
        ? `${formatLength(m.eyeFromBottomMm, u)} — must be ${formatRange(spec.eyeFromBottomMm, u)}`
        : `${formatLength(m.eyeFromBottomMm, u)} (guideline ${formatRange(spec.eyeFromBottomMm, u)})`,
    })
  }

  if (m.topMarginMm < -0.2) {
    out.push({
      id: 'top',
      label: 'Space above head',
      status: 'warn',
      detail: 'The hair goes past the top edge. That’s allowed as long as your whole head is shown and the head size is right.',
    })
  } else if (spec.topMarginMm) {
    const ok = inRange(m.topMarginMm, spec.topMarginMm, 0.3)
    out.push({
      id: 'top',
      label: 'Space above head',
      status: ok ? 'pass' : 'warn',
      detail: `${formatLength(m.topMarginMm, u)} (guideline ${formatRange(spec.topMarginMm, u)})`,
    })
  }

  if (m.chinFromBottomMm < 0) {
    out.push({ id: 'chin', label: 'Chin in frame', status: 'fail', detail: 'The chin is cut off at the bottom.' })
  }

  const offPct = (Math.abs(m.centerOffsetMm) / spec.widthMm) * 100
  out.push({
    id: 'center',
    label: 'Face centred',
    status: offPct <= 4 ? 'pass' : offPct <= 8 ? 'warn' : 'fail',
    detail: offPct <= 4 ? 'Centred horizontally' : `${offPct.toFixed(0)}% off centre`,
  })

  const tilt = Math.abs(m.tiltDeg)
  // How far the head leans in the original photo; straightening it rotates the shoulders instead.
  const angle = (eyeLineAngle(markers) * 180) / Math.PI
  const originalTilt = Math.abs(((angle + 90) % 180 + 180) % 180 - 90)
  out.push(
    tilt > 3
      ? { id: 'level', label: 'Head level', status: tilt <= 6 ? 'warn' : 'fail', detail: `Eyes tilted ${tilt.toFixed(1)}°` }
      : originalTilt > 8
        ? {
            id: 'level',
            label: 'Head level',
            status: 'warn',
            detail: `Your head is tilted about ${Math.round(originalTilt)}° in the original photo. It’s been straightened, but your shoulders now lean instead. Passport rules ask for a straight head, so retake it if you can.`,
          }
        : { id: 'level', label: 'Head level', status: 'pass', detail: `Eyes tilted ${tilt.toFixed(1)}°` },
  )

  const uncovered = uncoveredFraction(crop, spec, image.width, image.height)
  if (uncovered > 0.002) {
    const pct = Math.max(1, Math.round(uncovered * 100))
    const tooClose = 'This usually means the photo was taken too close, which is common with selfies. Retake it from about 4 ft (1.2 m) away, or ask someone else to take it.'
    out.push({
      id: 'coverage',
      label: 'Photo fills the frame',
      status: bg.mode === 'replace' ? 'warn' : 'fail',
      detail:
        bg.mode === 'replace'
          ? `${pct}% of the frame is past the edge of your photo and is filled with the background colour. ${tooClose}`
          : `${pct}% of the frame is past the edge of your photo. ${tooClose}`,
    })
  }

  const dpi = crop.pxPerMm * 25.4
  out.push({
    id: 'resolution',
    label: 'Print resolution',
    status: dpi >= 290 ? 'pass' : dpi >= 180 ? 'warn' : 'fail',
    detail:
      dpi >= 290
        ? `${Math.round(dpi)} pixels per inch`
        : `Only ${Math.round(dpi)} pixels per inch (300 recommended) — the print may look soft. Use a higher-resolution photo or move closer to the camera.`,
  })
  return out
}

interface FacePixels {
  lum: number[]
  chroma: number[]
  /** Mean R, G, B over the face. */
  rgb: [number, number, number]
}

function facePixels(photo: RenderedPhoto, data: Uint8ClampedArray, pts: Point[]): FacePixels {
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const x0 = Math.max(0, Math.floor(Math.min(...xs)))
  const x1 = Math.min(photo.width - 1, Math.ceil(Math.max(...xs)))
  const y0 = Math.max(0, Math.floor(Math.min(...ys)))
  const y1 = Math.min(photo.height - 1, Math.ceil(Math.max(...ys)))
  const out: FacePixels = { lum: [], chroma: [], rgb: [0, 0, 0] }
  let sr = 0, sg = 0, sb = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * photo.width + x
      if (photo.alpha[i] < 0.9) continue
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
      out.lum.push(lum(r, g, b))
      out.chroma.push(Math.max(r, g, b) - Math.min(r, g, b))
      sr += r; sg += g; sb += b
    }
  }
  const n = Math.max(1, out.lum.length)
  out.rgb = [sr / n, sg / n, sb / n]
  return out
}

function patchLuminance(photo: RenderedPhoto, data: Uint8ClampedArray, c: Point, radius: number): number | null {
  let sum = 0
  let n = 0
  for (let y = Math.round(c.y - radius); y <= c.y + radius; y++) {
    for (let x = Math.round(c.x - radius); x <= c.x + radius; x++) {
      if (x < 0 || y < 0 || x >= photo.width || y >= photo.height) continue
      if ((x - c.x) ** 2 + (y - c.y) ** 2 > radius * radius) continue
      const i = y * photo.width + x
      sum += lum(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
      n++
    }
  }
  return n > 10 ? sum / n : null
}

/** Variance of the Laplacian over a region — a standard focus/blur measure. */
function sharpness(photo: RenderedPhoto, data: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number): number {
  const w = photo.width
  const g = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return lum(data[i], data[i + 1], data[i + 2])
  }
  let sum = 0
  let sum2 = 0
  let n = 0
  for (let y = Math.max(1, y0); y < Math.min(photo.height - 1, y1); y++) {
    for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
      const l = g(x - 1, y) + g(x + 1, y) + g(x, y - 1) + g(x, y + 1) - 4 * g(x, y)
      sum += l
      sum2 += l * l
      n++
    }
  }
  if (n === 0) return 0
  const mean = sum / n
  return sum2 / n - mean * mean
}

/** Checks that the background (pixels outside the person matte) is plain, light and even. */
export function backgroundCheck(
  photo: RenderedPhoto,
  data: Uint8ClampedArray,
  spec: PhotoSpec,
  bg: BackgroundSettings,
): CheckResult {
  const label = 'Plain light background'
  if (bg.mode === 'replace') {
    return { id: 'background', label, status: 'pass', detail: 'Background replaced with a plain colour' }
  }
  let n = 0, sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0
  let leftSum = 0, leftN = 0, rightSum = 0, rightN = 0
  for (let y = 0; y < photo.height; y++) {
    for (let x = 0; x < photo.width; x++) {
      const i = y * photo.width + x
      if (photo.alpha[i] > 0.05) continue
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
      const l = lum(r, g, b)
      n++; sr += r; sg += g; sb += b; sl += l; sl2 += l * l
      if (x < photo.width / 2) { leftSum += l; leftN++ } else { rightSum += l; rightN++ }
    }
  }
  if (n < photo.width * photo.height * 0.05) {
    return { id: 'background', label, status: 'warn', detail: 'Too little background is visible to check it.' }
  }
  const L = sl / n
  const sd = Math.sqrt(Math.max(0, sl2 / n - L * L))
  const chroma = Math.max(sr, sg, sb) / n - Math.min(sr, sg, sb) / n
  const sideDiff = leftN && rightN ? Math.abs(leftSum / leftN - rightSum / rightN) : 0
  const min = spec.backgroundMinLuminance
  if (L < min - 35 || chroma > 30) {
    return {
      id: 'background',
      label,
      status: 'fail',
      detail:
        chroma > 30
          ? 'Background is coloured. Use a plain white or light background, or replace it.'
          : 'Background is too dark. Use a plain white or light background, or replace it.',
    }
  }
  if (L < min || chroma > 15) {
    return { id: 'background', label, status: 'warn', detail: 'Background is a little dark or tinted. Consider replacing it.' }
  }
  if (sd > 16 || sideDiff > 18) {
    return { id: 'background', label, status: 'warn', detail: 'Background is uneven — there may be shadows or texture behind you.' }
  }
  return { id: 'background', label, status: 'pass', detail: 'Background is plain and light' }
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)

/** Glasses, lens reflections and tinted lenses, judged against the spec's glasses rule. */
export function eyewearChecks(spec: PhotoSpec, eyewear: EyewearAnalysis | null): CheckResult[] {
  if (!eyewear) return []
  if (!eyewear.detected) {
    return [{ id: 'glasses', label: spec.glasses === 'allowed' ? 'Glasses' : 'No glasses', status: 'pass', detail: 'No glasses detected' }]
  }
  if (spec.glasses === 'forbidden') {
    return [
      {
        id: 'glasses',
        label: 'No glasses',
        status: 'fail',
        detail: 'Glasses detected. Take them off and retake the photo; they’re only allowed with a signed medical statement.',
      },
    ]
  }
  if (spec.glasses === 'discouraged') {
    return [
      {
        id: 'glasses',
        label: 'No glasses',
        status: 'warn',
        detail: 'Glasses detected. Many countries don’t accept glasses in passport photos, so check your country’s rules or retake without them.',
      },
    ]
  }
  const out: CheckResult[] = [
    { id: 'glasses', label: 'Glasses', status: 'pass', detail: 'Glasses detected: allowed if your eyes are clearly visible' },
  ]
  const glare = eyewear.glareShare
  out.push({
    id: 'glare',
    label: 'No glare on glasses',
    status: glare > 0.03 ? 'fail' : glare > 0.01 ? 'warn' : 'pass',
    detail:
      glare > 0.01
        ? 'There’s a reflection on your glasses. Turn off the flash, tilt your head slightly up or down, or move the light to the side and retake.'
        : 'No reflections on the lenses',
  })
  const tinted = eyewear.lensBrightness < 0.45
  out.push({
    id: 'tint',
    label: 'Clear lenses',
    status: tinted ? 'fail' : 'pass',
    detail: tinted ? 'Your lenses look tinted or dark. Wear clear glasses, or take them off.' : 'Lenses look clear',
  })
  return out
}

/** Whether any part of a face (grown a little to cover hair and ears) falls inside the passport frame. */
export function faceInFrame(face: DetectedFace, crop: Crop, spec: PhotoSpec): boolean {
  const { x, y, w, h } = face.box
  const grow = 0.25
  const n = 7
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = sourceToFrame(
        { x: x - w * grow + (w * (1 + 2 * grow) * i) / (n - 1), y: y - h * grow + (h * (1 + 2 * grow) * j) / (n - 1) },
        crop,
        spec,
      )
      if (p.x >= 0 && p.y >= 0 && p.x <= spec.widthMm && p.y <= spec.heightMm) return true
    }
  }
  return false
}

/**
 * Only the applicant may appear in the finished photo. Other people elsewhere
 * in the uploaded picture are fine as long as they stay out of the frame.
 */
export function faceCountCheck(analysis: FaceAnalysis, crop: Crop, spec: PhotoSpec): CheckResult {
  if (analysis.faceCount === 0) {
    return { id: 'face', label: 'Face detected', status: 'fail', detail: 'No face could be detected. Use a clear, front-facing photo with good lighting.' }
  }
  if (analysis.faceCount === 1) return { id: 'face', label: 'One person', status: 'pass', detail: 'Exactly one face found' }
  const others = analysis.faces.filter((_, i) => i !== analysis.subject)
  if (others.some((f) => faceInFrame(f, crop, spec))) {
    return {
      id: 'face',
      label: 'Only one person in the frame',
      status: 'fail',
      detail: 'Another person’s face is inside the photo frame. Zoom in or move the photo so only you are in it, or retake the photo alone.',
    }
  }
  return {
    id: 'face',
    label: 'Only one person in the frame',
    status: 'warn',
    detail:
      'There’s someone else in your original photo. Their face is outside the frame, but check that no part of them (hair, shoulder, arm or hand) shows. If it does, retake the photo alone.',
  }
}

/** Full compliance check of the finished photo. */
export function runChecks(input: CheckInput): CheckResult[] {
  const { spec, image, analysis, markers, crop, bg, photo } = input
  const results: CheckResult[] = []
  const data = ctx2d(photo.canvas).getImageData(0, 0, photo.width, photo.height).data

  results.push(faceCountCheck(analysis, crop, spec))

  results.push(...geometryChecks(spec, markers, crop, image, bg))
  if (analysis.crownAtImageEdge) {
    results.push({
      id: 'crown-edge',
      label: 'Top of head visible',
      status: 'warn',
      detail: 'The hair touches the top edge of your original photo, so the head size may be underestimated. Retake with more space above the head.',
    })
  }

  const bs = analysis.blendshapes
  if (analysis.faceCount > 0) {
    const blink = Math.max(bs.eyeBlinkLeft ?? 0, bs.eyeBlinkRight ?? 0)
    results.push({
      id: 'eyes-open',
      label: 'Both eyes open',
      status: blink < 0.5 ? 'pass' : blink < 0.7 ? 'warn' : 'fail',
      detail: blink < 0.5 ? 'Eyes look open' : 'One or both eyes look closed or squinting.',
    })

    const smile = ((bs.mouthSmileLeft ?? 0) + (bs.mouthSmileRight ?? 0)) / 2
    const lms = analysis.landmarks
    const dist = (a: number, b: number) => Math.hypot(lms[a].x - lms[b].x, lms[a].y - lms[b].y)
    // Gap between the inner lips relative to mouth width: ~0 when closed, >0.1 when teeth show.
    const lipsApart = dist(LM_LIP_TOP, LM_LIP_BOTTOM) / Math.max(1, dist(LM_MOUTH_LEFT, LM_MOUTH_RIGHT)) > 0.06
    if (spec.expression === 'neutral') {
      const ok = smile < 0.35 && !lipsApart
      results.push({
        id: 'expression',
        label: 'Neutral expression, mouth closed',
        status: ok ? 'pass' : 'warn',
        detail: ok ? 'Expression looks neutral' : 'This document needs a neutral expression with the mouth closed, so no smile.',
      })
    } else {
      results.push({
        id: 'expression',
        label: 'Mouth closed',
        status: lipsApart ? 'warn' : 'pass',
        detail: lipsApart
          ? 'Your lips look parted. You can smile, but keep your mouth closed.'
          : 'Mouth looks closed',
      })
    }
  }

  results.push(...eyewearChecks(spec, analysis.eyewear))

  if (analysis.pose) {
    // Pitch estimates also shift with camera height, so they're held to a looser standard.
    const yaw = Math.abs(analysis.pose.yaw)
    const pitch = Math.abs(analysis.pose.pitch)
    const status: CheckStatus = yaw > 15 ? 'fail' : yaw > 8 || pitch > 15 ? 'warn' : 'pass'
    results.push({
      id: 'facing',
      label: 'Facing the camera',
      status,
      detail:
        status === 'pass'
          ? 'Looking straight at the camera'
          : yaw > 8
            ? `Head turned about ${Math.round(yaw)}° to the side — face the camera directly.`
            : `Head tilted about ${Math.round(pitch)}° up or down — keep your chin level with the camera at eye height.`,
    })
  }

  results.push(backgroundCheck(photo, data, spec, bg))
  if (bg.mode === 'replace') {
    results.push({
      id: 'edited',
      label: 'Original, unedited photo',
      status: 'warn',
      detail: `${spec.editingPolicy} A replaced background may get the photo rejected. The safest option is to retake it against a plain white wall or sheet and keep the original background.`,
    })
  }

  // Face lighting, colour and focus — measured on the finished photo.
  if (analysis.landmarks.length > 0) {
    const k = photo.pxPerMm
    const toOut = (p: Point) => {
      const q = sourceToFrame(p, crop, spec)
      return { x: q.x * k, y: q.y * k }
    }
    const lms = analysis.landmarks.map(toOut)
    const face = facePixels(photo, data, lms)
    if (face.lum.length > 100) {
      const bright = face.lum.filter((l) => l >= 250).length / face.lum.length
      const dark = face.lum.filter((l) => l <= 20).length / face.lum.length
      const L = mean(face.lum)
      const exposureOk = bright < 0.05 && dark < 0.1 && L > 45
      results.push({
        id: 'exposure',
        label: 'Face well exposed',
        status: exposureOk ? 'pass' : 'warn',
        detail: exposureOk ? 'Exposure looks good' : bright >= 0.05 ? 'Parts of the face are overexposed (washed out).' : 'The face is too dark — add more light.',
      })

      const faceW = Math.hypot(lms[454].x - lms[234].x, lms[454].y - lms[234].y)
      const l1 = patchLuminance(photo, data, lms[50], faceW * 0.08)
      const l2 = patchLuminance(photo, data, lms[280], faceW * 0.08)
      if (l1 !== null && l2 !== null) {
        const diff = Math.abs(l1 - l2) / Math.max(l1, l2, 1)
        results.push({
          id: 'shadows',
          label: 'Even lighting on face',
          status: diff <= 0.22 ? 'pass' : 'warn',
          detail: diff <= 0.22 ? 'No strong shadows detected' : 'One side of the face is noticeably darker. Face a window or use even, diffuse light.',
        })
      }

      const [mr, mg, mb] = face.rgb
      const tinted = mb > mr * 0.85 || mg > mr * 0.95
      results.push({
        id: 'skin-tone',
        label: 'Natural skin tones',
        status: tinted ? 'warn' : 'pass',
        detail: tinted
          ? 'Skin tones look tinted (for example bluish or greenish). Check the camera’s white balance or the lighting and retake.'
          : 'Colours look natural',
      })

      const redEye = [LM_IRIS_A, LM_IRIS_B].some((c) => redPupilFraction(photo, data, lms, c) > 0.2)
      results.push({
        id: 'red-eye',
        label: 'No red eye',
        status: redEye ? 'warn' : 'pass',
        detail: redEye ? 'Red eye detected. Retake without the flash; don’t edit it out.' : 'No red eye detected',
      })

      if (spec.requiresColouredClothing) {
        const chinY = lms[LM_CHIN].y
        const headPx = Math.hypot(lms[LM_CHIN].x - lms[LM_FOREHEAD].x, lms[LM_CHIN].y - lms[LM_FOREHEAD].y)
        const white = whiteClothingFraction(photo, data, chinY + headPx * 0.25)
        if (white !== null) {
          results.push({
            id: 'attire',
            label: 'Coloured clothing',
            status: white > 0.5 ? 'warn' : 'pass',
            detail:
              white > 0.5
                ? 'Your clothing looks white. Wear plain, coloured clothing (for example a medium blue shirt) so it stands out from the white background.'
                : 'Clothing isn’t white',
          })
        }
      }

      const isColor = mean(face.chroma) >= 8
      results.push({
        id: 'color',
        label: 'Colour photo',
        status: isColor ? 'pass' : 'fail',
        detail: isColor ? 'Photo is in colour' : 'The photo looks black and white — colour photos are required.',
      })

      // Focus measured over the eyes-to-mouth band, at 300 DPI scale.
      const eyeY = Math.min(lms[468].y, lms[473].y)
      const mouthY = lms[13].y
      const sharp = sharpness(
        photo,
        data,
        Math.round(lms[234].x + faceW * 0.15),
        Math.round(eyeY - faceW * 0.1),
        Math.round(lms[454].x - faceW * 0.15),
        Math.round(mouthY),
      )
      results.push({
        id: 'focus',
        label: 'In focus',
        status: sharp >= 12 ? 'pass' : 'warn',
        detail: sharp >= 12 ? 'Photo looks sharp' : 'The face looks blurry. Hold the camera steady and make sure the face is in focus.',
      })
    }
  }

  const order: Record<CheckStatus, number> = { fail: 0, warn: 1, pass: 2 }
  return results.sort((a, b) => order[a.status] - order[b.status])
}
