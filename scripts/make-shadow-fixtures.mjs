// Generates shadow test photos in test-images/ from portrait.jpg (White House, public domain),
// which is evenly lit:
//   shadow-forehead-side.jpg — one side of the forehead shaded (hair or a hat, light at an angle)
//   shadow-brim.jpg          — a band of shadow across the forehead (hat brim)
//   shadow-overhead.jpg      — light from above: dark eye sockets, shadow under the nose and chin
//   shadow-side.jpg          — strong side light: one half of the face darker
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
  const shade = (paint) => {
    const c = createCanvas(img.width, img.height)
    const ctx = ctx2d(c)
    ctx.drawImage(img.canvas, 0, 0)
    // Multiply darkens like a real shadow; the blur softens its edge.
    ctx.globalCompositeOperation = 'multiply'
    ctx.filter = `blur(${Math.round(iod * 0.08)}px)`
    paint(ctx)
    return c.toDataURL('image/jpeg', 0.92).split(',')[1]
  }
  const dark = (a) => `rgb(${Math.round(255 * a)}, ${Math.round(255 * a)}, ${Math.round(255 * a)})`
  const ellipse = (ctx, p, rx, ry, a) => {
    ctx.fillStyle = dark(a)
    ctx.beginPath()
    ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  const leftEye = L[468].x < L[473].x ? L[468] : L[473]
  const rightEye = L[468].x < L[473].x ? L[473] : L[468]
  return {
    foreheadSide: shade((ctx) => ellipse(ctx, { x: leftEye.x - iod * 0.15, y: leftEye.y - iod * 0.75 }, iod * 0.55, iod * 0.42, 0.55)),
    brim: shade((ctx) => {
      ctx.fillStyle = dark(0.55)
      ctx.fillRect(L[234].x - iod, L[10].y - iod, Math.abs(L[454].x - L[234].x) + 2 * iod, Math.abs(L[105].y - L[10].y) * 0.75 + iod)
    }),
    overhead: shade((ctx) => {
      ellipse(ctx, leftEye, iod * 0.36, iod * 0.3, 0.55)
      ellipse(ctx, rightEye, iod * 0.36, iod * 0.3, 0.55)
      ellipse(ctx, { x: L[17].x, y: (L[17].y + L[152].y) / 2 }, iod * 0.45, iod * 0.28, 0.55)
      ellipse(ctx, { x: L[2].x, y: (L[2].y + L[0].y) / 2 }, iod * 0.32, iod * 0.12, 0.6)
    }),
    side: shade((ctx) => {
      const x0 = L[168].x
      const g = ctx.createLinearGradient(x0 - iod * 0.2, 0, x0 + iod * 0.6, 0)
      g.addColorStop(0, 'rgb(255,255,255)')
      g.addColorStop(1, dark(0.55))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, img.width, img.height)
    }),
  }
}, readFileSync('test-images/portrait.jpg').toString('base64'))
await browser.close()
for (const [key, file] of [
  ['foreheadSide', 'shadow-forehead-side'],
  ['brim', 'shadow-brim'],
  ['overhead', 'shadow-overhead'],
  ['side', 'shadow-side'],
]) {
  writeFileSync(`test-images/${file}.jpg`, Buffer.from(out[key], 'base64'))
}
console.log('wrote test-images/shadow-{forehead-side,brim,overhead,side}.jpg')
