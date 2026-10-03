// Diagnostic: writes e2e-output/zoom/inspect.png with original | result | coarse mask | refined matte.
// Requires the dev server (npx vite). Usage: Q="expand=0.5" node scripts/inspect-matte.mjs test-images/nasa2.jpg intl-35x45
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
const [, , file, specId = 'intl-35x45'] = process.argv
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
await page.goto((process.env.APP_URL ?? 'http://localhost:5173/') + '?' + (process.env.Q ?? ''))
await page.waitForTimeout(1500)
const out = await page.evaluate(
  async ({ b64, specId }) => {
    const f = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'x.jpg', { type: 'image/jpeg' })
    const { loadImageFile, createCanvas, ctx2d } = await import('/src/lib/image.ts')
    const vision = await import('/src/lib/vision.ts')
    const { autoFit, midpoint, sourceToOutputTransform } = await import('/src/lib/geometry.ts')
    const { renderPhoto, renderCrop } = await import('/src/lib/render.ts')
    const { PHOTO_SPECS } = await import('/src/config/photoSpecs.ts')
    const spec = PHOTO_SPECS.find((s) => s.id === specId)
    const img = await loadImageFile(f)
    const a = await vision.analyzePhoto(img)
    const crop = autoFit(a.markers, spec)
    const subj = midpoint(a.markers.eyeLeft, a.markers.eyeRight)
    const { portraitMatte } = await import('/src/lib/matte.ts')
    const masks = [...a.masks, await portraitMatte(img, crop, spec)]
    const bg = {
      mode: 'replace',
      color: '#e6e6e6',
      feather: Number(new URL(location.href).searchParams.get('feather') ?? 5),
      expand: Number(new URL(location.href).searchParams.get('expand') ?? 0),
    }
    const res = renderPhoto(img, masks, crop, spec, bg, 300, subj)
    const orig = renderCrop(img, crop, spec, 300 / 25.4)
    // coarse mask through the same transform
    const W = res.width,
      H = res.height
    const mc = createCanvas(W, H)
    const m = ctx2d(mc)
    m.fillStyle = '#000'
    m.fillRect(0, 0, W, H)
    m.setTransform(...sourceToOutputTransform(crop, spec, 300 / 25.4))
    for (const l of masks) m.drawImage(l.canvas, l.rect.x, l.rect.y, l.rect.w, l.rect.h)
    // refined alpha
    const ac = createCanvas(W, H)
    const actx = ctx2d(ac)
    const id = actx.createImageData(W, H)
    for (let i = 0; i < W * H; i++) {
      const v = res.alpha[i] * 255
      id.data[i * 4] = v
      id.data[i * 4 + 1] = v
      id.data[i * 4 + 2] = v
      id.data[i * 4 + 3] = 255
    }
    actx.putImageData(id, 0, 0)
    // side-by-side: original | result | coarse | refined
    const strip = createCanvas(W * 4 + 30, H)
    const s = ctx2d(strip)
    s.fillStyle = '#f00'
    s.fillRect(0, 0, strip.width, H)
    ;[orig, res.canvas, mc, ac].forEach((c, i) => s.drawImage(c, i * (W + 10), 0))
    return strip.toDataURL('image/png').split(',')[1]
  },
  { b64: readFileSync(file).toString('base64'), specId },
)
writeFileSync('e2e-output/zoom/inspect.png', Buffer.from(out, 'base64'))
await browser.close()
