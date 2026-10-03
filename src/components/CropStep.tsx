import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatLength, type PhotoSpec } from '../config/photoSpecs'
import { geometryChecks, type CheckResult } from '../lib/checks'
import {
  axes,
  frameToSource,
  measure,
  midpoint,
  sourceToFrame,
  sourceToOutputTransform,
  transformCropAbout,
  type Crop,
  type Markers,
  type Point,
} from '../lib/geometry'
import type { LoadedImage } from '../lib/image'
import type { DetectedFace } from '../lib/vision'
import type { BackgroundSettings } from '../lib/render'
import { CheckList, Slider } from './common'

/** Context shown around the frame, as a fraction of frame width. */
const PAD = 0.17

type MarkerKey = Exclude<keyof Markers, 'faceWidthPx'>

/** Order M steps through with the keyboard; null moves the photo. */
const KEY_ORDER: (MarkerKey | null)[] = [null, 'crown', 'chin', 'eyeLeft', 'eyeRight']
const MARKER_NAME: Record<MarkerKey, string> = {
  crown: 'top of head',
  chin: 'chin',
  eyeLeft: 'eye on the left',
  eyeRight: 'eye on the right',
}
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

type Drag =
  { kind: 'pan'; last: Point } | { kind: 'marker'; key: MarkerKey } | { kind: 'pinch'; startDist: number; startCrop: Crop; pivot: Point }

/** Source pixel → editor canvas CSS pixel. */
function viewOf(p: Point, crop: Crop, spec: PhotoSpec, vs: number, pad: number): Point {
  const q = sourceToFrame(p, crop, spec)
  return { x: pad + q.x * vs, y: pad + q.y * vs }
}

interface EditorProps {
  image: LoadedImage
  spec: PhotoSpec
  markers: Markers
  crop: Crop
  onCrop: (c: Crop) => void
  onMarkers: (m: Markers, done: boolean) => void
}

interface View {
  cssW: number
  cssH: number
  frameW: number
  frameH: number
  pad: number
  /** CSS pixels per millimetre of finished photo. */
  vs: number
}

function viewFor(cssW: number, spec: PhotoSpec): View {
  const frameW = cssW / (1 + 2 * PAD)
  const vs = frameW / spec.widthMm
  const frameH = spec.heightMm * vs
  const pad = PAD * frameW
  return { cssW, cssH: frameH + 2 * pad, frameW, frameH, pad, vs }
}

/**
 * Draws the editor: photo, dimmed surround, guides and markers. `fast` trades smoothing for speed mid-gesture;
 * `selected` is the marker picked with the keyboard.
 */
function drawEditor(
  ctx: CanvasRenderingContext2D,
  image: LoadedImage,
  spec: PhotoSpec,
  crop: Crop,
  markers: Markers,
  view: View,
  dpr: number,
  fast: boolean,
  selected: MarkerKey | null,
) {
  const { cssW, cssH, frameW, frameH, pad, vs } = view
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#23262e'
  ctx.fillRect(0, 0, cssW, cssH)

  ctx.save()
  ctx.transform(...sourceToOutputTransform(crop, spec, vs, pad, pad))
  // The editor draws a downscaled preview (scaled back up to working-image coordinates).
  ctx.imageSmoothingQuality = fast ? 'low' : 'high'
  ctx.drawImage(image.preview, 0, 0, image.width, image.height)
  ctx.restore()

  // Dim everything outside the photo frame.
  ctx.fillStyle = 'rgba(16, 18, 24, 0.62)'
  ctx.beginPath()
  ctx.rect(0, 0, cssW, cssH)
  ctx.rect(pad, pad, frameW, frameH)
  ctx.fill('evenodd')
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineWidth = 1
  ctx.strokeRect(pad + 0.5, pad + 0.5, frameW - 1, frameH - 1)

  ctx.font = '600 11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
  ctx.textBaseline = 'middle'

  // Centre line.
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'
  ctx.beginPath()
  ctx.moveTo(pad + frameW / 2, pad)
  ctx.lineTo(pad + frameW / 2, pad + frameH)
  ctx.stroke()

  // Allowed eye zone (or crown zone when the spec defines one instead).
  const zone =
    spec.eyeFromBottomMm && Number.isFinite(spec.eyeFromBottomMm.max)
      ? {
          top: spec.heightMm - spec.eyeFromBottomMm.max,
          bottom: spec.heightMm - spec.eyeFromBottomMm.min,
          label: 'eyes',
          color: '250, 204, 21',
        }
      : spec.topMarginMm
        ? { top: spec.topMarginMm.min, bottom: spec.topMarginMm.max, label: 'top of head', color: '56, 189, 248' }
        : null
  if (zone) {
    const y1 = pad + zone.top * vs
    const y2 = pad + zone.bottom * vs
    ctx.fillStyle = `rgba(${zone.color}, 0.14)`
    ctx.fillRect(pad, y1, frameW, y2 - y1)
    ctx.strokeStyle = `rgba(${zone.color}, 0.75)`
    ctx.beginPath()
    ctx.moveTo(pad, y1)
    ctx.lineTo(pad + frameW, y1)
    ctx.moveTo(pad, y2)
    ctx.lineTo(pad + frameW, y2)
    ctx.stroke()
    ctx.fillStyle = `rgba(${zone.color}, 0.95)`
    ctx.textAlign = 'right'
    ctx.fillText(zone.label, pad - 6, (y1 + y2) / 2)
  }
  ctx.setLineDash([])

  // Markers.
  const crownV = viewOf(markers.crown, crop, spec, vs, pad)
  const chinV = viewOf(markers.chin, crop, spec, vs, pad)
  const eL = viewOf(markers.eyeLeft, crop, spec, vs, pad)
  const eR = viewOf(markers.eyeRight, crop, spec, vs, pad)
  const blue = '#38bdf8'
  for (const [p, label] of [
    [crownV, 'top of head'],
    [chinV, 'chin'],
  ] as const) {
    ctx.strokeStyle = blue
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(pad, p.y)
    ctx.lineTo(pad + frameW, p.y)
    ctx.stroke()
    ctx.fillStyle = blue
    ctx.beginPath()
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.fillText(label, pad + 6, p.y + (label === 'chin' ? 10 : -10))
  }
  ctx.strokeStyle = '#facc15'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(eL.x, eL.y)
  ctx.lineTo(eR.x, eR.y)
  ctx.stroke()
  for (const p of [eL, eR]) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2)
    ctx.fillStyle = '#facc15'
    ctx.fill()
  }
  if (selected) {
    const p = { crown: crownV, chin: chinV, eyeLeft: eL, eyeRight: eR }[selected]
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.arc(p.x, p.y, 12, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Head-height bracket to the right of the frame.
  const m = measure(markers, crop, spec)
  const ok = m.headHeightMm >= spec.headHeightMm.min - 0.05 && m.headHeightMm <= spec.headHeightMm.max + 0.05
  const bx = pad + frameW + 10
  ctx.strokeStyle = ok ? '#4ade80' : '#f87171'
  ctx.fillStyle = ctx.strokeStyle
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(bx, crownV.y)
  ctx.lineTo(bx, chinV.y)
  ctx.moveTo(bx - 4, crownV.y)
  ctx.lineTo(bx + 4, crownV.y)
  ctx.moveTo(bx - 4, chinV.y)
  ctx.lineTo(bx + 4, chinV.y)
  ctx.stroke()
  ctx.save()
  ctx.translate(bx + 12, (crownV.y + chinV.y) / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillText(`head ${formatLength(m.headHeightMm, spec.displayUnit)}`, 0, 0)
  ctx.restore()
}

function CropEditor({ image, spec, markers, crop, onCrop, onMarkers }: EditorProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cssW, setCssW] = useState(460)
  const [cursor, setCursor] = useState('grab')
  /** The browser refused to draw (e.g. iOS Safari's canvas memory cap) or drawing threw. */
  const [drawError, setDrawError] = useState<string | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setCssW(Math.max(240, Math.min(600, Math.floor(entry.contentRect.width)))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const view = viewFor(cssW, spec)
  // Higher densities cost a lot of fill rate on phones for little visible gain here.
  const dpr = Math.min(2, window.devicePixelRatio || 1)

  // Gestures update `live` immediately and draw once per animation frame; the
  // parent is told about changes at most once per frame too.
  const live = useRef({ crop, markers })
  const sent = useRef({ crop, markers })
  const pending = useRef<{ crop?: Crop; markers?: Markers }>({})
  const props = useRef({ image, spec, view, dpr, onCrop, onMarkers })
  const raf = useRef(0)
  const interacting = useRef(false)
  const wheelTimer = useRef(0)
  const pointers = useRef(new Map<number, Point>())
  const drag = useRef<Drag | null>(null)
  /** Marker picked with the keyboard (M); the arrow keys move it instead of the photo. */
  const selected = useRef<MarkerKey | null>(null)
  /** A marker was moved with the keys, and the parent hasn't been told the move is finished. */
  const nudged = useRef(false)
  const [announcement, setAnnouncement] = useState('')

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setDrawError(
        'Your browser ran out of memory for images, so the photo can’t be shown. Close other tabs, reload the page and try again.',
      )
      return
    }
    const p = props.current
    const w = Math.round(p.view.cssW * p.dpr)
    const h = Math.round(p.view.cssH * p.dpr)
    // Resizing a canvas reallocates and clears it, so only do it when the size really changes.
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    try {
      drawEditor(ctx, p.image, p.spec, live.current.crop, live.current.markers, p.view, p.dpr, interacting.current, selected.current)
    } catch (err) {
      console.error(err)
      setDrawError(`The photo couldn’t be drawn (${err instanceof Error ? err.message : String(err)}). Reload the page and try again.`)
    }
  }

  const flush = () => {
    const { crop: c, markers: m } = pending.current
    pending.current = {}
    if (c) {
      sent.current.crop = c
      props.current.onCrop(c)
    }
    if (m) {
      sent.current.markers = m
      props.current.onMarkers(m, false)
    }
  }

  const schedule = () => {
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      flush()
      draw()
    })
  }

  useLayoutEffect(() => {
    props.current = { image, spec, view, dpr, onCrop, onMarkers }
    // Adopt changes that came from outside (sliders, auto-fit), not echoes of our own updates.
    if (crop !== sent.current.crop) live.current.crop = sent.current.crop = crop
    if (markers !== sent.current.markers) live.current.markers = sent.current.markers = markers
    schedule()
  })

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      // Clear the handle too, or schedule() would think a frame is still pending and
      // never draw again (React's dev mode unmounts and remounts effects once on mount).
      raf.current = 0
      clearTimeout(wheelTimer.current)
    },
    [],
  )

  const { vs, pad, frameW } = view
  const toView = (pt: Point) => viewOf(pt, live.current.crop, spec, vs, pad)
  const viewToMm = (v: Point) => ({ x: (v.x - pad) / vs, y: (v.y - pad) / vs })

  const setCrop = (c: Crop) => {
    live.current.crop = c
    pending.current.crop = c
    schedule()
  }
  const setMarkers = (m: Markers, done: boolean) => {
    live.current.markers = m
    if (done) {
      pending.current.markers = undefined
      flush()
      sent.current.markers = m
      props.current.onMarkers(m, true)
    } else {
      pending.current.markers = m
    }
    schedule()
  }

  const updateCursor = (next: string) => {
    if (next !== cursor) setCursor(next)
  }

  const localPoint = (e: React.PointerEvent | WheelEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const hitTest = (v: Point, touch = false): MarkerKey | null => {
    const { markers: m } = live.current
    // A fingertip is less precise than a mouse pointer, so markers take a wider area.
    const radius = touch ? 22 : 14
    const band = touch ? 11 : 7
    const pts: [MarkerKey, Point][] = [
      ['eyeLeft', toView(m.eyeLeft)],
      ['eyeRight', toView(m.eyeRight)],
      ['crown', toView(m.crown)],
      ['chin', toView(m.chin)],
    ]
    for (const [key, pt] of pts) if (Math.hypot(v.x - pt.x, v.y - pt.y) < radius) return key
    if (v.x >= pad && v.x <= pad + frameW) {
      for (const key of ['crown', 'chin'] as const) {
        if (Math.abs(v.y - toView(m[key]).y) < band) return key
      }
    }
    return null
  }

  const cursorFor = (key: MarkerKey | null, active: boolean) =>
    key ? (key === 'crown' || key === 'chin' ? 'ns-resize' : 'move') : active ? 'grabbing' : 'grab'

  const eyesMid = () => midpoint(live.current.markers.eyeLeft, live.current.markers.eyeRight)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    interacting.current = true
    const v = localPoint(e)
    pointers.current.set(e.pointerId, v)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const mid = midpoint(a, b)
      drag.current = {
        kind: 'pinch',
        startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        startCrop: live.current.crop,
        pivot: frameToSource(viewToMm(mid), live.current.crop, spec),
      }
      return
    }
    const key = hitTest(v, e.pointerType === 'touch')
    drag.current = key ? { kind: 'marker', key } : { kind: 'pan', last: v }
    updateCursor(cursorFor(key, true))
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = localPoint(e)
    const d = drag.current
    if (!d) {
      if (e.pointerType === 'mouse') updateCursor(cursorFor(hitTest(v), false))
      return
    }
    pointers.current.set(e.pointerId, v)
    const { crop: c, markers: m } = live.current
    if (d.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      setCrop(transformCropAbout(d.startCrop, d.pivot, dist / d.startDist, 0))
    } else if (d.kind === 'pan') {
      const dx = v.x - d.last.x
      const dy = v.y - d.last.y
      d.last = v
      const { ux, uy } = axes(c.angle)
      const k = c.pxPerMm / vs
      setCrop({ ...c, cx: c.cx - (dx * ux.x + dy * uy.x) * k, cy: c.cy - (dx * ux.y + dy * uy.y) * k })
    } else {
      const q = viewToMm(v)
      if (d.key === 'crown' || d.key === 'chin') q.x = sourceToFrame(m[d.key], c, spec).x
      setMarkers({ ...m, [d.key]: frameToSource(q, c, spec) }, false)
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId)
    const d = drag.current
    if (d?.kind === 'marker') setMarkers(live.current.markers, true)
    drag.current = null
    if (pointers.current.size === 0) {
      interacting.current = false
      schedule() // final full-quality redraw
    }
    updateCursor('grab')
  }

  // Wheel / trackpad zoom around the pointer (needs a non-passive listener).
  const onWheelRef = useRef<(e: WheelEvent) => void>(() => {})
  useLayoutEffect(() => {
    onWheelRef.current = (e: WheelEvent) => {
      e.preventDefault()
      interacting.current = true
      clearTimeout(wheelTimer.current)
      wheelTimer.current = window.setTimeout(() => {
        interacting.current = false
        schedule()
      }, 150)
      const v = localPoint(e)
      const c = live.current.crop
      const pivot = frameToSource(viewToMm(v), c, spec)
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
      setCrop(transformCropAbout(c, pivot, factor, 0))
    }
  })
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => onWheelRef.current(e)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  /** Tells the parent a keyboard move of a marker is finished (so auto re-fit runs once, not per key repeat). */
  const finishNudge = () => {
    if (!nudged.current) return
    nudged.current = false
    setMarkers(live.current.markers, true)
  }

  const select = (key: MarkerKey | null) => {
    finishNudge()
    selected.current = key
    setAnnouncement(
      key
        ? `Moving the ${MARKER_NAME[key]} marker. Arrow keys move it, M picks the next marker, Escape goes back to moving the photo.`
        : 'Moving the photo.',
    )
    schedule()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = selected.current
    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault()
      select(KEY_ORDER[(KEY_ORDER.indexOf(key) + 1) % KEY_ORDER.length])
      return
    }
    if (e.key === 'Escape' && key) {
      e.preventDefault()
      select(null)
      return
    }
    const dir = ARROWS[e.key]
    if (key && dir) {
      e.preventDefault()
      const { crop: c, markers: m } = live.current
      const step = e.shiftKey ? 1 : 0.2
      const q = sourceToFrame(m[key], c, spec)
      // The top of the head and the chin only move up and down, as when dragged.
      if (key === 'eyeLeft' || key === 'eyeRight') q.x += dir[0] * step
      q.y += dir[1] * step
      nudged.current = true
      setMarkers({ ...m, [key]: frameToSource(q, c, spec) }, false)
      return
    }
    const c = live.current.crop
    const step = (e.shiftKey ? 2 : 0.4) * c.pxPerMm
    const { ux, uy } = axes(c.angle)
    const move = (du: number, dv: number) => {
      e.preventDefault()
      setCrop({ ...c, cx: c.cx + (du * ux.x + dv * uy.x) * step, cy: c.cy + (du * ux.y + dv * uy.y) * step })
    }
    if (e.key === 'ArrowLeft') move(1, 0)
    else if (e.key === 'ArrowRight') move(-1, 0)
    else if (e.key === 'ArrowUp') move(0, 1)
    else if (e.key === 'ArrowDown') move(0, -1)
    else if (e.key === '+' || e.key === '=') setCrop(transformCropAbout(c, eyesMid(), 1.02, 0))
    else if (e.key === '-') setCrop(transformCropAbout(c, eyesMid(), 1 / 1.02, 0))
  }

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (ARROWS[e.key]) finishNudge()
  }

  const onBlur = () => {
    finishNudge()
    if (!selected.current) return
    selected.current = null
    setAnnouncement('')
    schedule()
  }

  return (
    <div ref={wrapRef} className="editor">
      {drawError && (
        <p className="alert alert--error editor__error" role="alert">
          {drawError}
        </p>
      )}
      <canvas
        ref={canvasRef}
        className="editor__canvas"
        style={{ width: view.cssW, height: view.cssH, cursor }}
        tabIndex={0}
        aria-label="Photo crop editor. Drag to move the photo, use arrow keys to nudge, plus and minus to zoom. Press M to pick the top-of-head, chin or eye marker and move it with the arrow keys."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={onBlur}
      />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}

/** Round thumbnail of one detected face, cut from the editor preview. */
function FaceThumb({ image, face }: { image: LoadedImage; face: DetectedFace }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const size = 56 * Math.min(2, window.devicePixelRatio || 1)
    canvas.width = size
    canvas.height = size
    const { x, y, w, h } = face.box
    const side = Math.max(w, h) * 1.5
    const s = image.preview.width / image.width
    ctx.drawImage(image.preview, (x + w / 2 - side / 2) * s, (y + h / 2 - side / 2) * s, side * s, side * s, 0, 0, size, size)
  }, [image, face])
  return <canvas ref={ref} className="face-thumb__img" aria-hidden />
}

function SubjectPicker(props: {
  image: LoadedImage
  faces: DetectedFace[]
  subject: number
  busy: boolean
  error: string | null
  onSubject: (i: number) => void
}) {
  // Left-to-right order reads naturally; `faces` itself is sorted largest first.
  const order = props.faces.map((f, i) => ({ f, i })).sort((a, b) => a.f.box.x - b.f.box.x)
  return (
    <div className="subject-picker">
      <h3>Who is this photo for?</h3>
      <p className="muted small">There’s more than one person in this photo. Tap the person the passport photo is for.</p>
      <div className="subject-picker__faces" role="radiogroup" aria-label="Person">
        {order.map(({ f, i }, n) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={i === props.subject}
            aria-label={`Person ${n + 1}`}
            className={`face-thumb ${i === props.subject ? 'is-selected' : ''}`}
            disabled={props.busy}
            onClick={() => props.onSubject(i)}
          >
            <FaceThumb image={props.image} face={f} />
          </button>
        ))}
        {props.busy && <span className="spinner spinner--small" aria-label="Switching person" />}
      </div>
      {props.error && (
        <p className="alert alert--error small" role="alert">
          {props.error}
        </p>
      )}
    </div>
  )
}

interface StepProps extends EditorProps {
  faces: DetectedFace[]
  subject: number
  subjectBusy: boolean
  subjectError: string | null
  onSubject: (index: number) => void
  /** Problems spotted at upload (e.g. glasses) worth knowing before cropping. */
  earlyIssues: CheckResult[]
  bg: BackgroundSettings
  autoRefit: boolean
  onAutoRefit: (v: boolean) => void
  onAutoFit: () => void
  onResetMarkers: () => void
  onNext: () => void
  onBack: () => void
}

export function CropStep(props: StepProps) {
  const { image, spec, markers, crop, onCrop, bg } = props
  const m = measure(markers, crop, spec)
  const results = geometryChecks(spec, markers, crop, image, bg)
  const eyes = midpoint(markers.eyeLeft, markers.eyeRight)
  const head = spec.headHeightMm

  return (
    <div className="step-grid">
      <section className="panel panel--editor">
        <CropEditor {...props} />
        <p className="muted small center">
          Drag to move · scroll or pinch to zoom · drag the <span className="swatch-text swatch-text--blue">blue lines</span> and{' '}
          <span className="swatch-text swatch-text--yellow">yellow eye markers</span> if they’re not exactly on the top of the hair, chin
          and pupils.
          <span className="keyboard-hint"> With a keyboard: arrow keys move, + and − zoom, M picks a marker to move.</span>
        </p>
      </section>

      <aside className="panel">
        <h2>Crop &amp; position</h2>
        {props.faces.length > 1 && (
          <SubjectPicker
            image={image}
            faces={props.faces}
            subject={props.subject}
            busy={props.subjectBusy}
            error={props.subjectError}
            onSubject={props.onSubject}
          />
        )}
        {props.earlyIssues.length > 0 && <CheckList results={props.earlyIssues} />}
        <Slider
          label="Head size"
          value={m.headHeightMm}
          min={head.min * 0.8}
          max={head.max * 1.2}
          step={0.1}
          display={formatLength(m.headHeightMm, spec.displayUnit)}
          onChange={(v) => onCrop(transformCropAbout(crop, eyes, v / m.headHeightMm, 0))}
        />
        <Slider
          label="Rotate"
          value={(crop.angle * 180) / Math.PI}
          min={-25}
          max={25}
          step={0.1}
          display={`${((crop.angle * 180) / Math.PI).toFixed(1)}°`}
          onChange={(v) => onCrop(transformCropAbout(crop, eyes, 1, (v * Math.PI) / 180 - crop.angle))}
        />
        <div className="row">
          <button type="button" className="btn" onClick={props.onAutoFit}>
            Auto-fit to spec
          </button>
          <button type="button" className="btn" onClick={props.onResetMarkers}>
            Reset markers
          </button>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={props.autoRefit} onChange={(e) => props.onAutoRefit(e.target.checked)} />
          Re-fit automatically after moving a marker
        </label>

        <h3>Measurements</h3>
        <CheckList results={results} />

        <div className="nav-row">
          <button type="button" className="btn" onClick={props.onBack}>
            ← Back
          </button>
          <button type="button" className="btn btn--primary" onClick={props.onNext}>
            Next: Background →
          </button>
        </div>
      </aside>
    </div>
  )
}
