import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { BackgroundStep } from './components/BackgroundStep'
import { CheckStep } from './components/CheckStep'
import { Stepper, type StepDef } from './components/common'
import { CropStep } from './components/CropStep'
import { LayoutStep } from './components/LayoutStep'
import { UploadStep } from './components/UploadStep'
import { PHOTO_SPECS, type PhotoSpec } from './config/photoSpecs'
import { DEFAULT_PRINT_SIZE_ID, PRINT_DPI, PRINT_SIZES } from './config/printSizes'
import { backgroundCheck, runChecks, type CheckResult } from './lib/checks'
import { autoFit, midpoint, type Crop, type Markers } from './lib/geometry'
import { canvasToJpeg, ctx2d, downloadBlob, loadImageFile, type LoadedImage } from './lib/image'
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

export default function App() {
  const [specId, setSpecId] = useState(PHOTO_SPECS[0].id)
  const spec = PHOTO_SPECS.find((s) => s.id === specId) ?? PHOTO_SPECS[0]
  const [step, setStep] = useState<StepId>('upload')
  const [session, setSession] = useState<Session | null>(null)
  const [markers, setMarkers] = useState<Markers | null>(null)
  const [crop, setCrop] = useState<Crop | null>(null)
  const [autoRefit, setAutoRefit] = useState(true)
  const [bg, setBg] = useState<BackgroundSettings>(() => defaultBackground(spec))
  const [printId, setPrintId] = useState(DEFAULT_PRINT_SIZE_ID)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('auto')
  const [cutGuides, setCutGuides] = useState(true)
  const [attest, setAttest] = useState<Record<string, boolean>>({})
  const [ackWarnings, setAckWarnings] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** MODNet matte for background replacement, and the crop it was computed for. */
  const [matte, setMatte] = useState<{ layer: MaskLayer; crop: Crop } | null>(null)
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
      const m = analysis.markers ?? vision.defaultMarkers(image)
      setSession({ image, analysis })
      setMarkers(m)
      setCrop(autoFit(m, spec))
      // Always start from the original photo; replacing the background is an opt-in edit.
      setBg(defaultBackground(spec))
      setMatte(null)
      setMatteFailedFor(null)
      setAttest({})
      setAckWarnings(false)
      setStep('crop')
    } catch (e) {
      console.error(e)
      setError(e instanceof Error ? e.message : 'Something went wrong while processing the photo.')
    } finally {
      setBusy(null)
    }
  }

  const changeSpec = (id: string) => {
    const next = PHOTO_SPECS.find((s) => s.id === id)
    if (!next) return
    setSpecId(id)
    if (markers) setCrop(autoFit(markers, next))
    setBg((b) => ({ ...b, color: next.backgrounds[0].color }))
    setAttest({})
    setAckWarnings(false)
  }

  const onMarkers = (m: Markers, done: boolean) => {
    setMarkers(m)
    if (done && autoRefit) setCrop(autoFit(m, spec))
  }

  const download = async (kind: 'sheet' | 'photo') => {
    if (!photo || !sheet) return
    const blob = await canvasToJpeg(kind === 'sheet' ? sheet : photo.canvas, PRINT_DPI)
    const name = kind === 'sheet' ? `passport-photo-${spec.id}-${print.id}-print.jpg` : `passport-photo-${spec.id}-digital.jpg`
    downloadBlob(blob, name)
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
            <p>Crop, check and lay out passport photos for cheap Walgreens prints</p>
          </div>
        </div>
        <span className="privacy-badge" title="All processing happens in your browser">
          🔒 Photos stay on your device
        </span>
      </header>

      <Stepper steps={STEPS} current={step} enabled={(s) => s === 'upload' || !!session} onSelect={goto} />

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
            hasDetection={!!session.analysis.markers}
            onCrop={setCrop}
            onMarkers={onMarkers}
            autoRefit={autoRefit}
            onAutoRefit={setAutoRefit}
            onAutoFit={() => setCrop(autoFit(markers, spec))}
            onResetMarkers={() => {
              const m = session.analysis.markers
              if (m) {
                setMarkers(m)
                setCrop(autoFit(m, spec))
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
            onNext={() => goto('layout')}
          />
        )}
        {step === 'layout' && session && (
          <LayoutStep
            spec={spec}
            print={print}
            onPrint={setPrintId}
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
            onFix={onFix}
            onDownloadSheet={() => download('sheet')}
            onDownloadPhoto={() => download('photo')}
            onBack={() => goto('layout')}
          />
        )}
      </main>

      <footer className="app__footer">
        <p>
          Not affiliated with Walgreens or any government agency. Automatic checks help catch common problems but can’t guarantee
          acceptance. Always confirm the current rules with your issuing authority.
        </p>
      </footer>
    </div>
  )
}
