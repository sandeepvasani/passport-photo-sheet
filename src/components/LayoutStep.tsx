import type { PhotoSpec } from '../config/photoSpecs'
import { PRINT_DPI, PRINT_SIZES, type PrintSize } from '../config/printSizes'
import { photosPerSheet, resolveMode, type LayoutMode, type SheetLayout } from '../lib/layout'
import { CanvasPreview } from './common'

interface Props {
  spec: PhotoSpec
  print: PrintSize
  onPrint: (id: string) => void
  mode: LayoutMode
  onMode: (m: LayoutMode) => void
  cutGuides: boolean
  onCutGuides: (v: boolean) => void
  layout: SheetLayout
  sheet: HTMLCanvasElement | null
  onNext: () => void
  onBack: () => void
}

const MODES: { id: LayoutMode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'max', label: 'Most photos' },
  { id: 'safe', label: 'With margins' },
]

export function LayoutStep({ spec, print, onPrint, mode, onMode, cutGuides, onCutGuides, layout, sheet, onNext, onBack }: Props) {
  const maxCount = photosPerSheet(spec, print, 'max')
  const safeCount = photosPerSheet(spec, print, 'safe')
  return (
    <div className="step-grid">
      <section className="panel panel--sheet">
        {sheet && <CanvasPreview canvas={sheet} label={`${print.label} inch print sheet`} className="sheet-preview" />}
        <p className="muted small center">
          {print.label} in · {Math.round(print.widthIn * PRINT_DPI)} × {Math.round(print.heightIn * PRINT_DPI)} px at {PRINT_DPI} DPI ·{' '}
          {layout.cells.length} photos
        </p>
      </section>

      <aside className="panel">
        <h2>Walgreens print size</h2>
        <div className="print-cards" role="radiogroup" aria-label="Print size">
          {PRINT_SIZES.map((p) => {
            const n = photosPerSheet(spec, p, resolveMode(spec, p, mode))
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={p.id === print.id}
                disabled={n === 0}
                className={`print-card ${p.id === print.id ? 'is-selected' : ''}`}
                onClick={() => onPrint(p.id)}
              >
                <span className="print-card__size">{p.label}</span>
                <span className="print-card__count">
                  {n} photo{n === 1 ? '' : 's'}
                </span>
              </button>
            )
          })}
        </div>

        <h3>Layout</h3>
        <div className="segmented" role="radiogroup" aria-label="Layout">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'is-selected' : ''} onClick={() => onMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          {layout.mode === 'max'
            ? `Photos run to the edge of the paper (${maxCount} per sheet). Some print machines trim a sliver (≈1 mm) off the paper edges, which would make the outer photos slightly under size. Choose “With margins” to rule that out${safeCount ? ` (${safeCount} per sheet)` : ''}.`
            : `A ${(layout.marginMm / 25.4).toFixed(2)} in margin keeps every photo clear of the paper edge, so nothing gets trimmed by the printer.`}
        </p>
        <label className="checkbox">
          <input type="checkbox" checked={cutGuides} onChange={(e) => onCutGuides(e.target.checked)} />
          Draw thin grey cut lines
        </label>

        <div className="nav-row">
          <button type="button" className="btn" onClick={onBack}>
            ← Back
          </button>
          <button type="button" className="btn btn--primary" onClick={onNext}>
            Next: Check &amp; download →
          </button>
        </div>
      </aside>
    </div>
  )
}
