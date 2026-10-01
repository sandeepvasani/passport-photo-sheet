// Copies the MediaPipe wasm runtime and downloads the ML models into public/ so
// the site is fully self-hosted (no third-party requests at runtime). The ONNX
// Runtime wasm is bundled by Vite itself.
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const wasmDest = join(root, 'public/mediapipe/wasm')
const modelsDest = join(root, 'public/models')

const MODELS = [
  {
    file: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  },
  {
    file: 'selfie_multiclass_256x256.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
  },
  {
    // MODNet portrait matting (Apache-2.0), used for background replacement.
    // fp16 matches fp32 quality at half the size; the int8 build leaves background blotches.
    file: 'modnet_fp16.onnx',
    url: 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model_fp16.onnx',
  },
]

async function exists(path) {
  try {
    return (await stat(path)).size > 0
  } catch {
    return false
  }
}

await mkdir(wasmDest, { recursive: true })
for (const name of await readdir(wasmSrc)) {
  // The ES-module variant is only used with FilesetResolver's useModule option.
  if (name.includes('_module_')) continue
  await copyFile(join(wasmSrc, name), join(wasmDest, name))
}

await mkdir(modelsDest, { recursive: true })
for (const { file, url } of MODELS) {
  const dest = join(modelsDest, file)
  if (await exists(dest)) continue
  console.log(`Downloading ${file}…`)
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await writeFile(dest, new Uint8Array(await res.arrayBuffer()))
  } catch (err) {
    // Node doesn't use the OS certificate store; curl does (helps behind TLS-inspecting proxies).
    console.log(`  fetch failed (${err.cause?.code ?? err.message}), retrying with curl`)
    execFileSync('curl', ['-fsSL', '-o', dest, url], { stdio: 'inherit' })
  }
}
console.log('Assets ready.')
