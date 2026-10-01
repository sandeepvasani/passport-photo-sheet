import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatLength, type PhotoSpec } from '../config/photoSpecs'
import { geometryChecks } from '../lib/checks'
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
import type { BackgroundSettings } from '../lib/render'
import { CheckList, Slider } from './common'

/** Context shown around the frame, as a fraction of frame width. */
const PAD = 0.17

type MarkerKey = keyof Markers

type Drag =
  | { kind: 'pan'; last: Point }
  | { kind: 'marker'; key: MarkerKey }
  | { kind: 'pinch'; startDist: number; startCrop: Crop; pivot: Point }

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

function CropEditor({ image, spec, markers, crop, onCrop, onMarkers }: EditorProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cssW, setCssW] = useState(460)
  const [cursor, setCursor] = useState('grab')

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setCssW(Math.max(240, Math.min(600, Math.floor(entry.contentRect.width)))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const frameW = cssW / (1 + 2 * PAD)
  const vs = frameW / spec.widthMm
  const frameH = spec.heightMm * vs
  const pad = PAD * frameW
  const cssH = frameH + 2 * pad

  // Latest values for event handlers (pointer events can outpace re-renders).
  const live = useRef({ crop, markers })
  useLayoutEffect(() => {
    live.current = { crop, markers }
  })
  const pointers = useRef(new Map<number, Point>())
  const drag = useRef<Drag | null>(null)

  const toView = (p: Point) => viewOf(p, live.current.crop, spec, vs, pad)
  const viewToMm = (v: Point) => ({ x: (v.x - pad) / vs, y: (v.y - pad) / vs })

  const setCrop = (c: Crop) => {
    live.current.crop = c
    onCrop(c)
  }
  const setMarkers = (m: Markers, done: boolean) => {
    live.current.markers = m
    onMarkers(m, done)
  }

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#23262e'
    ctx.fillRect(0, 0, cssW, cssH)

    ctx.save()
    ctx.transform(...sourceToOutputTransform(crop, spec, vs, pad, pad))
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image.canvas, 0, 0)
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
    const zone = spec.eyeFromBottomMm
      ? { top: spec.heightMm - spec.eyeFromBottomMm.max, bottom: spec.heightMm - spec.eyeFromBottomMm.min, label: 'eyes', color: '250, 204, 21' }
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
  }, [image, spec, crop, markers, cssW, cssH, frameW, frameH, pad, vs])

  const localPoint = (e: React.PointerEvent | WheelEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const hitTest = (v: Point): MarkerKey | null => {
    const { markers: m } = live.current
    const pts: [MarkerKey, Point][] = [
      ['eyeLeft', toView(m.eyeLeft)],
      ['eyeRight', toView(m.eyeRight)],
      ['crown', toView(m.crown)],
      ['chin', toView(m.chin)],
    ]
    for (const [key, p] of pts) if (Math.hypot(v.x - p.x, v.y - p.y) < 14) return key
    if (v.x >= pad && v.x <= pad + frameW) {
      for (const key of ['crown', 'chin'] as const) {
        if (Math.abs(v.y - toView(m[key]).y) < 7) return key
      }
    }
    return null
  }

  const eyesMid = () => midpoint(live.current.markers.eyeLeft, live.current.markers.eyeRight)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
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
    const key = hitTest(v)
    drag.current = key ? { kind: 'marker', key } : { kind: 'pan', last: v }
    setCursor(key ? (key === 'crown' || key === 'chin' ? 'ns-resize' : 'move') : 'grabbing')
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = localPoint(e)
    const d = drag.current
    if (!d) {
      const key = hitTest(v)
      setCursor(key ? (key === 'crown' || key === 'chin' ? 'ns-resize' : 'move') : 'grab')
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
      const s = c.pxPerMm / vs
      setCrop({ ...c, cx: c.cx - (dx * ux.x + dy * uy.x) * s, cy: c.cy - (dx * ux.y + dy * uy.y) * s })
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
    setCursor('grab')
  }

  // Wheel / trackpad zoom around the pointer (needs a non-passive listener).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = localPoint(e)
      const c = live.current.crop
      const pivot = frameToSource(viewToMm(v), c, spec)
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
      setCrop(transformCropAbout(c, pivot, factor, 0))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  })

  const onKeyDown = (e: React.KeyboardEvent) => {
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

  return (
    <div ref={wrapRef} className="editor">
      <canvas
        ref={canvasRef}
        className="editor__canvas"
        style={{ width: cssW, height: cssH, cursor }}
        tabIndex={0}
        aria-label="Photo crop editor. Drag to move the photo, use arrow keys to nudge, plus and minus to zoom."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

interface StepProps extends EditorProps {
  hasDetection: boolean
  bg: BackgroundSettings
  autoRefit: boolean
  onAutoRefit: (v: boolean) => void
  onAutoFit: () => void
  onResetMarkers: () => void
  onNext: () => void
  onBack: () => void
}

export function CropStep(props: StepProps) {
  const { image, spec, markers, crop, onCrop, bg, hasDetection } = props
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
          <span className="swatch-text swatch-text--yellow">yellow eye markers</span> if they’re not exactly on the top of the hair, chin and pupils.
        </p>
      </section>

      <aside className="panel">
        <h2>Crop &amp; position</h2>
        {!hasDetection && (
          <p className="alert alert--warn">
            No face was detected, so this photo can’t pass the final check. Try a clear, front-facing photo with even lighting. You can still
            drag the markers onto the head, chin and pupils to preview the crop.
          </p>
        )}
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
          {hasDetection && (
            <button type="button" className="btn" onClick={props.onResetMarkers}>
              Reset markers
            </button>
          )}
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
