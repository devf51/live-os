import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (e) => {
  const { title, body, url } = e.data?.json() as { title: string; body: string; url?: string }
  e.waitUntil(self.registration.showNotification(title, { body, data: { url } }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data as { url?: string } | null)?.url ?? '/'
  e.waitUntil(self.clients.openWindow(url))
})
