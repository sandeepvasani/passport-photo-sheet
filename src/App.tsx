import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { BackgroundStep } from './components/BackgroundStep'
import { CheckStep } from './components/CheckStep'
import { Stepper, type StepDef } from './components/common'
import { CropStep } from './components/CropStep'
import { LayoutStep } from './components/LayoutStep'
import { UploadStep, type UploadError } from './components/UploadStep'
import { PHOTO_SPECS, type PhotoSpec } from './config/photoSpecs'
import { DEFAULT_PRINT_SIZE_ID, PRINT_DPI, PRINT_SIZES } from './config/printSizes'
import { backgroundCheck, eyewearChecks, faceCountCheck, runChecks, type CheckResult } from './lib/checks'
import { autoFit, midpoint, type Crop, type Markers } from './lib/geometry'
import { canvasToJpeg, canvasToJpegSized, ctx2d, downloadBlob, loadImageFile, releaseCanvas, releaseImage, type LoadedImage } from './lib/image'
import { computeLayout, type LayoutMode } from './lib/layout'
import type { MaskLayer } from './lib/mask'
import { matteCovers, portraitMatte } from './lib/matte'
import { renderCrop, renderPhoto, type BackgroundSettings } from './lib/render'
import { renderSheet } from './lib/sheet'
import type { FaceAnalysis } from './lib/vision'

type StepId = 'upload' | 'crop' | 'background' | 'layout' | 'check'

const STEPS: StepDef<StepId>[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'crop', label: 'Crop' },
  { id: 'background', label: 'Background' },
  { id: 'layout', label: 'Print layout' },
  { id: 'check', label: 'Check & download' },
]

/** Which step fixes each check. */
const FIX_STEP: Record<string, StepId> = {
  head: 'crop',
  'face-width': 'crop',
  eyes: 'crop',
  top: 'crop',
  chin: 'crop',
  center: 'crop',
  level: 'crop',
  coverage: 'crop',
  background: 'background',
  edited: 'background',
}

interface Session {
  image: LoadedImage
  analysis: FaceAnalysis
}

const defaultBackground = (spec: PhotoSpec): BackgroundSettings => ({
  mode: 'original',
  color: spec.backgrounds[0].color,
  feather: 5,
  expand: 0,
})

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))

const NO_FACE_ERROR: UploadError = {
  message: 'We couldn’t find a face in this photo. Please try a different one:',
  tips: [
    'Your whole face is in the photo, looking straight at the camera.',
    'The light is bright and even: not too dark, and no bright window behind you.',
    'You’re not too far away: about 4 ft (1.2 m) from the camera works well.',
    'Nothing covers your face: no mask, hat brim, hands or hair over your eyes.',
  ],
}

export default function App() {
  const [specId, setSpecId] = useState(PHOTO_SPECS[0].id)
  const spec = PHOTO_SPECS.find((s) => s.id === specId) ?? PHOTO_SPECS[0]
  /** The photo only goes into an online form, so there's no print layout step. */
  const uploadOnly = !!spec.digital?.uploadOnly
  const [step, setStep] = useState<StepId>('upload')
  const [session, setSession] = useState<Session | null>(null)
  const [markers, setMarkers] = useState<Markers | null>(null)
  const [crop, setCrop] = useState<Crop | null>(null)
  const [autoRefit, setAutoRefit] = useState(true)
  const [bg, setBg] = useState<BackgroundSettings>(() => defaultBackground(spec))
  const [printId, setPrintId] = useState(spec.defaultPrintSizeId ?? DEFAULT_PRINT_SIZE_ID)
  /** Once the user picks a print size, switching photo type no longer changes it. */
  const [printChosen, setPrintChosen] = useState(false)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('auto')
  const [cutGuides, setCutGuides] = useState(true)
  const [attest, setAttest] = useState<Record<string, boolean>>({})
  const [ackWarnings, setAckWarnings] = useState(false)
  const [ackFailures, setAckFailures] = useState<string | null>(null)
  /** Result of the last online-upload download (file size, or why it failed). */
  const [saved, setSaved] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<UploadError | null>(null)
  /** MODNet matte for background replacement, and the crop it was computed for. */
  const [matte, setMatte] = useState<{ layer: MaskLayer; crop: Crop } | null>(null)
  const [subjectBusy, setSubjectBusy] = useState(false)
  /** Crop for which computing the matte failed (so it isn't retried in a loop). */
  const [matteFailedFor, setMatteFailedFor] = useState<Crop | null>(null)

  const print = PRINT_SIZES.find((p) => p.id === printId) ?? PRINT_SIZES[0]
  const deferredBg = useDeferredValue(bg)
  const deferredCrop = useDeferredValue(crop)
  const needsRender = step === 'background' || step === 'layout' || step === 'check'

  // Compute the hair-detail matte when replacing the background; reuse it while it still covers the crop.
  const wantMatte = !!session && !!crop && bg.mode === 'replace' && needsRender
  const matteReady = !!(session && crop && matte && (matte.crop === crop || matteCovers(matte.layer, crop, spec, session.image)))
  const matteStatus = !wantMatte || matteReady ? 'idle' : matteFailedFor === crop ? 'error' : 'loading'
  useEffect(() => {
    if (!session || !crop || matteStatus !== 'loading') return
    let cancelled = false
    portraitMatte(session.image, crop, spec).then(
      (layer) => !cancelled && setMatte({ layer, crop }),
      (err) => {
        console.error(err)
        if (!cancelled) setMatteFailedFor(crop)
      },
    )
    return () => {
      cancelled = true
    }
  }, [session, crop, spec, matteStatus])

  const subject = useMemo(() => (markers ? midpoint(markers.eyeLeft, markers.eyeRight) : undefined), [markers])
  const masks = useMemo(
    () => (session ? (deferredBg.mode === 'replace' && matte ? [...session.analysis.masks, matte.layer] : session.analysis.masks) : []),
    [session, deferredBg.mode, matte],
  )
  const photo = useMemo(
    () =>
      session && deferredCrop && needsRender
        ? renderPhoto(session.image, masks, deferredCrop, spec, deferredBg, PRINT_DPI, subject)
        : null,
    [session, masks, deferredCrop, spec, deferredBg, needsRender, subject],
  )
  const originalPreview = useMemo(
    () => (session && crop && step === 'background' ? renderCrop(session.image, crop, spec, 6) : null),
    [session, crop, spec, step],
  )
  const bgResult = useMemo(
    () => (photo ? backgroundCheck(photo, ctx2d(photo.canvas).getImageData(0, 0, photo.width, photo.height).data, spec, deferredBg) : null),
    [photo, spec, deferredBg],
  )
  const layout = useMemo(() => computeLayout(spec, print, layoutMode), [spec, print, layoutMode])
  const sheet = useMemo(
    () => (photo && (step === 'layout' || step === 'check') ? renderSheet(photo.canvas, layout, spec, { cutGuides }, PRINT_DPI) : null),
    [photo, layout, spec, cutGuides, step],
  )
  const results = useMemo(
    () =>
      session && markers && deferredCrop && photo && step === 'check'
        ? runChecks({ spec, image: session.image, analysis: session.analysis, markers, crop: deferredCrop, bg: deferredBg, photo })
        : [],
    [session, markers, deferredCrop, photo, spec, deferredBg, step],
  )

  // Free canvas memory as soon as something is replaced (iOS Safari caps the total).
  // Switching subject keeps the same photo and full-image mask, so only free what's gone.
  const prevSession = useRef<Session | null>(null)
  useEffect(() => {
    const prev = prevSession.current
    prevSession.current = session
    if (!prev || prev === session) return
    const kept = new Set<unknown>(session ? [session.image, ...session.analysis.masks] : [])
    if (!kept.has(prev.image)) releaseImage(prev.image)
    for (const layer of prev.analysis.masks) if (!kept.has(layer)) releaseCanvas(layer.canvas)
  }, [session])
  useEffect(() => () => releaseCanvas(matte?.layer.canvas), [matte])
  useEffect(() => () => releaseCanvas(photo?.canvas), [photo])
  useEffect(() => () => releaseCanvas(sheet), [sheet])
  useEffect(() => () => releaseCanvas(originalPreview), [originalPreview])

  const handleFile = async (file: File) => {
    setError(null)
    setBusy('Opening photo…')
    try {
      // MediaPipe is large, so it's loaded on first use rather than with the page.
      const visionModule = import('./lib/vision')
      const image = await loadImageFile(file)
      setBusy('Loading face detection (first visit downloads about 30 MB)…')
      const vision = await visionModule
      await vision.loadModels()
      setBusy('Finding your face…')
      await nextFrame()
      const analysis = await vision.analyzePhoto(image)
      const m = analysis.markers
      if (analysis.faceCount === 0 || !m) {
        // Stay here: a photo without a detectable face can never pass the final check.
        releaseImage(image)
        for (const layer of analysis.masks) releaseCanvas(layer.canvas)
        setError(NO_FACE_ERROR)
        return
      }
      setSession({ image, analysis })
      setMarkers(m)
      setCrop(autoFit(m, spec, image))
      // Always start from the original photo; replacing the background is an opt-in edit.
      setBg(defaultBackground(spec))
      setMatte(null)
      setMatteFailedFor(null)
      setAttest({})
      setAckWarnings(false)
      setAckFailures(null)
      setSaved(null)
      setStep('crop')
    } catch (e) {
      console.error(e)
      setError({ message: e instanceof Error ? e.message : 'Something went wrong while processing the photo.' })
    } finally {
      setBusy(null)
    }
  }

  const changeSpec = (id: string) => {
    const next = PHOTO_SPECS.find((s) => s.id === id)
    if (!next) return
    setSpecId(id)
    if (!printChosen) setPrintId(next.defaultPrintSizeId)
    if (markers) setCrop(autoFit(markers, next, session?.image))
    setBg((b) => ({ ...b, color: next.backgrounds[0].color }))
    setAttest({})
    setAckWarnings(false)
    setAckFailures(null)
    setSaved(null)
  }

  /** Re-centre everything on another detected person. */
  const chooseSubject = async (index: number) => {
    if (!session || index === session.analysis.subject) return
    setSubjectBusy(true)
    try {
      const vision = await import('./lib/vision')
      const analysis = await vision.selectSubject(session.image, session.analysis, index)
      if (!analysis.markers) return
      setSession({ image: session.image, analysis })
      setMarkers(analysis.markers)
      setCrop(autoFit(analysis.markers, spec, session.image))
      setAckWarnings(false)
      setAckFailures(null)
    } finally {
      setSubjectBusy(false)
    }
  }

  const onMarkers = (m: Markers, done: boolean) => {
    setMarkers(m)
    if (done && autoRefit) setCrop(autoFit(m, spec, session?.image))
  }

  const download = async (kind: 'sheet' | 'photo') => {
    if (!photo || !sheet || !session || !deferredCrop) return
    const digital = spec.digital
    if (kind === 'sheet' || !digital) {
      const blob = await canvasToJpeg(kind === 'sheet' ? sheet : photo.canvas, PRINT_DPI)
      downloadBlob(blob, kind === 'sheet' ? `passport-photo-${spec.id}-${print.id}-print.jpg` : `passport-photo-${spec.id}-digital.jpg`)
      return
    }
    // Rendered straight from the original at the exact pixel size, not resized from the print version.
    const dpi = (digital.widthPx / spec.widthMm) * 25.4
    const out = renderPhoto(session.image, masks, deferredCrop, spec, deferredBg, dpi, subject)
    try {
      const blob = await canvasToJpegSized(out.canvas, Math.round(dpi), digital.maxBytes, digital.minBytes)
      downloadBlob(blob, `passport-photo-${spec.id}-${out.width}x${out.height}.jpg`)
      setSaved({ text: `Saved: ${out.width} × ${out.height} px JPEG, ${Math.ceil(blob.size / 1000)} KB.` })
    } catch (e) {
      setSaved({ text: e instanceof Error ? e.message : 'Couldn’t save the photo.', error: true })
    } finally {
      releaseCanvas(out.canvas)
    }
  }

  const onFix = (r: CheckResult) => setStep(FIX_STEP[r.id] ?? 'upload')

  const goto = (s: StepId) => {
    setStep(s)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">
          <span className="brand__logo" aria-hidden>
            ▣
          </span>
          <div>
            <h1>Passport Photo Sheet</h1>
            <p>Crop, check and lay out passport photos on a standard photo print</p>
          </div>
        </div>
        <span className="privacy-badge" title="All processing happens in your browser">
          🔒 Photos stay on your device
        </span>
      </header>

      <Stepper steps={uploadOnly ? STEPS.filter((s) => s.id !== 'layout') : STEPS} current={step} enabled={(s) => s === 'upload' || !!session} onSelect={goto} />

      <main className="app__main">
        {step === 'upload' && (
          <UploadStep
            specs={PHOTO_SPECS}
            spec={spec}
            onSpec={changeSpec}
            onFile={handleFile}
            busy={busy}
            error={error}
            hasPhoto={!!session}
            onContinue={() => goto('crop')}
          />
        )}
        {step === 'crop' && session && markers && crop && (
          <CropStep
            image={session.image}
            spec={spec}
            markers={markers}
            crop={crop}
            bg={bg}
            earlyIssues={[faceCountCheck(session.analysis, crop, spec), ...eyewearChecks(spec, session.analysis.eyewear)].filter(
              (r) => r.status !== 'pass',
            )}
            faces={session.analysis.faces}
            subject={session.analysis.subject}
            subjectBusy={subjectBusy}
            onSubject={chooseSubject}
            onCrop={setCrop}
            onMarkers={onMarkers}
            autoRefit={autoRefit}
            onAutoRefit={setAutoRefit}
            onAutoFit={() => setCrop(autoFit(markers, spec, session.image))}
            onResetMarkers={() => {
              const m = session.analysis.markers
              if (m) {
                setMarkers(m)
                setCrop(autoFit(m, spec, session.image))
              }
            }}
            onBack={() => goto('upload')}
            onNext={() => goto('background')}
          />
        )}
        {step === 'background' && session && (
          <BackgroundStep
            spec={spec}
            bg={bg}
            onBg={setBg}
            photo={photo}
            original={originalPreview}
            check={bgResult}
            matteStatus={matteStatus}
            onBack={() => goto('crop')}
            onNext={() => goto(uploadOnly ? 'check' : 'layout')}
            nextLabel={uploadOnly ? 'Next: Check & download →' : 'Next: Print layout →'}
          />
        )}
        {step === 'layout' && session && (
          <LayoutStep
            spec={spec}
            print={print}
            onPrint={(id) => {
              setPrintId(id)
              setPrintChosen(true)
            }}
            mode={layoutMode}
            onMode={setLayoutMode}
            cutGuides={cutGuides}
            onCutGuides={setCutGuides}
            layout={layout}
            sheet={sheet}
            onBack={() => goto('background')}
            onNext={() => goto('check')}
          />
        )}
        {step === 'check' && session && photo && sheet && (
          <CheckStep
            spec={spec}
            print={print}
            results={results}
            photo={photo}
            sheet={sheet}
            photoCount={layout.cells.length}
            attest={attest}
            onAttest={(id, v) => setAttest((a) => ({ ...a, [id]: v }))}
            ackWarnings={ackWarnings}
            onAckWarnings={setAckWarnings}
            ackFailures={ackFailures}
            onAckFailures={setAckFailures}
            onFix={onFix}
            onDownloadSheet={() => download('sheet')}
            onDownloadPhoto={() => download('photo')}
            saved={saved}
            onSwitchSpec={(id) => {
              changeSpec(id)
              goto('crop')
            }}
            onBack={() => goto(uploadOnly ? 'background' : 'layout')}
          />
        )}
      </main>

      <footer className="app__footer">
        <p>
          Not affiliated with any photo lab or government agency. Automatic checks help catch common problems but can’t guarantee
          acceptance. Always confirm the current rules with your issuing authority.
        </p>
      </footer>
    </div>
  )
}
