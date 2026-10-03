import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * The built site may only load its own files, so the browser enforces "no third-party
 * requests". 'wasm-unsafe-eval' lets it compile the WebAssembly runtimes (MediaPipe, ONNX
 * Runtime, libheif); blob: covers decoding a photo through <img> when createImageBitmap can't.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    // The dev server needs inline scripts and a websocket.
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  }
}

/** Every file under `dir`, recursively. */
function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesIn(join(dir, e.name)) : [join(dir, e.name)]))
}

/**
 * Writes sw.js from src/service-worker.js with this build's app files (cached on install)
 * and a version of the models and runtimes in public/ (cached when first used), so each
 * deploy replaces exactly what changed.
 */
function serviceWorker(): Plugin {
  let root = ''
  let publicDir = ''
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root
      publicDir = config.publicDir
    },
    generateBundle(_, bundle) {
      const shell = ['./', 'favicon.svg', ...Object.keys(bundle).filter((f) => f.startsWith('assets/'))].sort()
      const files = createHash('sha256')
      for (const dir of ['models', 'mediapipe', 'vendor']) {
        for (const f of filesIn(join(publicDir, dir)).sort()) files.update(relative(publicDir, f)).update(readFileSync(f))
      }
      const build = {
        version: createHash('sha256').update(shell.join()).digest('hex').slice(0, 12),
        filesVersion: files.digest('hex').slice(0, 12),
        shell,
      }
      const source = readFileSync(join(root, 'src/service-worker.js'), 'utf8').replace('__BUILD__', JSON.stringify(build))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), contentSecurityPolicy(), serviceWorker()],
  // Relative asset URLs so the static build works from any path (e.g. GitHub Pages).
  base: './',
})
