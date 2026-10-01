import { useRef, useState } from 'react'
import { formatRange, type PhotoSpec } from '../config/photoSpecs'

interface Props {
  specs: PhotoSpec[]
  spec: PhotoSpec
  onSpec: (id: string) => void
  onFile: (file: File) => void
  busy: string | null
  error: string | null
  hasPhoto: boolean
  onContinue: () => void
}

export function UploadStep({ specs, spec, onSpec, onFile, busy, error, hasPhoto, onContinue }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const pick = (files: FileList | null) => {
    const file = files?.[0]
    if (file) onFile(file)
  }

  return (
    <div className="step-grid">
      <section className="panel">
        <h2>1. Choose the photo type</h2>
        <div className="spec-cards" role="radiogroup" aria-label="Photo type">
          {specs.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === spec.id}
              className={`spec-card ${s.id === spec.id ? 'is-selected' : ''}`}
              onClick={() => onSpec(s.id)}
            >
              <span className="spec-card__size">{s.sizeLabel}</span>
              <span className="spec-card__label">{s.label}</span>
              <span className="spec-card__countries">{s.countries}</span>
            </button>
          ))}
        </div>

        <dl className="spec-summary">
          <div>
            <dt>Photo size</dt>
            <dd>{spec.sizeLabel}</dd>
          </div>
          <div>
            <dt>Head (chin to top of hair)</dt>
            <dd>{formatRange(spec.headHeightMm, spec.displayUnit)}</dd>
          </div>
          {spec.eyeFromBottomMm && (
            <div>
              <dt>Eyes from bottom</dt>
              <dd>{formatRange(spec.eyeFromBottomMm, spec.displayUnit)}</dd>
            </div>
          )}
          <div>
            <dt>Background</dt>
            <dd>{spec.backgrounds.map((b) => b.label).join(', ')}</dd>
          </div>
          {spec.requiresColouredClothing && (
            <div>
              <dt>Clothing</dt>
              <dd>Plain and coloured, not white</dd>
            </div>
          )}
          <div>
            <dt>Glasses</dt>
            <dd>{{ forbidden: 'Not allowed', discouraged: 'Avoid (often not allowed)', allowed: 'Allowed: clear lenses, no glare' }[spec.glasses]}</dd>
          </div>
        </dl>
        <p className="muted small">
          Official rules:{' '}
          <a href={spec.sourceUrl} target="_blank" rel="noreferrer">
            {new URL(spec.sourceUrl).hostname}
          </a>
        </p>

        <h2>2. Upload a photo</h2>
        <div
          className={`dropzone ${dragOver ? 'is-over' : ''} ${busy ? 'is-busy' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            pick(e.dataTransfer.files)
          }}
        >
          {busy ? (
            <div className="dropzone__busy" role="status">
              <span className="spinner" aria-hidden />
              {busy}
            </div>
          ) : (
            <>
              <p className="dropzone__title">Drop a photo here</p>
              <div className="row">
                <button type="button" className="btn btn--primary" onClick={() => inputRef.current?.click()}>
                  Choose photo
                </button>
                <button type="button" className="btn mobile-only" onClick={() => cameraRef.current?.click()}>
                  Take photo
                </button>
              </div>
              <p className="muted small">JPEG, PNG or WebP. Your photo never leaves this device.</p>
              <p className="muted small mobile-only">
                Selfies are usually too close to fit a passport frame. Prop the phone up about 4 ft (1.2 m) away and use the timer, or ask someone to
                take it.
              </p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            data-testid="file-input"
            onChange={(e) => {
              pick(e.target.files)
              e.target.value = ''
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="user"
            hidden
            onChange={(e) => {
              pick(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
        {error && (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        )}
        {hasPhoto && !busy && (
          <div className="row row--end">
            <button type="button" className="btn btn--primary" onClick={onContinue}>
              Continue with current photo →
            </button>
          </div>
        )}
      </section>

      <aside className="panel panel--tips">
        <h2>Tips for a photo that passes</h2>
        <ul className="tips">
          <li>
            Stand a few feet in front of a <strong>plain {spec.backgrounds.map((b) => b.label.toLowerCase()).join(' or ')} wall</strong> so you
            don’t cast a shadow. No suitable wall? Hang a white sheet or blanket.
          </li>
          <li>Have someone else take the photo from <strong>4 ft (1.2 m) away</strong>, with the camera at eye level. Selfies distort the face.</li>
          <li>Face a window or use soft, even light. <strong>No shadows</strong> on the face or behind you, and no flash (it causes red eye).</li>
          <li>
            Look straight at the camera with both eyes open and your <strong>mouth closed</strong>
            {spec.expression === 'smile-mouth-closed' ? '. A closed-mouth smile is fine.' : ' and a neutral expression.'}
          </li>
          {spec.glasses !== 'allowed' && (
            <li>
              Take off your <strong>glasses</strong>, and don’t rest them on your head.
            </li>
          )}
          {spec.requiresColouredClothing && (
            <li>
              Wear <strong>plain, coloured clothing</strong> such as a medium blue shirt. White or patterned clothes aren’t accepted.
            </li>
          )}
          <li>Leave space around your head and shoulders. Don’t crop the photo yourself.</li>
          <li>Use the camera’s full resolution, and no filters or edits.</li>
        </ul>
      </aside>
    </div>
  )
}
