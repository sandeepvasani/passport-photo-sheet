# Passport Photo Sheet

Make passport photos in the browser and print them cheaply at any photo lab. You upload a photo, the app crops it to the official size and can fix the background, and checks the result against the photo rules. Once it passes (or you've reviewed what doesn't), it tiles copies onto a standard photo print (4 × 6 in or 10 × 15 cm by default) for you to download. You order the print from a pharmacy, supermarket photo counter or online print service, and cut the individual photos out at home.

Everything runs on the user's device. Photos are never uploaded, and there are no analytics or third-party requests: a Content-Security-Policy makes the browser block any request to another site, and the usage statistics MediaPipe would otherwise send to Google every minute are refused before they're sent. After the first visit it also works offline.

## Features

- **Photo types:** US passport and visa (2×2 in); India visa and OCI (2×2 in) and the India passport upload for the Passport Seva portal (630×810 px); 35×45 mm (UK, EU/Schengen, Australia and others); Canada passport (50×70 mm) and visa (35×45 mm); China visa, printed (33×48 mm) and as an upload (420×560 px). Each type is defined as data in [`src/config/photoSpecs.ts`](src/config/photoSpecs.ts).
- **Opening photos:** choose, drop or paste (Ctrl+V or ⌘V) a JPEG, PNG, WebP or HEIC photo, or take one on a phone. Browsers that can't open HEIC themselves (all but Safari) use [libheif](https://github.com/strukturag/libheif) (LGPL-3.0) through [libheif-js](https://github.com/catdad-experiments/libheif-js), loaded only when needed.
- **Automatic face detection:** MediaPipe Face Landmarker finds the pupils and chin. MediaPipe's multiclass selfie segmenter finds the top of the hair.
- **Automatic crop:** levels the eyes, centres the face, and picks a head size and eye height inside the official ranges. Where the rules give a face width instead (China's upload), it sizes the head to that, using the person's own face proportions.
- **Crop editor:** drag to move, pinch or scroll to zoom, rotate, and drag markers to correct the top-of-head, chin and eye positions. With a keyboard, the arrow keys move the photo, + and − zoom, and M picks a marker to move with the arrow keys. Measurements update live against the spec.
- **Background:** the original background is kept by default and checked for being plain, light and even. You can optionally replace it. Replacement uses [MODNet](https://github.com/ZHKKKe/MODNet) portrait matting (Apache-2.0) through ONNX Runtime Web, which keeps fine hair strands, and edge colours are corrected so hair doesn't keep a halo of the old background. **Replaced photos get a prominent warning.** The US State Department explicitly rejects digitally edited photos, including replaced backgrounds, and checks for AI edits. Most other countries also require unedited photos.
- **Print sizes:** inch sizes (4×4, 4×5.3, 4×6, 5×7, 6×8, 8×8, 8×10) for North America and metric sizes (10×15, 13×18, 15×20, 20×30 cm) for most other countries. Each photo type starts on the print size its applicants can usually order locally. Photos are rotated when that fits more on the sheet. Choose edge-to-edge (most photos) or safe margins, with optional cut lines. When there's room, a scale bar is printed so you can confirm the print came out at 100%.
- **Requirement check:** comes before the print layout and download, which stay locked until it's done. Failed checks block the download unless the user confirms they want it anyway; warnings need to be acknowledged. Problems that need a new photo rather than a different crop (another person in the frame, hair cut off at the top, closed eyes, expression, gaze, glasses, a turned head, shadows) already show on the Crop step, straight after upload.
  - Measured: face count, head size, face width, eye height, space above the head, centring, tilt, head turn, eyes open, expression, looking at the camera, glasses, glare on glasses, tinted lenses, background, exposure, lighting across the face (beards and stubble are left out), natural skin tones, red eye, colour, focus, clothing colour (India), and print and upload resolution.
  - Expression: the face mesh catches smiles where they aren't allowed, parted lips and pouting. Frowns, raised eyebrows, a sad, tense or lopsided face come from [FER+](https://github.com/onnx/models/tree/main/validated/vision/body_analysis/emotion_ferplus) (MIT), an expression classifier run through ONNX Runtime Web; its int8 build gives the same results as fp32 at half the size.
  - Glasses are detected by combining the segmenter's accessory class around the eyes with the straight edges that frames make. They fail for the US, get a warning for 35×45 mm, and are allowed for India and Canada, where glare and tinted lenses are checked instead.
  - Confirmed by the user, since they can't be measured: glasses, recency, headwear, devices and filters.
- **Exports:** JPEG with 300 DPI metadata, sized exactly to the print, plus a single digital photo. Types meant for online forms produce an upload file at the exact pixel size, at the highest JPEG quality within the form's file-size limits. Where the browser can share files (phones, mostly), **Share…** sends the same file to the system share sheet, to save it to Photos or send it to a print app.
- **Remembered settings and links:** the photo type, print size, layout and cut lines are remembered on the device (never the photo). `?type=` in the address picks a photo type, so a link can go straight to one: `us-2x2`, `in-2x2`, `in-online`, `intl-35x45`, `ca-50x70`, `ca-visa`, `cn-visa`, `cn-visa-upload`.

## Development

```bash
npm install
npm run dev        # copies the wasm runtimes and downloads the models into public/, then starts Vite
npm test           # unit tests (geometry, layout, checks, matting, JPEG files)
npm run lint       # oxlint
npm run format     # Prettier (CI checks it with npm run format:check)
npm run build      # type-check and build static files to dist/
```

`npm run setup` (also run automatically before `dev` and `build`) copies the MediaPipe wasm runtime from `node_modules` into `public/mediapipe/`, and ONNX Runtime and libheif, unmodified, into `public/vendor/` (libheif with its licence and source notice). It downloads the face landmarker, segmentation, MODNet and FER+ models (about 52 MB) into `public/models/`. Each model is a fixed version whose SHA-256 is checked, so every build ships the same files; a missing, incomplete or changed file is downloaded again. To update a model, change its URL and hash in [`scripts/setup-assets.mjs`](scripts/setup-assets.mjs). These folders are generated and git-ignored. If Node can't download through a TLS-inspecting proxy, the script falls back to `curl`.

### End-to-end check

```bash
npm run build && npx vite preview --port 4173 &
npm run e2e -- test-images/portrait.jpg us-2x2 "4 × 6"
```

`scripts/inspect-matte.mjs` renders the original, result and masks side by side, for checking hair edges against the dev server.

This drives the whole flow in Chrome through Playwright. It saves screenshots and the downloaded files to `e2e-output/`, and exits with an error if the page reported any. Set `REPLACE_BG=1` to force background replacement, and `MOBILE=1` to use a phone viewport. The test images in `test-images/` are public-domain US government portraits (White House and NASA). [`scripts/make-fixtures.mjs`](scripts/make-fixtures.mjs) generates the plain-background and no-face variants. [`scripts/make-glasses-fixtures.mjs`](scripts/make-glasses-fixtures.mjs) adds a lens reflection and tinted lenses to `glasses-thick.jpg`. [`scripts/make-selfie-fixtures.mjs`](scripts/make-selfie-fixtures.mjs) generates a close-up selfie and a copy stored sideways with EXIF orientation, as phones do. [`scripts/make-group-fixture.mjs`](scripts/make-group-fixture.mjs) puts four people in one photo (`group.jpg`). `portrait.heic` is `portrait.jpg` converted with macOS's `sips -s format heic`. Set `ENGINE=webkit` to run in Safari's engine or `ENGINE=firefox` for Firefox's; install them once with `npx playwright install webkit firefox`. (Playwright's Firefox 155 doesn't start on macOS 27, so CI runs the Firefox scenarios on Linux. Headless Firefox has no WebGL, so there it runs headed in a virtual display: `ENGINE=firefox HEADED=1 xvfb-run -a npm run e2e:scenarios`.)

`npm run e2e:scenarios` runs scenarios that the walkthrough doesn't reach, against the same preview server. They cover a download the browser can't encode, a background model that won't load, running out of canvas memory while switching person, the Fix buttons, the Download step staying locked until the check is done, retake problems shown on the Crop step, drag and drop (including files dropped outside the drop box), moving markers with the keyboard and by touch, focus on each new step, status names for screen readers, reduced motion, Data Saver, group photos, preview memory, wording that follows the settings, the page staying responsive while it works, the service worker (the first-visit reload, multi-threading and offline use), the Content-Security-Policy, HEIC photos, remembered settings and `?type=` links, pasting and sharing, and MediaPipe's usage statistics not being sent. A failed scenario also reports what the page showed and logged. Add words after `--` to run only the scenarios whose names contain them. It exits with an error if any scenario fails.

## Deploying

`dist/` is a plain static site with relative paths, so it works from any host or sub-path. Serve it over HTTPS. The first photo downloads about 30 MB of face-detection model and wasm files. The expression model (19 MB, plus ONNX Runtime) then downloads in the background while the photo is cropped, unless the browser is set to save data; without it, the other checks still run. Replacing a background downloads the 13 MB MODNet model the first time. The hair matting and expression models run in ONNX Runtime's own worker and the edge refinement in another, so the page stays responsive.

A service worker ([`src/service-worker.js`](src/service-worker.js), written to `sw.js` at build time with the build's file list) caches the app when it installs, and the models and runtimes the first time they're used, so the site works offline afterwards; each deploy replaces only what changed. It also adds the cross-origin isolation headers (COOP and COEP) that GitHub Pages can't send, which let ONNX Runtime use several threads. They only apply to pages it controls, so a first visit reloads once, straight away, unless a photo has already been chosen.

The repo deploys to GitHub Pages automatically: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) lints, checks formatting, runs the unit tests, builds (downloading the models) and runs the browser scenarios in Chrome and Firefox on every pull request and push, and publishes `dist/` on every push to `main`. To use it in a fork, set **Settings → Pages → Source** to **GitHub Actions**.

## Adding a country

Append a `PhotoSpec` to `PHOTO_SPECS` in [`src/config/photoSpecs.ts`](src/config/photoSpecs.ts) with:

- photo width and height
- head-height range
- either an eye-height range (enforced) or a top-margin guideline (warning only, unless marked required)
- optionally a face-width range, and upload rules (pixel size, file-size limits) for online forms
- background colours, glasses and expression rules
- the items the user must confirm

The auto-fit, editor guides, checks and sheet layout all adapt automatically.

## Project layout

```
src/
  config/      photo specs and print sizes (data only)
  lib/
    geometry.ts  crop model, measurements, auto-fit
    vision.ts    MediaPipe loading, face landmarks, segmentation, crown detection, head pose
    matte.ts     MODNet portrait matting (loaded only for background replacement)
    expression.ts  FER+ facial-expression scores (loaded in the background)
    onnx.ts      shared ONNX Runtime Web loader (models run in its worker)
    mask.ts      mask layers shared by segmentation and matting
    matting.ts   guided filter, background replacement, stray-blob removal
    render.ts    renders the finished photo at print resolution (edge refinement in refine.worker.ts)
    layout.ts    packs photos onto a print sheet
    sheet.ts     draws the sheet with cut guides and scale bar
    checks.ts    compliance checks
    image.ts     file decoding (HEIC through libheif), JPEG DPI metadata, downloads
    serviceWorker.ts  registers the service worker
  components/  one component per wizard step
  service-worker.js  offline cache and cross-origin isolation (built into sw.js)
  settings.ts  remembered settings and ?type= links
  steps.ts     which step fixes each check, and what's left before download
```

## Caveats

- The automatic checks catch common problems but can't guarantee a photo will be accepted. Always check the current rules with the issuing authority.
- The US State Department asks for the original, unedited photo and lists a digitally replaced background as unacceptable. For a US passport, the reliable path is a photo taken against a plain white wall or sheet, with the original background kept.
- The US eye-height range (1⅛–1⅜ in) isn't on the current State Department page, so it's only a positioning guideline here. Head size (1–1⅜ in) is enforced.
- India's VFS sheet gives the eye height as "1⅛ to 1⅓ in", which is probably a typo for 1⅜. The app enforces 1⅛–1⅓ in, which satisfies both readings. India also requires plain, coloured (non-white) clothing; the app warns when clothing looks white but can't detect patterns.
- Face detection needs WebGL: MediaPipe passes the photo to its models through it, even on the CPU. Browsers with WebGL turned off (some privacy-hardened setups) get a message saying so.
- MODNet can misjudge dark areas inside clothing, such as a collar opening, as background. Check the result before printing.
- Canadian paper applications need a photographer's stamp on the back of one photo.
- Edge-to-edge layouts depend on the printer not trimming the paper edges. Use "With margins" if that is a concern.
