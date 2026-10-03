// End-to-end scenarios for things a plain walkthrough doesn't reach: failures (a
// download the browser can't encode, a model that won't load, running out of canvas
// memory), the Fix buttons, drag and drop, moving markers by keyboard and touch, focus
// and reduced motion, Data Saver, group photos, preview memory, and wording that follows
// the settings. Exits non-zero if any scenario fails. Usage:
//   npm run build && npx vite preview --port 4173 &
//   npm run e2e:scenarios                # all scenarios
//   npm run e2e:scenarios -- download    # only those whose name contains "download"
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright'

const images = join(dirname(fileURLToPath(import.meta.url)), '../test-images')
const url = process.env.APP_URL ?? 'http://localhost:4173/'
const only = process.argv.slice(2).map((s) => s.toLowerCase())
// ENGINE=webkit runs Safari's engine and ENGINE=firefox Firefox's; otherwise installed Chrome
// (PW_CHANNEL=bundled for Playwright's Chromium).
const engine = process.env.ENGINE ?? 'chromium'
const browser =
  engine === 'chromium'
    ? await chromium.launch(process.env.PW_CHANNEL === 'bundled' ? {} : { channel: 'chrome' })
    : engine === 'firefox'
      ? // Headless Firefox has no WebGL, which face detection needs: CI runs it headed (HEADED=1) in a
        // virtual display, and software WebGL is allowed.
        await firefox.launch({ headless: !process.env.HEADED, firefoxUserPrefs: { 'webgl.force-enabled': true } })
      : await webkit.launch()
const results = []

async function scenario(name, fn, pageOptions = {}) {
  if (only.length && !only.some((s) => name.toLowerCase().includes(s))) return
  // A short window, so the Check step's list runs below the fold. The service worker is blocked unless a
  // scenario allows it: it would reload the first visit, and page.route() can't see the requests it handles.
  const page = await browser.newPage({
    viewport: { width: 1280, height: 700 },
    acceptDownloads: true,
    serviceWorkers: 'block',
    ...pageOptions,
  })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  const consoleErrors = []
  // Errors logged as objects are described by their message (the text would be "JSHandle@object").
  const describe = (m) =>
    Promise.all(
      m
        .args()
        .map((a) => a.evaluate((v) => (v instanceof Error ? v.message : typeof v === 'string' ? v : JSON.stringify(v))).catch(() => '?')),
    ).then((parts) => parts.join(' ') || m.text())
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('INFO:') && consoleErrors.push(describe(m)))
  // Content-Security-Policy violations count as failures in every scenario.
  page.on('console', (m) => m.text().startsWith('CSP violation') && pageErrors.push(m.text()))
  await page.addInitScript(() =>
    document.addEventListener(
      'securitypolicyviolation',
      (e) => !window.__expectViolation && console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`),
    ),
  )
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
  if (fails.length) {
    // What the page showed and logged, to explain a failure (in CI, say).
    const shown = await page
      .locator('.alert--error')
      .allInnerTexts()
      .catch(() => [])
    if (shown.length) fails.push(`page showed: ${shown.join(' | ').replace(/\s+/g, ' ')}`)
    if (consoleErrors.length) fails.push(`console errors: ${(await Promise.all(consoleErrors.slice(-5))).join(' | ')}`)
  }
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
  await page.getByRole('button', { name: /Next: Check/ }).click()
  await page.getByRole('heading', { name: 'Requirement check' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.status-icon--pending'), null, { timeout: 180_000 })
}

/** Ticks every box on the Check step, including the warnings and failures ones. */
async function acceptAll(page) {
  for (const box of await page.locator('.attestations input[type=checkbox]').all()) await box.check()
}

const toDownloadButton = (page) => page.getByRole('button', { name: /^Next: (Print & d|D)ownload/ })

/** From the Check step, ticks every box and goes on to the Download step. */
async function checkToDownload(page) {
  await acceptAll(page)
  await toDownloadButton(page).click()
  await page.getByRole('heading', { name: 'Download', exact: true }).waitFor()
}

async function toDownload(page) {
  await toCheck(page)
  await checkToDownload(page)
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
  await page
    .locator('.stepper')
    .getByRole('button', { name: /Check$/ })
    .click()
  await page.getByRole('heading', { name: 'Requirement check' }).waitFor()
  const expression = page.locator('li.check', { hasText: 'Neutral expression' })
  expect(await expression.count(), 'no expression warning to try')
  await expression.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await expression.getByRole('button', { name: 'Fix' }).click()
  expect(await page.getByRole('heading', { name: /Choose the photo type/ }).isVisible(), 'expression Fix did not open the Upload step')
  await page.waitForTimeout(1200)
  expect((await scrollY(page)) === 0, 'not scrolled to the top after the expression Fix')
})

await scenario('The Download step stays locked until the Check step is done', async (page, expect) => {
  await upload(page, 'portrait.jpg')
  // Straight to the last step through the step bar.
  await page
    .locator('.stepper')
    .getByRole('button', { name: /Print & download$/ })
    .click()
  await page.getByRole('heading', { name: 'Download', exact: true }).waitFor()
  const sheet = page.getByRole('button', { name: /print sheet/ })
  expect(await page.locator('.download-gate').isVisible(), 'no note saying the check comes first')
  expect(!(await sheet.isEnabled()), 'the sheet can be downloaded before the check')

  await page.getByRole('button', { name: 'Go to Check' }).click()
  await page.getByRole('heading', { name: 'Requirement check' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.status-icon--pending'), null, { timeout: 180_000 })
  expect(!(await toDownloadButton(page).isEnabled()), '“Next” is enabled before anything is ticked')
  await acceptAll(page)
  expect(await toDownloadButton(page).isEnabled(), '“Next” is still disabled after ticking every box')
  await toDownloadButton(page).click()
  expect((await page.locator('.download-gate').count()) === 0, 'the note is still shown after the check')
  expect(await sheet.isEnabled(), 'the sheet can’t be downloaded after the check')
})

await scenario('Problems that need a new photo show on the Crop step, before any more work goes into it', async (page, expect) => {
  await upload(page, 'shadow-side.jpg')
  const shadows = (list) => list.locator('li.check', { hasText: 'Even lighting on face' }).locator('.check__body')
  const list = page.locator('.checks').first()
  const early = (await shadows(list).count()) ? await shadows(list).innerText() : ''
  expect(early.includes('Shadow found'), `no shadow warning on the Crop step: ${await list.innerText()}`)
  // The final check says the same.
  await toCheck(page)
  const final = await shadows(page).innerText()
  expect(final === early, `the Crop step says "${early}", the final check "${final}"`)
})

await scenario('A failed print download says why, and a later download clears it', async (page, expect) => {
  await upload(page, 'portrait.jpg')
  await toDownload(page)
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
  await toDownload(page)
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
  await page
    .locator('.inline-status')
    .waitFor({ timeout: 5000 })
    .catch(() => {})
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
  await page
    .locator('.subject-picker')
    .waitFor({ timeout: 120_000 })
    .catch(() => {})
  expect(await page.locator('.subject-picker').isVisible(), 'dropping a photo did nothing')
})

await scenario('Cut-line wording follows the cut-lines setting, and warnings are counted in words', async (page, expect) => {
  await pickSpec(page, /India Visa \/ OCI/)
  await upload(page, 'glasses-glare.jpg')
  await toCheck(page)
  // This photo currently has one warning, which checks the singular.
  const warnings = await page.locator('li.check--warn').count()
  const pill = warnings ? await page.locator('.summary__pill--warn').innerText() : ''
  expect(!warnings || pill === `${warnings} warning${warnings === 1 ? '' : 's'}`, `"${pill}" for ${warnings} warnings`)

  await checkToDownload(page)
  // 2 × 2 in photos fill a 4 × 6 edge to edge, leaving no room for the scale bar; a 5 × 7 has room.
  await page.getByRole('radio', { name: /5 × 7 in/ }).click()
  const sheetLabel = () => page.evaluate(() => window.__texts.filter((t) => t.startsWith('← should')).at(-1))

  await page.getByLabel('Draw thin grey cut lines').uncheck()
  const helpOff = await page.locator('.print-help').innerText()
  expect(helpOff.includes('cut the photos apart') && !helpOff.includes('grey lines'), `instructions without cut lines: ${helpOff}`)
  const labelOff = await sheetLabel()
  expect(labelOff && !labelOff.includes('cut along'), `sheet label without cut lines: ${labelOff}`)

  await page.getByLabel('Draw thin grey cut lines').check()
  const helpOn = await page.locator('.print-help').innerText()
  expect(helpOn.includes('cut along the grey lines'), `instructions with cut lines: ${helpOn}`)
  const labelOn = await sheetLabel()
  expect(
    labelOn === '← should measure exactly 1 inch  ·  India Visa / OCI 2 × 2 in  ·  cut along the grey lines',
    `sheet label with cut lines: ${labelOn}`,
  )
})

/** Drags a file over an element and drops it; whether the page stopped the browser opening it, for each event. */
const dropOutside = (page, selector) =>
  page.evaluate((selector) => {
    const dt = new DataTransfer()
    dt.items.add(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }))
    const target = document.querySelector(selector)
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
    target.dispatchEvent(over)
    target.dispatchEvent(drop)
    return over.defaultPrevented && drop.defaultPrevented
  }, selector)

await scenario('A file dropped outside the drop box isn’t opened in place of the app', async (page, expect) => {
  expect(await dropOutside(page, '.app__header'), 'a drop on the header would open the file (Upload step)')
  await upload(page, 'portrait.jpg')
  expect(await dropOutside(page, '.editor__canvas'), 'a drop on the crop editor would open the file')
  expect(await dropOutside(page, '.app__footer'), 'a drop on the footer would open the file (Crop step)')
})

await scenario('Upload-only photo types don’t render a print sheet', async (page, expect) => {
  const sheetDrawn = () => page.evaluate(() => window.__texts.some((t) => t.startsWith('← should')))
  // The printed China type does, which shows the sheet's label is a fair sign of a sheet.
  await pickSpec(page, /China Visa(?! Upload)/)
  await upload(page, 'portrait.jpg')
  await toDownload(page)
  expect(await sheetDrawn(), 'no sheet drawn for the printed China photo')

  await page.goto(url)
  await pickSpec(page, /China Visa Upload/)
  await upload(page, 'portrait.jpg')
  await toDownload(page)
  expect(!(await sheetDrawn()), 'a print sheet was drawn for an upload-only photo')
  expect((await page.getByRole('radio', { name: /4 × 6 in/ }).count()) === 0, 'print sizes offered for an upload-only photo')
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10_000 }),
    page.getByRole('button', { name: /online upload/ }).click(),
  ])
  expect(download.suggestedFilename() === 'passport-photo-cn-visa-upload-420x560.jpg', `saved as ${download.suggestedFilename()}`)
})

await scenario('Each new step moves focus to its heading', async (page, expect) => {
  const focused = () =>
    page.evaluate(() => (document.activeElement?.tagName === 'H2' ? document.activeElement.textContent : document.activeElement?.tagName))
  expect((await focused()) === 'BODY', `focus moved on page load (to ${await focused()})`)
  await upload(page, 'portrait.jpg')
  expect((await focused()) === 'Crop & position', `after upload, focus is on ${await focused()}`)
  const next = async (button, heading) => {
    await page.getByRole('button', { name: button }).click()
    await page.waitForTimeout(100)
    expect((await focused()) === heading, `after "${button}", focus is on ${await focused()}, not "${heading}"`)
  }
  await next(/Next: Background/, 'Background')
  await next(/Next: Check/, 'Requirement check')
  await page.waitForFunction(() => !document.querySelector('.status-icon--pending'), null, { timeout: 180_000 })
  await acceptAll(page)
  await next(/Next: Print & download/, 'Print size')
  await next('← Back', 'Requirement check')
})

await scenario('Check results name their status for screen readers', async (page, expect) => {
  await upload(page, 'portrait.jpg')
  await toCheck(page)
  const list = page.locator('.checks').first()
  for (const [status, name] of [
    ['pass', 'Passed'],
    ['warn', 'Warning'],
    ['fail', 'Failed'],
  ]) {
    const rows = await list.locator(`li.check--${status}`).count()
    const icons = await list.getByRole('img', { name, exact: true }).count()
    expect(rows === icons, `${rows} ${status} checks but ${icons} icons named "${name}"`)
  }
})

await scenario('With reduced motion, step changes jump to the top and the spinner slows', async (page, expect) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByTestId('file-input').setInputFiles(join(images, 'portrait.jpg'))
  const spinner = page.locator('.dropzone__busy .spinner')
  await spinner.waitFor()
  const duration = await spinner.evaluate((el) => getComputedStyle(el).animationDuration)
  expect(duration === '2.4s', `spinner turns every ${duration}`)
  await page.getByRole('heading', { name: 'Crop & position' }).waitFor({ timeout: 120_000 })
  // From the bottom of the Download step back to the Check step, which is tall enough to scroll.
  await toDownload(page)
  const back = page.getByRole('button', { name: '← Back' })
  await back.evaluate((el) => el.scrollIntoView({ block: 'end' }))
  await back.click()
  const checkHeight = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
  expect(checkHeight > 0, 'the Check step is too short to show whether it scrolls')
  expect((await scrollY(page)) === 0, `not at the top straight after the step change (scrollY ${await scrollY(page)})`)
})

await scenario('Sheet previews are a smaller copy, freed when the step changes; photo previews are full size', async (page, expect) => {
  await upload(page, 'portrait.jpg')
  await toDownload(page)
  await page.getByRole('radio', { name: /8 × 10 in/ }).click()
  await page.waitForTimeout(500)
  const preview = await page.locator('.sheet-preview').elementHandle()
  const size = await preview.evaluate((c) => [c.width, c.height])
  // The 8 × 10 in sheet is 2400 × 3000 px at 300 DPI.
  expect(size[0] === 1280 && size[1] === 1600, `sheet preview is ${size.join(' × ')} px, expected 1280 × 1600`)
  const drawn = await preview.evaluate((c) => c.getContext('2d').getImageData(c.width / 2, c.height / 4, 1, 1).data[3] === 255)
  expect(drawn, 'sheet preview is blank')
  // Shown as large as before: the full 72% of the window's height (CSS max-height: 72vh).
  const box = await preview.boundingBox()
  expect(box && Math.abs(box.height - 0.72 * 700) < 2, `sheet preview shown ${box?.height} px tall, expected 504`)

  await page.getByRole('button', { name: '← Back' }).click()
  await page.getByRole('heading', { name: 'Requirement check' }).waitFor()
  expect((await preview.evaluate((c) => c.width)) === 0, 'the Download step’s preview was not freed')
  const photo = await page.locator('.final-previews .photo-frame').evaluate((c) => [c.width, c.height])
  expect(photo[0] === 600 && photo[1] === 600, `photo preview is ${photo.join(' × ')} px, expected the full 600 × 600`)
})

await scenario('The Upload step lists China’s face width and space above the head', async (page, expect) => {
  const summary = () => page.locator('.spec-summary').innerText()
  await pickSpec(page, /China Visa(?! Upload)/)
  const printed = await summary()
  expect(/Face width\s+15–22 mm/.test(printed), `China Visa summary: ${printed}`)
  expect(/Space above head\s+3–5 mm/.test(printed), `China Visa summary: ${printed}`)
  await pickSpec(page, /China Visa Upload/)
  const online = await summary()
  expect(/Head \(chin to top of hair\)\s+28–37 mm \(guideline\)/.test(online), `China Visa Upload summary: ${online}`)
  expect(online.includes('Face width'), `China Visa Upload summary: ${online}`)
  await pickSpec(page, /US Passport/)
  const us = await summary()
  expect(!us.includes('Face width') && !us.includes('Space above head') && !us.includes('guideline'), `US summary: ${us}`)
})

/** Reads the Crop step's head size (mm) and eye tilt (degrees). */
const headSize = async (page) => parseFloat(await page.locator('.slider', { hasText: 'Head size' }).locator('output').innerText())
const eyeTilt = async (page) =>
  parseFloat((await page.locator('li.check', { hasText: 'Head level' }).innerText()).match(/tilted (-?[\d.]+)°/)?.[1])

await scenario('Markers can be picked and moved with the keyboard', async (page, expect) => {
  await pickSpec(page, /35 . 45 mm Passport/)
  await upload(page, 'portrait.jpg')
  const refit = page.getByLabel('Re-fit automatically after moving a marker')
  const editor = page.locator('.editor__canvas')
  const live = page.locator('.editor [aria-live]')
  await refit.uncheck()
  await editor.focus()

  const fitted = await headSize(page)
  await page.keyboard.press('m')
  expect((await live.innerText()).includes('top of head'), `announced "${await live.innerText()}"`)
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(100)
  const moved = await headSize(page)
  expect(Math.abs(moved - (fitted - 1)) < 0.11, `head ${fitted} → ${moved} mm after moving the top of head 1 mm down`)

  await page.keyboard.press('Escape')
  expect((await live.innerText()) === 'Moving the photo.', `announced "${await live.innerText()}"`)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(100)
  expect((await headSize(page)) === moved, 'moving the photo changed the head size')

  for (let i = 0; i < 3; i++) await page.keyboard.press('m')
  expect((await live.innerText()).includes('eye on the left'), `announced "${await live.innerText()}"`)
  await page.keyboard.press('Shift+ArrowUp')
  await page.waitForTimeout(100)
  expect(Math.abs(await eyeTilt(page)) > 2, `eyes tilted ${await eyeTilt(page)}° after moving one 1 mm up`)

  // With re-fit on, letting go of the key re-fits, which levels the eyes again.
  await refit.check()
  await editor.focus()
  await page.keyboard.press('m')
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(200)
  expect((await eyeTilt(page)) === 0, `eyes tilted ${await eyeTilt(page)}° after letting go of the key with re-fit on`)
})

await scenario(
  'A finger grabs a marker from further away than a mouse does',
  async (page, expect) => {
    if (engine !== 'chromium') return console.log('      (touch input needs Chromium: skipped)')
    await pickSpec(page, /35 . 45 mm Passport/)
    await upload(page, 'portrait.jpg')
    await page.getByLabel('Re-fit automatically after moving a marker').uncheck()
    const editor = page.locator('.editor__canvas')
    await editor.scrollIntoViewIfNeeded()
    // The eye on the left: the yellow eye line and circles start 6 px left of its centre.
    const eye = () =>
      editor.evaluate((c) => {
        const { data, width, height } = c.getContext('2d').getImageData(0, 0, c.width, c.height)
        let minX = Infinity
        let sumY = 0
        let n = 0
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4
            if (data[i] > 235 && data[i + 1] > 190 && data[i + 1] < 220 && data[i + 2] < 60) {
              minX = Math.min(minX, x)
              sumY += y
              n++
            }
          }
        }
        const r = c.getBoundingClientRect()
        return { x: r.left + ((minX + 6.25) * r.width) / width, y: r.top + ((sumY / n) * r.height) / height }
      })
    expect((await eyeTilt(page)) === 0, 'eyes not level to start with')

    // 18 px above the eye: outside a mouse's reach (14 px), so a mouse drag moves the photo.
    let e = await eye()
    await page.mouse.move(e.x, e.y - 18)
    await page.mouse.down()
    await page.mouse.move(e.x, e.y - 28, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    expect((await eyeTilt(page)) === 0, `a mouse drag 18 px from the eye moved it (tilt ${await eyeTilt(page)}°)`)

    // The same from a finger grabs the eye.
    e = await eye()
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
    await touch('touchStart', e.x, e.y - 18)
    await touch('touchMove', e.x, e.y - 24)
    await touch('touchMove', e.x, e.y - 30)
    await touch('touchEnd')
    await page.waitForTimeout(200)
    expect(Math.abs(await eyeTilt(page)) > 2, `a touch 18 px from the eye didn't move it (tilt ${await eyeTilt(page)}°)`)
  },
  { hasTouch: true },
)

await scenario('With Data Saver on, the expression model isn’t downloaded and nothing waits for it', async (page, expect) => {
  const model = /emotion-ferplus|ort-wasm/
  // Without Data Saver (in a separate browser context, so nothing is cached), the model is fetched.
  const control = await browser.newPage({ viewport: { width: 1280, height: 700 } })
  await control.goto(url)
  const fetched = control.waitForRequest(model, { timeout: 120_000 }).then(
    () => true,
    () => false,
  )
  await upload(control, 'portrait.jpg')
  expect(await fetched, 'the expression model wasn’t fetched without Data Saver either')
  await control.close()

  const requested = []
  page.on('request', (r) => model.test(r.url()) && requested.push(r.url()))
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true } }))
  await page.goto(url)
  await pickSpec(page, /35 . 45 mm Passport/)
  await upload(page, 'portrait.jpg')
  await page.getByRole('button', { name: /Next: Background/ }).click()
  await page.getByRole('button', { name: /Next: Check/ }).click()
  await page.waitForTimeout(300)
  expect((await page.locator('.status-icon--pending').count()) === 0, 'a check is waiting for the expression model')
  // The face mesh still catches the smile.
  const expression = await page.locator('li.check', { hasText: 'Neutral expression' }).innerText()
  expect(expression.includes('smiling'), `expression check: ${expression}`)
  await page.waitForTimeout(2000)
  expect(requested.length === 0, `fetched with Data Saver on: ${requested.join(', ')}`)
})

await scenario('Everyone in a group photo can be picked', async (page, expect) => {
  await upload(page, 'group.jpg')
  const people = await page.locator('.subject-picker [role=radio]').count()
  expect(people === 4, `${people} of the 4 people offered`)
})

const chromiumOnly = (reason) => engine !== 'chromium' && (console.log(`      (${reason}: skipped)`), true)
const isChecked = async (page, name) => (await page.getByRole('radio', { name }).first().getAttribute('aria-checked')) === 'true'

await scenario('Replacing the background and adjusting its edges don’t freeze the page', async (page, expect) => {
  if (!(await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('longtask')))) {
    return console.log('      (this browser doesn’t report long tasks: skipped)')
  }
  await pickSpec(page, /Canada Passport/)
  await upload(page, 'plain-bg.jpg')
  await page.getByRole('button', { name: /Next: Background/ }).click()
  await page.evaluate(() => {
    window.__long = []
    new PerformanceObserver((list) => window.__long.push(...list.getEntries().map((e) => e.duration))).observe({ type: 'longtask' })
  })
  await page.getByRole('radio', { name: 'Replace background' }).click()
  await page.waitForTimeout(300)
  await page.locator('.inline-status').waitFor({ state: 'detached', timeout: 120_000 })
  const slider = page.locator('.slider', { hasText: 'Edge softness' }).locator('input')
  for (const v of [6, 7, 8, 9]) {
    await slider.fill(String(v))
    await page.waitForTimeout(150)
  }
  await page.waitForTimeout(1500)
  const longest = await page.evaluate(() => Math.max(0, ...window.__long))
  expect(longest < 400, `the page froze for ${Math.round(longest)} ms`)
})

await scenario('If the edge-refinement worker can’t load, the photo is still made', async (page, expect) => {
  let failed = false
  page.on('requestfailed', (r) => r.url().includes('refine.worker') && (failed = true))
  await page.route('**/refine.worker-*.js', (route) => route.abort())
  await upload(page, 'portrait.jpg')
  await toDownload(page)
  expect(failed, 'the worker wasn’t asked for')
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: /print sheet/ }).click(),
  ])
  expect(download.suggestedFilename() === 'passport-photo-us-2x2-4x6-print.jpg', `saved as ${download.suggestedFilename()}`)
})

await scenario('A first visit reloads once to turn on multi-threading, and ONNX Runtime uses several threads', async (_, expect) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } })
  let loads = 0
  page.on('load', () => loads++)
  await page.goto(url)
  await page.waitForFunction(() => self.crossOriginIsolated, null, { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => self.crossOriginIsolated), 'not cross-origin isolated after the first visit')
  // The app notes the reload it makes. Firefox also counts a page load of its own as it switches the page
  // into isolation (a new process), so the number of loads is only checked in the other engines.
  const reloaded = await page.evaluate(() => sessionStorage.getItem('passport-photo:isolation-reload'))
  expect(reloaded === '1', `the app didn’t note its reload (${reloaded})`)
  if (engine !== 'firefox') expect(loads === 2, `${loads} page loads on the first visit, expected 2 (one reload)`)
  const before = loads
  await page.reload()
  await page.waitForTimeout(1000)
  expect(loads === before + 1, `${loads - before} loads on the next visit, expected 1 (no extra reload)`)
  // The expression model starts ONNX Runtime; it then reports the threads it was set up with.
  const model = page.waitForRequest(/emotion-ferplus/, { timeout: 120_000 })
  await upload(page, 'portrait.jpg')
  await model
  const threads = await page.evaluate(async () => (await import('./vendor/onnxruntime/ort.wasm.bundle.min.mjs')).env.wasm.numThreads)
  expect(threads > 1, `ONNX Runtime set up with ${threads} thread(s)`)
  await page.close()
})

await scenario('The first-visit reload doesn’t happen once a photo has been chosen', async (_, expect) => {
  if (chromiumOnly('holding the service worker’s requests needs Chromium')) return
  const context = await browser.newContext({ viewport: { width: 1280, height: 700 } })
  // Hold the service worker's install until a photo has been chosen.
  let release
  const held = new Promise((resolve) => (release = resolve))
  await context.route('**/favicon.svg', async (route) => {
    await held
    await route.continue()
  })
  const page = await context.newPage()
  let loads = 0
  page.on('load', () => loads++)
  await page.goto(url)
  await upload(page, 'portrait.jpg')
  release()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 })
  await page.waitForTimeout(1500)
  expect(loads === 1, `the page reloaded with a photo chosen (${loads} loads)`)
  expect(await page.getByRole('heading', { name: 'Crop & position' }).isVisible(), 'the photo was lost')
  await context.close()
})

await scenario('After one visit, it works offline, background replacement included', async (_, expect) => {
  if (engine === 'webkit') return console.log('      (Playwright’s offline mode can’t reload WebKit: skipped)')
  const context = await browser.newContext({ viewport: { width: 1280, height: 700 }, acceptDownloads: true })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const replaceBackground = async () => {
    await pickSpec(page, /Canada Passport/)
    await upload(page, 'plain-bg.jpg')
    await page.getByRole('button', { name: /Next: Background/ }).click()
    await page.getByRole('radio', { name: 'Replace background' }).click()
    await page.waitForTimeout(300)
    await page.locator('.inline-status').waitFor({ state: 'detached', timeout: 120_000 })
  }
  await page.goto(url)
  await page.waitForFunction(() => self.crossOriginIsolated, null, { timeout: 30_000 })
  await replaceBackground()
  await context.setOffline(true)
  await page.reload()
  await replaceBackground()
  expect((await page.locator('.alert--error').count()) === 0, `offline: ${await page.locator('.alert--error').allInnerTexts()}`)
  await page.getByRole('button', { name: /Next: Check/ }).click()
  await page.getByRole('heading', { name: 'Requirement check' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.status-icon--pending'), null, { timeout: 120_000 })
  await checkToDownload(page)
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: /print sheet/ }).click(),
  ])
  expect(
    download.suggestedFilename() === 'passport-photo-ca-50x70-4x6-print.jpg',
    `offline download saved as ${download.suggestedFilename()}`,
  )
  expect(errors.length === 0, `page errors offline: ${errors.join(' | ')}`)
  await context.close()
})

await scenario('The page can’t send anything to another site', async (page, expect) => {
  await page.evaluate(() => {
    window.__expectViolation = true
    window.__blocked = []
    document.addEventListener('securitypolicyviolation', (e) => window.__blocked.push(e.blockedURI))
  })
  await page.evaluate(() => fetch('https://example.com/').catch(() => {}))
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const img = new Image()
        img.onload = img.onerror = resolve
        img.src = 'https://example.com/pixel.png'
      }),
  )
  await page.waitForTimeout(300)
  const blocked = await page.evaluate(() => window.__blocked)
  expect(blocked.filter((u) => u.startsWith('https://example.com')).length === 2, `blocked by the policy: ${JSON.stringify(blocked)}`)
  await page.evaluate(() => (window.__expectViolation = false))
})

await scenario('A HEIC photo opens, through libheif where the browser can’t decode it', async (page, expect) => {
  let libheif = false
  page.on('request', (r) => r.url().includes('/vendor/libheif/') && (libheif = true))
  // The HEIC is portrait.jpg re-encoded, so both should give about the same fit; the resolution
  // shows it was decoded at full size, and finding the face that it's the right way up.
  const measure = async (file) => {
    await upload(page, file)
    const dpi = parseFloat((await page.locator('li.check', { hasText: 'Print resolution' }).innerText()).match(/(\d+) pixels per inch/)[1])
    return { head: await headSize(page), dpi }
  }
  const heic = await measure('portrait.heic')
  await page.goto(url)
  const jpeg = await measure('portrait.jpg')
  expect(Math.abs(heic.head - jpeg.head) <= 0.05, `head ${heic.head} from the HEIC, ${jpeg.head} from the JPEG`)
  expect(Math.abs(heic.dpi / jpeg.dpi - 1) < 0.03, `${heic.dpi} pixels per inch from the HEIC, ${jpeg.dpi} from the JPEG`)
  // Only Safari's engine decodes HEIC itself.
  if (engine !== 'webkit') expect(libheif, `${engine} can’t decode HEIC, but libheif wasn’t loaded`)
})

await scenario('The photo type, print size and layout are remembered', async (page, expect) => {
  const layout = async () => {
    await upload(page, 'portrait.jpg')
    await toDownload(page)
  }
  await pickSpec(page, /China Visa(?! Upload)/)
  await layout()
  await page.getByRole('radio', { name: /5 × 7 in/ }).click()
  await page.getByRole('radio', { name: 'With margins' }).click()
  await page.getByLabel('Draw thin grey cut lines').uncheck()
  await page.reload()
  expect(await isChecked(page, /China Visa(?! Upload)/), 'photo type not remembered')
  await layout()
  expect(await isChecked(page, /5 × 7 in/), 'print size not remembered')
  expect(await isChecked(page, 'With margins'), 'layout not remembered')
  expect(!(await page.getByLabel('Draw thin grey cut lines').isChecked()), 'cut lines not remembered')
})

await scenario('A ?type= link picks the photo type, and the address follows the choice', async (page, expect) => {
  await page.goto(`${url}?type=in-online`)
  expect(await isChecked(page, /India Passport \(Passport Seva\)/), 'the linked photo type isn’t selected')
  await pickSpec(page, /Canada Visa/)
  expect(new URL(page.url()).searchParams.get('type') === 'ca-visa', `address is ${page.url()}`)
  // An unknown type falls back to the one remembered.
  await page.goto(`${url}?type=nonsense`)
  expect(await isChecked(page, /Canada Visa/), 'an unknown type didn’t fall back to the remembered one')
})

await scenario('A pasted photo is used like a chosen one, but not while one is processing', async (page, expect) => {
  const paste = async (file) => {
    const b64 = readFileSync(join(images, file)).toString('base64')
    await page.evaluate(
      ({ b64, name }) => {
        const dt = new DataTransfer()
        dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: 'image/jpeg' }))
        // Firefox ignores clipboardData given to the ClipboardEvent constructor, so it's attached directly.
        const paste = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(paste, 'clipboardData', { value: dt })
        window.dispatchEvent(paste)
      },
      { b64, name: file },
    )
  }
  let release
  const held = new Promise((resolve) => (release = resolve))
  await page.route('**/models/face_landmarker.task', async (route) => {
    await held
    await route.continue()
  })
  await page.getByTestId('file-input').setInputFiles(join(images, 'portrait.jpg'))
  await page.getByText(/Loading face detection/).waitFor()
  await paste('no-face.jpg')
  release()
  await page.getByRole('heading', { name: 'Crop & position' }).waitFor({ timeout: 120_000 })
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: '← Back' }).click()
  await page.waitForTimeout(300)
  const errors = await page.locator('.alert--error').allInnerTexts()
  expect(errors.length === 0, `the photo pasted while busy was used: ${errors.join(' ')}`)

  await paste('two-people.jpg')
  await page
    .locator('.subject-picker')
    .waitFor({ timeout: 120_000 })
    .catch(() => {})
  expect(await page.locator('.subject-picker').isVisible(), 'pasting a photo did nothing')
})

await scenario('Share offers the same file as the download, where the browser can share files', async (page, expect) => {
  // A browser that can share files, with the share sheet replaced by a recorder.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: async (data) => (window.__shared = data), configurable: true })
  })
  await page.reload()
  await upload(page, 'portrait.jpg')
  await toDownload(page)
  const share = page.getByRole('button', { name: /^Share/ })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.startsWith('Share') && !b.disabled))
  await share.click()
  await page.waitForFunction(() => window.__shared)
  const shared = await page.evaluate(async () => {
    const file = window.__shared.files[0]
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return { name: file.name, type: file.type, sha: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') }
  })
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: /print sheet/ }).click(),
  ])
  const sha = createHash('sha256')
    .update(readFileSync(await download.path()))
    .digest('hex')
  expect(shared.name === download.suggestedFilename() && shared.type === 'image/jpeg', `shared ${shared.name} (${shared.type})`)
  expect(shared.sha === sha, 'the shared file differs from the download')

  // Without file sharing, there's no Share button.
  const plain = await browser.newPage({ serviceWorkers: 'block' })
  await plain.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }))
  await plain.goto(url)
  await upload(plain, 'portrait.jpg')
  await toDownload(plain)
  expect((await plain.getByRole('button', { name: /^Share/ }).count()) === 0, 'a Share button without file sharing')
  await plain.close()
})

await scenario('Without WebGL, the page says face detection needs it', async (page, expect) => {
  await page.addInitScript(() => {
    for (const Canvas of [HTMLCanvasElement, OffscreenCanvas]) {
      const getContext = Canvas.prototype.getContext
      Canvas.prototype.getContext = function (type, ...rest) {
        return /webgl/.test(type) ? null : getContext.call(this, type, ...rest)
      }
    }
  })
  await page.goto(url)
  await page.getByTestId('file-input').setInputFiles(join(images, 'portrait.jpg'))
  const alert = page.locator('.alert--error')
  await alert.waitFor({ timeout: 60_000 }).catch(() => {})
  const text = (await alert.count()) ? await alert.innerText() : ''
  expect(text.includes('Face detection needs WebGL'), `the page showed: ${text || 'nothing'}`)
})

await scenario('MediaPipe’s usage statistics aren’t sent to Google', async (page, expect) => {
  // MediaPipe sends them every minute; the clock is moved on rather than waiting.
  const sent = []
  page.on('request', (r) => r.url().includes('googleapis.com') && sent.push(r.url()))
  await page.clock.install()
  await page.goto(url)
  await upload(page, 'portrait.jpg')
  await page.clock.fastForward('02:00')
  await page.waitForTimeout(1000)
  expect(sent.length === 0, `sent: ${sent.join(', ')}`)
})

await browser.close()
const failed = results.filter((r) => r.fails.length)
console.log(`\n${results.length - failed.length} of ${results.length} scenarios passed`)
process.exit(failed.length || !results.length ? 1 : 0)
