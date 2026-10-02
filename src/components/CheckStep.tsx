import type { PhotoSpec } from '../config/photoSpecs'
import { PRINT_DPI, type PrintSize } from '../config/printSizes'
import type { CheckResult } from '../lib/checks'
import type { RenderedPhoto } from '../lib/render'
import { CanvasPreview, CheckList } from './common'

interface Props {
  spec: PhotoSpec
  print: PrintSize
  results: CheckResult[]
  photo: RenderedPhoto
  sheet: HTMLCanvasElement
  photoCount: number
  attest: Record<string, boolean>
  onAttest: (id: string, v: boolean) => void
  ackWarnings: boolean
  onAckWarnings: (v: boolean) => void
  onFix: (r: CheckResult) => void
  onDownloadSheet: () => void
  onDownloadPhoto: () => void
  onBack: () => void
}

export function CheckStep(props: Props) {
  const { spec, print, results, attest, ackWarnings } = props
  const fails = results.filter((r) => r.status === 'fail')
  const warns = results.filter((r) => r.status === 'warn')
  const attested = spec.attestations.every((a) => attest[a.id])
  const ready = fails.length === 0 && attested && (warns.length === 0 || ackWarnings)

  const blocker =
    fails.length > 0
      ? `Fix ${fails.length} failing check${fails.length === 1 ? '' : 's'} first.`
      : !attested
        ? 'Confirm every item in the checklist.'
        : warns.length > 0 && !ackWarnings
          ? 'Review the warnings and tick the box to continue.'
          : null

  return (
    <div className="step-grid">
      <section className="panel">
        <div className="final-previews">
          <figure>
            <CanvasPreview canvas={props.photo.canvas} label="Final passport photo" className="photo-frame" />
            <figcaption>
              {spec.label} · {spec.sizeLabel}
            </figcaption>
          </figure>
          <figure>
            <CanvasPreview canvas={props.sheet} label="Print sheet" className="sheet-thumb" />
            <figcaption>
              {print.label} sheet · {props.photoCount} photos
            </figcaption>
          </figure>
        </div>

        <div className="print-help">
          <h3>Getting it printed</h3>
          <ol>
            <li>Download the print sheet below.</li>
            <li>
              Order a <strong>{print.label}</strong> photo print from any photo lab, pharmacy, supermarket photo counter or online print
              service. Matte or glossy are both fine.
            </li>
            <li>
              The file is {Math.round(print.widthIn * PRINT_DPI)} × {Math.round(print.heightIn * PRINT_DPI)} pixels, exactly {print.label} at{' '}
              {PRINT_DPI} DPI (the standard print resolution), so every photo prints at exactly {spec.sizeLabel}. Choose the same print size,
              keep the whole image selected if the order screen offers cropping, and turn off any auto-enhance.
            </li>
            <li>At home, cut along the grey lines and measure one photo with a ruler: it should be exactly {spec.sizeLabel}.</li>
          </ol>
        </div>
      </section>

      <aside className="panel">
        <h2>Requirement check</h2>
        <p className="summary">
          <span className="summary__pill summary__pill--pass">{results.length - fails.length - warns.length} passed</span>
          {warns.length > 0 && <span className="summary__pill summary__pill--warn">{warns.length} warnings</span>}
          {fails.length > 0 && <span className="summary__pill summary__pill--fail">{fails.length} failed</span>}
        </p>
        <CheckList results={results} onFix={props.onFix} />

        <h3>Please confirm</h3>
        <p className="muted small">These can’t be checked automatically.</p>
        <div className="attestations">
          {spec.attestations.map((a) => (
            <label key={a.id} className="checkbox">
              <input type="checkbox" checked={!!attest[a.id]} onChange={(e) => props.onAttest(a.id, e.target.checked)} />
              {a.label}
            </label>
          ))}
          {warns.length > 0 && (
            <label className="checkbox checkbox--warn">
              <input type="checkbox" checked={ackWarnings} onChange={(e) => props.onAckWarnings(e.target.checked)} />
              I’ve reviewed the warnings above and want to continue
            </label>
          )}
        </div>

        <div className="downloads">
          <button type="button" className="btn btn--primary btn--large" disabled={!ready} onClick={props.onDownloadSheet}>
            Download {print.label} print sheet
          </button>
          <button type="button" className="btn" disabled={!ready} onClick={props.onDownloadPhoto}>
            Download single digital photo ({props.photo.width}×{props.photo.height} px)
          </button>
          {blocker && <p className="muted small">{blocker}</p>}
        </div>

        {spec.notes.length > 0 && (
          <div className="notes">
            {spec.notes.map((n) => (
              <p key={n} className="alert alert--info small">
                {n}
              </p>
            ))}
          </div>
        )}

        <div className="nav-row">
          <button type="button" className="btn" onClick={props.onBack}>
            ← Back
          </button>
        </div>
      </aside>
    </div>
  )
}
