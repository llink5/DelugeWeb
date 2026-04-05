/*
 * Cross-Origin Isolation service worker.
 *
 * GitHub Pages and most static hosts don't serve the COOP/COEP headers
 * required for SharedArrayBuffer. This worker intercepts every fetch and
 * adds the necessary headers to responses so the page becomes cross-origin
 * isolated. After the first load the worker auto-registers and reloads the
 * page once so the headers apply.
 *
 * Approach cloned from gzuidhof/coi-serviceworker (MIT licensed).
 */

let coepCredentialless = false

if (typeof window !== 'undefined') {
  if (
    !window.crossOriginIsolated &&
    !window.sessionStorage.getItem('coiReloadedBySelf')
  ) {
    window.sessionStorage.setItem('coiReloadedBySelf', '1')
    navigator.serviceWorker
      .register(window.document.currentScript.src)
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          window.sessionStorage.removeItem('coiReloadedBySelf')
          window.location.reload()
        })
        if (registration.active && !navigator.serviceWorker.controller) {
          window.sessionStorage.removeItem('coiReloadedBySelf')
          window.location.reload()
        }
      })
      .catch((e) => console.error('COI SW registration failed:', e))
  } else {
    window.sessionStorage.removeItem('coiReloadedBySelf')
  }
} else {
  self.addEventListener('install', () => self.skipWaiting())
  self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim())
  })
  self.addEventListener('fetch', (event) => {
    const request = event.request
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
      return
    }
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 0) return response
          const headers = new Headers(response.headers)
          headers.set('Cross-Origin-Opener-Policy', 'same-origin')
          headers.set(
            'Cross-Origin-Embedder-Policy',
            coepCredentialless ? 'credentialless' : 'require-corp',
          )
          headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          })
        })
        .catch((e) => console.error('COI SW fetch error:', e)),
    )
  })
}
