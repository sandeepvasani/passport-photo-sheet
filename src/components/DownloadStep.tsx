import { PHOTO_SPECS, type PhotoSpec } from '../config/photoSpecs'
import { PRINT_DPI, PRINT_SIZES, type PrintSize } from '../config/printSizes'
import { formatKb } from '../lib/image'
import { photosPerSheet, resolveMode, type LayoutMode, type SheetLayout } from '../lib/layout'
import type { RenderedPhoto } from '../lib/render'
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
  photo: RenderedPhoto
  /** The print sheet; null for upload-only photo types. */
  sheet: HTMLCanvasElement | null
  /** The Check step is done: everything confirmed, and every warning and failure reviewed. */
  checked: boolean
  onDownloadSheet: () => void
  onDownloadPhoto: () => void
  /** Opens the share sheet with the main download's file; absent when the browser can't share files. */
  onShare?: () => void
  /** The file to share has been prepared. */
  shareReady: boolean
  /** Outcome of the last download: the online-upload file's size, or why a download failed. */
  saved: { text: string; error?: boolean } | null
  onSwitchSpec: (id: string) => void
  /** Back to the Check step. */
  onBack: () => void
}

const PRINT_GROUPS: { unit: PrintSize['unit']; label: string }[] = [
  { unit: 'in', label: 'Inches (US, Canada)' },
  { unit: 'cm', label: 'Centimetres (most other countries)' },
]

const MODES: { id: LayoutMode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'max', label: 'Most photos' },
  { id: 'safe', label: 'With margins' },
]

/** Print size, layout and cut lines for the sheet. */
function PrintSettings({ spec, print, onPrint, mode, onMode, cutGuides, onCutGuides, layout }: Props) {
  const maxCount = photosPerSheet(spec, print, 'max')
  const safeCount = photosPerSheet(spec, print, 'safe')
  return (
    <>
      <h2 className="section-title">Print size</h2>
      <p className="muted small">Pick a size your photo lab, pharmacy or online print service offers.</p>
      {PRINT_GROUPS.map((group) => (
        <div key={group.unit}>
          <h3 className="print-group">{group.label}</h3>
          <div className="print-cards" role="radiogroup" aria-label={group.label}>
            {PRINT_SIZES.filter((p) => p.unit === group.unit).map((p) => {
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
        </div>
      ))}
      {print.unit === 'cm' && (
        <p className="muted small">
          Labs don’t all print metric sizes identically (some make “10 × 15” as 4 × 6 in). Measure one photo with a ruler after printing, or
          pick the matching inch size if your lab lists one.
        </p>
      )}

      <h3>Layout</h3>
      <div className="segmented" role="radiogroup" aria-label="Layout">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            className={mode === m.id ? 'is-selected' : ''}
            onClick={() => onMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="muted small">
        {layout.mode === 'max'
          ? `Photos run to the edge of the paper (${maxCount} per sheet). Some print machines trim a sliver (≈1 mm) off the paper edges, which would make the outer photos slightly under size. Choose “With margins” to rule that out${safeCount ? ` (${safeCount} per sheet)` : ''}.`
          : `A ${print.unit === 'cm' ? `${Math.round(layout.marginMm)} mm` : `${(layout.marginMm / 25.4).toFixed(2)} in`} margin keeps every photo clear of the paper edge, so nothing gets trimmed by the printer.`}
      </p>
      <label className="checkbox">
        <input type="checkbox" checked={cutGuides} onChange={(e) => onCutGuides(e.target.checked)} />
        Draw thin grey cut lines
      </label>
    </>
  )
}

export function DownloadStep(props: Props) {
  const { spec, print, photo, sheet, checked } = props
  const digital = spec.digital
  const fileSizeRule = digital
    ? digital.minBytes
      ? `${formatKb(digital.minBytes)}–${formatKb(digital.maxBytes)} KB`
      : `under ${formatKb(digital.maxBytes)} KB`
    : ''
  const related = PHOTO_SPECS.find((s) => s.id === spec.related?.specId)

  const sheetButton = sheet && (
    <button type="button" className={digital ? 'btn' : 'btn btn--primary btn--large'} disabled={!checked} onClick={props.onDownloadSheet}>
      Download {print.label} print sheet
    </button>
  )
  // The main download: the online-upload file for types that have one, otherwise the print sheet.
  const downloads = (
    <div className="downloads">
      {!checked && (
        <div className="alert alert--warn download-gate row">
          <span>Finish the Check step first: tick the items under “Please confirm” and review any warnings or failed checks.</span>
          <button type="button" className="btn btn--small" onClick={props.onBack}>
            Go to Check
          </button>
        </div>
      )}
      {digital ? (
        <button type="button" className="btn btn--primary btn--large" disabled={!checked} onClick={props.onDownloadPhoto}>
          Download for online upload
          <span className="btn__sub">
            {digital.widthPx} × {digital.heightPx} px JPEG, {fileSizeRule}
          </span>
        </button>
      ) : (
        <>
          {sheetButton}
          <button type="button" className="btn" disabled={!checked} onClick={props.onDownloadPhoto}>
            Download single digital photo ({photo.width}×{photo.height} px)
          </button>
        </>
      )}
      {props.onShare && (
        <button type="button" className="btn" disabled={!checked || !props.shareReady} onClick={props.onShare}>
          Share…
          <span className="btn__sub">Save to Photos, or send it to a print app</span>
        </button>
      )}
      {props.saved && (
        <p className={`small ${props.saved.error ? 'alert alert--error' : 'muted'}`} role="status">
          {props.saved.text}
        </p>
      )}
    </div>
  )

  return (
    <div className="step-grid">
      {sheet ? (
        <section className="panel panel--sheet">
          <CanvasPreview canvas={sheet} label={`${print.label} print sheet`} className="sheet-preview" />
          <p className="muted small center">
            {print.label} · {Math.round(print.widthIn * PRINT_DPI)} × {Math.round(print.heightIn * PRINT_DPI)} px at {PRINT_DPI} DPI ·{' '}
            {props.layout.cells.length} photos
          </p>
        </section>
      ) : (
        <section className="panel">
          <div className="final-previews final-previews--single">
            <figure>
              <CanvasPreview canvas={photo.canvas} label="Final passport photo" className="photo-frame" />
              <figcaption>
                {spec.label} · {digital ? `${digital.widthPx} × ${digital.heightPx} px` : spec.sizeLabel}
              </figcaption>
            </figure>
          </div>
          {digital && (
            <div className="print-help">
              <h3>Uploading it</h3>
              <ol>
                <li>Download the photo.</li>
                <li>
                  Upload it to the online form as it is. It’s exactly {digital.widthPx} × {digital.heightPx} pixels and {fileSizeRule};
                  editing or re-saving it in another app can change that.
                </li>
              </ol>
            </div>
          )}
        </section>
      )}

      <aside className="panel">
        {digital ? (
          // The online-upload file comes first; printed copies are extra.
          <>
            <h2 className="section-title">Download</h2>
            {downloads}
            {sheet && (
              <>
                <PrintSettings {...props} />
                <div className="downloads">{sheetButton}</div>
              </>
            )}
          </>
        ) : (
          <>
            <PrintSettings {...props} />
            <h2 className="section-title">Download</h2>
            {downloads}
          </>
        )}

        {sheet && (
          <div className="print-help">
            <h3>Getting it printed</h3>
            <ol>
              <li>Download the print sheet.</li>
              <li>
                Order a <strong>{print.label}</strong> photo print from any photo lab, pharmacy, supermarket photo counter or online print
                service. Matte or glossy are both fine.
              </li>
              <li>
                The file is {Math.round(print.widthIn * PRINT_DPI)} × {Math.round(print.heightIn * PRINT_DPI)} pixels, exactly {print.label}{' '}
                at {PRINT_DPI} DPI (the standard print resolution), so every photo prints at exactly {spec.sizeLabel}. Choose the same print
                size, keep the whole image selected if the order screen offers cropping, and turn off any auto-enhance.
              </li>
              <li>
                At home, {props.cutGuides ? 'cut along the grey lines' : 'cut the photos apart'} and measure one photo with a ruler: it
                should be exactly {spec.sizeLabel}.
              </li>
            </ol>
          </div>
        )}

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
