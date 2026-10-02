// Generates synthetic test photos in test-images/ using the app's own pipeline:
//   plain-bg.jpg — nasa2.jpg with its background replaced by white at full resolution
//   no-face.jpg  — the helmet area of nasa1.jpg (no person's face)
//   two-people.jpg — nasa2.jpg and nasa3.jpg side by side
// Requires the dev server: npx vite --port 5173
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
await page.goto(process.env.APP_URL ?? 'http://localhost:5174/')
await page.waitForTimeout(1500)
const read = (f) => readFileSync(f).toString('base64')
const out = await page.evaluate(
  async ({ a, b, c }) => {
    const toFile = (b64) => new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'x.jpg', { type: 'image/jpeg' })
    const { loadImageFile, createCanvas, ctx2d } = await import('/src/lib/image.ts')
    const vision = await import('/src/lib/vision.ts')
    const { renderPhoto } = await import('/src/lib/render.ts')
    const { US_PASSPORT } = await import('/src/config/photoSpecs.ts')
    const jpeg = (c) => c.toDataURL('image/jpeg', 0.92).split(',')[1]

    const img = await loadImageFile(toFile(a))
    const analysis = await vision.analyzePhoto(img)
    const spec = { ...US_PASSPORT, widthMm: img.width / 10, heightMm: img.height / 10 }
    const crop = { cx: img.width / 2, cy: img.height / 2, angle: 0, pxPerMm: 10 }
    const plain = renderPhoto(img, analysis.masks, crop, spec, { mode: 'replace', color: '#f7f7f5', feather: 6, expand: 0 }, 254)

    const img2 = await loadImageFile(toFile(b))
    const crop2 = createCanvas(600, 600)
    ctx2d(crop2).drawImage(img2.canvas, 40, 1150, 600, 600, 0, 0, 600, 600)
    const img3 = await loadImageFile(toFile(c))
    const pair = createCanvas(1600, 1000)
    const pctx = ctx2d(pair)
    pctx.drawImage(img.canvas, 0, 0, img.width, img.width * 0.65, 0, 0, 800, 800 * 0.65 * (img.width / img.width))
    pctx.drawImage(img3.canvas, 0, 0, img3.width, img3.width * 0.65, 800, 0, 800, 800 * 0.65)
    pctx.drawImage(img.canvas, 0, img.width * 0.65, img.width, img.height - img.width * 0.65, 0, 520, 800, 480)
    pctx.drawImage(img3.canvas, 0, img3.width * 0.65, img3.width, img3.height - img3.width * 0.65, 800, 520, 800, 480)
    return { plain: jpeg(plain.canvas), noface: jpeg(crop2), pair: jpeg(pair) }
  },
  { a: read('test-images/nasa2.jpg'), b: read('test-images/nasa1.jpg'), c: read('test-images/nasa3.jpg') },
)
writeFileSync('test-images/plain-bg.jpg', Buffer.from(out.plain, 'base64'))
writeFileSync('test-images/no-face.jpg', Buffer.from(out.noface, 'base64'))
writeFileSync('test-images/two-people.jpg', Buffer.from(out.pair, 'base64'))
await browser.close()
console.log('wrote test-images/plain-bg.jpg, test-images/no-face.jpg, test-images/two-people.jpg')
