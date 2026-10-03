import { useEffect, useRef } from 'react'
import type { CheckResult, CheckStatus } from '../lib/checks'

/** Shows an offscreen canvas on screen, scaled to the container width. */
export function CanvasPreview({ canvas, label, className }: { canvas: HTMLCanvasElement; label: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.width = canvas.width
    el.height = canvas.height
    el.getContext('2d')?.drawImage(canvas, 0, 0)
  }, [canvas])
  return <canvas ref={ref} className={`canvas-preview ${className ?? ''}`} role="img" aria-label={label} />
}

const ICON: Record<CheckStatus, string> = { pass: '✓', warn: '!', fail: '✕', pending: '…' }

export function StatusIcon({ status }: { status: CheckStatus }) {
  return (
    <span className={`status-icon status-icon--${status}`} aria-label={status}>
      {ICON[status]}
    </span>
  )
}

export function CheckList({
  results,
  onFix,
}: {
  results: CheckResult[]
  onFix?: (r: CheckResult) => void
}) {
  return (
    <ul className="checks">
      {results.map((r) => (
        <li key={r.id} className={`check check--${r.status}`}>
          <StatusIcon status={r.status} />
          <div className="check__body">
            <strong>{r.label}</strong>
            <span>{r.detail}</span>
          </div>
          {onFix && (r.status === 'warn' || r.status === 'fail') && (
            <button type="button" className="btn btn--small" onClick={() => onFix(r)}>
              Fix
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export interface StepDef<T extends string> {
  id: T
  label: string
}

export function Stepper<T extends string>({
  steps,
  current,
  enabled,
  onSelect,
}: {
  steps: StepDef<T>[]
  current: T
  enabled: (id: T) => boolean
  onSelect: (id: T) => void
}) {
  const currentIndex = steps.findIndex((s) => s.id === current)
  return (
    <nav className="stepper" aria-label="Progress">
      <ol>
        {steps.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              className={`stepper__step ${i === currentIndex ? 'is-current' : ''} ${i < currentIndex ? 'is-done' : ''}`}
              disabled={!enabled(s.id)}
              aria-current={i === currentIndex ? 'step' : undefined}
              onClick={() => onSelect(s.id)}
            >
              <span className="stepper__num">{i < currentIndex ? '✓' : i + 1}</span>
              <span className="stepper__label">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (v: number) => void
}) {
  return (
    <label className="slider">
      <span className="slider__head">
        <span>{label}</span>
        <output>{display}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
