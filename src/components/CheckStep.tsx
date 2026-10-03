import { PHOTO_SPECS, type PhotoSpec } from '../config/photoSpecs'
import { PRINT_DPI, type PrintSize } from '../config/printSizes'
import type { CheckResult } from '../lib/checks'
import type { RenderedPhoto } from '../lib/render'
import { formatKb } from '../lib/image'
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
  /** Ids of the failed checks the user chose to download anyway (as `failureKey`). */
  ackFailures: string | null
  onAckFailures: (key: string | null) => void
  onFix: (r: CheckResult) => void
  onDownloadSheet: () => void
  onDownloadPhoto: () => void
  /** Outcome of the last online-upload download. */
  saved: { text: string; error?: boolean } | null
  onSwitchSpec: (id: string) => void
  onBack: () => void
}

export function CheckStep(props: Props) {
  const { spec, print, results, attest, ackWarnings } = props
  const fails = results.filter((r) => r.status === 'fail')
  const warns = results.filter((r) => r.status === 'warn')
  const pending = results.filter((r) => r.status === 'pending')
  const unconfirmed = spec.attestations.filter((a) => !attest[a.id]).length
  // Ticking applies to the failures shown: a new one (after going back to edit) needs a new tick.
  const failureKey = fails.map((r) => r.id).join()
  const failuresAccepted = fails.length === 0 || props.ackFailures === failureKey
  const warningsAccepted = warns.length === 0 || ackWarnings
  const ready = unconfirmed === 0 && failuresAccepted && warningsAccepted && pending.length === 0
  const failedNames = fails.map((r) => `“${r.label}”`).join(', ')
  const digital = spec.digital
  const uploadOnly = !!digital?.uploadOnly
  const fileSizeRule = digital
    ? digital.minBytes
      ? `${formatKb(digital.minBytes)}–${formatKb(digital.maxBytes)} KB`
      : `under ${formatKb(digital.maxBytes)} KB`
    : ''
  const related = PHOTO_SPECS.find((s) => s.id === spec.related?.specId)

  const todo = [
    !failuresAccepted &&
      `Fix the failed check${fails.length === 1 ? '' : 's'} (${failedNames}), or tick the red box above to download anyway.`,
    unconfirmed > 0 &&
      `Tick ${unconfirmed === spec.attestations.length ? `all ${unconfirmed} items` : unconfirmed === 1 ? 'the last item' : `the ${unconfirmed} remaining items`} under “Please confirm”.`,
    !warningsAccepted && 'Review the warnings and tick the orange box above.',
    pending.length > 0 && 'Wait a moment: the expression check is still running.',
  ].filter((t): t is string => !!t)

  return (
    <div className="step-grid">
      <section className="panel">
        <div className="final-previews">
          <figure>
            <CanvasPreview canvas={props.photo.canvas} label="Final passport photo" className="photo-frame" />
            <figcaption>
              {spec.label} · {digital ? `${digital.widthPx} × ${digital.heightPx} px` : spec.sizeLabel}
            </figcaption>
          </figure>
          {!uploadOnly && (
            <figure>
              <CanvasPreview canvas={props.sheet} label="Print sheet" className="sheet-thumb" />
              <figcaption>
                {print.label} sheet · {props.photoCount} photos
              </figcaption>
            </figure>
          )}
        </div>

        {uploadOnly ? (
          <div className="print-help">
            <h3>Uploading it</h3>
            <ol>
              <li>Download the photo below.</li>
              <li>
                Upload it to the online form as it is. It’s exactly {digital!.widthPx} × {digital!.heightPx} pixels and {fileSizeRule}; editing or
                re-saving it in another app can change that.
              </li>
            </ol>
          </div>
        ) : (
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
        )}
      </section>

      <aside className="panel">
        <h2>Requirement check</h2>
        <p className="summary">
          <span className="summary__pill summary__pill--pass">{results.length - fails.length - warns.length - pending.length} passed</span>
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
          {fails.length > 0 && (
            <label className="checkbox checkbox--fail">
              <input
                type="checkbox"
                checked={props.ackFailures === failureKey}
                onChange={(e) => props.onAckFailures(e.target.checked ? failureKey : null)}
              />
              This photo fails {fails.length === 1 ? 'a requirement' : `${fails.length} requirements`} ({failedNames}). I understand it’s
              likely to be rejected and want to download it anyway.
            </label>
          )}
        </div>

        <div className="downloads">
          {todo.length > 0 && (
            <div className="alert alert--warn download-todo">
              <strong>To download:</strong>
              <ul>
                {todo.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          {digital ? (
            <>
              <button type="button" className="btn btn--primary btn--large" disabled={!ready} onClick={props.onDownloadPhoto}>
                Download for online upload
                <span className="btn__sub">
                  {digital.widthPx} × {digital.heightPx} px JPEG, {fileSizeRule}
                </span>
              </button>
              {!uploadOnly && (
                <button type="button" className="btn" disabled={!ready} onClick={props.onDownloadSheet}>
                  Download {print.label} print sheet
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" className="btn btn--primary btn--large" disabled={!ready} onClick={props.onDownloadSheet}>
                Download {print.label} print sheet
              </button>
              <button type="button" className="btn" disabled={!ready} onClick={props.onDownloadPhoto}>
                Download single digital photo ({props.photo.width}×{props.photo.height} px)
              </button>
            </>
          )}
          {props.saved && (
            <p className={`small ${props.saved.error ? 'alert alert--error' : 'muted'}`} role="status">
              {props.saved.text}
            </p>
          )}
        </div>

        {related && (
          <div className="related small">
            <p>{spec.related!.prompt}</p>
            <button type="button" className="btn btn--small" onClick={() => props.onSwitchSpec(related.id)}>
              Switch to {related.label} →
            </button>
            <p className="muted">Your photo stays loaded; you’ll check the new crop first.</p>
          </div>
        )}

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
