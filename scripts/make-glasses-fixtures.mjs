// Generates eyewear test photos in test-images/ from glasses-thick.jpg (NASA, public domain):
//   glasses-glare.jpg  — a flash-style reflection painted on one lens
//   glasses-tinted.jpg — lenses darkened like sunglasses
// Requires the dev server: npx vite --port 5174
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
await page.goto(process.env.APP_URL ?? 'http://localhost:5174/')
await page.waitForTimeout(1500)
const out = await page.evaluate(async (b64) => {
  const file = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'x.jpg', { type: 'image/jpeg' })
  const { loadImageFile, createCanvas, ctx2d } = await import('/src/lib/image.ts')
  const vision = await import('/src/lib/vision.ts')
  const img = await loadImageFile(file)
  const L = (await vision.analyzePhoto(img)).landmarks
  const iod = Math.hypot(L[468].x - L[473].x, L[468].y - L[473].y)
  const copy = () => {
    const c = createCanvas(img.width, img.height)
    ctx2d(c).drawImage(img.canvas, 0, 0)
    return c
  }
  const glare = copy()
  const g = ctx2d(glare)
  const gx = L[468].x + iod * 0.12,
    gy = L[468].y - iod * 0.12
  const grad = g.createRadialGradient(gx, gy, 0, gx, gy, iod * 0.2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.6, 'rgba(255,255,255,0.95)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath()
  g.ellipse(gx, gy, iod * 0.26, iod * 0.16, -0.3, 0, Math.PI * 2)
  g.fill()

  const tinted = copy()
  const t = ctx2d(tinted)
  t.fillStyle = 'rgba(20, 15, 10, 0.72)'
  for (const c of [L[468], L[473]]) {
    t.beginPath()
    t.ellipse(c.x, c.y, iod * 0.42, iod * 0.3, 0, 0, Math.PI * 2)
    t.fill()
  }
  const jpeg = (c) => c.toDataURL('image/jpeg', 0.92).split(',')[1]
  return { glare: jpeg(glare), tinted: jpeg(tinted) }
}, readFileSync('test-images/glasses-thick.jpg').toString('base64'))
await browser.close()
writeFileSync('test-images/glasses-glare.jpg', Buffer.from(out.glare, 'base64'))
writeFileSync('test-images/glasses-tinted.jpg', Buffer.from(out.tinted, 'base64'))
console.log('wrote test-images/glasses-glare.jpg, test-images/glasses-tinted.jpg')
