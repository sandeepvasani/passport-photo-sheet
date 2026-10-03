// Copies the MediaPipe and ONNX Runtime wasm runtimes and downloads the ML models
// into public/ so the site is fully self-hosted (no third-party requests at runtime).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const wasmDest = join(root, 'public/mediapipe/wasm')
const vendorDest = join(root, 'public/vendor')
const modelsDest = join(root, 'public/models')

// Each URL names a fixed version, and the SHA-256 is checked, so every build ships the
// same models. To update one, change both.
const MODELS = [
  {
    file: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  },
  {
    file: 'selfie_multiclass_256x256.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite',
    sha256: 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0',
  },
  {
    // MODNet portrait matting (Apache-2.0), used for background replacement.
    // fp16 matches fp32 quality at half the size; the int8 build leaves background blotches.
    file: 'modnet_fp16.onnx',
    url: 'https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model_fp16.onnx',
    sha256: '25f165da9bfd30830a575f1f0490f1acd995975cb349bc02f3d79332e1fe5cf6',
  },
  {
    // FER+ facial-expression classifier (MIT, ONNX Model Zoo); int8 gives the same
    // results as fp32 at half the size.
    file: 'emotion-ferplus-12-int8.onnx',
    url: 'https://github.com/onnx/models/raw/4c46cd00fbdb7cd30b6c1c17ab54f2e1f4f7b177/validated/vision/body_analysis/emotion_ferplus/model/emotion-ferplus-12-int8.onnx',
    sha256: '3e47195d79e9593294df9e81a6d296a1e10969b68a717284081c29493a0ff5f1',
  },
]

/** SHA-256 of a file, or null if it doesn't exist. */
async function hashOf(path) {
  try {
    return createHash('sha256')
      .update(await readFile(path))
      .digest('hex')
  } catch {
    return null
  }
}

await mkdir(wasmDest, { recursive: true })
for (const name of await readdir(wasmSrc)) {
  // The ES-module variant is only used with FilesetResolver's useModule option.
  if (name.includes('_module_')) continue
  await copyFile(join(wasmSrc, name), join(wasmDest, name))
}

// ONNX Runtime is served as its own prebuilt files rather than bundled: it runs the
// models in a worker started from the same file, which mustn't import the app's bundle.
await mkdir(join(vendorDest, 'onnxruntime'), { recursive: true })
for (const name of ['ort.wasm.bundle.min.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(join(root, 'node_modules/onnxruntime-web/dist', name), join(vendorDest, 'onnxruntime', name))
}

// libheif (LGPL-3.0) decodes HEIC photos in browsers that can't. It's served unmodified as
// its own file, with its licence and where to get the source, as the LGPL asks.
const libheifSrc = join(root, 'node_modules/libheif-js')
const libheifDest = join(vendorDest, 'libheif')
const { version: libheifVersion } = JSON.parse(await readFile(join(libheifSrc, 'package.json'), 'utf8'))
await mkdir(libheifDest, { recursive: true })
await copyFile(join(libheifSrc, 'libheif-wasm/libheif-bundle.mjs'), join(libheifDest, 'libheif-bundle.mjs'))
await copyFile(join(libheifSrc, 'libheif-wasm/LICENSE'), join(libheifDest, 'LICENSE.txt'))
await writeFile(
  join(libheifDest, 'NOTICE.txt'),
  `libheif-bundle.mjs is libheif-js ${libheifVersion}, an unmodified Emscripten build of libheif:\n` +
    `  https://github.com/catdad-experiments/libheif-js/tree/${libheifVersion}\n` +
    '  https://github.com/strukturag/libheif\n' +
    'libheif is distributed under the GNU Lesser General Public License, version 3: see LICENSE.txt.\n' +
    'You may replace this file with another build of libheif-js.\n',
)

await mkdir(modelsDest, { recursive: true })
for (const { file, url, sha256 } of MODELS) {
  const dest = join(modelsDest, file)
  // Downloads go to a .part file first, so an interrupted one is never mistaken for the model.
  const part = `${dest}.part`
  await rm(part, { force: true })
  // Checking the hash also replaces a file that was cut short or has changed.
  if ((await hashOf(dest)) === sha256) continue
  console.log(`Downloading ${file}…`)
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await writeFile(part, new Uint8Array(await res.arrayBuffer()))
  } catch (err) {
    // Node doesn't use the OS certificate store; curl does (helps behind TLS-inspecting proxies).
    console.log(`  fetch failed (${err.cause?.code ?? err.message}), retrying with curl`)
    execFileSync('curl', ['-fsSL', '-o', part, url], { stdio: 'inherit' })
  }
  const actual = await hashOf(part)
  if (actual !== sha256) {
    await rm(part, { force: true })
    throw new Error(
      `${file} from ${url} has SHA-256 ${actual}, expected ${sha256}. The download may be incomplete, or the file has changed.`,
    )
  }
  await rename(part, dest)
}
console.log('Assets ready.')
