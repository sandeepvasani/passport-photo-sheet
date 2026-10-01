// Generates selfie-like test photos in test-images/ from nasa2.jpg:
//   selfie-tight.jpg        — portrait 3:4, head filling ~55% of the height (arm's-length selfie)
//   selfie-exif-rotated.jpg — same pixels stored sideways with EXIF orientation 6 (as phones do)
// Requires the dev server: npx vite --port 5174
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
await page.goto(process.env.APP_URL ?? 'http://localhost:5174/')
const out = await page.evaluate(async (b64) => {
  const img = new Image()
  img.src = 'data:image/jpeg;base64,' + b64
  await img.decode()
  // Head spans roughly y 200–720 at x ≈ 770 in nasa2.jpg.
  const h = 950, w = 712, x = 770 - w / 2, y = 90
  const upright = document.createElement('canvas')
  upright.width = w; upright.height = h
  upright.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h)
  // Stored rotated 90° counter-clockwise; orientation 6 tells viewers to rotate it back clockwise.
  const sideways = document.createElement('canvas')
  sideways.width = h; sideways.height = w
  const sc = sideways.getContext('2d')
  sc.translate(0, w)
  sc.rotate(-Math.PI / 2)
  sc.drawImage(upright, 0, 0)
  const jpeg = (c) => c.toDataURL('image/jpeg', 0.92).split(',')[1]
  return { upright: jpeg(upright), sideways: jpeg(sideways) }
}, readFileSync('test-images/nasa2.jpg').toString('base64'))
await browser.close()

function withExifOrientation(jpeg, orientation) {
  const app1 = Buffer.from([
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // APP1 "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF header, big-endian
    0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // IFD0: Orientation
    0x00, 0x00, 0x00, 0x00,
  ])
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)])
}

writeFileSync('test-images/selfie-tight.jpg', Buffer.from(out.upright, 'base64'))
writeFileSync('test-images/selfie-exif-rotated.jpg', withExifOrientation(Buffer.from(out.sideways, 'base64'), 6))
console.log('wrote test-images/selfie-tight.jpg, test-images/selfie-exif-rotated.jpg')
