import { precacheAndRoute } from 'workbox-precaching'
import { parsePushPayload, resolveClickUrl } from './sw-logic'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (e) => {
  const { title, body, url } = parsePushPayload(e.data)
  e.waitUntil(self.registration.showNotification(title, { body, data: { url } }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = resolveClickUrl(String((e.notification.data as { url?: unknown } | null)?.url ?? '/'), self.location.origin)
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (all) => {
      const w = all.find((c) => new URL(c.url).origin === self.location.origin)
      if (w) return (await w.focus()).navigate(url)
      return self.clients.openWindow(url)
    }),
  )
})
