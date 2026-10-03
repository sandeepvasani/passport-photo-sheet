// The service worker, written to sw.js by vite.config.ts with this build's file list. It:
// - keeps the site working offline: the app files are cached when it installs, and the
//   models and wasm runtimes the first time they're used;
// - adds the headers that make the page cross-origin isolated (COOP and COEP), which ONNX
//   Runtime needs to run on several threads. GitHub Pages can't send headers of its own.
// Only pages it controls get the headers, so the app reloads once on a first visit (see
// src/lib/serviceWorker.ts).

/** { version, filesVersion, shell }: filled in at build time. */
const BUILD = __BUILD__

/** The app's own files, cached on install and replaced by every new build. */
const SHELL = `shell-${BUILD.version}`
/** Models and runtimes, cached when first used; replaced when any of them changes. */
const FILES = `files-${BUILD.filesVersion}`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(BUILD.shell))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL && key !== FILES).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return
  event.respondWith(request.mode === 'navigate' ? page(request) : file(request))
})

/** The page: from the network first, so a new version shows straight away; the cached copy when offline. */
async function page(request) {
  const cache = await caches.open(SHELL)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(self.registration.scope, response.clone())
    return isolated(response)
  } catch (err) {
    const cached = await cache.match(self.registration.scope, { ignoreVary: true })
    if (cached) return isolated(cached)
    throw err
  }
}

/**
 * Everything else: the cache first, then the network. The app's file names change with
 * their content, and the models and runtimes are versioned by FILES.
 */
async function file(request) {
  // Vary is ignored: these are static files, and a CORS request (the app's module script) would otherwise miss.
  const cached = await caches.match(request, { ignoreVary: true })
  if (cached) return isolated(cached)
  const response = await fetch(request)
  // App files from another build (an old tab) aren't kept: they'd pile up.
  if (response.status === 200 && !new URL(request.url).pathname.includes('/assets/')) {
    const cache = await caches.open(FILES)
    await cache.put(request, response.clone())
  }
  return isolated(response)
}

/** The response with the headers that turn on cross-origin isolation. */
function isolated(response) {
  if (response.status === 0) return response
  const headers = new Headers(response.headers)
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
