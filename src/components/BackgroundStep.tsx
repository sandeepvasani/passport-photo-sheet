import type { PhotoSpec } from '../config/photoSpecs'
import type { CheckResult } from '../lib/checks'
import type { BackgroundSettings, RenderedPhoto } from '../lib/render'
import { CanvasPreview, CheckList, Slider } from './common'

interface Props {
  spec: PhotoSpec
  bg: BackgroundSettings
  onBg: (bg: BackgroundSettings) => void
  photo: RenderedPhoto | null
  original: HTMLCanvasElement | null
  check: CheckResult | null
  matteStatus: 'idle' | 'loading' | 'error'
  onRetryMatte: () => void
  onNext: () => void
  nextLabel: string
  onBack: () => void
}

export function BackgroundStep({ spec, bg, onBg, photo, original, check, matteStatus, onRetryMatte, onNext, nextLabel, onBack }: Props) {
  const replace = bg.mode === 'replace'
  const originalFails = !replace && check?.status === 'fail'
  return (
    <div className="step-grid">
      <section className="panel">
        <div className="compare">
          <figure>
            {original && <CanvasPreview canvas={original} label="Original crop" className="photo-frame" />}
            <figcaption>Original</figcaption>
          </figure>
          <figure>
            {photo ? (
              <CanvasPreview canvas={photo.canvas} label="Result" className="photo-frame" />
            ) : (
              <div className="photo-frame placeholder" />
            )}
            <figcaption>
              {replace && matteStatus === 'loading' ? (
                <span className="inline-status" role="status">
                  <span className="spinner spinner--small" aria-hidden /> Refining hair edges…
                </span>
              ) : (
                'Result'
              )}
            </figcaption>
          </figure>
        </div>
      </section>

      <aside className="panel">
        <h2>Background</h2>
        <p className="muted">
          {spec.label} photos need a plain {spec.backgrounds.map((b) => b.label.toLowerCase()).join(' or ')} background with no shadows or
          patterns.
        </p>
        <div className="segmented" role="radiogroup" aria-label="Background">
          <button
            type="button"
            role="radio"
            aria-checked={!replace}
            className={!replace ? 'is-selected' : ''}
            onClick={() => onBg({ ...bg, mode: 'original' })}
          >
            Keep original
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={replace}
            className={replace ? 'is-selected' : ''}
            onClick={() => onBg({ ...bg, mode: 'replace' })}
          >
            Replace background
          </button>
        </div>

        {check && <CheckList results={[check]} />}

        {originalFails && (
          <p className="alert alert--warn small">
            Your background doesn’t meet the rules. The most reliable fix is to retake the photo against a plain white wall or sheet. You
            can replace the background below, but read the warning first.
          </p>
        )}

        {replace && (
          <>
            <p className="alert alert--warn small" role="note">
              <strong>Edited photos can be rejected.</strong> {spec.editingPolicy}
            </p>
            {matteStatus === 'error' && (
              <div className="alert alert--error small row" role="alert">
                <span>Couldn’t load the hair-detail model, so the edges are less precise. Check your connection and try again.</span>
                <button type="button" className="btn btn--small" onClick={onRetryMatte}>
                  Try again
                </button>
              </div>
            )}
            <div className="swatches" role="radiogroup" aria-label="Background colour">
              {spec.backgrounds.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={bg.color === b.color}
                  className={`swatch ${bg.color === b.color ? 'is-selected' : ''}`}
                  onClick={() => onBg({ ...bg, color: b.color })}
                >
                  <span className="swatch__chip" style={{ background: b.color }} />
                  {b.label}
                </button>
              ))}
            </div>
            <Slider
              label="Edge softness"
              value={bg.feather}
              min={0}
              max={14}
              step={1}
              display={String(bg.feather)}
              onChange={(v) => onBg({ ...bg, feather: v })}
            />
            <Slider
              label="Tighten ↔ expand outline"
              value={bg.expand}
              min={-1}
              max={1}
              step={0.05}
              display={bg.expand === 0 ? '0' : bg.expand > 0 ? `+${bg.expand.toFixed(2)}` : bg.expand.toFixed(2)}
              onChange={(v) => onBg({ ...bg, expand: v })}
            />
            <p className="muted small">
              Check the hair and shoulders in the result. If bits of the old background remain, tighten the outline. If hair is cut off,
              expand it. The first time you replace a background, a 13 MB model is downloaded.
            </p>
          </>
        )}

        <div className="nav-row">
          <button type="button" className="btn" onClick={onBack}>
            ← Back
          </button>
          <button type="button" className="btn btn--primary" onClick={onNext}>
            {nextLabel}
          </button>
        </div>
      </aside>
    </div>
  )
}
