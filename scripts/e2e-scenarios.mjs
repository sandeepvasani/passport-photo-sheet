// End-to-end scenarios for things a plain walkthrough doesn't reach: failures (a
// download the browser can't encode, a model that won't load, running out of canvas
// memory), the Fix buttons, drag and drop, and wording that follows the settings.
// Exits non-zero if any scenario fails. Usage:
//   npm run build && npx vite preview --port 4173 &
//   npm run e2e:scenarios                # all scenarios
//   npm run e2e:scenarios -- download    # only those whose name contains "download"
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit } from 'playwright'

const images = join(dirname(fileURLToPath(import.meta.url)), '../test-images')
const url = process.env.APP_URL ?? 'http://localhost:4173/'
const only = process.argv.slice(2).map((s) => s.toLowerCase())
// ENGINE=webkit runs Safari's engine; otherwise installed Chrome (PW_CHANNEL=bundled for Playwright's Chromium).
const browser =
  process.env.ENGINE === 'webkit'
    ? await webkit.launch()
    : await chromium.launch(process.env.PW_CHANNEL === 'bundled' ? {} : { channel: 'chrome' })
const results = []

async function scenario(name, fn) {
  if (only.length && !only.some((s) => name.toLowerCase().includes(s))) return
  // A short window, so the Check step's list runs below the fold.
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 }, acceptDownloads: true })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  // Records text drawn on canvases (the sheet's scale-bar label).
  await page.addInitScript(() => {
    window.__texts = []
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
      window.__texts.push(String(text))
      return fillText.call(this, text, ...rest)
    }
  })
  const fails = []
  const expect = (ok, message) => ok || fails.push(message)
  try {
    await page.goto(url)
    await fn(page, expect)
  } catch (e) {
    fails.push(`threw: ${e.message.split('\n')[0]}`)
  }
  if (pageErrors.length) fails.push(`uncaught page errors: ${pageErrors.join(' | ')}`)
  results.push({ name, fails })
  console.log(`${fails.length ? 'FAIL' : 'PASS'}  ${name}${fails.map((f) => `\n      - ${f}`).join('')}`)
  await page.close()
}

const pickSpec = (page, name) => page.getByRole('radio', { name }).first().click()
const scrollY = (page) => page.evaluate(() => window.scrollY)

async function upload(page, file) {
  await page.getByTestId('file-input').setInputFiles(join(images, file))
  await page.getByRole('heading', { name: 'Crop & position' }).waitFor({ timeout: 120_000 })
}

async function toCheck(page) {
  await page.getByRole('button', { name: /Next: Background/ }).click()
  const toLayout = page.getByRole('button', { name: /Next: Print layout/ })
  if (await toLayout.count()) await toLayout.click()
  await page.getByRole('button', { name: /Next: Check/ }).click()
  await page.getByRole('heading', { name: 'Requirement check' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.status-icon--pending'), null, { timeout: 180_000 })
}

/** Ticks every box on the Check step, so the download buttons are enabled. */
async function confirmAll(page) {
  for (const box of await page.locator('.attestations input[type=checkbox]').all()) await box.check()
}

/** Makes canvas.toBlob give null, as browsers do when they can't spare the memory. */
const breakToBlob = (page) =>
  page.evaluate(() => {
    window.__toBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = (callback) => callback(null)
  })
const restoreToBlob = (page) => page.evaluate(() => (HTMLCanvasElement.prototype.toBlob = window.__toBlob))

async function dropFile(page, file) {
  const b64 = readFileSync(join(images, file)).toString('base64')
  const dataTransfer = await page.evaluateHandle(
    ({ b64, name }) => {
      const dt = new DataTransfer()
      dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: 'image/jpeg' }))
      return dt
    },
    { b64, name: file },
  )
  await page.dispatchEvent('.dropzone', 'drop', { dataTransfer })
}

await scenario('Fix buttons open the step that fixes the problem, scrolled to the top', async (page, expect) => {
  await pickSpec(page, /35 . 45 mm Passport/)
  await upload(page, 'two-people.jpg')
  await toCheck(page)

  // Another person in the frame is fixed by zooming in or moving the photo.
  const other = page.locator('li.check', { hasText: 'Only one person in the frame' })
  expect(await other.count(), 'no "Only one person in the frame" check')
  await other.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  expect((await scrollY(page)) > 0, 'page not scrolled down before clicking Fix')
  await other.getByRole('button', { name: 'Fix' }).click()
  expect(await page.getByRole('heading', { name: 'Crop & position' }).isVisible(), 'Fix did not open the Crop step')
  await page.waitForTimeout(1200)
  expect((await scrollY(page)) === 0, `not scrolled to the top after Fix (scrollY ${await scrollY(page)})`)

  // An expression needs a new photo.
  await page.getByRole('button', { name: /Check & download/ }).first().click()
  await page.getByRole('heading', { name: 'Requirement check' }).waitFor()
  const expression = page.locator('li.check', { hasText: 'Neutral expression' })
  expect(await expression.count(), 'no expression warning to try')
  await expression.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await expression.getByRole('button', { name: 'Fix' }).click()
  expect(await page.getByRole('heading', { name: /Choose the photo type/ }).isVisible(), 'expression Fix did not open the Upload step')
  await page.waitForTimeout(1200)
  expect((await scrollY(page)) === 0, 'not scrolled to the top after the expression Fix')
})

await scenario('A failed print download says why, and a later download clears it', async (page, expect) => {
  await upload(page, 'portrait.jpg')
  await toCheck(page)
  await confirmAll(page)
  for (const box of ['.checkbox--warn input', '.checkbox--fail input']) if (await page.locator(box).count()) await page.locator(box).check()
  const sheet = page.getByRole('button', { name: /print sheet/ })
  const photo = page.getByRole('button', { name: /single digital photo/ })
  const status = page.locator('.downloads [role=status]')
  expect(await sheet.isEnabled(), 'download not enabled after ticking every box')

  await breakToBlob(page)
  await sheet.click()
  await status.waitFor({ timeout: 5000 }).catch(() => {})
  const text = (await status.count()) ? await status.innerText() : ''
  expect(text.includes('low on memory'), `no explanation after the download failed (got "${text}")`)
  expect(text && (await status.getAttribute('class')).includes('alert--error'), 'the failure isn’t shown as an error')

  await restoreToBlob(page)
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), sheet.click()])
  expect(download.suggestedFilename() === 'passport-photo-us-2x2-4x6-print.jpg', `sheet saved as ${download.suggestedFilename()}`)
  await page.waitForTimeout(300)
  expect((await status.count()) === 0, 'the error is still shown after a download worked')
  const [single] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), photo.click()])
  expect(single.suggestedFilename() === 'passport-photo-us-2x2-digital.jpg', `photo saved as ${single.suggestedFilename()}`)
})

await scenario('A failed online-upload download says why; a working one shows the file size', async (page, expect) => {
  await pickSpec(page, /India Passport \(Passport Seva\)/)
  await upload(page, 'portrait.jpg')
  await toCheck(page)
  await confirmAll(page)
  for (const box of ['.checkbox--warn input', '.checkbox--fail input']) if (await page.locator(box).count()) await page.locator(box).check()
  const button = page.getByRole('button', { name: /online upload/ })
  const status = page.locator('.downloads [role=status]')

  await breakToBlob(page)
  await button.click()
  await status.waitFor({ timeout: 5000 }).catch(() => {})
  const failed = (await status.count()) ? await status.innerText() : ''
  expect(failed.includes('low on memory'), `no explanation after the download failed (got "${failed}")`)

  await restoreToBlob(page)
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), button.click()])
  expect(download.suggestedFilename() === 'passport-photo-in-online-630x810.jpg', `saved as ${download.suggestedFilename()}`)
  await page.waitForTimeout(300)
  const saved = await status.innerText()
  expect(/^Saved: 630 × 810 px JPEG, \d+ KB\.$/.test(saved), `unexpected status "${saved}"`)
})

await scenario('When the hair-detail model fails to load, "Try again" loads it', async (page, expect) => {
  await pickSpec(page, /Canada Passport/)
  await page.route('**/models/modnet_fp16.onnx', (route) => route.abort())
  await upload(page, 'plain-bg.jpg')
  await page.getByRole('button', { name: /Next: Background/ }).click()
  await page.getByRole('radio', { name: 'Replace background' }).click()
  const retry = page.getByRole('button', { name: 'Try again' })
  await retry.waitFor({ timeout: 60_000 }).catch(() => {})
  expect(await retry.count(), 'no "Try again" button after the model failed to load')
  await page.unroute('**/models/modnet_fp16.onnx')
  if (!(await retry.count())) return

  await retry.click()
  await page.locator('.inline-status').waitFor({ timeout: 5000 }).catch(() => {})
  await page.locator('.inline-status').waitFor({ state: 'detached', timeout: 120_000 })
  await page.waitForTimeout(500)
  expect((await retry.count()) === 0, '"Try again" still shown once the model could load')
  expect((await page.locator('.alert--error').count()) === 0, 'the error is still shown once the model could load')
})

await scenario('Switching person: a failure is explained, and switching works afterwards', async (page, expect) => {
  await upload(page, 'two-people.jpg')
  const other = page.locator('.subject-picker [role=radio][aria-checked=false]').first()
  const name = await other.getAttribute('aria-label')
  const alert = page.locator('.subject-picker [role=alert]')
  // Image-processing canvases fail, as when the browser runs out of canvas memory.
  await page.evaluate(() => {
    window.__getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return opts?.willReadFrequently ? null : window.__getContext.call(this, type, opts)
    }
  })
  await other.click()
  await alert.waitFor({ timeout: 10_000 }).catch(() => {})
  const text = (await alert.count()) ? await alert.innerText() : ''
  expect(text.startsWith('Couldn’t switch to that person.'), `no explanation after switching failed (got "${text}")`)
  expect((await page.locator('.subject-picker .spinner').count()) === 0, 'still showing the spinner')
  expect(await other.isEnabled(), 'the person buttons are still disabled')

  await page.evaluate(() => (HTMLCanvasElement.prototype.getContext = window.__getContext))
  await page.getByRole('radio', { name }).click()
  await page.waitForFunction(() => !document.querySelector('.subject-picker .spinner'), null, { timeout: 60_000 })
  expect((await page.getByRole('radio', { name }).getAttribute('aria-checked')) === 'true', 'switching didn’t work after the failure')
  expect((await alert.count()) === 0, 'the error is still shown after switching worked')
})

await scenario('A drop while a photo is processing is ignored, and dropping a photo works', async (page, expect) => {
  // Hold the face-detection model back, so the first photo stays "processing" while the page can still take a drop.
  let release
  const held = new Promise((resolve) => (release = resolve))
  await page.route('**/models/face_landmarker.task', async (route) => {
    await held
    await route.continue()
  })
  const crop = page.getByRole('heading', { name: 'Crop & position' })
  await page.getByTestId('file-input').setInputFiles(join(images, 'portrait.jpg'))
  await page.getByText(/Loading face detection/).waitFor()
  // A photo without a face: if it were used, the Upload step would show an error.
  await dropFile(page, 'no-face.jpg')
  release()
  await crop.waitFor({ timeout: 120_000 })
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: '← Back' }).click()
  await page.waitForTimeout(300)
  const errors = await page.locator('.alert--error').allInnerTexts()
  expect(errors.length === 0, `the photo dropped while busy was used: ${errors.join(' ')}`)

  await dropFile(page, 'two-people.jpg')
  await page.locator('.subject-picker').waitFor({ timeout: 120_000 }).catch(() => {})
  expect(await page.locator('.subject-picker').isVisible(), 'dropping a photo did nothing')
})

await scenario('Cut-line wording follows the cut-lines setting, and warnings are counted in words', async (page, expect) => {
  await pickSpec(page, /India Visa \/ OCI/)
  await upload(page, 'glasses-glare.jpg')
  await page.getByRole('button', { name: /Next: Background/ }).click()
  await page.getByRole('button', { name: /Next: Print layout/ }).click()
  // 2 × 2 in photos fill a 4 × 6 edge to edge, leaving no room for the scale bar; a 5 × 7 has room.
  await page.getByRole('radio', { name: /5 × 7 in/ }).click()
  const sheetLabel = () => page.evaluate(() => window.__texts.filter((t) => t.startsWith('← should')).at(-1))

  await page.getByLabel('Draw thin grey cut lines').uncheck()
  await page.getByRole('button', { name: /Next: Check/ }).click()
  await page.waitForFunction(() => !document.querySelector('.status-icon--pending'), null, { timeout: 180_000 })
  const helpOff = await page.locator('.print-help').innerText()
  expect(helpOff.includes('cut the photos apart') && !helpOff.includes('grey lines'), `instructions without cut lines: ${helpOff}`)
  const labelOff = await sheetLabel()
  expect(labelOff && !labelOff.includes('cut along'), `sheet label without cut lines: ${labelOff}`)

  // This photo currently has one warning, which checks the singular.
  const warnings = await page.locator('li.check--warn').count()
  const pill = warnings ? await page.locator('.summary__pill--warn').innerText() : ''
  expect(!warnings || pill === `${warnings} warning${warnings === 1 ? '' : 's'}`, `"${pill}" for ${warnings} warnings`)

  await page.getByRole('button', { name: '← Back' }).click()
  await page.getByLabel('Draw thin grey cut lines').check()
  await page.getByRole('button', { name: /Next: Check/ }).click()
  const helpOn = await page.locator('.print-help').innerText()
  expect(helpOn.includes('cut along the grey lines'), `instructions with cut lines: ${helpOn}`)
  const labelOn = await sheetLabel()
  expect(labelOn === '← should measure exactly 1 inch  ·  India Visa / OCI 2 × 2 in  ·  cut along the grey lines', `sheet label with cut lines: ${labelOn}`)
})

await browser.close()
const failed = results.filter((r) => r.fails.length)
console.log(`\n${results.length - failed.length} of ${results.length} scenarios passed`)
process.exit(failed.length || !results.length ? 1 : 0)
