/** Shared ONNX Runtime Web setup for the models run in the browser. */
import type { InferenceSession } from 'onnxruntime-web'
import { assetUrl } from './assets'

type Ort = typeof import('onnxruntime-web')

let ortPromise: Promise<Ort> | null = null

function loadOrt(): Promise<Ort> {
  ortPromise ??= (async () => {
    // ONNX Runtime's prebuilt file (copied to public/ by scripts/setup-assets.mjs), not bundled:
    // its worker starts from this same file, and it finds its wasm binary next to it.
    const ort: Ort = await import(/* @vite-ignore */ assetUrl('vendor/onnxruntime/ort.wasm.bundle.min.mjs'))
    // Multi-threading needs cross-origin isolation; fall back to one thread otherwise.
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1
    // Run the models in ONNX Runtime's own worker, so the page stays responsive while they work.
    ort.env.wasm.proxy = true
    return ort
  })()
  return ortPromise
}

/**
 * Loads a model from public/models once. A failed load (say, offline) is forgotten
 * so a later call can retry.
 */
export function modelLoader(file: string): () => Promise<{ session: InferenceSession; ort: Ort }> {
  let promise: Promise<{ session: InferenceSession; ort: Ort }> | null = null
  return () => {
    if (!promise) {
      promise = (async () => {
        const ort = await loadOrt()
        const session = await ort.InferenceSession.create(assetUrl(`models/${file}`), {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        })
        return { session, ort }
      })()
      promise.catch(() => (promise = null))
    }
    return promise
  }
}
