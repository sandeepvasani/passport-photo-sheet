// End-to-end smoke test: uploads a photo, walks every step, saves screenshots
// and the downloaded files to e2e-output/. Usage:
//   npm run build && npx vite preview --port 4173 &
//   node scripts/e2e.mjs test-images/portrait.jpg [spec-id] [print-id]
import { statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { chromium, webkit } from 'playwright'

const [, , imagePath = 'test-images/portrait.jpg', specId = 'us-2x2', printLabel = '4 × 6'] = process.argv
const url = process.env.APP_URL ?? 'http://localhost:4173/'
const out = join(
  'e2e-output',
  `${basename(imagePath).replace(/\.\w+$/, '')}-${specId}${process.env.MOBILE ? '-mobile' : ''}${process.env.ENGINE === 'webkit' ? '-webkit' : ''}`,
)
await mkdir(out, { recursive: true })

// ENGINE=webkit runs Safari's engine; otherwise installed Chrome (PW_CHANNEL=bundled for Playwright's Chromium).
const browser =
  process.env.ENGINE === 'webkit'
    ? await webkit.launch()
    : await chromium.launch(process.env.PW_CHANNEL === 'bundled' ? {} : { channel: 'chrome' })
const page = await browser.newPage(
  process.env.MOBILE
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true }
    : { viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true },
)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('INFO:') && errors.push(m.text()))

await page.goto(url)
const specLabel = { 'us-2x2': 'US Passport / Visa', 'in-2x2': 'India Visa / OCI', 'in-online': 'India Passport \\(Passport Seva\\)', 'intl-35x45': '35 × 45 mm Passport', 'ca-50x70': 'Canada Passport' }[specId]
await page.getByRole('radio', { name: new RegExp(specLabel.replace(/[/×]/g, '.')) }).click()
await page.screenshot({ path: join(out, '1-upload.png') })

const t0 = Date.now()
await page.getByTestId('file-input').setInputFiles(imagePath)
const cropHeading = page.getByRole('heading', { name: 'Crop & position' })
const uploadError = page.locator('.alert--error')
await Promise.race([cropHeading.waitFor({ timeout: 120_000 }), uploadError.waitFor({ timeout: 120_000 })])
console.log(`analysis took ${Date.now() - t0} ms`)
if (await uploadError.isVisible()) {
  // Photos that can't be used are stopped on the Upload screen.
  await page.screenshot({ path: join(out, '1b-upload-error.png'), fullPage: true })
  console.log('upload error:', await uploadError.innerText())
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors')
  await browser.close()
  process.exit(0)
}
if (process.env.SUBJECT) {
  // SUBJECT=n picks the n-th person from the left when the photo has several.
  await page.getByRole('radio', { name: `Person ${process.env.SUBJECT}` }).click()
  await page.waitForFunction(() => !document.querySelector('.subject-picker .spinner'), null, { timeout: 60_000 })
  console.log(`picked person ${process.env.SUBJECT}`)
}
await page.waitForTimeout(300)
// The editor must actually show the photo (a blank canvas once slipped through as a "white screen").
const drawn = await page.evaluate(() => {
  const c = document.querySelector('.editor__canvas')
  if (!c || c.width === 300) return false
  const px = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data
  return px[3] === 255
})
console.log(`editor drawn: ${drawn ? 'yes' : 'NO'}`)
if (!drawn) errors.push('Crop editor did not draw the photo')
await page.screenshot({ path: join(out, '2-crop.png'), fullPage: true })
const lists = page.locator('.checks')
if ((await lists.count()) > 1) console.log('early issues:', await lists.first().innerText())
console.log('crop measurements:', await lists.last().innerText())

await page.getByRole('button', { name: /Next: Background/ }).click()
await page.waitForTimeout(800)
await page.screenshot({ path: join(out, '3-background.png'), fullPage: true })

if (process.env.REPLACE_BG) {
  await page.getByRole('radio', { name: 'Replace background' }).click()
  const t1 = Date.now()
  await page.waitForTimeout(300)
  await page.locator('.inline-status').waitFor({ state: 'detached', timeout: 120_000 })
  await page.waitForTimeout(500)
  console.log(`hair-detail matte took ${Date.now() - t1} ms`)
  await page.screenshot({ path: join(out, '3b-background-replaced.png'), fullPage: true })
}

await page.getByRole('button', { name: /Next: Print layout/ }).click()
await page.getByRole('radio', { name: new RegExp(printLabel) }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: join(out, '4-layout.png'), fullPage: true })

await page.getByRole('button', { name: /Next: Check/ }).click()
await page.waitForTimeout(800)
console.log('checks:\n' + (await page.locator('.checks').first().innerText()))
const sheetButton = page.getByRole('button', { name: /print sheet/ })
console.log('download enabled before confirming:', await sheetButton.isEnabled())
console.log((await page.locator('.download-todo').innerText()).trim())
await page.screenshot({ path: join(out, '5a-check-unconfirmed.png'), fullPage: true })
for (const box of await page.locator('.attestations input[type=checkbox]').all()) await box.check()
await page.screenshot({ path: join(out, '5-check.png'), fullPage: true })
console.log(`to-do after confirming: ${(await page.locator('.download-todo').count()) ? 'still shown' : 'gone'}`)
console.log('download enabled after confirming:', await sheetButton.isEnabled())

if (await sheetButton.isEnabled()) {
  for (const [button, file] of [
    [sheetButton, 'sheet.jpg'],
    [page.getByRole('button', { name: /single digital photo|online upload/ }), 'photo.jpg'],
  ]) {
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
    await download.saveAs(join(out, file))
    console.log('saved', download.suggestedFilename(), `${statSync(join(out, file)).size} bytes`)
  }
  const status = page.locator('.downloads [role=status]')
  if (await status.count()) console.log('status:', await status.innerText())
}

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors')
await browser.close()
