// Generates test-images/group.jpg: the head and shoulders of four people (portrait.jpg,
// glasses-thin.jpg, nasa2.jpg and nasa3.jpg) in a 2 × 2 grid, for checking that every
// face is found. The astronaut in nasa1.jpg is left out: in a suit, the face is too small to detect.
// Usage: node scripts/make-group-fixture.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const people = ['portrait.jpg', 'glasses-thin.jpg', 'nasa2.jpg', 'nasa3.jpg'].map((f) =>
  readFileSync(`test-images/${f}`).toString('base64'),
)
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
const bytes = await page.evaluate(async (people) => {
  const cell = 800
  const canvas = new OffscreenCanvas(cell * 2, cell * 2)
  const ctx = canvas.getContext('2d')
  for (const [i, b64] of people.entries()) {
    const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]))
    // The top square of each portrait holds the head and shoulders.
    ctx.drawImage(img, 0, 0, img.width, img.width, (i % 2) * cell, Math.floor(i / 2) * cell, cell, cell)
  }
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
}, people)
writeFileSync('test-images/group.jpg', Buffer.from(bytes))
await browser.close()
console.log('wrote test-images/group.jpg')
