/** Set just before the first-visit reload (see below), so a tab never reloads twice for it, whatever the browser does. */
const ISOLATION_RELOAD = 'passport-photo:isolation-reload'

function reloadedBefore(): boolean {
  try {
    if (sessionStorage.getItem(ISOLATION_RELOAD)) return true
    sessionStorage.setItem(ISOLATION_RELOAD, '1')
  } catch {
    // Storage blocked: it still reloads at most once per page.
  }
  return false
}

/**
 * Registers the service worker (see src/service-worker.js) in the built site. It keeps the
 * site working offline and makes the page cross-origin isolated, which lets ONNX Runtime
 * use several threads. Only pages it controls are isolated, so on a first visit the page
 * reloads once as soon as it takes control, if `canReload()` says nothing would be lost.
 */
export function registerServiceWorker(canReload: () => boolean): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const controlled = !!navigator.serviceWorker.controller
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => console.warn('Service worker not registered', err))
  // Already controlled: isolated now, or this browser can't be isolated this way (so a reload wouldn't help).
  if (controlled || crossOriginIsolated) return
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => {
      if (!crossOriginIsolated && canReload() && !reloadedBefore()) location.reload()
    },
    { once: true },
  )
}
