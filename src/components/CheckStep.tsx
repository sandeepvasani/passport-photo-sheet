import type { PhotoSpec } from '../config/photoSpecs'
import type { CheckResult } from '../lib/checks'
import type { RenderedPhoto } from '../lib/render'
import { failureKey, warningKey } from '../steps'
import { CanvasPreview, CheckList } from './common'

interface Props {
  spec: PhotoSpec
  results: CheckResult[]
  photo: RenderedPhoto
  attest: Record<string, boolean>
  onAttest: (id: string, v: boolean) => void
  /** The warnings (as `warningKey`) the user reviewed. */
  ackWarnings: string | null
  onAckWarnings: (key: string | null) => void
  /** Ids of the failed checks the user chose to download anyway (as `failureKey`). */
  ackFailures: string | null
  onAckFailures: (key: string | null) => void
  /** What's left before the photo can be downloaded (see `checkTodo`). */
  todo: string[]
  onFix: (r: CheckResult) => void
  onBack: () => void
  onNext: () => void
  nextLabel: string
}

export function CheckStep(props: Props) {
  const { spec, results, attest, ackWarnings, todo } = props
  const fails = results.filter((r) => r.status === 'fail')
  const warns = results.filter((r) => r.status === 'warn')
  const pending = results.filter((r) => r.status === 'pending')
  const failedNames = fails.map((r) => `“${r.label}”`).join(', ')
  const digital = spec.digital

  return (
    <div className="step-grid">
      <section className="panel">
        <div className="final-previews final-previews--single">
          <figure>
            <CanvasPreview canvas={props.photo.canvas} label="Final passport photo" className="photo-frame" />
            <figcaption>
              {spec.label} · {digital ? `${digital.widthPx} × ${digital.heightPx} px` : spec.sizeLabel}
            </figcaption>
          </figure>
        </div>
      </section>

      <aside className="panel">
        <h2>Requirement check</h2>
        <p className="summary">
          <span className="summary__pill summary__pill--pass">{results.length - fails.length - warns.length - pending.length} passed</span>
          {warns.length > 0 && (
            <span className="summary__pill summary__pill--warn">
              {warns.length} warning{warns.length === 1 ? '' : 's'}
            </span>
          )}
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
              <input
                type="checkbox"
                checked={ackWarnings === warningKey(results)}
                onChange={(e) => props.onAckWarnings(e.target.checked ? warningKey(results) : null)}
              />
              I’ve reviewed the warnings above and want to continue
            </label>
          )}
          {fails.length > 0 && (
            <label className="checkbox checkbox--fail">
              <input
                type="checkbox"
                checked={props.ackFailures === failureKey(results)}
                onChange={(e) => props.onAckFailures(e.target.checked ? failureKey(results) : null)}
              />
              This photo fails {fails.length === 1 ? 'a requirement' : `${fails.length} requirements`} ({failedNames}). I understand it’s
              likely to be rejected and want to download it anyway.
            </label>
          )}
        </div>

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

        <div className="nav-row">
          <button type="button" className="btn" onClick={props.onBack}>
            ← Back
          </button>
          <button type="button" className="btn btn--primary" disabled={todo.length > 0} onClick={props.onNext}>
            {props.nextLabel}
          </button>
        </div>
      </aside>
    </div>
  )
}
