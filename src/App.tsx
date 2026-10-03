import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { BackgroundStep } from './components/BackgroundStep'
import { CheckStep } from './components/CheckStep'
import { Stepper, type StepDef } from './components/common'
import { CropStep } from './components/CropStep'
import { DownloadStep } from './components/DownloadStep'
import { UploadStep, type UploadError } from './components/UploadStep'
import { PHOTO_SPECS, type PhotoSpec } from './config/photoSpecs'
import { DEFAULT_PRINT_SIZE_ID, PRINT_DPI, PRINT_SIZES, type PrintSize } from './config/printSizes'
import { backgroundCheck, retakeIssues, runChecks, type CheckResult } from './lib/checks'
import { scoreExpression, type ExpressionScores } from './lib/expression'
import { autoFit, midpoint, type Crop, type Markers, type Point } from './lib/geometry'
import {
  canvasToJpeg,
  canvasToJpegSized,
  ctx2d,
  downloadBlob,
  loadImageFile,
  releaseCanvas,
  releaseImage,
  type LoadedImage,
} from './lib/image'
import { computeLayout, type LayoutMode } from './lib/layout'
import type { MaskLayer } from './lib/mask'
import { matteCovers, portraitMatte } from './lib/matte'
import { renderCrop, renderPhoto, Superseded, type BackgroundSettings, type RenderedPhoto } from './lib/render'
import { registerServiceWorker } from './lib/serviceWorker'
import { SETTINGS_KEY, startingSettings, type Settings } from './settings'
import { renderSheet } from './lib/sheet'
import type { FaceAnalysis } from './lib/vision'
import { checkTodo, fixStep, type StepId } from './steps'

const STEPS: StepDef<StepId>[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'crop', label: 'Crop' },
  { id: 'background', label: 'Background' },
  { id: 'check', label: 'Check' },
  { id: 'download', label: 'Print & download' },
]

interface Session {
  image: LoadedImage
  analysis: FaceAnalysis
}

/** A finished photo, and what it was rendered from. */
interface Rendered {
  photo: RenderedPhoto
  session: Session
  spec: PhotoSpec
  crop: Crop
  bg: BackgroundSettings
  masks: MaskLayer[]
}

const defaultBackground = (spec: PhotoSpec): BackgroundSettings => ({
  mode: 'original',
  color: spec.backgrounds[0].color,
  feather: 5,
  expand: 0,
})

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** The browser can share files through the system share sheet. */
const canShareFiles = () =>
  typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([''], 'photo.jpg', { type: 'image/jpeg' })] })

/** A download: the file, its name, and its size and pixels for online forms. */
interface SavedFile {
  blob: Blob
  name: string
  about?: string
}

/** The browser is set to use less data (Data Saver in Chrome and on Android). */
const saveData = () => !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData

const NO_FACE_ERROR: UploadError = {
  message: 'We couldn’t find a face in this photo. Please try a different one:',
  tips: [
    'Your whole face is in the photo, looking straight at the camera.',
    'The light is bright and even: not too dark, and no bright window behind you.',
    'You’re not too far away: about 4 ft (1.2 m) from the camera works well.',
    'Nothing covers your face: no mask, hat brim, hands or hair over your eyes.',
  ],
}

/**
 * The file a download or share gives: the print sheet, or the single photo (for online forms,
 * rendered straight from the original at the exact pixel size, from the crop and background on screen).
 */
async function makeFile(
  kind: 'sheet' | 'photo',
  from: Rendered,
  sheet: HTMLCanvasElement | null,
  spec: PhotoSpec,
  print: PrintSize,
  subject: Point | undefined,
): Promise<SavedFile> {
  const digital = spec.digital
  if (kind === 'sheet' || !digital) {
    const canvas = kind === 'sheet' ? sheet : from.photo.canvas
    if (!canvas) throw new Error('The print sheet isn’t ready yet.')
    const name = kind === 'sheet' ? `passport-photo-${spec.id}-${print.id}-print.jpg` : `passport-photo-${spec.id}-digital.jpg`
    return { blob: await canvasToJpeg(canvas, PRINT_DPI), name }
  }
  const dpi = (digital.widthPx / spec.widthMm) * 25.4
  const out = await renderPhoto(from.session.image, from.masks, from.crop, spec, from.bg, dpi, subject)
  try {
    const blob = await canvasToJpegSized(out.canvas, Math.round(dpi), digital.maxBytes, digital.minBytes)
    const about = `${out.width} × ${out.height} px JPEG, ${Math.ceil(blob.size / 1000)} KB`
    return { blob, name: `passport-photo-${spec.id}-${out.width}x${out.height}.jpg`, about }
  } finally {
    releaseCanvas(out.canvas)
  }
}

export default function App() {
  const [initial] = useState(() => startingSettings(readStorage(SETTINGS_KEY), location.search))
  const [specId, setSpecId] = useState(initial.specId)
  const spec = PHOTO_SPECS.find((s) => s.id === specId) ?? PHOTO_SPECS[0]
  /** The photo only goes into an online form, so it isn't laid out for printing. */
  const uploadOnly = !!spec.digital?.uploadOnly
  const downloadLabel = uploadOnly ? 'Download' : 'Print & download'
  const [step, setStep] = useState<StepId>('upload')
  const [session, setSession] = useState<Session | null>(null)
  const [markers, setMarkers] = useState<Markers | null>(null)
  const [crop, setCrop] = useState<Crop | null>(null)
  const [autoRefit, setAutoRefit] = useState(true)
  const [bg, setBg] = useState<BackgroundSettings>(() => defaultBackground(spec))
  const [printId, setPrintId] = useState(initial.printId ?? spec.defaultPrintSizeId ?? DEFAULT_PRINT_SIZE_ID)
  /** Once the user picks a print size, switching photo type no longer changes it. */
  const [printChosen, setPrintChosen] = useState(initial.printId !== null)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(initial.layoutMode)
  const [cutGuides, setCutGuides] = useState(initial.cutGuides)
  // Remember the settings for next time, and keep the photo type in the address so the link can be shared.
  useEffect(() => {
    const settings: Settings = { specId, printId: printChosen ? printId : null, layoutMode, cutGuides }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // Storage blocked or full: they just aren't remembered.
    }
    const url = new URL(location.href)
    if (url.searchParams.get('type') === specId) return
    url.searchParams.set('type', specId)
    history.replaceState(history.state, '', url)
  }, [specId, printId, printChosen, layoutMode, cutGuides])
  const [attest, setAttest] = useState<Record<string, boolean>>({})
  const [ackWarnings, setAckWarnings] = useState<string | null>(null)
  const [ackFailures, setAckFailures] = useState<string | null>(null)
  /** Result of the last download: the online-upload file's size, or why a download failed. */
  const [saved, setSaved] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<UploadError | null>(null)
  /** MODNet matte for background replacement, and the crop it was computed for. */
  const [matte, setMatte] = useState<{ layer: MaskLayer; crop: Crop } | null>(null)
  const [subjectBusy, setSubjectBusy] = useState(false)
  /** Why switching to another detected person failed. */
  const [subjectError, setSubjectError] = useState<string | null>(null)
  /** Crop for which computing the matte failed (so it isn't retried in a loop). */
  const [matteFailedFor, setMatteFailedFor] = useState<Crop | null>(null)
  /** FER+ expression scores and the analysis (photo and person) they were computed for. */
  const [expression, setExpression] = useState<{ analysis: FaceAnalysis; scores: ExpressionScores } | null>(null)
  /** Analysis for which the expression model couldn't run (so the check stops waiting). */
  const [expressionFailedFor, setExpressionFailedFor] = useState<FaceAnalysis | null>(null)

  const print = PRINT_SIZES.find((p) => p.id === printId) ?? PRINT_SIZES[0]
  const deferredBg = useDeferredValue(bg)
  const deferredCrop = useDeferredValue(crop)
  const needsRender = step === 'background' || step === 'check' || step === 'download'

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

  // Score the expression in the background; the model downloads while the photo is being cropped.
  // It's 19 MB plus ONNX Runtime, so it's skipped when the browser is set to save data.
  useEffect(() => {
    if (!session || saveData()) return
    let cancelled = false
    scoreExpression(session.image, session.analysis.landmarks).then(
      (scores) => !cancelled && setExpression({ analysis: session.analysis, scores }),
      // Without it, the expression check still covers smiles, parted lips and pouting.
      (err) => {
        console.warn('Expression model unavailable', err)
        if (!cancelled) setExpressionFailedFor(session.analysis)
      },
    )
    return () => {
      cancelled = true
    }
  }, [session])
  const expressionScores =
    !session || saveData() || expressionFailedFor === session.analysis
      ? null
      : expression?.analysis === session.analysis
        ? expression.scores
        : 'pending'

  const subject = useMemo(() => (markers ? midpoint(markers.eyeLeft, markers.eyeRight) : undefined), [markers])
  const masks = useMemo(
    () => (session ? (deferredBg.mode === 'replace' && matte ? [...session.analysis.masks, matte.layer] : session.analysis.masks) : []),
    [session, deferredBg.mode, matte],
  )
  /** The last finished photo, and what it was rendered from. */
  const [rendered, setRendered] = useState<Rendered | null>(null)
  const [renderError, setRenderError] = useState<unknown>(null)
  // Rendering is asynchronous (the edge refinement runs in a worker).
  useEffect(() => {
    if (!session || !deferredCrop || !needsRender) return
    let cancelled = false
    const [crop, bg] = [deferredCrop, deferredBg]
    renderPhoto(session.image, masks, crop, spec, bg, PRINT_DPI, subject, { replaceable: true }).then(
      (photo) => (cancelled ? releaseCanvas(photo.canvas) : setRendered({ photo, session, spec, crop, bg, masks })),
      (err) => !cancelled && !(err instanceof Superseded) && setRenderError(err),
    )
    return () => {
      cancelled = true
    }
  }, [session, masks, deferredCrop, spec, deferredBg, needsRender, subject])
  // A failed render shows the error screen, as it did when rendering was synchronous.
  if (renderError) throw renderError
  // The photo that's shown, checked and downloaded, with the crop and background it was rendered from.
  // While new background settings render, the previous photo stays; a different crop waits for its own.
  const shown =
    rendered && needsRender && rendered.session === session && rendered.spec === spec && rendered.crop === deferredCrop ? rendered : null
  const photo = shown?.photo ?? null
  const originalPreview = useMemo(
    () => (session && crop && step === 'background' ? renderCrop(session.image, crop, spec, 6) : null),
    [session, crop, spec, step],
  )
  const bgResult = useMemo(
    () =>
      shown
        ? backgroundCheck(
            shown.photo,
            ctx2d(shown.photo.canvas).getImageData(0, 0, shown.photo.width, shown.photo.height).data,
            spec,
            shown.bg,
          )
        : null,
    [shown, spec],
  )
  const layout = useMemo(() => computeLayout(spec, print, layoutMode), [spec, print, layoutMode])
  // Upload-only photo types are never printed, so they don't get a sheet.
  const sheet = useMemo(
    () => (photo && !uploadOnly && step === 'download' ? renderSheet(photo.canvas, layout, spec, { cutGuides }, PRINT_DPI) : null),
    [photo, uploadOnly, layout, spec, cutGuides, step],
  )
  const results = useMemo(
    () =>
      session && markers && shown && (step === 'check' || step === 'download')
        ? runChecks({
            spec,
            image: session.image,
            analysis: session.analysis,
            markers,
            crop: shown.crop,
            bg: shown.bg,
            photo: shown.photo,
            expression: expressionScores,
          })
        : [],
    [session, markers, shown, spec, step, expressionScores],
  )
  // The Download step stays locked until the Check step is done.
  const todo = checkTodo(spec, results, { attest, ackWarnings, ackFailures })
  // The Check step shows the finished photo; the Download step its print sheet too, if it has one.
  const prepared = !!photo && (step !== 'download' || uploadOnly || !!sheet)

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
  // Freed when replaced (not when hidden on the Crop step: going back with the same crop shows it again).
  useEffect(() => () => releaseCanvas(rendered?.photo.canvas), [rendered])
  useEffect(() => () => releaseCanvas(sheet), [sheet])
  useEffect(() => () => releaseCanvas(originalPreview), [originalPreview])

  // On a new step, move focus to its heading, so keyboard and screen-reader users start there.
  const mainRef = useRef<HTMLElement>(null)
  const focusedStep = useRef(step)
  useEffect(() => {
    if (focusedStep.current === step) return
    const heading = mainRef.current?.querySelector('h2')
    // The step may still be preparing (the Check and Download steps wait for the photo): try again after the next render.
    if (!heading) return
    focusedStep.current = step
    heading.tabIndex = -1
    heading.focus({ preventScroll: true })
  })

  // The service worker's first-visit reload is fine until a photo is chosen (settings are remembered).
  const photoChosen = useRef(false)
  useEffect(() => registerServiceWorker(() => !photoChosen.current), [])

  const handleFile = async (file: File) => {
    photoChosen.current = true
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
      setSubjectError(null)
      setAttest({})
      setAckWarnings(null)
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
    setAckWarnings(null)
    setAckFailures(null)
    setSaved(null)
  }

  /** Re-centre everything on another detected person. */
  const chooseSubject = async (index: number) => {
    if (!session || index === session.analysis.subject) return
    setSubjectBusy(true)
    setSubjectError(null)
    try {
      const vision = await import('./lib/vision')
      const analysis = await vision.selectSubject(session.image, session.analysis, index)
      if (!analysis.markers) return
      setSession({ image: session.image, analysis })
      setMarkers(analysis.markers)
      setCrop(autoFit(analysis.markers, spec, session.image))
      setAckWarnings(null)
      setAckFailures(null)
    } catch (e) {
      console.error(e)
      setSubjectError(`Couldn’t switch to that person. ${e instanceof Error ? e.message : 'Please try again.'}`)
    } finally {
      setSubjectBusy(false)
    }
  }

  const onMarkers = (m: Markers, done: boolean) => {
    setMarkers(m)
    if (done && autoRefit) setCrop(autoFit(m, spec, session?.image))
  }

  const download = async (kind: 'sheet' | 'photo') => {
    if (!shown || (kind === 'sheet' && !sheet)) return
    try {
      const file = await makeFile(kind, shown, sheet, spec, print, subject)
      downloadBlob(file.blob, file.name)
      // A download that works clears an earlier failure message.
      setSaved((s) => (file.about ? { text: `Saved: ${file.about}.` } : s?.error ? null : s))
    } catch (e) {
      console.error(e)
      setSaved({ text: e instanceof Error ? e.message : 'Couldn’t save the photo.', error: true })
    }
  }

  // The system share sheet (on phones, and some computers) can save the file to Photos or send it to a
  // print app. It only opens straight from a tap, so the main download's file is made beforehand.
  const shareKind = spec.digital ? 'photo' : 'sheet'
  const [shareable, setShareable] = useState<{ file: File; for: [Rendered, HTMLCanvasElement | null] } | null>(null)
  useEffect(() => {
    if (step !== 'download' || !shown || !canShareFiles() || (shareKind === 'sheet' && !sheet)) return
    let cancelled = false
    makeFile(shareKind, shown, sheet, spec, print, subject).then(
      ({ blob, name }) => !cancelled && setShareable({ file: new File([blob], name, { type: 'image/jpeg' }), for: [shown, sheet] }),
      (err) => console.warn('Couldn’t prepare the file to share', err),
    )
    return () => {
      cancelled = true
    }
  }, [step, shown, sheet, shareKind, spec, print, subject])
  const shareFile = shareable && shareable.for[0] === shown && shareable.for[1] === sheet ? shareable.file : null
  const share = () => {
    if (!shareFile) return
    navigator.share({ files: [shareFile], title: `${spec.label} photo` }).catch((err: Error) => {
      if (err.name !== 'AbortError') setSaved({ text: `Couldn’t share the file: ${err.message}`, error: true })
    })
  }

  const onFix = (r: CheckResult) => goto(fixStep(r.id))

  const goto = (s: StepId) => {
    setStep(s)
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
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

      <Stepper
        steps={STEPS.map((s) => (s.id === 'download' ? { ...s, label: downloadLabel } : s))}
        current={step}
        enabled={(s) => s === 'upload' || !!session}
        onSelect={goto}
      />

      <main className="app__main" ref={mainRef}>
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
            earlyIssues={retakeIssues(session.analysis, crop, spec, expressionScores)}
            faces={session.analysis.faces}
            subject={session.analysis.subject}
            subjectBusy={subjectBusy}
            subjectError={subjectError}
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
            onRetryMatte={() => setMatteFailedFor(null)}
            onBack={() => goto('crop')}
            onNext={() => goto('check')}
          />
        )}
        {(step === 'check' || step === 'download') && session && !prepared && (
          <div className="panel">
            <div className="dropzone__busy" role="status">
              <span className="spinner" aria-hidden />
              Preparing your photo…
            </div>
          </div>
        )}
        {step === 'check' && session && photo && (
          <CheckStep
            spec={spec}
            results={results}
            photo={photo}
            attest={attest}
            onAttest={(id, v) => setAttest((a) => ({ ...a, [id]: v }))}
            ackWarnings={ackWarnings}
            onAckWarnings={setAckWarnings}
            ackFailures={ackFailures}
            onAckFailures={setAckFailures}
            todo={todo}
            onFix={onFix}
            onBack={() => goto('background')}
            onNext={() => goto('download')}
            nextLabel={`Next: ${downloadLabel} →`}
          />
        )}
        {step === 'download' && session && photo && (sheet || uploadOnly) && (
          <DownloadStep
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
            photo={photo}
            sheet={sheet}
            checked={todo.length === 0}
            onDownloadSheet={() => download('sheet')}
            onDownloadPhoto={() => download('photo')}
            onShare={canShareFiles() ? share : undefined}
            shareReady={!!shareFile}
            saved={saved}
            onSwitchSpec={(id) => {
              changeSpec(id)
              goto('crop')
            }}
            onBack={() => goto('check')}
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
