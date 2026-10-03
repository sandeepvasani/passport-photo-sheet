/** Shared ONNX Runtime Web setup for the models run in the browser. */
import type { InferenceSession } from 'onnxruntime-web'

type Ort = typeof import('onnxruntime-web')

let ortPromise: Promise<Ort> | null = null

/** URL of a file in public/, respecting the site's base path. */
export function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).href
}

function loadOrt(): Promise<Ort> {
  ortPromise ??= (async () => {
    // The wasm binary is emitted and served by Vite alongside this chunk.
    const ort = await import('onnxruntime-web/wasm')
    // Multi-threading needs cross-origin isolation; fall back to one thread otherwise.
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1
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
